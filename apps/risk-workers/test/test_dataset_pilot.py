"""No.39 synthetic private bundles only; no real dataset or database access."""

import contextlib
from datetime import datetime, timedelta
import gzip
from hashlib import sha256
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import socket
import sys
import tempfile
import unittest
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))
import dataset_pilot as pilot
import export_transfer as export

START = datetime(2026, 10, 1)


def write_bundle(path, rows=3, mutate=None):
    path.mkdir(mode=0o700)
    values = []
    for i in range(rows):
        row = {name: None for name in export.PILOT_COLUMNS}
        row.update(id=i + 1, requesttime=str(START + timedelta(seconds=i)), txtime=str(START),
                   reference="SYNTHETIC_REFERENCE", frommember="0001", tomember="0002", totype="SYN",
                   amount=("1.00", "100.00", "-1.00")[i % 3], ccy="SYN", isreconciled=0, issettled=0,
                   fromaccount="SYNTHETIC_PRIVATE_ACCOUNT", toaccount='{"candidate":"SYNTHETIC_PRIVATE_QR"}', fee="0.10")
        if mutate:
            mutate(row, i)
        values.append(row)
    raw = ("\t".join(export.PILOT_COLUMNS) + "\n").encode()
    raw += b"".join(("\t".join(export.field(row[name]) for name in export.PILOT_COLUMNS) + "\n").encode() for row in values)
    name = "transfer_20261001_0000_20261001_0001.tsv.gz"
    (path / name).write_bytes(gzip.compress(raw, mtime=0))
    (path / "profile.json").write_text(json.dumps({"rows": rows, "account_identity": "unverified", "raw_values_included": False}))
    (path / "preflight.json").write_text(json.dumps({"format": "synthetic_preflight", "plan": {"type": "range"}}))
    metadata = {"record": "dataset", "format": export.PILOT_FORMAT, "source_table": "transfer",
                "columns": list(export.PILOT_COLUMNS), "account_identity": "unverified", "sample_only": True,
                "sample_limit": 1000, "requested_start_inclusive": str(START),
                "requested_end_exclusive": "2026-10-01 00:01:00"}
    window = {"record": "window", "status": "complete", "file": name, "start_inclusive": str(START),
              "end_exclusive": "2026-10-01 00:01:00", "rows": rows, "tsv_bytes": len(raw),
              "gzip_bytes": (path / name).stat().st_size, "tsv_sha256": sha256(raw).hexdigest(),
              "gzip_sha256": export.file_sha256(path / name), "sample_limit": 1000, "sample_truncated": False}
    summary = {"record": "summary", "status": "pilot_complete", "completed_windows": 1, "rows": rows,
               "tsv_bytes": len(raw), "gzip_bytes": window["gzip_bytes"], "completed_end_exclusive": window["end_exclusive"],
               "sample_only": True, "sample_limit": 1000, "sample_truncated": False,
               "artifacts": {name: export.file_sha256(path / name) for name in ("profile.json", "preflight.json")}}
    (path / "manifest.jsonl").write_bytes(b"".join(pilot.encoded(value) for value in (metadata, window, summary)))
    for file in path.iterdir():
        file.chmod(0o600)
    return values


class PilotAdapterTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="lmps-pilot-adapter-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.bundle = self.root / "source"
        self.output = self.root / "adapted"

    def test_projection_lineage_and_full_private_evidence_are_bound(self):
        rows = write_bundle(self.bundle)
        before = pilot.tree_files(self.bundle)
        with patch.object(socket.socket, "connect", side_effect=AssertionError("No network")):
            result = pilot.adapt(self.bundle, self.output)
        self.assertEqual(result["rows"], 3)
        self.assertEqual(pilot.tree_files(self.bundle), before)
        receipt = json.loads((self.output / "receipt.json").read_text())
        self.assertEqual(receipt["account_identity"], "unverified")
        self.assertFalse(receipt["account_fields_in_staging"])
        self.assertEqual(pilot.tree_files(self.output / "evidence"), before)
        projected = []
        report = pilot.csv_profile.profile_file(self.output / "transfer.csv", "transfer", projected)
        self.assertEqual(report["validation_status"], "valid")
        self.assertEqual(projected[1][2], "100.00")
        lines = [json.loads(line) for line in (self.output / "lineage.jsonl").read_text().splitlines()]
        self.assertEqual(len(lines), len(rows))
        for line, values in zip(lines, projected):
            self.assertEqual(line["source_key"], {"id": values[0], "requesttime": values[1]})
            self.assertEqual(line["staged_row_sha256"], sha256(json.dumps(values, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest())
        for name in ("transfer.csv", "csv-profile.json", "input.json", "receipt.json", "lineage.jsonl"):
            text = (self.output / name).read_text()
            self.assertNotIn("SYNTHETIC_PRIVATE_ACCOUNT", text)
            self.assertNotIn("SYNTHETIC_PRIVATE_QR", text)
            self.assertEqual((self.output / name).stat().st_mode & 0o077, 0)

    def test_duplicate_adapter_reuses_ids_and_rejects_partial_or_changed_output(self):
        write_bundle(self.bundle)
        self.assertEqual(pilot.adapt(self.bundle, self.output)["status"], "created")
        before = pilot.tree_files(self.output)
        self.assertEqual(pilot.adapt(self.bundle, self.output)["status"], "duplicate")
        self.assertEqual(pilot.tree_files(self.output), before)
        (self.output / "transfer.csv").write_text("SYNTHETIC_TAMPER")
        with self.assertRaises(pilot.PilotError):
            pilot.adapt(self.bundle, self.output)
        self.assertEqual((self.output / "transfer.csv").read_text(), "SYNTHETIC_TAMPER")

    def test_source_null_empty_controls_unicode_and_literal_backslashes_are_lossless(self):
        def mutate(row, i):
            row["result"] = None if i == 0 else ""
            row["fromaccount"] = "000001"
            row["toaccount"] = 'ລາວ ไทย\t\n\r\0\\N"'
        write_bundle(self.bundle, mutate=mutate)
        pilot.adapt(self.bundle, self.output)
        values = []
        pilot.csv_profile.profile_file(self.output / "transfer.csv", "transfer", values)
        self.assertIsNone(values[0][4])
        self.assertEqual(values[1][4], "")
        archive = next((self.output / "evidence").glob("*.gz"))
        self.assertIn(b"000001", gzip.decompress(archive.read_bytes()))
        self.assertEqual(pilot.decode_field(r"\\N"), r"\N")
        for value in ("\\", r"\x", r"\q"):
            with self.assertRaises(pilot.PilotError):
                pilot.decode_field(value)

    def test_literal_null_in_selected_scalar_rejects_before_publication(self):
        write_bundle(self.bundle, mutate=lambda row, _: row.update(result=r"\N"))
        with self.assertRaisesRegex(pilot.PilotError, "PILOT_LITERAL_NULL_NOT_REPRESENTABLE"):
            pilot.adapt(self.bundle, self.output)
        self.assertFalse(self.output.exists())

    def test_invalid_csv_values_and_duplicate_keys_are_not_silently_fixed(self):
        for label, mutate in (("date", lambda row, _: row.update(txtime="0000-00-00 00:00:00")),
                              ("duplicate", lambda row, _: row.update(id=1, requesttime=str(START)))):
            path = self.root / label
            write_bundle(path, mutate=mutate)
            with self.assertRaisesRegex(pilot.PilotError, "PILOT_CSV_PROFILE_REJECTED"):
                pilot.adapt(path, self.output)
            self.assertFalse(self.output.exists())

    def test_bounded_decompression_and_source_tamper_reject(self):
        write_bundle(self.bundle)
        with patch.object(pilot, "MAX_BYTES", 10000):
            # Limit the raw decompression separately from small compressed evidence files.
            archive = next(self.bundle.glob("*.gz"))
            archive.write_bytes(gzip.compress(b"x" * 20000))
            with self.assertRaisesRegex(pilot.PilotError, "PILOT_DECOMPRESSED_LIMIT"):
                pilot.adapt(self.bundle, self.output)
        self.assertFalse(self.output.exists())

    def test_private_permissions_links_and_path_overlap_are_rejected(self):
        write_bundle(self.bundle)
        archive = next(self.bundle.glob("*.gz"))
        archive.chmod(0o644)
        with self.assertRaises(Exception):
            pilot.adapt(self.bundle, self.output)
        archive.chmod(0o600)
        for output in (self.bundle / "child", self.root, self.bundle):
            with self.assertRaises(pilot.PilotError):
                pilot.adapt(self.bundle, output)
        original = self.root / "original.gz"
        archive.rename(original)
        archive.symlink_to(original)
        with self.assertRaises(Exception):
            pilot.adapt(self.bundle, self.output)
        self.assertFalse(self.output.exists())

    def test_cli_and_mode_failures_are_redacted_and_never_publish(self):
        write_bundle(self.bundle)
        out, error = io.StringIO(), io.StringIO()
        with patch.dict(os.environ, {"NODE_ENV": "production"}), contextlib.redirect_stdout(out), contextlib.redirect_stderr(error):
            self.assertEqual(pilot.main(["--bundle", str(self.bundle), "--output", str(self.output)]), 1)
        self.assertEqual(out.getvalue(), "")
        self.assertNotIn(str(self.bundle), error.getvalue())
        self.assertFalse(self.output.exists())


if __name__ == "__main__":
    unittest.main()
