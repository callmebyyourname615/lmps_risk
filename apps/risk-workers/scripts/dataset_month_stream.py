"""Verified streaming passes, bounded external sorts and exact money summaries.

Only one source table per streaming run. Scratch contains SHA-256 commitments,
ordinals or recorded amounts with report-local currency IDs, never account text.
"""

from collections import Counter
from contextlib import ExitStack
from hashlib import sha256
from pathlib import Path
import calendar
import heapq
import json
import os
import shutil
import sys
import tempfile
import time

import dataset_readiness as month

MAX_FILES = 4096
MAX_ROWS = 30_000_000
MAX_TOTAL_BYTES = 16 * 1024**3
MAX_SCRATCH_BYTES = 2 * 1024**3
FREE_RESERVE = 1024**3
MAX_SECONDS = 7200
RUN_ROWS = 250_000
KEY_BYTES = 36
CONFLICT_BYTES = 68
AMOUNT_BYTES = 12
AMOUNT_OFFSET = 10**24


class Budget:
    def __init__(self, root):
        self.root = root
        self.started = time.monotonic()
        self.disk_bytes = 0
        self.peak_bytes = 0

    def check(self, additional=0):
        month.check(time.monotonic() - self.started <= MAX_SECONDS)
        month.check(self.disk_bytes + additional <= MAX_SCRATCH_BYTES)
        month.check(shutil.disk_usage(self.root).free >= FREE_RESERVE + additional)

    def progress(self, phase, files, rows):
        self.check()
        payload = month.encoded(dict(phase=phase, files=files, rows=rows,
                                     scratch_bytes=self.disk_bytes))
        target = self.root / "progress.json"
        with target.open("wb") as out:
            os.chmod(target, 0o600)
            out.write(payload)


class SortedRuns:
    def __init__(self, budget, prefix, width):
        self.budget, self.prefix, self.width = budget, prefix, width
        self.chunk, self.paths = [], []

    def add(self, record):
        self.chunk.append(record)
        if len(self.chunk) >= RUN_ROWS:
            self.flush()

    def flush(self):
        if not self.chunk:
            return
        size = len(self.chunk) * self.width
        self.budget.check(size)
        self.chunk.sort()
        path = self.budget.root / f"{self.prefix}-{len(self.paths):04d}.bin"
        with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as out:
            out.write(b"".join(self.chunk))
        self.budget.disk_bytes += size
        self.budget.peak_bytes = max(self.budget.peak_bytes, self.budget.disk_bytes)
        self.paths.append(path)
        self.chunk.clear()

    def records(self):
        self.flush()
        # At most 120 runs at the production row cap; no merged copy is written.
        month.check(len(self.paths) <= 128)
        with ExitStack() as stack:
            def read(path, source):
                while record := source.read(self.width):
                    month.check(len(record) == self.width)
                    yield record
                size = path.stat().st_size
                path.unlink()
                self.budget.disk_bytes -= size

            inputs = [read(p, stack.enter_context(p.open("rb", buffering=131072))) for p in self.paths]
            for i, record in enumerate(heapq.merge(*inputs)):
                if i % 16384 == 0:
                    self.budget.check()
                yield record
        month.check(self.budget.disk_bytes == 0)


def bit_get(bits, ordinal):
    return bool(bits[ordinal >> 3] & (1 << (ordinal & 7)))


def bit_clear(bits, ordinal):
    bits[ordinal >> 3] &= 255 ^ (1 << (ordinal & 7))


def profile_plan(plan, scratch, *, hourly=False):
    month.pilot.mode()
    month.validate_plan(plan, max_files=MAX_FILES, max_rows=MAX_ROWS)
    month.check(len({f["table"] for f in plan["files"]}) == 1)
    month.check(type(hourly) is bool)
    month.check(not hourly or plan["files"][0]["table"] != "transfer_old")
    scratch = month.canonical_private(scratch)
    os.close(month.profile.private_directory(scratch))
    expected = sum(f["expected_rows"] for f in plan["files"])
    required = max(min(expected, RUN_ROWS) * CONFLICT_BYTES, expected * AMOUNT_BYTES) if hourly else expected * KEY_BYTES
    month.check(required <= MAX_SCRATCH_BYTES)
    month.check(shutil.disk_usage(scratch).free >= required + FREE_RESERVE + 64 * 1024**2)
    eligible = bytearray((expected + 7) // 8)
    repeated = bytearray(len(eligible))
    name = plan["files"][0]["table"]
    table = dict(source_table=name, observed_rows=0, malformed_rows=0, invalid_rows=0,
                 invalid_key_rows=0, duplicate_key_rows=0, conflicting_duplicate_rows=0,
                 unique_complete_source_keys=0, conflicting_source_keys_withheld=0,
                 valid_nonconflicting_keys=0, profiled_month_observations=0,
                 outside_requested_month=0, before_requested_month=0, after_requested_month=0, fields={})
    codes, combinations, evidence, projection = {}, Counter(), [], None
    selectors = ("result", "txtype", "totype", "shouldrevert", "isreconciled", "issettled")

    def code_ref(field, value, count=True):
        if value is None:
            return None
        groups = codes.setdefault(field, {})
        month.check(value in groups or len(groups) < month.MAX_CODES)
        if value not in groups:
            month.check(count)
            label = value if field == "ccy" and value in ("LAK", "THB", "USD", "CNY", "SYN") else f"{field}_code_{len(groups)+1}"
            groups[value] = dict(code_ref=label, rows=0)
        if count:
            groups[value]["rows"] += 1
        return groups[value]["code_ref"]

    with tempfile.TemporaryDirectory(prefix=".month-stream-", dir=scratch) as temporary:
        budget = Budget(Path(temporary))
        keys = SortedRuns(budget, "keys", CONFLICT_BYTES if hourly else KEY_BYTES)
        active_hour, candidates = None, 0

        def deduplicate():
            nonlocal candidates
            previous, first_ordinal, first_payload, group_repeated, conflict = None, None, None, False, False
            for record in keys.records():
                key, ordinal, payload = record[:32], int.from_bytes(record[32:36], "big"), record[36:]
                if key != previous:
                    table["unique_complete_source_keys"] += 1
                    previous, first_ordinal, first_payload, group_repeated, conflict = key, ordinal, payload, False, False
                else:
                    table["duplicate_key_rows"] += 1
                    bit_clear(eligible, ordinal)
                    if hourly:
                        if payload != first_payload:
                            table["conflicting_duplicate_rows"] += 1
                            if not conflict:
                                table["conflicting_source_keys_withheld"] += 1
                                conflict = True
                                bit_clear(eligible, first_ordinal)
                    else:
                        repeated[ordinal >> 3] |= 1 << (ordinal & 7)
                        candidates += 1
                        if not group_repeated:
                            repeated[first_ordinal >> 3] |= 1 << (first_ordinal & 7)
                            candidates += 1
                            group_repeated = True

        for file_number, f in enumerate(plan["files"]):
            ev = dict(ordinal=file_number, source_table=name, encoding=f["encoding"])
            file_hour = None
            for row in month.source_rows(f, ev):
                ordinal = table["observed_rows"]
                table["observed_rows"] += 1
                month.check(table["observed_rows"] <= expected)
                if ordinal % 16384 == 0:
                    budget.check()
                if row is None:
                    table["malformed_rows"] += 1
                    table["invalid_rows"] += 1
                    continue
                valid = {k: month.valid_value(k, v) for k, v in row.items()}
                all_valid = all(valid.values())
                table["invalid_rows"] += not all_valid
                for k, v in row.items():
                    field = table["fields"].setdefault(k, dict(null_rows=0, empty_rows=0, invalid_rows=0))
                    field["null_rows"] += v is None
                    field["empty_rows"] += v == ""
                    field["invalid_rows"] += not valid[k]
                refs = {k: code_ref(k, row[k]) for k in ("result", "ccy", "txtype", "totype", "qrtype", "fromchannel", "shouldrevert", "isreconciled", "issettled") if k in row}
                combination = tuple(refs.get(k, "column_absent") for k in selectors)
                month.check(combination in combinations or len(combinations) < month.MAX_GROUPS)
                combinations[combination] += 1
                if not (valid["id"] and valid["requesttime"]):
                    table["invalid_key_rows"] += 1
                    continue
                if hourly:
                    hour = row["requesttime"][:13]
                    month.check(file_hour is None or file_hour == hour)
                    file_hour = hour
                    if active_hour is not None and active_hour != hour:
                        month.check(hour > active_hour)
                        deduplicate()
                        keys = SortedRuns(budget, "keys", CONFLICT_BYTES)
                    active_hour = hour
                key = (name, row["id"], "" if name == "transfer_old" else row["requesttime"])
                keys.add(sha256(month.encoded(key)).digest() + ordinal.to_bytes(4, "big")
                         + (sha256(month.encoded(row)).digest() if hourly else b""))
                if all_valid:
                    eligible[ordinal >> 3] |= 1 << (ordinal & 7)
            month.check(projection is None or projection == ev["columns"])
            projection = ev["columns"]
            evidence.append(ev)
            month.check(sum(e["input_bytes"] for e in evidence) <= MAX_TOTAL_BYTES)
            month.check(sum(e["decoded_bytes"] for e in evidence) <= MAX_TOTAL_BYTES)
            budget.progress("validate_and_sort_keys", file_number + 1, table["observed_rows"])
        month.check(table["observed_rows"] == expected)
        budget.progress("deduplicate_keys", len(evidence), expected)
        deduplicate()

        # Only repeated keys need payload comparisons. The full key spool is freed
        # first, so a normal unique-key export needs just 36 scratch bytes per row.
        if candidates:
            budget.check(candidates * CONFLICT_BYTES)
            conflicts = SortedRuns(budget, "conflicts", CONFLICT_BYTES)
            ordinal = 0
            for file_number, f in enumerate(plan["files"]):
                ev = dict(ordinal=file_number, source_table=name, encoding=f["encoding"])
                for row in month.source_rows(f, ev):
                    if ordinal % 16384 == 0:
                        budget.check()
                    if bit_get(repeated, ordinal):
                        key = (name, row["id"], "" if name == "transfer_old" else row["requesttime"])
                        conflicts.add(sha256(month.encoded(key)).digest() + ordinal.to_bytes(4, "big") + sha256(month.encoded(row)).digest())
                    ordinal += 1
                month.check(ev == evidence[file_number])
                budget.progress("compare_repeated_payloads", file_number + 1, ordinal)
            month.check(ordinal == expected)
            previous, first_payload, first_ordinal, conflict = None, None, None, False
            for record in conflicts.records():
                key, ordinal, payload = record[:32], int.from_bytes(record[32:36], "big"), record[36:]
                if key != previous:
                    previous, first_payload, first_ordinal, conflict = key, payload, ordinal, False
                elif payload != first_payload:
                    table["conflicting_duplicate_rows"] += 1
                    if not conflict:
                        table["conflicting_source_keys_withheld"] += 1
                        conflict = True
                        bit_clear(eligible, first_ordinal)

        # Reuse the freed key-sort space for exact per-currency amount order statistics.
        amounts = SortedRuns(budget, "amounts", AMOUNT_BYTES)
        currency_ids = {c: i for i, c in enumerate(sorted(v["code_ref"] for v in codes.get("ccy", {}).values()))}
        currencies, daily, hour_counts, channels = {}, Counter(), Counter(), Counter()
        ordinal = 0
        for file_number, f in enumerate(plan["files"]):
            ev = dict(ordinal=file_number, source_table=name, encoding=f["encoding"])
            for row in month.source_rows(f, ev):
                keep = bit_get(eligible, ordinal)
                ordinal += 1
                if ordinal % 16384 == 0:
                    budget.check()
                if not keep:
                    continue
                table["valid_nonconflicting_keys"] += 1
                day = row["requesttime"][:10]
                if not day.startswith(plan["month"] + "-"):
                    table["outside_requested_month"] += 1
                    table["before_requested_month" if day < plan["month"] + "-01" else "after_requested_month"] += 1
                    continue
                table["profiled_month_observations"] += 1
                daily[day] += 1
                hour_counts[int(row["requesttime"][11:13])] += 1
                currency = code_ref("ccy", row["ccy"], False)
                channel = code_ref("fromchannel", row.get("fromchannel"), False)
                channels[(channel, currency)] += 1
                month.check(len(channels) <= month.MAX_GROUPS)
                value = month.cents(row["amount"])
                group = currencies.setdefault(currency, dict(source_observations=0, total=0, screens=Counter()))
                group["source_observations"] += 1
                group["total"] += value
                amounts.add(bytes([currency_ids[currency]]) + (value + AMOUNT_OFFSET).to_bytes(11, "big"))
                for screen in plan["amount_screens"]:
                    if screen["currency"] == currency:
                        bucket = ("negative_amount_withheld" if value < 0 else "unknown_result_withheld" if row["result"] not in ("OK", "TRANSACTION_FAILED")
                                  else "failed_or_zero_not_applicable" if row["result"] == "TRANSACTION_FAILED" or value == 0
                                  else "matched" if value >= month.cents(screen["threshold"]) else "below_threshold")
                        group["screens"][bucket] += 1
            month.check(ev == evidence[file_number])
            budget.progress("aggregate_and_sort_amounts", file_number + 1, ordinal)
        month.check(ordinal == expected)
        quantiles, ranks, positions = {}, {}, Counter()
        for currency, group in currencies.items():
            n = group["source_observations"]
            cid = currency_ids[currency]
            quantiles[cid] = {}
            ranks[cid] = dict(min=1, p50=(50*n+99)//100, p90=(90*n+99)//100,
                              p95=(95*n+99)//100, p99=(99*n+99)//100, max=n)
        budget.progress("exact_amount_quantiles", len(evidence), ordinal)
        for record in amounts.records():
            cid = record[0]
            positions[cid] += 1
            for label, rank in ranks[cid].items():
                if positions[cid] == rank:
                    quantiles[cid][label] = month.money(int.from_bytes(record[1:], "big") - AMOUNT_OFFSET)
        table["currencies"] = []
        for currency, group in sorted(currencies.items()):
            month.check(positions[currency_ids[currency]] == group["source_observations"])
            screens = [dict(threshold=s["threshold"], purpose="recorded_amount_scenario_only",
                            mapping="operator_intake_test_ok_failed_v1", active_policy_verified=False,
                            net_execution_verified=False, counts=dict(sorted(group["screens"].items())))
                       for s in plan["amount_screens"] if s["currency"] == currency]
            table["currencies"].append(dict(currency_ref=currency, source_observations=group["source_observations"],
                recorded_amount_total=month.money(group["total"]), recorded_amount_quantiles=quantiles[currency_ids[currency]], amount_screens=screens))
        year, number = map(int, plan["month"].split("-"))
        table["days"] = [dict(day=f"{plan['month']}-{d:02d}", observations=daily[f"{plan['month']}-{d:02d}"])
                         for d in range(1, calendar.monthrange(year, number)[1] + 1)]
        table["days_without_observed_rows"] = sum(d["observations"] == 0 for d in table["days"])
        table["hour_of_day"] = [dict(hour=h, observations=n) for h, n in sorted(hour_counts.items())]
        table["columns"] = projection
        table["lifecycle_combinations"] = [dict(selector_code_refs=list(k), rows=n) for k, n in combinations.items()]
        table["channel_groups"] = [dict(channel_ref=ch, currency_ref=c, observations=n) for (ch, c), n in sorted(channels.items(), key=lambda item: (item[0][0] is not None, item[0][0] or "", item[0][1]))]
        month.check(sum(c["source_observations"] for c in table["currencies"]) == table["profiled_month_observations"])
        month.check(sum(d["observations"] for d in table["days"]) == table["profiled_month_observations"])
        month.check(table["valid_nonconflicting_keys"] == table["outside_requested_month"] + table["profiled_month_observations"])
        budget.check()
        report = dict(format=month.VERSION, execution_mode="offline_analysis", requested_month=plan["month"],
            scope="source_observations_not_business_payments", input_files=evidence,
            input_bytes=sum(e["input_bytes"] for e in evidence), decoded_bytes=sum(e["decoded_bytes"] for e in evidence),
            observed_rows=expected, tables=[table], cross_table_overlaps=[], source_semantics="unverified",
            account_identity="unverified", source_completeness="unverified", source_timezone="unverified",
            historical_availability="unverified", production_ready=False, assessment_performed=False,
            operational_alerts=False, enforcement=False, quantile_method="nearest_rank_exact_recorded_amount",
            code_distributions={k: list(v.values()) for k, v in sorted(codes.items())},
            coverage_note="Days without observations are not proof of source gaps; full-month completeness requires independent evidence.",
            capacity_mode="streaming_hourly_v1" if hourly else "streaming_single_table_v1", verification_passes=3 if candidates else 2,
            source_key_comparison="table_scoped_literal_key_sha256_commitments",
            scratch_peak_bytes=budget.peak_bytes,
            limits=dict(files=MAX_FILES, rows=MAX_ROWS, file_bytes=month.profile.MAX_BYTES,
                        total_input_bytes=MAX_TOTAL_BYTES, scratch_bytes=MAX_SCRATCH_BYTES,
                        free_disk_reserve_bytes=FREE_RESERVE, seconds=MAX_SECONDS, sorted_run_rows=RUN_ROWS))
        month.check(len(month.encoded(report)) <= month.MAX_REPORT_BYTES)
        return report


if __name__ == "__main__":
    try:
        month.check(len(sys.argv) == 1)
        raw = sys.stdin.buffer.read(1024 * 1024 + 1)
        month.check(len(raw) <= 1024 * 1024)
        request = json.loads(raw, object_pairs_hook=month.export.unique_object)
        month.check(month.exact(request, "plan scratch") or month.exact(request, "plan scratch hourly"))
        print(month.encoded(profile_plan(request["plan"], request["scratch"], hourly=request.get("hourly", False))).decode())
    except Exception:
        print("MONTH_PROFILE_FAILED; private diagnostics withheld.", file=sys.stderr)
        raise SystemExit(1)
