"""Synthetic temporary exports only; no private dataset or CSV fixture is published."""

import contextlib
import csv
from hashlib import sha256
import importlib.util
import io
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/dataset_profile.py"
spec = importlib.util.spec_from_file_location("dataset_profile", SCRIPT)
profile = importlib.util.module_from_spec(spec)
spec.loader.exec_module(profile)
ROOT = SCRIPT.parents[3]


class DatasetTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="lmps-dataset-test-")
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.input = self.base / "synthetic.csv"
        self.output = self.base / "result"

    def write(self, rows=None, table="transfer", header=None):
        header = list(profile.SCHEMAS[table]) if header is None else header
        if rows is None:
            values = {"id": "1", "requesttime": "2026-10-01 12:00:00", "amount": "1.00",
                      "ccy": "SYNTHETIC_CCY", "result": "SYNTHETIC_RESULT", "txtime": "2026-10-01 12:00:00",
                      "code": "0001", "status": "SYNTH", "member_type": "SYNTH"}
            rows = [[values[n] for n in header]]
        with self.input.open("w", encoding="utf-8", newline="") as file:
            writer = csv.writer(file)
            writer.writerow(header)
            writer.writerows(rows)
        self.input.chmod(0o600)
        return self.input

    def run_main(self, *args):
        out, error = io.StringIO(), io.StringIO()
        with patch.dict(os.environ, {"LMPS_ENVIRONMENT": "test", "LMPS_EXECUTION_MODE": "test", "NODE_ENV": "test"}), contextlib.redirect_stdout(out), contextlib.redirect_stderr(error):
            code = profile.main(list(args) or ["--table", "transfer", "--input", str(self.input), "--output-dir", str(self.output)])
        return code, out.getvalue(), error.getvalue()

    def test_profile_exact_file_identity_and_offline_boundaries(self):
        self.write()
        before = self.input.read_bytes()
        with patch.object(socket.socket, "connect", side_effect=AssertionError("Unexpected network")) as network:
            report = profile.profile_file(self.input, "transfer")
        self.assertEqual(network.call_count, 0)
        self.assertEqual(self.input.read_bytes(), before)
        self.assertEqual(report["dataset_sha256"], sha256(before).hexdigest())
        self.assertEqual(report["input_bytes"], len(before))
        self.assertEqual(report["validation_status"], "valid")
        self.assertEqual(report["row_counts"]["valid_rows"], 1)
        self.assertEqual(report["source_semantics"], "unverified")
        self.assertEqual(report["risk_assessment"], "not_performed")
        self.assertEqual(report["import_eligibility"], "not_evaluated")

    def test_all_source_profiles_and_reordered_headers(self):
        for table in profile.SCHEMAS:
            self.write(table=table, header=list(reversed(profile.SCHEMAS[table])))
            report = profile.profile_file(self.input, table)
            self.assertEqual(report["validation_status"], "valid", table)
            self.assertEqual(report["row_counts"]["unique_complete_source_keys"], 1)
            if table == "member":
                self.assertIsNone(report["amount_signs"])

    def test_profile_spec_matches_selected_offline_ddl(self):
        metadata = json.loads((ROOT / "docs/data-dictionary/lmps-schema/metadata.json").read_text())
        for table, fields in profile.SCHEMAS.items():
            declared = {c["name"]: c for t in metadata["tables"] if t["name"] == table for c in t["columns"]}
            for name, (kind, width, nullable) in fields.items():
                self.assertEqual(nullable, declared[name]["nullable"], (table, name))
                if kind == "text":
                    self.assertEqual(width, declared[name]["numeric_parameters"][0])
            self.assertEqual(tuple(profile.KEYS[table]), ("code",) if table == "member" else ("id",) if table == "transfer_old" else ("id", "requesttime"))

    def test_null_marker_empty_and_whitespace_are_distinct(self):
        self.write([["0001", "\\N", ""], ["0002", "", " "], ["0003", " ", "\\N"]], table="member")
        report = profile.profile_file(self.input, "member")
        self.assertEqual(report["fields"]["status"], {"null_rows": 1, "empty_rows": 1, "non_null_rows": 2, "invalid_rows": 0, "distinct_non_null": 2})
        self.assertEqual(report["row_counts"]["valid_rows"], 3)

    def test_member_keys_preserve_leading_zero_and_case(self):
        self.write([["0001", "", ""], ["1", "", ""], ["A", "", ""], ["a", "", ""]], table="member")
        report = profile.profile_file(self.input, "member")
        self.assertEqual(report["row_counts"]["unique_complete_source_keys"], 4)
        self.assertEqual(report["row_counts"]["duplicate_key_rows"], 0)
        self.assertEqual(report["source_key_comparison"], "exact_export_strings")

    def test_composite_key_duplicates_conflicts_and_different_times(self):
        self.write()
        rows = list(csv.reader(io.StringIO(self.input.read_text())))[1:]
        changed = [*rows[0]]; changed[2] = "2.00"
        later = [*rows[0]]; later[1] = "2026-10-02 12:00:00"
        self.write([rows[0], rows[0], changed, later])
        report = profile.profile_file(self.input, "transfer")
        self.assertEqual(report["row_counts"]["duplicate_key_rows"], 2)
        self.assertEqual(report["row_counts"]["conflicting_key_rows"], 1)
        self.assertEqual(report["row_counts"]["unique_complete_source_keys"], 2)
        self.assertEqual(report["validation_status"], "needs_attention")
        self.assertEqual(report["business_payment_deduplication"], "not_performed")

    def test_invalid_keys_not_grouped_as_duplicates(self):
        self.write([["", "", ""], ["", "", ""], ["\\N", "", ""]], table="member")
        counts = profile.profile_file(self.input, "member")["row_counts"]
        self.assertEqual(counts["invalid_key_rows"], 3)
        self.assertEqual(counts["duplicate_key_rows"], 0)

    def test_exact_decimal_source_range_and_signs(self):
        amounts = ["9999999999999999999999.99", "-9999999999999999999999.99", "-0.00", "0.00", "0.10",
                   "10000000000000000000000.00", "1.001", "1e3", "NaN", "01.00", "1,000.00", " 1.00", "\\N"]
        rows = [[str(i), "2026-10-01 12:00:00", value, "SYNTH", "\\N", "2026-10-01 12:00:00"] for i, value in enumerate(amounts)]
        self.write(rows)
        report = profile.profile_file(self.input, "transfer")
        self.assertEqual(report["fields"]["amount"]["invalid_rows"], 8)
        self.assertEqual(report["amount_signs"], {"positive_rows": 2, "zero_rows": 2, "negative_rows": 1})

    def test_calendar_validation_does_not_invent_timezone(self):
        rows = [[str(i), value, "0.00", "SYNTH", "", value] for i, value in enumerate([
            "2024-02-29 00:00:00", "2023-02-29 00:00:00", "2026-01-01T00:00:00Z", "2026-10-01 24:00:00", "0000-01-01 00:00:00"])]
        self.write(rows)
        report = profile.profile_file(self.input, "transfer")
        self.assertEqual(report["fields"]["requesttime"]["invalid_rows"], 4)
        self.assertEqual(report["source_timezone"], "unverified")
        self.assertNotIn("occurred_at", report)

    def test_csv_quoted_commas_quotes_and_multiline(self):
        self.write([["0001", 'SYN,"TH', "SYNTH"], ["0002", "SYN\nTH", "SYNTH"]], table="member")
        report = profile.profile_file(self.input, "member")
        self.assertEqual(report["observed_rows"], 2)
        self.assertEqual(report["fields"]["status"]["invalid_rows"], 1)
        self.assertEqual(report["code_distributions"]["status"][0]["rows"], 1)

    def test_bom_crlf_and_no_final_newline(self):
        self.input.write_bytes(b'\xef\xbb\xbfcode,status,member_type\r\n0001,SYNTH,SYNTH')
        self.input.chmod(0o600)
        self.assertEqual(profile.profile_file(self.input, "member")["validation_status"], "valid")

    def test_header_missing_unknown_and_duplicates_never_echo_names_or_values(self):
        self.write([["SYNTHETIC_PRIVATE_VALUE"] * 3], header=["id", "id", "SYNTHETIC_PRIVATE_HEADER"])
        code, out, error = self.run_main()
        self.assertEqual(code, 2)
        report = json.loads((self.output / "report.json").read_text())
        self.assertEqual(report["validation_status"], "header_rejected")
        self.assertEqual(report["header"]["unexpected_column_count"], 1)
        self.assertEqual(report["header"]["duplicate_column_count"], 1)
        self.assertIn("requesttime", report["header"]["missing_columns"])
        self.assertIsNone(report["observed_rows"])
        self.assertNotIn("SYNTHETIC_PRIVATE", out + error + json.dumps(report))

    def test_malformed_width_counted_without_wrong_field_mapping(self):
        self.write([["0001", "SYNTH", "SYNTH"], ["0002"], ["0003", "SYNTH", "SYNTH", "extra"]], table="member")
        report = profile.profile_file(self.input, "member")
        self.assertEqual(report["observed_rows"], 3)
        self.assertEqual(report["row_counts"]["malformed_rows"], 2)
        self.assertEqual(report["row_counts"]["invalid_rows"], 2)
        self.assertEqual(report["fields"]["code"]["non_null_rows"], 1)

    def test_empty_file_and_header_only_do_not_claim_ready(self):
        self.input.write_bytes(b""); self.input.chmod(0o600)
        self.assertEqual(profile.profile_file(self.input, "transfer")["validation_status"], "header_rejected")
        self.write([], table="member")
        self.assertEqual(profile.profile_file(self.input, "member")["validation_status"], "no_rows")

    def test_utf8_csv_and_field_failures_publish_nothing(self):
        for data in [b'code,status,member_type\n0001,"unterminated,x', b'code,status,member_type\n0001,\xff,x',
                     b'code,status,member_type\n0001,' + b'x' * (profile.MAX_FIELD_CHARS + 1) + b',x']:
            self.input.write_bytes(data); self.input.chmod(0o600)
            code, out, error = self.run_main("--table", "member", "--input", str(self.input), "--output-dir", str(self.output))
            self.assertEqual(code, 1)
            self.assertEqual(out, "")
            self.assertNotIn(str(self.input), error)
            self.assertFalse(self.output.exists())

    def test_limits_fail_closed_without_partial_success(self):
        self.write([["0001", "SYNTH", "SYNTH"], ["0002", "OTHER", "SYNTH"]], table="member")
        for name, limit in [("MAX_ROWS", 1), ("MAX_BYTES", 1), ("MAX_CODES", 1), ("MAX_COLUMNS", 2), ("MAX_RECORD_CHARS", 8)]:
            with self.subTest(name=name), patch.object(profile, name, limit):
                with self.assertRaises(profile.DatasetError):
                    profile.profile_file(self.input, "member")

    def test_byte_guard_applies_during_read_and_hashes_exact_bytes(self):
        source = profile.HashedReader(io.BytesIO(b"synthetic"))
        buffer = bytearray(3)
        self.assertEqual(source.readinto(buffer), 3)
        self.assertEqual(buffer, b"syn")
        with patch.object(profile, "MAX_BYTES", 4), self.assertRaises(profile.DatasetError):
            source.readinto(buffer)

    def test_actual_maximum_rows_and_one_over_limit(self):
        self.write(([f"SYN{i:06}", "SYNTH", "SYNTH"] for i in range(profile.MAX_ROWS)), table="member")
        report = profile.profile_file(self.input, "member")
        self.assertEqual(report["observed_rows"], profile.MAX_ROWS)
        self.assertEqual(report["fields"]["code"]["distinct_non_null"], profile.MAX_ROWS)
        self.assertEqual(report["validation_status"], "valid")
        with self.input.open("a") as file:
            file.write("SYN_EXTRA,SYNTH,SYNTH\n")
        with self.assertRaises(profile.DatasetError):
            profile.profile_file(self.input, "member")

    def test_integer_boundaries_required_fields_and_control_characters(self):
        rows = [[value, "2026-10-01 12:00:00", "1.00", "SYNTH", "", "2026-10-01 12:00:00"]
                for value in ["-2147483648", "2147483647", "2147483648", "-2147483649", "01", "1.0", "\\N"]]
        rows.append(["0", "2026-10-01 12:00:00", "1.00", "", "SYN\x00TH", "\\N"])
        self.write(rows)
        report = profile.profile_file(self.input, "transfer")
        self.assertEqual(report["fields"]["id"]["invalid_rows"], 5)
        self.assertEqual(report["fields"]["ccy"]["invalid_rows"], 1)
        self.assertEqual(report["fields"]["result"]["invalid_rows"], 1)
        self.assertEqual(report["fields"]["txtime"]["invalid_rows"], 1)

    def test_input_mutation_rejected_before_publication(self):
        self.write()
        original = profile.profile_stream
        def changed(stream, table):
            report = original(stream, table)
            with self.input.open("ab") as file:
                file.write(b"\n")
            return report
        with patch.object(profile, "profile_stream", changed):
            code, out, error = self.run_main()
        self.assertEqual(code, 1)
        self.assertIn("DATASET_INPUT_CHANGED", error)
        self.assertFalse(self.output.exists())

    def test_private_publication_determinism_replay_and_conflict(self):
        self.write()
        self.assertEqual(self.run_main()[0], 0)
        original = {name: (self.output / name).read_bytes() for name in ["report.json", "mapping-template.json"]}
        self.assertEqual(self.output.stat().st_mode & 0o777, 0o700)
        for name in original:
            self.assertEqual((self.output / name).stat().st_mode & 0o777, 0o600)
        code, out, error = self.run_main()
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out)["status"], "duplicate")
        self.write([["2", "2026-10-01 12:00:00", "2.00", "OTHER", "", "2026-10-01 12:00:00"]])
        self.assertEqual(self.run_main()[0], 1)
        for name, data in original.items():
            self.assertEqual((self.output / name).read_bytes(), data)

    def test_no_source_values_paths_or_keys_in_artifacts_and_stdout(self):
        self.write([["987654321", "2026-10-01 12:00:00", "1234567.89", "SYNTHETIC_PRIVATE_VALUE", "SYNTHETIC_PRIVATE_RESULT", "2026-10-01 12:00:00"]])
        code, out, error = self.run_main()
        self.assertEqual(code, 0)
        artifacts = "".join(p.read_text() for p in self.output.iterdir())
        for value in ["987654321", "1234567.89", "2026-10-01 12:00:00", "SYNTHETIC_PRIVATE", str(self.input), str(self.output)]:
            self.assertNotIn(value, artifacts + out + error)
        self.assertNotIn("dataset_sha256", out)
        template = json.loads((self.output / "mapping-template.json").read_text())
        self.assertFalse(template["canonical_emission"])
        self.assertEqual(template["codebooks"]["ccy"][0]["first_data_row"], 1)
        self.assertIsNone(template["codebooks"]["ccy"][0]["target_value"])

    def test_insecure_symlink_hardlink_fifo_and_relative_input_rejected(self):
        self.write()
        self.input.chmod(0o644)
        self.assertEqual(self.run_main()[0], 1)
        self.input.chmod(0o600)
        alias = self.base / "alias.csv"
        alias.symlink_to(self.input)
        with self.assertRaises(OSError):
            profile.profile_file(alias, "transfer")
        alias.unlink(); os.link(self.input, alias)
        self.assertEqual(self.run_main()[0], 1)
        alias.unlink(); self.input.unlink(); os.mkfifo(self.input, 0o600)
        self.assertEqual(self.run_main()[0], 1)
        with self.assertRaises(profile.DatasetError):
            profile.profile_file(Path("relative.csv"), "transfer")
        self.assertFalse(self.output.exists())

    def test_insecure_parent_and_output_links_are_not_repaired(self):
        self.write()
        self.base.chmod(0o755)
        self.assertEqual(self.run_main()[0], 1)
        self.base.chmod(0o700)
        self.output.symlink_to(self.base, target_is_directory=True)
        self.assertEqual(self.run_main()[0], 1)
        self.assertTrue(self.output.is_symlink())

    def test_partial_or_tampered_reports_are_preserved(self):
        self.write()
        self.output.mkdir(mode=0o700)
        pending = self.output / "pending-report.json"
        pending.write_text("SYNTHETIC_PRIVATE_PARTIAL"); pending.chmod(0o600)
        self.assertEqual(self.run_main()[0], 1)
        self.assertEqual(pending.read_text(), "SYNTHETIC_PRIVATE_PARTIAL")
        pending.unlink(); self.output.rmdir()
        self.assertEqual(self.run_main()[0], 0)
        report = self.output / "report.json"
        report.write_text("SYNTHETIC_PRIVATE_TAMPER")
        code, out, error = self.run_main()
        self.assertEqual(code, 1)
        self.assertNotIn("SYNTHETIC_PRIVATE", out + error)
        self.assertEqual(report.read_text(), "SYNTHETIC_PRIVATE_TAMPER")

    def test_report_read_permissions_links_and_size_are_checked(self):
        self.write(); self.assertEqual(self.run_main()[0], 0)
        report = self.output / "report.json"
        original = report.read_bytes()
        report.chmod(0o644); self.assertEqual(self.run_main()[0], 1); report.chmod(0o600)
        alias = self.base / "alias.json"; os.link(report, alias)
        self.assertEqual(self.run_main()[0], 1); alias.unlink()
        report.unlink(); report.symlink_to(self.input)
        self.assertEqual(self.run_main()[0], 1); report.unlink()
        os.mkfifo(report, 0o600); self.assertEqual(self.run_main()[0], 1); report.unlink()
        report.write_bytes(b"x" * (profile.MAX_REPORT_BYTES + 1)); report.chmod(0o600)
        self.assertEqual(self.run_main()[0], 1)
        report.write_bytes(original)
        self.assertEqual(self.run_main()[0], 0)

    def test_invalid_usage_and_production_mode_never_echo_arguments(self):
        for args in [["--SYNTHETIC_PRIVATE_ARGUMENT"], ["--table", "SYNTHETIC_PRIVATE_TABLE"], ["--tab", "transfer"]]:
            code, out, error = self.run_main(*args)
            self.assertEqual(code, 1)
            self.assertNotIn("SYNTHETIC_PRIVATE", out + error)
        self.write()
        with patch.dict(os.environ, {"LMPS_ENVIRONMENT": "production"}), contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(profile.main(["--table", "transfer", "--input", str(self.input), "--output-dir", str(self.output)]), 1)
        self.assertFalse(self.output.exists())

    def test_real_cli_process_outputs_counts_only_and_no_traceback(self):
        self.write()
        result = subprocess.run([sys.executable, str(SCRIPT), "--table", "transfer", "--input", str(self.input), "--output-dir", str(self.output)], capture_output=True, text=True, timeout=10,
                                env={**os.environ, "LMPS_ENVIRONMENT": "test", "LMPS_EXECUTION_MODE": "test", "NODE_ENV": "test"})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(set(json.loads(result.stdout)), {"format", "status", "validation_status", "observed_rows"})
        self.assertEqual(result.stderr, "")
        self.assertEqual(self.input.stat().st_mode & 0o777, 0o600)

    def test_concurrent_cli_publication_has_one_winner_and_replay_recovers(self):
        self.write()
        command = [sys.executable, str(SCRIPT), "--table", "transfer", "--input", str(self.input), "--output-dir", str(self.output)]
        env = {**os.environ, "LMPS_ENVIRONMENT": "test", "LMPS_EXECUTION_MODE": "test", "NODE_ENV": "test"}
        children = [subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env) for _ in range(4)]
        results = [(child, child.communicate(timeout=10)) for child in children]
        successful = [json.loads(out) for child, (out, error) in results if child.returncode == 0]
        self.assertEqual(sum(r["status"] == "profiled" for r in successful), 1)
        self.assertTrue(all(child.returncode in (0, 1) for child, _ in results))
        code, out, error = self.run_main()
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out)["status"], "duplicate")

    def test_documented_root_command_suppresses_package_manager_argument_echo(self):
        self.write()
        result = subprocess.run(["pnpm", "--silent", "dataset:profile", "--table", "transfer", "--input", str(self.input), "--output-dir", str(self.output)],
                                cwd=ROOT, capture_output=True, text=True, timeout=20,
                                env={**os.environ, "LMPS_ENVIRONMENT": "test", "LMPS_EXECUTION_MODE": "test", "NODE_ENV": "test"})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["status"], "profiled")
        self.assertNotIn(str(self.input), result.stdout + result.stderr)
        self.assertNotIn(str(self.output), result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
