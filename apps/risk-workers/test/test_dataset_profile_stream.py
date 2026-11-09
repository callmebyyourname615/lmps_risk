"""Cross-check exact streaming summaries against the bounded SQLite implementation."""

from pathlib import Path
import json
import socket
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import test_dataset_profile_month as fixtures
import dataset_month_stream as stream
import dataset_readiness as month


class StreamingTests(fixtures.MonthProfileTests):
    def run_profile(self, plan):
        with patch.object(socket, "socket", side_effect=AssertionError("No network")):
            return stream.profile_plan(plan, str(self.root))

    def test_table_scopes_archive_keys_and_cross_table_overlap_do_not_merge(self):
        row = self.row()
        with self.assertRaises(ValueError):
            self.run_profile(self.plan([self.file([row]), self.file([row], "transfer_hist")]))
        table = self.run_profile(self.plan([self.file([row, self.row(stamp="2026-10-02 00:00:00")], "transfer_old")]))["tables"][0]
        self.assertEqual(table["conflicting_source_keys_withheld"], 1)
        self.assertEqual(table["profiled_month_observations"], 0)

    def test_hash_rows_links_permissions_production_and_caps_fail_closed(self):
        # Parent assertions patch the original SQLite caps; use this mode's explicit caps.
        f = self.file([self.row()])
        for changes in ({"sha256": "a"*64}, {"expected_rows": 2}, {"path": "relative.csv"}):
            with self.subTest(changes=changes), self.assertRaises(Exception):
                self.run_profile(self.plan([{**f, **changes}]))
        source = Path(f["path"])
        source.chmod(0o644)
        with self.assertRaises(Exception):
            self.run_profile(self.plan([f]))
        source.chmod(0o600)
        with patch.dict("os.environ", {"NODE_ENV": "production"}), self.assertRaises(Exception):
            self.run_profile(self.plan([f]))
        for key, value in [("MAX_ROWS", 0), ("MAX_FILES", 0), ("MAX_TOTAL_BYTES", 1),
                           ("MAX_SCRATCH_BYTES", 1), ("MAX_SECONDS", -1)]:
            with patch.object(stream, key, value), self.subTest(key=key), self.assertRaises(Exception):
                self.run_profile(self.plan([f]))
        with patch.object(stream.shutil, "disk_usage", return_value=SimpleNamespace(free=stream.FREE_RESERVE)), self.assertRaises(Exception):
            self.run_profile(self.plan([f]))
        self.assertFalse(list(self.root.glob(".month-stream-*")))

    def test_external_runs_match_sqlite_with_duplicates_conflicts_and_exact_quantiles(self):
        rows = [self.row(str(i), f"{i-30}.00", "LAK" if i % 2 else "THB",
                         "OK" if i % 3 else "PRIVATE_UNKNOWN") for i in range(1, 85)]
        plan = self.plan([self.file(rows, tsv=True), self.file([rows[0], rows[20], self.row("15", "0.01"),
                        rows[14], self.row("90", "9999999999999999999999.99")], tsv=True)])
        reference = month.profile_plan(plan, str(self.root))
        with patch.object(stream, "RUN_ROWS", 2):
            actual = self.run_profile(plan)
        for name in ("tables", "code_distributions", "input_files", "observed_rows", "decoded_bytes"):
            self.assertEqual(actual[name], reference[name], name)
        self.assertEqual(actual["verification_passes"], 3)
        self.assertLessEqual(actual["scratch_peak_bytes"], 89 * stream.KEY_BYTES)
        self.assertFalse(list(self.root.glob(".month-stream-*")))
        self.assertNotIn("PRIVATE_UNKNOWN", json.dumps(actual))

    def test_changed_source_between_passes_is_rejected_and_scratch_removed(self):
        f = self.file([self.row()])
        real_records = stream.SortedRuns.records
        def records(runs):
            yield from real_records(runs)
            if runs.prefix == "keys":
                with Path(f["path"]).open("ab") as out:
                    out.write(b"\n")
        with patch.object(stream.SortedRuns, "records", records), self.assertRaises(Exception):
            self.run_profile(self.plan([f]))
        self.assertFalse(list(self.root.glob(".month-stream-*")))

    def test_disk_reserve_during_sort_and_second_pass_are_enforced(self):
        f = self.file([self.row()])
        real_progress = stream.Budget.progress
        def progress(budget, phase, files, rows):
            real_progress(budget, phase, files, rows)
            if phase == "deduplicate_keys":
                budget.started -= stream.MAX_SECONDS + 1
        with patch.object(stream.Budget, "progress", progress), self.assertRaises(Exception):
            self.run_profile(self.plan([f]))
        real_usage = stream.shutil.disk_usage
        calls = 0
        def usage(path):
            nonlocal calls
            calls += 1
            return real_usage(path) if calls <= 2 else SimpleNamespace(free=0)
        with patch.object(stream.shutil, "disk_usage", usage), self.assertRaises(Exception):
            self.run_profile(self.plan([f]))
        self.assertFalse(list(self.root.glob(".month-stream-*")))

    def test_hourly_partition_matches_sqlite_and_reclaims_each_hour(self):
        first = [self.row("1"), self.row("2", "200.00")]
        second = [first[0], self.row("2", "250.00"), first[1]]
        later = [self.row("1", "0.01", stamp="2026-10-01 01:00:00"),
                 self.row("4", "9999999999999999999999.99", stamp="2026-10-01 01:00:00")]
        plan = self.plan([self.file(first, tsv=True), self.file(second, tsv=True), self.file(later, tsv=True)])
        reference = month.profile_plan(plan, str(self.root))
        with patch.object(stream, "RUN_ROWS", 2):
            result = stream.profile_plan(plan, str(self.root), hourly=True)
        self.assertEqual(result["tables"], reference["tables"])
        self.assertEqual(result["verification_passes"], 2)
        self.assertEqual(result["capacity_mode"], "streaming_hourly_v1")
        self.assertEqual(result["scratch_peak_bytes"], 5 * stream.CONFLICT_BYTES)
        self.assertFalse(list(self.root.glob(".month-stream-*")))

    def test_hourly_checks_file_boundaries_monotonic_hours_and_archive_scope(self):
        first = self.row()
        later = self.row("2", stamp="2026-10-01 01:00:00")
        for files in ([self.file([first, later])], [self.file([later]), self.file([first])],
                      [self.file([first], "transfer_old")]):
            with self.assertRaises(ValueError):
                stream.profile_plan(self.plan(files), str(self.root), hourly=True)
        self.assertFalse(list(self.root.glob(".month-stream-*")))

    def test_hourly_completes_under_scratch_cap_that_rejects_global_key_sort(self):
        files = []
        for i in range(50):
            stamp = f"2026-10-{i//24+1:02d} {i%24:02d}:00:00"
            files.append(self.file([self.row(str(i*2), stamp=stamp), self.row(str(i*2+1), stamp=stamp)]))
        plan = self.plan(files)
        reference = month.profile_plan(plan, str(self.root))
        with patch.object(stream, "RUN_ROWS", 2), patch.object(stream, "MAX_SCRATCH_BYTES", 1500):
            with self.assertRaises(ValueError):
                self.run_profile(plan)
            result = stream.profile_plan(plan, str(self.root), hourly=True)
        self.assertEqual(result["tables"], reference["tables"])
        self.assertEqual(result["scratch_peak_bytes"], 1200)


if __name__ == "__main__":
    unittest.main()
