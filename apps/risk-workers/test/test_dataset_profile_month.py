"""Private invented month partitions; no database/source access."""

import csv
import gzip
from hashlib import sha256
import json
import os
from pathlib import Path
import socket
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import dataset_readiness as month
import dataset_profile as profile
import export_transfer as export


class MonthProfileTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="lmps-month-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.root.chmod(0o700)
        self.sequence = 0

    def file(self, rows, table="transfer", columns=None, tsv=False):
        columns = columns or list(profile.TRANSFER)
        self.sequence += 1
        path = self.root / (str(self.sequence) + (".tsv.gz" if tsv else ".csv"))
        if tsv:
            raw = ("\t".join(columns) + "\n").encode()
            raw += b"".join(("\t".join(export.field(row.get(n)) for n in columns) + "\n").encode() for row in rows)
            path.write_bytes(gzip.compress(raw, mtime=0))
        else:
            with path.open("w", newline="") as f:
                writer = csv.writer(f, lineterminator="\n")
                writer.writerow(columns)
                writer.writerows([[r"\N" if row.get(n) is None else row[n] for n in columns] for row in rows])
        path.chmod(0o600)
        return {"path": str(path), "table": table, "encoding": "export_tsv_gzip" if tsv else "csv",
                "sha256": sha256(path.read_bytes()).hexdigest(), "expected_rows": len(rows)}

    def row(self, id="1", amount="100.00", currency="LAK", result="OK", stamp="2026-10-01 00:00:00"):
        return dict(id=id, requesttime=stamp, txtime=stamp, amount=amount, ccy=currency, result=result)

    def plan(self, files, **changes):
        return {"format": month.VERSION, "month": "2026-10", "files": files,
                "amount_screens": [{"currency": "LAK", "threshold": "100.00"}], **changes}

    def run_profile(self, plan):
        with patch.object(socket, "socket", side_effect=AssertionError("No network")):
            return month.profile_plan(plan, str(self.root))

    def test_cross_file_dedup_conflict_exact_money_and_screen_reconcile(self):
        huge = "9999999999999999999999.99"
        rows = [self.row(), self.row("2", "200.00"), self.row("3", "0.00"), self.row("4", "-1.00"),
                self.row("5", "300.00", "THB", "TRANSACTION_FAILED"), self.row("6", "400.00", "THB", "PRIVATE_UNKNOWN_RESULT"),
                self.row("7", huge), self.row("8", "50.00", stamp="2026-09-30 23:59:59")]
        plan = self.plan([self.file(rows), self.file([rows[0], self.row("2", "250.00"), self.row("9", "1.00")])])
        report = self.run_profile(plan)
        table = report["tables"][0]
        self.assertEqual(report["observed_rows"], 11)
        self.assertEqual(table["unique_complete_source_keys"], 9)
        self.assertEqual(table["duplicate_key_rows"], 2)
        self.assertEqual(table["conflicting_source_keys_withheld"], 1)
        self.assertEqual(table["profiled_month_observations"], 7)
        self.assertEqual(table["before_requested_month"], 1)
        self.assertEqual(table["days_without_observed_rows"], 30)
        lak, thb = table["currencies"]
        self.assertEqual(lak["currency_ref"], "LAK")
        self.assertEqual(lak["recorded_amount_total"], "10000000000000000000099.99")
        self.assertEqual(lak["recorded_amount_quantiles"], {"min": "-1.00", "p50": "1.00", "p90": huge, "p95": huge, "p99": huge, "max": huge})
        self.assertEqual(lak["amount_screens"][0]["counts"], {"matched": 2, "below_threshold": 1,
                         "failed_or_zero_not_applicable": 1, "negative_amount_withheld": 1})
        self.assertEqual(thb["recorded_amount_total"], "700.00")
        self.assertEqual(thb["amount_screens"], [])
        self.assertEqual(sum(x["rows"] for x in report["code_distributions"]["ccy"]), 11)
        self.assertNotIn("PRIVATE_UNKNOWN_RESULT", json.dumps(report))
        self.assertFalse(list(self.root.glob(".month-profile-*")))
        self.assertEqual(report, self.run_profile(plan))

    def test_pilot_gzip_escapes_widths_privacy_and_schema_mismatch(self):
        row = {n: None for n in export.PILOT_COLUMNS}
        row.update(self.row(), reference="PRIVATE_REFERENCE", frommember="0001", tomember="0002", totype="PRIVATE_TYPE",
                   fromaccount="000001", toaccount="PRIVATE_ACCOUNT" + "\t\n\\" * 1000,
                   fee="0.10", isreconciled="0", issettled="0", fromchannel="PRIVATE_CHANNEL")
        plan = self.plan([self.file([row], columns=list(export.PILOT_COLUMNS), tsv=True)])
        report = self.run_profile(plan)
        self.assertEqual(report["tables"][0]["invalid_rows"], 0)
        self.assertEqual(report["tables"][0]["fields"]["toaccount"]["null_rows"], 0)
        for marker in ("PRIVATE_ACCOUNT", "PRIVATE_REFERENCE", "PRIVATE_CHANNEL", "PRIVATE_TYPE", str(self.root), "000001"):
            self.assertNotIn(marker, json.dumps(report))
        self.assertEqual(report["account_identity"], "unverified")
        bad = self.plan([self.file([row], columns=[*profile.TRANSFER, "fromaccount"])])
        with self.assertRaises(ValueError):
            self.run_profile(bad)

    def test_table_scopes_archive_keys_and_cross_table_overlap_do_not_merge(self):
        row = self.row()
        report = self.run_profile(self.plan([self.file([row]), self.file([row], "transfer_hist"), self.file([row], "transfer_old")]))
        self.assertEqual(len(report["tables"]), 3)
        self.assertEqual(len(report["cross_table_overlaps"]), 3)
        self.assertTrue(all(t["profiled_month_observations"] == 1 for t in report["tables"]))
        report = self.run_profile(self.plan([self.file([row, self.row(stamp="2026-10-02 00:00:00")], "transfer_old")]))
        self.assertEqual(report["tables"][0]["conflicting_source_keys_withheld"], 1)
        self.assertEqual(report["tables"][0]["profiled_month_observations"], 0)

    def test_invalid_fields_empty_month_and_month_boundaries_stay_explicit(self):
        rows = [self.row("1", stamp="2026-09-30 23:59:59"), self.row("2", stamp="2026-10-31 23:59:59"),
                self.row("3", stamp="2026-11-01 00:00:00"), self.row("4", amount="NaN"), self.row("5", stamp="2026-02-30 00:00:00")]
        table = self.run_profile(self.plan([self.file(rows)]))["tables"][0]
        self.assertEqual(table["invalid_rows"], 2)
        self.assertEqual(table["profiled_month_observations"], 1)
        self.assertEqual((table["before_requested_month"], table["after_requested_month"]), (1, 1))
        empty = self.run_profile(self.plan([self.file([])]))["tables"][0]
        self.assertEqual(empty["currencies"], [])
        self.assertEqual(empty["days_without_observed_rows"], 31)

    def test_hash_rows_links_permissions_production_and_caps_fail_closed(self):
        original = self.file([self.row()])
        for changes in ({"sha256": "a"*64}, {"expected_rows": 2}, {"path": "relative.csv"}):
            with self.subTest(changes=list(changes)), self.assertRaises(Exception):
                self.run_profile(self.plan([{**original, **changes}]))
        source = Path(original["path"])
        link = self.root / "link.csv"
        link.symlink_to(source)
        with self.assertRaises(Exception):
            self.run_profile(self.plan([{**original, "path": str(link)}]))
        source.chmod(0o644)
        with self.assertRaises(Exception):
            self.run_profile(self.plan([original]))
        source.chmod(0o600)
        hard = self.root / "hard.csv"
        os.link(source, hard)
        with self.assertRaises(Exception):
            self.run_profile(self.plan([original]))
        hard.unlink()
        with patch.dict(os.environ, {"NODE_ENV": "production"}), self.assertRaises(Exception):
            self.run_profile(self.plan([original]))
        for key, value in [("MAX_ROWS", 0), ("MAX_TOTAL_BYTES", 1), ("MAX_SECONDS", -1)]:
            with patch.object(month, key, value), self.assertRaises(Exception):
                self.run_profile(self.plan([original]))
        self.assertFalse(list(self.root.glob(".month-profile-*")))

    def test_input_changes_during_read_never_return_a_report(self):
        f = self.file([self.row()])
        real_read = profile.HashedReader.readinto
        mutated = False
        def read(reader, buffer):
            nonlocal mutated
            n = real_read(reader, buffer)
            if not mutated:
                mutated = True
                with Path(f["path"]).open("ab") as out:
                    out.write(b"\n")
            return n
        with patch.object(profile.HashedReader, "readinto", read), self.assertRaises(Exception):
            self.run_profile(self.plan([f]))

    def test_projection_and_column_specs_match_supplied_schema(self):
        metadata = json.loads((Path(__file__).resolve().parents[3] / "docs/data-dictionary/lmps-schema/metadata.json").read_text())
        declared = {t["name"]: {c["name"]: c for c in t["columns"]} for t in metadata["tables"]}
        for name in export.PILOT_COLUMNS:
            self.assertIn(name, declared["transfer"])
        for table in ("transfer_hist", "transfer_old"):
            self.assertEqual(set(export.PILOT_COLUMNS) - set(declared[table]), {"fromchannel"})
        self.assertEqual(month.SPECS["toaccount"][1], 5000)


if __name__ == "__main__":
    unittest.main()
