"""Design/fixture consistency checks, not a source normalizer or a database test."""

from copy import deepcopy
from decimal import Decimal
import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from lmps_ml.contracts import SCHEMA_VERSION, Transaction

ROOT = Path(__file__).resolve().parents[3]
MAPPING = json.loads((ROOT / "docs/data-dictionary/source-mapping.json").read_text())
INVENTORY = json.loads((ROOT / "docs/data-dictionary/lmps-schema/metadata.json").read_text())
CORPUS = json.loads((ROOT / "packages/contracts/fixtures/source-mapping.json").read_text())


@pytest.mark.parametrize("name", MAPPING["source_tables"])
def test_candidate_columns_and_complete_keys_match_observed_ddl(name):
    declared = next(table for table in INVENTORY["tables"] if table["name"] == name)
    proposed = MAPPING["source_tables"][name]
    for column in proposed["column_candidates"]:
        observed = next(item for item in declared["columns"] if item["name"] == column["name"])
        assert column == {key: observed[key] for key in column}
    for kind, key in (("primary", "primary_key"), ("unique", "unique_keys")):
        expected = [[column["name"] for column in index["columns"]] for index in declared["indexes"] if index["kind"] == kind]
        assert proposed[key] == (expected[0] if kind == "primary" else expected)
    assert proposed["source_line"] == declared["source_line"]


def test_mapping_covers_current_wire_fields_and_references_real_candidates():
    assert (ROOT / "docs/data-dictionary" / MAPPING["evidence_ref"]).resolve() == ROOT / "docs/data-dictionary/lmps-schema/metadata.json"
    assert MAPPING["canonical_schema_version"] == SCHEMA_VERSION
    assert set(MAPPING["canonical_fields"]) == set(Transaction.model_json_schema()["properties"])
    assert CORPUS["mapping_design_version"] == MAPPING["design_version"]
    for field in MAPPING["canonical_fields"].values():
        assert set(field["gate_ids"]) <= MAPPING["gates"].keys()
        for ref in field["source_candidates"]:
            columns = MAPPING["source_tables"][ref["table"]]["column_candidates"]
            assert ref["column"] in {column["name"] for column in columns}


def test_draft_does_not_enable_capture_or_claim_business_identity():
    assert MAPPING["status"] == "DRAFT_FOR_REVIEW"
    assert all(table["capture_enabled"] is False for table in MAPPING["source_tables"].values())
    assert all(gate["status"] == "UNVERIFIED" for gate in MAPPING["gates"].values())
    assert MAPPING["identity_layers"]["business_transaction"]["candidate_components"] is None
    assert MAPPING["identity_layers"]["source_record"]["verified_business_identity"] is False
    assert MAPPING["identity_layers"]["capture_event"]["format_selected"] is False
    assert CORPUS["synthetic_only"] is True
    assert CORPUS["production_mapping_approved"] is False


def test_missing_required_semantics_hold_canonical_emission_instead_of_filling_values():
    for name in ("transaction_id", "transaction_revision", "source_reference", "observed_at", "amount", "currency"):
        assert MAPPING["canonical_fields"][name]["unresolved_behavior"] == "hold_canonical_emission"
    assert MAPPING["canonical_fields"]["occurred_at"]["unresolved_behavior"] == "null"
    assert MAPPING["canonical_fields"]["transaction_status"]["unresolved_behavior"] == "unknown"
    for name in ("sender", "receiver"):
        assert MAPPING["canonical_fields"][name]["unresolved_behavior"] == "unresolved_account"


@pytest.mark.parametrize("case", CORPUS["cases"], ids=lambda case: case["id"])
def test_source_design_examples_against_existing_wire_contract(case):
    source = deepcopy(CORPUS["source_example"])
    source.update(case["source_set"])
    candidate = deepcopy(CORPUS["canonical_example"])
    candidate.update(case["canonical_set"])
    before = deepcopy(candidate)
    if not case["wire_valid"]:
        with pytest.raises(ValidationError):
            Transaction.model_validate_json(json.dumps(candidate))
        return
    parsed = Transaction.model_validate_json(json.dumps(candidate))
    assert json.loads(parsed.model_dump_json()) == before
    assert candidate["execution_mode"] == "test"
    assert candidate["source_reference"]["mapping_version"] is None
    assert candidate["amount"] == source["amount"]
    assert Decimal(candidate["amount"]) == Decimal(source["amount"])
    assert candidate["occurred_at"] is None
    assert candidate["transaction_status"] == "unknown"
    assert candidate["source_bank_id"] is candidate["destination_bank_id"] is None
    assert source["frommember"] == "0001" and source["tomember"] == "0002"
    assert type(source["id"]) is int
    assert candidate["transaction_id"] != source["id"]
    assert candidate["source_reference"]["record_ref"] != source["reference"]
    for role in ("sender", "receiver"):
        assert candidate[role]["status"] == "unresolved"
        assert candidate[role]["source_representation"] == "unknown"
    assert set(candidate).isdisjoint(MAPPING["raw_fields_not_allowed_in_shared_wire"])


@pytest.mark.parametrize("case", CORPUS["money_boundaries"], ids=lambda case: case["value"])
def test_decimal_24_2_candidates_require_no_rounding_or_float(case):
    # This is an exact fixture oracle, not permission to round/rewrite source money.
    value = Decimal(case["value"])
    fits = value.is_finite() and abs(value) < Decimal("10000000000000000000000") and value.as_tuple().exponent >= -2
    assert fits is case["fits_declared_decimal"]
    if case["value"].startswith("-"):
        candidate = dict(CORPUS["canonical_example"], amount=case["value"])
        with pytest.raises(ValidationError):
            Transaction.model_validate_json(json.dumps(candidate))
    # Wider/overscaled values can be wire-valid but cannot pass source numeric gates.
    elif not fits:
        Transaction.model_validate_json(json.dumps(dict(CORPUS["canonical_example"], amount=case["value"])))


@pytest.mark.parametrize("case", CORPUS["identity_examples"], ids=lambda case: case["id"])
def test_complete_source_key_counterexamples_do_not_resolve_business_identity(case):
    scoped_keys = []
    for side in ("left", "right"):
        table = case[side + "_table"]
        keys = case[side + "_key"]
        assert set(keys) == set(MAPPING["source_tables"][table]["primary_key"])
        scoped_keys.append((table, tuple((column, keys[column]) for column in MAPPING["source_tables"][table]["primary_key"])))
    assert (scoped_keys[0] == scoped_keys[1]) is case["same_scoped_source_key"]
    assert case["business_relation"] == "UNVERIFIED"
    if "shared_reference" in case:
        table = MAPPING["source_tables"][case["left_table"]]
        assert case["left_table"] == case["right_table"]
        assert table["unique_keys"] == [["reference", "requesttime"]]
        rows = [dict(case[side + "_key"], reference=case["shared_reference"]) for side in ("left", "right")]
        assert rows[0]["reference"] == rows[1]["reference"]
        assert tuple(rows[0][column] for column in table["unique_keys"][0]) != tuple(rows[1][column] for column in table["unique_keys"][0])


def test_reference_width_and_history_channel_gap_are_explicit():
    tables = MAPPING["source_tables"]
    reference = next(column for column in tables["transfer"]["column_candidates"] if column["name"] == "reference")
    wire = Transaction.model_json_schema()
    assert reference["numeric_parameters"] == [200]
    assert wire["$defs"]["SourceReference"]["properties"]["record_ref"]["maxLength"] == 128
    assert {ref["table"] for ref in MAPPING["canonical_fields"]["channel"]["source_candidates"]} == {"transfer"}
    assert tables["member"]["primary_key"] == ["code"]
    assert tables["member"]["unique_keys"] == []
