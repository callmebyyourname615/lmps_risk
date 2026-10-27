"""Private invented pilot evidence only; no persistent database or source connection."""
import contextlib
from hashlib import sha256
import io
import json
import os
from pathlib import Path
import socket
import tempfile
import unittest
from unittest.mock import patch

from test_dataset_pilot import write_bundle, pilot
import dataset_semantics as semantics


class SemanticsEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="lmps-semantic-evidence-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source, self.adapted = self.root / "source", self.root / "adapted"

    def prepare(self, mutate=None):
        write_bundle(self.source, mutate=mutate)
        pilot.adapt(self.source, self.adapted)

    def test_full_evidence_binding_and_lineage_without_identifiers_or_network(self):
        self.prepare()
        before = pilot.tree_files(self.adapted)
        with patch.object(socket.socket, "connect", side_effect=AssertionError("No network")):
            value = semantics.evidence(self.adapted)
        self.assertEqual(value["source_rows"], 3)
        self.assertEqual(value["adapter_receipt_sha256"], sha256((self.adapted / "receipt.json").read_bytes()).hexdigest())
        lineage = [json.loads(line) for line in (self.adapted / "lineage.jsonl").read_text().splitlines()]
        for row, origin in zip(value["records"], lineage):
            self.assertEqual(row["source_row_sha256"], origin["source_tsv_row_sha256"])
        serialized = json.dumps(value)
        for marker in ("SYNTHETIC_PRIVATE_ACCOUNT", "SYNTHETIC_PRIVATE_QR", "SYNTHETIC_REFERENCE", "fromaccount", "toaccount"):
            self.assertNotIn(marker, serialized)
        self.assertEqual(pilot.tree_files(self.adapted), before)

    def test_null_empty_control_money_and_reference_presence_remain_distinct(self):
        def change(row, i):
            row.update(txtype=(None, "", "ທົດລອງ\\N")[i], originalreference=(None, "", "PRIVATE_ORIGINAL")[i],
                       amount=("9999999999999999999999.99", "-0.00", "-1.00")[i])
        self.prepare(change)
        rows = semantics.evidence(self.adapted)["records"]
        self.assertEqual([row["txtype"] for row in rows], [None, "", "ທົດລອງ\\N"])
        self.assertEqual([row["originalreference_presence"] for row in rows], ["null", "empty", "present"])
        self.assertEqual(rows[0]["amount"], "9999999999999999999999.99")
        self.assertEqual(rows[1]["amount"], "-0.00")
        self.assertNotIn("PRIVATE_ORIGINAL", json.dumps(rows))

    def test_modified_csv_lineage_archive_and_receipt_are_rejected(self):
        self.prepare()
        extra = self.adapted / "unexpected.json"
        extra.write_text("{}")
        extra.chmod(0o600)
        with patch.object(pilot, "tree_files") as inventory:
            with self.assertRaises(ValueError): semantics.evidence(self.adapted)
            inventory.assert_not_called()
        extra.unlink()
        for name in ("transfer.csv", "lineage.jsonl", "evidence/profile.json", "receipt.json"):
            path = self.adapted / name
            before = path.read_bytes()
            path.write_bytes(before + b"changed")
            with self.assertRaises(Exception):
                semantics.evidence(self.adapted)
            path.write_bytes(before)
        receipt = self.adapted / "receipt.json"
        value = json.loads(receipt.read_bytes()); value["source_rows"] = 999
        receipt.write_text(json.dumps(value))
        with self.assertRaises(Exception):
            semantics.evidence(self.adapted)

    def test_unsafe_permissions_symlinks_and_wrong_mode_fail_closed(self):
        self.prepare()
        path = self.adapted / "lineage.jsonl"
        path.chmod(0o644)
        with self.assertRaises(Exception): semantics.evidence(self.adapted)
        path.chmod(0o600)
        original = self.root / "lineage.original"
        path.rename(original)
        path.mkdir(mode=0o700)
        with patch.object(pilot, "tree_files") as inventory:
            with self.assertRaises(ValueError): semantics.evidence(self.adapted)
            inventory.assert_not_called()
        path.rmdir()
        original.rename(path)
        linked = self.root / "linked"; linked.symlink_to(self.adapted)
        with self.assertRaises(Exception): semantics.evidence(linked)
        with patch.dict(os.environ, {"LMPS_ENVIRONMENT": "production"}):
            with self.assertRaises(Exception): semantics.evidence(self.adapted)

    def test_bridge_errors_are_fixed_without_input_path_or_values(self):
        output, error = io.StringIO(), io.StringIO()
        with patch("sys.argv", ["bridge", str(self.root / "PRIVATE_MISSING")]), contextlib.redirect_stdout(output), contextlib.redirect_stderr(error):
            self.assertEqual(semantics.main(), 1)
        self.assertEqual(output.getvalue(), "")
        self.assertEqual(error.getvalue(), "SEMANTICS_EVIDENCE_REJECTED; private diagnostics withheld.\n")


if __name__ == "__main__":
    unittest.main()
