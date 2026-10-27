"""Invented records and a subprocess client stub only; never connects to a database."""

import argparse
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
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/export_transfer.py"
spec = importlib.util.spec_from_file_location("export_transfer", SCRIPT)
export = importlib.util.module_from_spec(spec)
spec.loader.exec_module(export)
START = datetime(2026, 10, 1)


def invented():
    return {"id": -1, "requesttime": str(START), "txtime": "0000-00-00 00:00:00",
            "reference": "SYNTHETIC_REFERENCE", "frommember": "0001", "tomember": "0002",
            "totype": "SYNTHETIC_TYPE", "amount": "9999999999999999999999.99", "ccy": "SYN",
            "result": None, "responsetime": None, "txtype": "", "originalreference": r"\N",
            "shouldrevert": None, "isreconciled": 2, "issettled": 0, "settletime": None,
            "qrtype": "ລາວ ไทย\t\n\r\0\\", "fromchannel": 'SYNTHETIC_"CHANNEL"'}


class ExportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="lmps-export-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.client = self.root / "mariadb"
        self.config = self.root / "fixture.json"
        self.calls = self.root / "calls.jsonl"
        self.config.write_text(json.dumps({"row": invented(), "mode": "valid", "columns": list(export.PILOT_COLUMNS)}))
        self.client.write_text("#!" + sys.executable + "\n" + '''
import json, os, pathlib, re, stat, sys, time
base = pathlib.Path(__file__).parent
config = json.loads((base / "fixture.json").read_text())
args = sys.argv[1:]
sql = next(a.split("=", 1)[1] for a in args if a.startswith("--execute="))
match = re.search(r">= '([^']+)'", sql)
stamp = match.group(1) if match else None
auth = pathlib.Path(args[0].split("=", 1)[1])
with (base / "calls.jsonl").open("a") as log:
    log.write(json.dumps({"args": args, "stamp": stamp, "auth": auth.read_text(),
                          "auth_mode": stat.S_IMODE(auth.stat().st_mode)}) + "\\n")
mode = config["mode"]
if sql.startswith("SHOW COLUMNS"):
    print("Field\\tType\\tNull")
    for name in config["columns"]:
        print(name + "\\tvarchar(5000)\\tYES")
    sys.exit(0)
if sql.startswith("SHOW INDEX"):
    print("Key_name\\tColumn_name\\tSeq_in_index")
    print("idx2_transfer\\trequesttime\\t1")
    sys.exit(0)
if sql.startswith("EXPLAIN PARTITIONS"):
    print("partitions\\ttype\\tkey\\trows\\tExtra")
    print("Y2026_P10\\t" + config.get("plan_type", "range") + "\\tidx2_transfer\\t20\\tUsing where")
    sys.exit(0)
if "--init-command=" in args:
    print("ERROR 1065 (42000): Query was empty", file=sys.stderr)
    sys.exit(1)
if mode == "empty":
    sys.exit(0)
if mode == "oversize":
    print("x" * 70000, flush=True)
    time.sleep(30)
if mode == "bad_json":
    print("SYNTHETIC_PRIVATE_ERROR", flush=True)
    time.sleep(30)
row = config["row"]
row["requesttime"] = stamp
limit = re.search(r"LIMIT ([0-9]+)", sql)
count = min(config.get("count", 2), int(limit.group(1))) if limit else config.get("count", 2)
for i in range(count):
    row["id"] = i
    print(json.dumps(row, ensure_ascii=False))
if mode == "failed" or mode == "fail_second" and stamp.endswith("01:00:00"):
    print("SYNTHETIC_PRIVATE_ERROR", file=sys.stderr)
    sys.exit(7)
''')
        self.client.chmod(0o700)
        self.credentials = self.root / "client.cnf"
        self.credentials.write_text("[client]\npassword=" + export.option_value("SYNTHETIC_ONLY") + "\n")
        self.credentials.chmod(0o600)
        self.old_mask = os.umask(0o077)
        self.addCleanup(os.umask, self.old_mask)

    def mode(self, mode, **changes):
        value = json.loads(self.config.read_text())
        value.update(mode=mode, **changes)
        self.config.write_text(json.dumps(value))

    def call_log(self):
        return [json.loads(line) for line in self.calls.read_text().splitlines()]

    def run_export(self, target=1, hours=4):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            code = export.export_dataset(str(self.client), "synthetic.invalid", 3306,
                                         "synthetic_reader", 'SYNTHETIC_ONLY #"\\\t', START,
                                         START + timedelta(hours=hours), target, self.root, pause=0)
        directory = next(self.root.glob("lmps-export-2gb-*"))
        entries = [json.loads(line) for line in (directory / "manifest.jsonl").read_text().splitlines()]
        return code, directory, entries, output.getvalue()

    def run_pilot(self, count=2):
        row = {**invented(), "fromaccount": "0001234", "toaccount": '{"candidate":"SYNTHETIC_PRIVATE_ACCOUNT"}', "fee": "0.10"}
        self.mode("valid", row=row, count=count)
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            code = export.export_pilot(str(self.client), "synthetic.invalid", 3306,
                                       "synthetic_reader", "SYNTHETIC_ONLY", START, self.root)
        directory = next(self.root.glob("lmps-export-pilot-v2-*"))
        entries = [json.loads(line) for line in (directory / "manifest.jsonl").read_text().splitlines()]
        return code, directory, entries, output.getvalue()

    def test_projection_matches_ddl_and_only_selects_selected_columns(self):
        metadata = json.loads((SCRIPT.parents[3] / "docs/data-dictionary/lmps-schema/metadata.json").read_text())
        declared = next(table for table in metadata["tables"] if table["name"] == "transfer")
        fields = {column["name"]: column for column in declared["columns"]}
        for name in export.PILOT_COLUMNS:
            self.assertIn(name, fields)
            self.assertEqual(name in export.NULLABLE | {"fee"}, fields[name]["nullable"])
        self.assertEqual(fields["fromaccount"]["numeric_parameters"], [200])
        self.assertEqual(fields["toaccount"]["numeric_parameters"], [5000])
        self.assertEqual(fields["fee"]["numeric_parameters"], [24, 2])
        sql = export.query(START, START + export.HOUR)
        self.assertTrue(sql.startswith("SELECT JSON_OBJECT("))
        self.assertEqual(sql.count(";"), 1)
        self.assertIn("CAST(t.`amount` AS CHAR)", sql)
        self.assertIn("t.requesttime >= '2026-10-01 00:00:00'", sql)
        self.assertIn("t.requesttime <  '2026-10-01 01:00:00'", sql)
        self.assertNotRegex(sql.upper(), r"\b(SET|UPDATE|DELETE|INSERT|CREATE|DROP|ALTER|INTO|LOCK|JOIN|LIMIT|OFFSET)\b")
        for forbidden in ("fromaccount", "toaccount", "fromuser", "purpose", "receipt", "ORDER BY"):
            self.assertNotIn(forbidden, sql)

    def test_lossless_tsv_controls_nulls_leading_zeros_exact_money(self):
        encoded = export.row_bytes(json.dumps(invented()), str(START), str(START + export.HOUR))
        expected = ("-1\t2026-10-01 00:00:00\t0000-00-00 00:00:00\tSYNTHETIC_REFERENCE\t0001\t0002\t"
                    "SYNTHETIC_TYPE\t9999999999999999999999.99\tSYN\t\\N\t\\N\t\t\\\\N\t\\N\t2\t0\t\\N\t"
                    'ລາວ ไทย\\t\\n\\r\\0\\\\\tSYNTHETIC_"CHANNEL"\n').encode()
        self.assertEqual(encoded, expected)
        self.assertEqual(encoded.count(b"\n"), 1)
        self.assertEqual(len(encoded.rstrip(b"\n").split(b"\t")), 19)

    def test_bad_shapes_types_money_windows_and_duplicate_columns_fail(self):
        for field, value in [("amount", 1.25), ("amount", "NaN"), ("amount", "1.001"),
                             ("amount", "10000000000000000000000.00"), ("id", True),
                             ("ccy", None), ("requesttime", "2026-10-01 01:00:00")]:
            row = invented()
            row[field] = value
            with self.subTest(field=field, value=value), self.assertRaises(export.ExportError):
                export.row_bytes(json.dumps(row), str(START), str(START + export.HOUR))
        for line in ('{"id":1,"id":2}', "[]", "{}", "broken"):
            with self.assertRaises(export.ExportError):
                export.row_bytes(line, str(START), str(START + export.HOUR))

    def test_whole_hour_gzip_header_hashes_private_modes_and_credentials_cleanup(self):
        code, directory, entries, output = self.run_export()
        self.assertEqual(code, 0)
        window = entries[1]
        path = directory / window["file"]
        data = gzip.decompress(path.read_bytes())
        self.assertEqual(data.splitlines()[0] + b"\n", export.HEADER)
        self.assertEqual(data.count(b"\n"), 3)
        self.assertIn(path.name[:-3].encode() + b"\0", path.read_bytes()[:100])
        self.assertEqual(window["rows"], 2)
        self.assertEqual(window["tsv_bytes"], len(data))
        self.assertEqual(window["tsv_sha256"], sha256(data).hexdigest())
        self.assertEqual(window["gzip_sha256"], sha256(path.read_bytes()).hexdigest())
        self.assertEqual(set(p.name for p in directory.iterdir()), {path.name, "manifest.jsonl"})
        self.assertEqual(stat.S_IMODE(directory.stat().st_mode), 0o700)
        for file in directory.iterdir():
            self.assertEqual(stat.S_IMODE(file.stat().st_mode), 0o600)
        call = self.call_log()[0]
        self.assertEqual(call["auth_mode"], 0o600)
        self.assertFalse(Path(call["args"][0].split("=", 1)[1]).exists())
        self.assertIn("--quick", call["args"])
        self.assertIn("--skip-reconnect", call["args"])
        self.assertIn("--init-command=SELECT 1", call["args"])
        self.assertNotIn("--init-command=", call["args"])
        self.assertNotIn("SYNTHETIC_ONLY", " ".join(call["args"]) + output)
        self.assertNotIn("SYNTHETIC_REFERENCE", output)
        self.assertEqual(export.verify_dataset(directory), entries[-1])

    def test_actual_utf8_bytes_threshold_and_adjacent_complete_hours(self):
        code, directory, entries, _ = self.run_export(target=1000)
        windows = entries[1:-1]
        self.assertEqual(code, 0)
        self.assertGreaterEqual(len(windows), 2)
        self.assertGreaterEqual(sum(w["tsv_bytes"] for w in windows), 1000)
        self.assertLess(sum(w["tsv_bytes"] for w in windows[:-1]), 1000)
        self.assertEqual(len(self.call_log()), len(windows))
        for first, second in zip(windows, windows[1:]):
            self.assertEqual(first["end_exclusive"], second["start_inclusive"])
        self.assertEqual(export.verify_dataset(directory), entries[-1])

    def test_range_exhausted_is_not_target_success(self):
        code, directory, entries, _ = self.run_export(target=10_000_000, hours=2)
        self.assertEqual(code, 2)
        self.assertEqual(entries[-1]["status"], "range_exhausted")
        self.assertEqual(entries[-1]["completed_windows"], 2)
        self.assertEqual(export.verify_dataset(directory), entries[-1])

    def test_empty_hours_are_recorded_without_inventing_rows(self):
        self.mode("empty")
        code, directory, entries, _ = self.run_export(target=10_000_000, hours=2)
        self.assertEqual(code, 2)
        self.assertEqual(entries[-1]["rows"], 0)
        self.assertEqual(entries[-1]["tsv_bytes"], 2 * len(export.HEADER))
        self.assertEqual(export.verify_dataset(directory), entries[-1])

    def test_nonzero_client_after_rows_never_publishes_a_complete_archive(self):
        self.mode("failed")
        with self.assertRaisesRegex(export.ExportError, "MARIADB_SELECT_FAILED"):
            self.run_export()
        directory = next(self.root.glob("lmps-export-2gb-*"))
        self.assertEqual(list(directory.glob("*.tsv.gz")), [])
        self.assertEqual(len(list(directory.glob("*.part"))), 1)
        summary = json.loads((directory / "manifest.jsonl").read_text().splitlines()[-1])
        self.assertEqual(summary["status"], "interrupted_or_failed")
        self.assertEqual(summary["rows"], 0)
        with self.assertRaises(export.ExportError):
            export.verify_dataset(directory)
        auth = Path(self.call_log()[0]["args"][0].split("=", 1)[1])
        self.assertFalse(auth.exists())

    def test_mid_run_failure_preserves_verified_first_hour_and_manifest(self):
        self.mode("fail_second")
        with self.assertRaises(export.ExportError):
            self.run_export(target=10_000_000)
        directory = next(self.root.glob("lmps-export-2gb-*"))
        self.assertEqual(len(list(directory.glob("*.tsv.gz"))), 1)
        entries = [json.loads(line) for line in (directory / "manifest.jsonl").read_text().splitlines()]
        self.assertEqual(entries[-1]["completed_windows"], 1)
        self.assertEqual(entries[-1]["completed_end_exclusive"], "2026-10-01 01:00:00")

    def test_bad_or_oversize_output_terminates_client_without_publishing(self):
        for mode in ("bad_json", "oversize"):
            with self.subTest(mode=mode):
                self.mode(mode)
                with self.assertRaises(export.ExportError):
                    export.export_hour(str(self.client), [], self.credentials, self.root, START, START + export.HOUR)
                self.assertEqual(list(self.root.glob("*.tsv.gz")), [])
                for partial in self.root.glob("*.part"):
                    partial.unlink()

    def test_existing_archive_is_not_overwritten_or_queried_again(self):
        result = export.export_hour(str(self.client), [], self.credentials, self.root, START, START + export.HOUR)
        before = (self.root / result["file"]).read_bytes()
        with self.assertRaisesRegex(export.ExportError, "OUTPUT_ALREADY_EXISTS"):
            export.export_hour(str(self.client), [], self.credentials, self.root, START, START + export.HOUR)
        self.assertEqual((self.root / result["file"]).read_bytes(), before)
        self.assertEqual(len(self.call_log()), 1)

    def test_copy_verification_rejects_tamper_missing_files_paths_and_symlinks(self):
        _, directory, entries, _ = self.run_export()
        archive = directory / entries[1]["file"]
        original = archive.read_bytes()
        archive.write_bytes(original[:-1] + bytes([original[-1] ^ 1]))
        with self.assertRaises(export.ExportError):
            export.verify_dataset(directory)
        archive.unlink()
        with self.assertRaises(export.ExportError):
            export.verify_dataset(directory)
        outside = self.root / "outside.gz"
        outside.write_bytes(original)
        archive.symlink_to(outside)
        with self.assertRaises(export.ExportError):
            export.verify_dataset(directory)
        archive.unlink()
        archive.write_bytes(original)
        entries[1]["file"] = "../outside.gz"
        (directory / "manifest.jsonl").write_text("".join(json.dumps(e) + "\n" for e in entries))
        with self.assertRaises(export.ExportError):
            export.verify_dataset(directory)

    def test_cli_prompts_once_hidden_secret_and_offline_verification_needs_no_client(self):
        output, errors = io.StringIO(), io.StringIO()
        secret = 'SYNTHETIC_ONLY #"\\\n\r\t\b'
        with patch.object(export.shutil, "which", side_effect=[None, str(self.client)]), \
                patch.object(export.sys.stdin, "isatty", return_value=True), \
                patch("builtins.input", side_effect=["synthetic.invalid", "synthetic_reader", "3306"]), \
                patch.object(export.getpass, "getpass", return_value=secret) as prompt, \
                contextlib.redirect_stdout(output), contextlib.redirect_stderr(errors):
            code = export.main(["--output-root", str(self.root), "--target-bytes", "1"])
        self.assertEqual(code, 0)
        self.assertEqual(prompt.call_count, 1)
        self.assertEqual(errors.getvalue(), "")
        self.assertNotIn("SYNTHETIC_ONLY", output.getvalue())
        self.assertEqual(self.call_log()[0]["auth"], "[client]\npassword=" + export.option_value(secret) + "\n")
        directory = next(self.root.glob("lmps-export-2gb-*"))
        with patch.object(export.shutil, "which", side_effect=AssertionError("No client lookup")), \
                patch.object(export.getpass, "getpass", side_effect=AssertionError("No password")), \
                contextlib.redirect_stdout(output):
            self.assertEqual(export.main(["--verify", str(directory)]), 0)

    def test_cli_help_invalid_bounds_and_missing_client_fail_before_creating_data(self):
        help_result = subprocess.run([sys.executable, str(SCRIPT), "--help"], capture_output=True, text=True)
        self.assertEqual(help_result.returncode, 0)
        self.assertIn("--verify", help_result.stdout)
        for value in ("2026-10-01T00:30:00", "2026-10-01T00:00:00Z", "invalid", "0001-01-01"):
            with self.assertRaises(argparse.ArgumentTypeError):
                export.hour(value)
        with contextlib.redirect_stderr(io.StringIO()), patch.object(export.shutil, "which", return_value=None):
            self.assertEqual(export.main(["--output-root", str(self.root)]), 1)
            self.assertEqual(export.main(["--target-bytes", "0"]), 1)
            self.assertEqual(export.main(["--start", "2026-01-01"]), 1)
        self.assertEqual(list(self.root.glob("lmps-export-2gb-*")), [])

    def test_flash_copy_verifies_offline_before_removing_only_home_staging_copy(self):
        _, directory, _, _ = self.run_export()
        flash = self.root / "flash" / directory.name
        shutil.copytree(directory, flash)
        self.assertEqual(export.verify_dataset(flash)["status"], "target_reached")
        proof = export.file_sha256(flash / "manifest.jsonl")
        flash_before = {p.name: p.read_bytes() for p in flash.iterdir()}
        with patch.object(export.Path, "home", return_value=self.root), \
                patch.object(export.shutil, "which", side_effect=AssertionError("No DB client")), \
                contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(export.main(["--cleanup-copy", str(directory),
                                          "--verified-manifest-sha256", proof]), 0)
        self.assertFalse(directory.exists())
        self.assertEqual({p.name: p.read_bytes() for p in flash.iterdir()}, flash_before)
        self.assertTrue(SCRIPT.exists())

    def test_cleanup_rejects_wrong_proof_flash_path_and_unrelated_files(self):
        _, directory, _, _ = self.run_export()
        flash = self.root / "flash" / directory.name
        shutil.copytree(directory, flash)
        proof = export.file_sha256(flash / "manifest.jsonl")
        before = {p.name: p.read_bytes() for p in directory.iterdir()}
        with patch.object(export.Path, "home", return_value=self.root):
            for path, digest in ((directory, "0" * 64), (directory, None), (flash, proof)):
                with self.subTest(path=path, digest=digest), self.assertRaises(export.ExportError):
                    export.cleanup_copy(path, digest)
            self.assertEqual({p.name: p.read_bytes() for p in directory.iterdir()}, before)
            extra = directory / "unrelated.txt"
            extra.write_text("SYNTHETIC_DO_NOT_REMOVE")
            with self.assertRaisesRegex(export.ExportError, "CLEANUP_UNEXPECTED_FILES"):
                export.cleanup_copy(directory, proof)
            self.assertEqual(extra.read_text(), "SYNTHETIC_DO_NOT_REMOVE")
            self.assertEqual({p.name: p.read_bytes() for p in directory.iterdir() if p != extra}, before)

    def test_cleanup_rejects_incomplete_target_and_altered_source(self):
        _, directory, entries, _ = self.run_export(target=10_000_000, hours=1)
        proof = export.file_sha256(directory / "manifest.jsonl")
        with patch.object(export.Path, "home", return_value=self.root):
            with self.assertRaisesRegex(export.ExportError, "CLEANUP_TARGET_NOT_REACHED"):
                export.cleanup_copy(directory, proof)
            archive = directory / entries[1]["file"]
            archive.write_bytes(b"SYNTHETIC_CORRUPTION")
            with self.assertRaises(export.ExportError):
                export.cleanup_copy(directory, proof)
        self.assertTrue((directory / "manifest.jsonl").exists())
        self.assertTrue(archive.exists())

    def test_decompressed_tamper_is_rejected_even_when_gzip_hash_is_updated(self):
        _, directory, entries, _ = self.run_export()
        path = directory / entries[1]["file"]
        data = gzip.decompress(path.read_bytes()).replace(b"SYNTHETIC_REFERENCE", b"SYNTHETIC_DIFFERENT")
        path.write_bytes(gzip.compress(data))
        entries[1]["gzip_sha256"] = export.file_sha256(path)
        entries[1]["gzip_bytes"] = path.stat().st_size
        (directory / "manifest.jsonl").write_text("".join(json.dumps(e) + "\n" for e in entries))
        with self.assertRaises(export.ExportError):
            export.verify_dataset(directory)

    def test_client_error_numbers_are_bounded_and_do_not_disclose_diagnostics(self):
        for diagnostic, expected in (
            (b"ERROR 1065 (42000): SYNTHETIC_PRIVATE_VALUE", "MARIADB_SELECT_FAILED_ERROR_1065"),
            (b"ERROR 1045 (28000): SYNTHETIC_PRIVATE_VALUE", "MARIADB_SELECT_FAILED_ERROR_1045"),
            (b"client: unknown option SYNTHETIC_PRIVATE_VALUE", "MARIADB_CLIENT_OPTION_UNSUPPORTED"),
            (b"SYNTHETIC_PRIVATE_VALUE", "MARIADB_SELECT_FAILED"),
            (b"x" * 16_384 + b"ERROR 1065", "MARIADB_SELECT_FAILED"),
        ):
            with self.subTest(expected=expected):
                self.assertEqual(export.client_failure(io.BytesIO(diagnostic)), expected)

    def test_desktop_cleanup_preserves_flash_and_neighbours_and_rejects_redirected_desktop(self):
        _, directory, _, _ = self.run_export()
        desktop = self.root / "Desktop"
        desktop.mkdir()
        copied = desktop / directory.name
        shutil.copytree(directory, copied)
        neighbour = desktop / "unrelated.txt"
        neighbour.write_text("SYNTHETIC_KEEP")
        flash = self.root / "flash" / directory.name
        shutil.copytree(directory, flash)
        proof = export.file_sha256(flash / "manifest.jsonl")
        with patch.object(export.Path, "home", return_value=self.root):
            export.cleanup_copy(copied, proof)
        self.assertFalse(copied.exists())
        self.assertEqual(neighbour.read_text(), "SYNTHETIC_KEEP")
        self.assertEqual(export.verify_dataset(flash)["status"], "target_reached")
        neighbour.unlink()
        desktop.rmdir()
        desktop.symlink_to(flash.parent, target_is_directory=True)
        with patch.object(export.Path, "home", return_value=self.root):
            with self.assertRaises(export.ExportError):
                export.cleanup_copy(desktop / directory.name, proof)
        self.assertEqual(export.verify_dataset(flash)["status"], "target_reached")

    def test_pilot_22_columns_one_minute_private_profile_and_no_identity_claim(self):
        code, directory, entries, output = self.run_pilot()
        self.assertEqual(code, 0)
        self.assertEqual(entries[0]["columns"], list(export.PILOT_COLUMNS))
        self.assertEqual(entries[-1]["status"], "pilot_complete")
        self.assertEqual(entries[-1]["completed_end_exclusive"], "2026-10-01 00:01:00")
        self.assertFalse(entries[-1]["sample_truncated"])
        self.assertEqual(export.verify_dataset(directory), entries[-1])
        profile = json.loads((directory / "profile.json").read_text())
        self.assertEqual(profile["account_identity"], "unverified")
        self.assertEqual(profile["rows"], 2)
        self.assertEqual(profile["account_field_shapes"]["fromaccount"]["ascii_digits"], 2)
        self.assertEqual(profile["account_field_shapes"]["toaccount"]["json_object_or_array"], 2)
        reports = output + (directory / "profile.json").read_text() + (directory / "preflight.json").read_text() + (directory / "manifest.jsonl").read_text()
        self.assertNotIn("SYNTHETIC_PRIVATE_ACCOUNT", reports)
        self.assertNotIn("0001234", reports)
        archive = gzip.decompress((directory / entries[1]["file"]).read_bytes()).decode()
        self.assertIn("\tfromaccount\ttoaccount\tfee\n", archive)
        self.assertIn("\t0001234\t", archive)
        self.assertIn("SYNTHETIC_PRIVATE_ACCOUNT", archive)
        self.assertEqual(set(p.name for p in directory.iterdir()), {entries[1]["file"], "manifest.jsonl", "profile.json", "preflight.json"})
        for file in directory.iterdir():
            self.assertEqual(stat.S_IMODE(file.stat().st_mode), 0o600)
        queries = [next(arg for arg in call["args"] if arg.startswith("--execute=")) for call in self.call_log()]
        self.assertEqual(len(queries), 4)
        self.assertTrue(queries[0].startswith("--execute=SHOW COLUMNS"))
        self.assertTrue(queries[1].startswith("--execute=SHOW INDEX"))
        self.assertTrue(queries[2].startswith("--execute=EXPLAIN PARTITIONS SELECT"))
        self.assertIn("LIMIT 1001", queries[3])
        self.assertIn("2026-10-01 00:01:00", queries[3])

    def test_pilot_limit_marks_truncation_and_preserves_v1_compatibility(self):
        _, old_directory, old_entries, _ = self.run_export()
        _, directory, entries, _ = self.run_pilot(count=1200)
        self.assertEqual(entries[-1]["rows"], 1000)
        self.assertTrue(entries[-1]["sample_truncated"])
        self.assertTrue(entries[0]["sample_only"])
        self.assertEqual(json.loads((directory / "profile.json").read_text())["rows"], 1000)
        self.assertEqual(export.verify_dataset(directory), entries[-1])
        self.assertEqual(export.verify_dataset(old_directory), old_entries[-1])

    def test_pilot_unsafe_plan_or_missing_columns_stops_before_reading_records(self):
        for changes, reason in (({"plan_type": "ALL"}, "PILOT_INDEXED_RANGE_PLAN_REQUIRED"),
                                ({"columns": list(export.COLUMNS)}, "PILOT_REQUIRED_COLUMNS_MISSING")):
            with self.subTest(reason=reason):
                self.mode("valid", **{"columns": list(export.PILOT_COLUMNS), "plan_type": "range", **changes})
                before = len(self.call_log()) if self.calls.exists() else 0
                with contextlib.redirect_stdout(io.StringIO()), self.assertRaisesRegex(export.ExportError, reason):
                    export.export_pilot(str(self.client), "synthetic.invalid", 3306,
                                        "synthetic_reader", "SYNTHETIC_ONLY", START, self.root)
                recent = self.call_log()[before:]
                self.assertFalse(any(any(arg.startswith("--execute=SELECT") for arg in call["args"]) for call in recent))
                self.assertEqual([file for folder in self.root.glob("lmps-export-pilot-v2-*")
                                  for file in folder.glob("*.tsv.gz")], [])

    def test_pilot_profile_hash_and_cleanup_are_bound_to_verified_copy(self):
        _, directory, entries, _ = self.run_pilot()
        profile = directory / "profile.json"
        original = profile.read_bytes()
        profile.write_bytes(original + b" ")
        with self.assertRaises(export.ExportError):
            export.verify_dataset(directory)
        profile.write_bytes(original)
        flash = self.root / "flash" / directory.name
        shutil.copytree(directory, flash)
        proof = export.file_sha256(flash / "manifest.jsonl")
        with patch.object(export.Path, "home", return_value=self.root):
            export.cleanup_copy(directory, proof)
        self.assertFalse(directory.exists())
        self.assertEqual(export.verify_dataset(flash), entries[-1])

    def test_pilot_account_heuristics_never_resolve_masked_or_qr_candidates(self):
        _, directory, _, _ = self.run_pilot(count=0)
        profile = json.loads((directory / "profile.json").read_text())
        row = {**invented(), "fromaccount": "XXXX1234", "toaccount": "000201" + "1" * 4994, "fee": None}
        encoded = export.row_bytes(json.dumps(row), str(START), "2026-10-01 00:01:00", export.PILOT_COLUMNS)
        export.profile_row(profile, row)
        self.assertIn(row["toaccount"].encode(), encoded)
        self.assertEqual(profile["account_field_shapes"]["toaccount"]["max_characters"], 5000)
        self.assertEqual(profile["account_field_shapes"]["toaccount"]["starts_with_000201"], 1)
        self.assertEqual(profile["account_field_shapes"]["fromaccount"]["contains_mask_markers"], 1)
        self.assertEqual(profile["account_identity"], "unverified")
        self.assertNotIn("XXXX1234", json.dumps(profile))
        row["fee"] = "1.001"
        with self.assertRaises(export.ExportError):
            export.row_bytes(json.dumps(row), str(START), "2026-10-01 00:01:00", export.PILOT_COLUMNS)

    def test_cli_pilot_selects_one_small_window_and_offline_reader_detects_v2(self):
        self.mode("valid", row={**invented(), "fromaccount": "SYNTHETIC_A",
                               "toaccount": "SYNTHETIC_B", "fee": None})
        with patch.object(export.shutil, "which", return_value=str(self.client)), \
                patch.object(export.sys.stdin, "isatty", return_value=True), \
                patch("builtins.input", side_effect=["synthetic.invalid", "synthetic_reader", "3306"]), \
                patch.object(export.getpass, "getpass", return_value="SYNTHETIC_ONLY"), \
                contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(export.main(["--pilot-v2", "--output-root", str(self.root)]), 0)
        directory = next(self.root.glob("lmps-export-pilot-v2-*"))
        self.assertEqual(len(self.call_log()), 4)
        self.assertEqual(export.verify_dataset(directory)["completed_windows"], 1)
        with patch.object(export.shutil, "which", side_effect=AssertionError("Offline only")), \
                contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(export.main(["--verify", str(directory)]), 0)


if __name__ == "__main__":
    unittest.main()
