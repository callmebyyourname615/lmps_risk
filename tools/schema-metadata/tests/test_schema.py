from contextlib import redirect_stderr, redirect_stdout
from hashlib import sha256
from io import StringIO
import json
import logging
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from lmps_schema.__main__ import main
from lmps_schema.analyze import MAX_INPUT_BYTES, analyze
from lmps_schema.report import enrich, render_markdown

FIXTURE = Path(__file__).parent / "fixtures/schema.sql"
CANARY = "SYNTHETIC_PRIVATE_CANARY"


class InventoryTests(unittest.TestCase):
    def setUp(self):
        self.data = FIXTURE.read_bytes()
        self.report = enrich(analyze(self.data))
        self.table = next(table for table in self.report["tables"] if table["name"] == "synthetic_transfer_hist")

    def column(self, name):
        return next(column for column in self.table["columns"] if column["name"] == name)

    def test_counts_and_complete_supported_subset(self):
        self.assertEqual(self.report["coverage"], "complete_for_supported_inventory")
        self.assertEqual(self.report["counts"]["tables"], 2)
        self.assertEqual(self.report["counts"]["columns"], 13)
        self.assertEqual(self.report["counts"]["indexes"], 6)
        self.assertEqual(self.report["counts"]["foreign_keys"], 1)

    def test_composite_and_inline_keys(self):
        primary = next(index for index in self.table["indexes"] if index["kind"] == "primary")
        self.assertEqual([column["name"] for column in primary["columns"]], ["id", "requesttime"])
        parent = self.report["tables"][0]
        self.assertEqual([index["kind"] for index in parent["indexes"]], ["primary", "unique"])

    def test_precision_unsigned_and_nullability(self):
        self.assertEqual(self.column("amount")["numeric_parameters"], [24, 2])
        self.assertEqual(self.column("id")["data_type"], "ubigint")
        self.assertFalse(self.column("id")["nullable"])
        self.assertTrue(self.column("id")["auto_increment"])
        self.assertTrue(self.column("seen_at")["nullable"])
        self.assertEqual(self.column("seen_at")["nullability_basis"], "explicit")

    def test_prefix_and_descending_indexes(self):
        prefix = next(index for index in self.table["indexes"] if index["name"] == "sender_prefix")
        descending = next(index for index in self.table["indexes"] if index["name"] == "amount_desc")
        self.assertEqual(prefix["columns"][0]["prefix_length"], 10)
        self.assertEqual(descending["columns"][0]["direction"], "desc")

    def test_declared_foreign_key(self):
        key = self.table["foreign_keys"][0]
        self.assertEqual(key["columns"], ["parent_id"])
        self.assertEqual(key["referenced_table"], "synthetic_parent")
        self.assertEqual(key["referenced_columns"], ["id"])
        self.assertEqual(key["actions"], ["ON DELETE CASCADE"])

    def test_no_literals_comments_defaults_or_enum_values(self):
        serialized = json.dumps(self.report) + render_markdown(self.report)
        self.assertNotIn(CANARY, serialized)
        self.assertNotIn("SYNTHETIC_OTHER", serialized)
        self.assertNotIn("fake", serialized)
        self.assertTrue(self.column("result")["type_values_redacted"])

    def test_provenance_and_determinism(self):
        self.assertEqual(self.report["source"]["sha256"], sha256(self.data).hexdigest())
        self.assertEqual(self.report, enrich(analyze(self.data)))

    def test_candidates_are_unverified_and_name_based(self):
        self.assertIn("synthetic_transfer_hist", self.report["history_or_backup_name_candidates"])
        sender = next(item for item in self.report["field_candidates"] if item["column"] == "fromaccount")
        self.assertEqual(sender["roles"], ["sender_account_field"])
        self.assertIn("not confirmed", self.report["candidate_basis"])
        self.assertTrue(any("Binlog" in item for item in self.report["unverified"]))

    def test_no_network_is_used(self):
        with patch("socket.socket", side_effect=AssertionError("Network access is forbidden")):
            self.assertEqual(analyze(self.data)["counts"]["tables"], 2)

    def test_fulltext_and_spatial_kinds(self):
        report = analyze(b"CREATE TABLE t (body TEXT, point GEOMETRY, FULLTEXT KEY ft (body), SPATIAL KEY sp (point));")
        self.assertEqual([index["kind"] for index in report["tables"][0]["indexes"]], ["fulltext", "spatial"])

    def test_unknown_timestamp_setting_remains_unknown(self):
        report = analyze(b"CREATE TABLE t (seen TIMESTAMP);")
        self.assertIsNone(report["tables"][0]["columns"][0]["nullable"])

    def test_auto_increment_implies_not_null_without_primary_key(self):
        report = analyze(b"CREATE TABLE t (id INT AUTO_INCREMENT UNIQUE);")
        column = report["tables"][0]["columns"][0]
        self.assertFalse(column["nullable"])
        self.assertEqual(column["nullability_basis"], "auto_increment")

    def test_table_and_column_checks_are_not_silently_ignored(self):
        report = analyze(b"CREATE TABLE t (id INT CHECK(id > 0), CHECK(id < 100));")
        self.assertEqual(report["coverage"], "partial")
        self.assertIn("CHECK_EXPRESSION_NOT_EXTRACTED", {item["code"] for item in report["issues"]})
        self.assertIn("TABLE_CONSTRAINT_NOT_EXTRACTED", {item["code"] for item in report["issues"]})

    def test_alter_standalone_index_and_insert_are_not_applied(self):
        report = analyze(b"CREATE TABLE t (id INT); ALTER TABLE t ADD secret INT; CREATE INDEX ix ON t(id); INSERT INTO t VALUES ('SYNTHETIC_PRIVATE_CANARY');")
        self.assertEqual(report["coverage"], "partial")
        self.assertEqual(len(report["tables"][0]["columns"]), 1)
        self.assertNotIn(CANARY, json.dumps(report))

    def test_unsupported_tail_retains_column_and_key_inventory(self):
        report = analyze(b"CREATE TABLE t (id INT PRIMARY KEY) SYNTHETIC_BAD_OPTION 'SYNTHETIC_PRIVATE_CANARY';")
        self.assertEqual(report["coverage"], "partial")
        self.assertEqual(report["counts"]["tables"], 1)
        self.assertEqual(report["tables"][0]["columns"][0]["name"], "id")
        self.assertNotIn(CANARY, json.dumps(report))

    def test_executable_ddl_comment_is_reported(self):
        report = analyze(b"CREATE TABLE t (id INT); /*!50001 ALTER TABLE t ADD secret INT */;")
        self.assertIn("EXECUTABLE_COMMENT_NOT_EXTRACTED", {item["code"] for item in report["issues"]})

    def test_duplicate_create_is_flagged(self):
        report = analyze(b"CREATE TABLE t (id INT); CREATE TABLE t (other INT);")
        self.assertEqual(len(report["tables"]), 2)
        self.assertIn("DUPLICATE_TABLE_DECLARATION", {item["code"] for item in report["issues"]})

    def test_malformed_or_empty_input_has_incomplete_coverage(self):
        for sql in (b"", b"-- only a comment", b"CREATE TABLE t (id INT", b"CREATE TABLE t (id INT DEFAULT 'unterminated"):
            with self.subTest(size=len(sql)):
                self.assertEqual(analyze(sql)["coverage"], "partial")

    def test_non_metadata_identifiers_are_redacted(self):
        report = analyze(b"CREATE TABLE `unsafe|name` (`unsafe<script>` INT);")
        self.assertIsNone(report["tables"][0]["name"])
        self.assertIsNone(report["tables"][0]["columns"][0]["name"])
        self.assertNotIn("<script>", render_markdown(enrich(report)))

    def test_logging_state_is_restored(self):
        logger = logging.getLogger("sqlglot")
        before = logger.handlers[:], logger.propagate, logger.level
        analyze(b"CREATE TABLE t (id INT DEFAULT 'unterminated")
        self.assertEqual((logger.handlers, logger.propagate, logger.level), before)


class CliTests(unittest.TestCase):
    def invoke(self, source, output, *extra):
        stdout, stderr = StringIO(), StringIO()
        with redirect_stdout(stdout), redirect_stderr(stderr):
            code = main(["--input", str(source), "--output-dir", str(output), *extra])
        return code, stdout.getvalue(), stderr.getvalue()

    def test_real_entrypoint_writes_reports_without_modifying_input(self):
        with tempfile.TemporaryDirectory() as temp:
            source, output = Path(temp)/"schema.sql", Path(temp)/"report"
            source.write_bytes(FIXTURE.read_bytes())
            before = source.read_bytes()
            result = subprocess.run([sys.executable, "-m", "lmps_schema", "--input", str(source), "--output-dir", str(output)], capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 0)
            self.assertEqual(source.read_bytes(), before)
            self.assertEqual(json.loads((output/"metadata.json").read_text())["counts"]["tables"], 2)
            self.assertNotIn(CANARY, result.stdout + result.stderr + (output/"report.md").read_text())

    def test_partial_report_exits_two_without_echoing_sql(self):
        with tempfile.TemporaryDirectory() as temp:
            source, output = Path(temp)/"schema.sql", Path(temp)/"report"
            source.write_text("CREATE FOO 'SYNTHETIC_PRIVATE_CANARY';")
            code, stdout, stderr = self.invoke(source, output)
            self.assertEqual(code, 2)
            self.assertNotIn(CANARY, stdout + stderr + (output/"metadata.json").read_text())

    def test_missing_invalid_utf8_and_oversized_input_are_safe_errors(self):
        with tempfile.TemporaryDirectory() as temp:
            source, output = Path(temp)/CANARY, Path(temp)/"report"
            for data in (None, b"\xff", b" " * (MAX_INPUT_BYTES + 1)):
                if data is not None:
                    source.write_bytes(data)
                code, stdout, stderr = self.invoke(source, output)
                self.assertEqual(code, 1)
                self.assertNotIn(CANARY, stdout + stderr)
                self.assertFalse(output.exists())

    def test_existing_report_requires_explicit_overwrite(self):
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp)/"report"
            self.assertEqual(self.invoke(FIXTURE, output)[0], 0)
            self.assertEqual(self.invoke(FIXTURE, output)[0], 1)
            self.assertEqual(self.invoke(FIXTURE, output, "--overwrite")[0], 0)

    def test_output_cannot_replace_input_even_with_overwrite(self):
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp)/"metadata.json"
            source.write_bytes(FIXTURE.read_bytes())
            before = source.read_bytes()
            self.assertEqual(self.invoke(source, Path(temp), "--overwrite")[0], 1)
            self.assertEqual(source.read_bytes(), before)

    def test_symlink_output_cannot_replace_input(self):
        with tempfile.TemporaryDirectory() as temp:
            source, output = Path(temp)/"schema.sql", Path(temp)/"report"
            source.write_bytes(FIXTURE.read_bytes())
            output.mkdir()
            (output/"report.md").symlink_to(source)
            before = source.read_bytes()
            self.assertEqual(self.invoke(source, output, "--overwrite")[0], 1)
            self.assertEqual(source.read_bytes(), before)

    def test_hardlink_output_cannot_replace_input(self):
        with tempfile.TemporaryDirectory() as temp:
            source, output = Path(temp)/"schema.sql", Path(temp)/"report"
            source.write_bytes(FIXTURE.read_bytes())
            output.mkdir()
            (output/"metadata.json").hardlink_to(source)
            self.assertEqual(self.invoke(source, output, "--overwrite")[0], 1)
            self.assertEqual(source.read_bytes(), FIXTURE.read_bytes())

    def test_case_insensitive_alias_cannot_replace_input(self):
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp)/"METADATA.JSON"
            source.write_bytes(FIXTURE.read_bytes())
            if not (Path(temp)/"metadata.json").exists():
                self.skipTest("Filesystem is case sensitive")
            self.assertEqual(self.invoke(source, Path(temp), "--overwrite")[0], 1)
            self.assertEqual(source.read_bytes(), FIXTURE.read_bytes())


if __name__ == "__main__":
    unittest.main()
