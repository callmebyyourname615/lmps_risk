from copy import deepcopy
import json

import pytest
from pydantic import ValidationError

from lmps_ml.contracts import CONTRACTS, Transaction
from lmps_ml.export_contracts import SCHEMA_DIRECTORY, schemas

CORPUS = json.loads((SCHEMA_DIRECTORY.parent / "fixtures/corpus.json").read_text())


@pytest.mark.parametrize("case", CORPUS["cases"], ids=lambda case: case["id"])
def test_shared_wire_examples(case):
    assert CORPUS["synthetic_only"] is True
    payload = deepcopy(CORPUS["examples"][case["contract"]])
    payload.update(case["set"])
    for field in case["omit"]:
        del payload[field]
    try:
        model = CONTRACTS[case["contract"]].model_validate_json(json.dumps(payload, allow_nan=False))
    except ValidationError:
        accepted = False
    else:
        accepted = True
        assert json.loads(model.model_dump_json()) == payload
    assert accepted is case["valid"], case["id"]


def test_committed_schemas_match_pydantic_models():
    for name, schema in schemas().items():
        assert json.loads((SCHEMA_DIRECTORY / f"{name}.schema.json").read_text()) == schema


def test_synthetic_example_references_are_consistent():
    transaction = CORPUS["examples"]["transaction"]
    assessment = CORPUS["examples"]["risk-assessment"]
    alert = CORPUS["examples"]["alert"]
    assert transaction["transaction_id"] == assessment["transaction_id"] == alert["transaction_id"]
    assert transaction["transaction_revision"] == assessment["transaction_revision"] == alert["transaction_revision"]
    assert assessment["assessment_id"] == alert["assessment_id"]
    for record in (transaction, assessment, alert):
        assert record["execution_mode"] == "test"
        assert record["run_id"].startswith("synthetic-")


def test_validation_error_does_not_echo_sensitive_input():
    payload = deepcopy(CORPUS["examples"]["transaction"])
    payload["amount"] = "synthetic-private-canary"
    with pytest.raises(ValidationError) as error:
        Transaction.model_validate_json(json.dumps(payload))
    assert "synthetic-private-canary" not in str(error.value)
