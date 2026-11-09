"""Internal file-only month profiler. SQLite holds bounded scratch evidence, never account values."""

from collections import Counter
from contextlib import ExitStack, closing
from datetime import datetime
from hashlib import sha256
import calendar
import csv
import gzip
import io
import json
import os
from pathlib import Path
import re
import sqlite3
import sys
import tempfile
import time

import dataset_profile as profile
import dataset_pilot as pilot
import export_transfer as export

VERSION = "lmps-month-profile-1"
MAX_FILES = 1000
MAX_ROWS = 1_000_000
MAX_TOTAL_BYTES = 4 * 1024**3
MAX_SCRATCH_BYTES = 2 * 1024**3
MAX_SECONDS = 300
MAX_CODES = 256
MAX_GROUPS = 10000
MAX_REPORT_BYTES = 2 * 1024**2
TABLES = ("transfer", "transfer_hist", "transfer_old")
MONEY = re.compile(r"-?(?:0|[1-9][0-9]{0,21})\.[0-9]{2}\Z")
SPECS = dict(profile.TRANSFER, reference=("text", 200, False),
             frommember=("text", 200, False), tomember=("text", 200, False),
             fromaccount=("text", 200, False), toaccount=("text", 5000, False),
             totype=("text", 200, False), responsetime=("datetime", 19, True),
             txtype=("text", 200, True), originalreference=("text", 200, True),
             shouldrevert=("integer", 11, True), isreconciled=("integer", 4, False),
             issettled=("integer", 4, False), settletime=("datetime", 19, True),
             qrtype=("text", 100, True), fromchannel=("text", 100, True), fee=("decimal", 26, True))


def check(condition):
    if not condition:
        raise ValueError("MONTH_PROFILE_INVALID")


def encoded(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=True, separators=(",", ":")).encode()


def exact(value, names):
    return isinstance(value, dict) and set(value) == set(names.split())


def canonical_private(path):
    check(isinstance(path, str))
    p = Path(path)
    check(p.is_absolute() and str(p.resolve(strict=True)) == path)
    return p


def validate_plan(plan, *, max_files=None, max_rows=None):
    max_files = MAX_FILES if max_files is None else max_files
    max_rows = MAX_ROWS if max_rows is None else max_rows
    check(exact(plan, "format month files amount_screens") and plan["format"] == VERSION)
    check(isinstance(plan["month"], str) and re.fullmatch(r"[1-9][0-9]{3}-(0[1-9]|1[0-2])", plan["month"]))
    check(isinstance(plan["files"], list) and 1 <= len(plan["files"]) <= max_files)
    paths = set()
    for f in plan["files"]:
        check(exact(f, "path table encoding sha256 expected_rows"))
        check(f["table"] in TABLES and f["encoding"] in ("csv", "export_tsv_gzip"))
        check(isinstance(f["sha256"], str) and re.fullmatch(r"[a-f0-9]{64}", f["sha256"]))
        check(type(f["expected_rows"]) is int and 0 <= f["expected_rows"] <= max_rows)
        p = canonical_private(f["path"])
        check(str(p) not in paths)
        paths.add(str(p))
    check(sum(f["expected_rows"] for f in plan["files"]) <= max_rows)
    check(isinstance(plan["amount_screens"], list) and len(plan["amount_screens"]) <= 16)
    screens = set()
    for s in plan["amount_screens"]:
        check(exact(s, "currency threshold") and isinstance(s["currency"], str))
        check(s["currency"] in ("LAK", "THB", "USD", "CNY", "SYN"))
        check(isinstance(s["threshold"], str) and MONEY.fullmatch(s["threshold"]) and cents(s["threshold"]) > 0)
        check(s["currency"] not in screens)
        screens.add(s["currency"])
    return plan


def cents(value):
    return int(value.replace(".", ""))


def money(value):
    return ("-" if value < 0 else "") + f"{abs(value) // 100}.{abs(value) % 100:02d}"


def order_key(value):
    digits = str(abs(value))
    if value < 0:
        return "0" + f"{24 - len(digits):02d}" + "".join(str(9 - int(d)) for d in digits)
    return "1" + f"{len(digits):02d}" + digits


def valid_value(name, value):
    if name in ("fromaccount", "toaccount"):
        return value is not None and len(value) <= SPECS[name][1]
    return profile.valid_value(name, value, SPECS[name])


def fingerprint(info):
    return tuple(getattr(info, k) for k in ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns"))


def source_rows(f, evidence):
    path = canonical_private(f["path"])
    parent = profile.private_directory(path.parent)
    old_limit = csv.field_size_limit(export.MAX_LINE_CHARS if f["encoding"] == "export_tsv_gzip" else 5000)
    try:
        with profile.private_file(parent, path.name) as source, ExitStack() as stack:
            before = os.fstat(source.fileno())
            check(before.st_size <= profile.MAX_BYTES)
            raw = profile.HashedReader(source)
            stream = io.BufferedReader(raw)
            decoded = raw
            if f["encoding"] == "export_tsv_gzip":
                decoded = profile.HashedReader(gzip.GzipFile(fileobj=stream))
                stream = io.BufferedReader(decoded)
            text = stack.enter_context(io.TextIOWrapper(stream, encoding="utf-8-sig", errors="strict", newline=""))
            lines = profile.RecordLines(text)
            reader = csv.reader(lines, strict=True, **({"delimiter": "\t", "quoting": csv.QUOTE_NONE}
                                                      if f["encoding"] == "export_tsv_gzip" else {}))
            header = next(reader, [])
            lines.characters = 0
            projections = [set(profile.TRANSFER), set(export.COLUMNS), set(export.PILOT_COLUMNS)]
            if f["table"] != "transfer":
                projections = [p - {"fromchannel"} for p in projections]
            check(len(header) == len(set(header)) and set(header) in projections)
            evidence["columns"] = sorted(header)
            count = 0
            for fields in reader:
                lines.characters = 0
                count += 1
                check(count <= f["expected_rows"])
                if len(fields) != len(header):
                    yield None
                else:
                    values = [pilot.decode_field(v) if f["encoding"] == "export_tsv_gzip"
                              else None if v == r"\N" else v for v in fields]
                    yield dict(zip(header, values))
            check(count == f["expected_rows"] and raw.digest.hexdigest() == f["sha256"])
            check(raw.size == before.st_size)
            check(fingerprint(before) == fingerprint(os.fstat(source.fileno())))
            check(fingerprint(before) == fingerprint(os.stat(path.name, dir_fd=parent, follow_symlinks=False)))
            evidence.update(rows=count, input_bytes=raw.size, decoded_bytes=decoded.size, sha256=raw.digest.hexdigest())
    finally:
        csv.field_size_limit(old_limit)
        os.close(parent)


def summarize(index, table, currency, month, screens):
    condition = "source_table=? AND currency=? AND valid=1 AND conflict=0 AND day LIKE ?"
    args = (table, currency, month + "-%")
    n = index.execute("SELECT count(*) FROM records WHERE " + condition, args).fetchone()[0]
    result = {"currency_ref": currency, "source_observations": n, "recorded_amount_total": "0.00",
              "recorded_amount_quantiles": {}, "amount_screens": []}
    total = sum(cents(r[0]) for r in index.execute("SELECT amount FROM records WHERE " + condition, args))
    result["recorded_amount_total"] = money(total)
    for name, offset in [("min", 0), ("p50", (50*n + 99)//100 - 1), ("p90", (90*n + 99)//100 - 1),
                         ("p95", (95*n + 99)//100 - 1), ("p99", (99*n + 99)//100 - 1), ("max", n-1)]:
        value = index.execute("SELECT amount FROM records WHERE " + condition + " ORDER BY amount_order LIMIT 1 OFFSET ?", (*args, offset)).fetchone()
        result["recorded_amount_quantiles"][name] = value[0]
    for screen in screens:
        if screen["currency"] != currency:
            continue
        counts = Counter()
        for amount, lifecycle in index.execute("SELECT amount,lifecycle FROM records WHERE " + condition, args):
            value = cents(amount)
            if value < 0:
                counts["negative_amount_withheld"] += 1
            elif lifecycle == "unknown":
                counts["unknown_result_withheld"] += 1
            elif lifecycle == "failed" or value == 0:
                counts["failed_or_zero_not_applicable"] += 1
            else:
                counts["matched" if value >= cents(screen["threshold"]) else "below_threshold"] += 1
        result["amount_screens"].append({"threshold": screen["threshold"], "purpose": "recorded_amount_scenario_only",
            "mapping": "operator_intake_test_ok_failed_v1", "active_policy_verified": False,
            "net_execution_verified": False, "counts": dict(sorted(counts.items()))})
    return result


def profile_plan(plan, scratch):
    pilot.mode()
    validate_plan(plan)
    scratch = canonical_private(scratch)
    fd = profile.private_directory(scratch)
    os.close(fd)
    month = plan["month"]
    year, number = map(int, month.split("-"))
    days = [f"{month}-{d:02d}" for d in range(1, calendar.monthrange(year, number)[1] + 1)]
    stats, projections, codes, evidence, total_rows, total_bytes, decoded_bytes = {}, {}, {}, [], 0, 0, 0
    combinations = {}
    started = time.monotonic()

    def code_ref(field, value):
        if value is None:
            return None
        groups = codes.setdefault(field, {})
        check(value in groups or len(groups) < MAX_CODES)
        if value not in groups:
            label = value if field == "ccy" and value in ("LAK", "THB", "USD", "CNY", "SYN") else f"{field}_code_{len(groups)+1}"
            groups[value] = {"code_ref": label, "rows": 0}
        groups[value]["rows"] += 1
        return groups[value]["code_ref"]

    with tempfile.TemporaryDirectory(prefix=".month-profile-", dir=scratch) as temporary:
        dbpath = Path(temporary) / "index.sqlite"
        pilot.write_private(dbpath, b"")
        with closing(sqlite3.connect(dbpath)) as index:
            index.execute("PRAGMA cache_size=-16384")
            index.execute("CREATE TABLE records(source_table TEXT,key_id TEXT,key_stamp TEXT,payload_hash TEXT,valid INTEGER,conflict INTEGER,day TEXT,hour INTEGER,currency TEXT,amount TEXT,amount_order TEXT,lifecycle TEXT,channel TEXT,source_stamp TEXT,PRIMARY KEY(source_table,key_id,key_stamp)) WITHOUT ROWID")
            for ordinal, f in enumerate(plan["files"]):
                ev = {"ordinal": ordinal, "source_table": f["table"], "encoding": f["encoding"]}
                table = stats.setdefault(f["table"], {"observed_rows": 0, "malformed_rows": 0, "invalid_rows": 0,
                    "invalid_key_rows": 0, "duplicate_key_rows": 0, "conflicting_duplicate_rows": 0, "fields": {}})
                for row in source_rows(f, ev):
                    total_rows += 1
                    check(total_rows <= MAX_ROWS and time.monotonic() - started <= MAX_SECONDS)
                    table["observed_rows"] += 1
                    if total_rows % 1000 == 0:
                        index.commit()
                        check(sum(p.stat().st_size for p in Path(temporary).iterdir()) <= MAX_SCRATCH_BYTES)
                    if f["table"] in projections:
                        check(projections[f["table"]] == ev["columns"])
                    projections[f["table"]] = ev["columns"]
                    if row is None:
                        table["malformed_rows"] += 1
                        table["invalid_rows"] += 1
                        continue
                    valid = {name: valid_value(name, value) for name, value in row.items()}
                    table["invalid_rows"] += not all(valid.values())
                    for name, value in row.items():
                        field = table["fields"].setdefault(name, {"null_rows": 0, "empty_rows": 0, "invalid_rows": 0})
                        field["null_rows"] += value is None
                        field["empty_rows"] += value == ""
                        field["invalid_rows"] += not valid[name]
                    refs = {}
                    for field in ("result", "ccy", "txtype", "totype", "qrtype", "fromchannel", "shouldrevert", "isreconciled", "issettled"):
                        if field in row:
                            refs[field] = code_ref(field, row[field])
                    selectors = ("result", "txtype", "totype", "shouldrevert", "isreconciled", "issettled")
                    combination = tuple(refs.get(k, "column_absent") for k in selectors)
                    groups = combinations.setdefault(f["table"], Counter())
                    check(combination in groups or len(groups) < MAX_GROUPS)
                    groups[combination] += 1
                    if not (valid["id"] and valid["requesttime"]):
                        table["invalid_key_rows"] += 1
                        continue
                    key = (f["table"], row["id"], "" if f["table"] == "transfer_old" else row["requesttime"])
                    digest = sha256(encoded(row)).hexdigest()
                    previous = index.execute("SELECT payload_hash FROM records WHERE (source_table,key_id,key_stamp)=(?,?,?)", key).fetchone()
                    if previous:
                        table["duplicate_key_rows"] += 1
                        if previous[0] != digest:
                            table["conflicting_duplicate_rows"] += 1
                            index.execute("UPDATE records SET conflict=1 WHERE (source_table,key_id,key_stamp)=(?,?,?)", key)
                    else:
                        value = cents(row["amount"]) if valid["amount"] else 0
                        lifecycle = {"OK": "succeeded", "TRANSACTION_FAILED": "failed"}.get(row["result"], "unknown")
                        index.execute("INSERT INTO records VALUES(?,?,?,?,?,0,?,?,?,?,?,?,?,?)", (*key, digest,
                            int(all(valid.values())), row["requesttime"][:10], int(row["requesttime"][11:13]),
                            refs["ccy"],
                            money(value), order_key(value), lifecycle,
                            refs.get("fromchannel"), row["requesttime"]))
                if f["table"] in projections:
                    check(projections[f["table"]] == ev["columns"])
                projections[f["table"]] = ev["columns"]
                evidence.append(ev)
                total_bytes += ev["input_bytes"]
                decoded_bytes += ev["decoded_bytes"]
                check(total_bytes <= MAX_TOTAL_BYTES and decoded_bytes <= MAX_TOTAL_BYTES)
                index.commit()
            results = []
            for name, table in sorted(stats.items()):
                table["source_table"] = name
                table["columns"] = projections[name]
                table["unique_complete_source_keys"] = index.execute("SELECT count(*) FROM records WHERE source_table=?", (name,)).fetchone()[0]
                table["conflicting_source_keys_withheld"] = index.execute("SELECT count(*) FROM records WHERE source_table=? AND conflict=1", (name,)).fetchone()[0]
                table["valid_nonconflicting_keys"] = index.execute("SELECT count(*) FROM records WHERE source_table=? AND conflict=0 AND valid=1", (name,)).fetchone()[0]
                condition = "source_table=? AND valid=1 AND conflict=0 AND day LIKE ?"
                args = (name, month + "-%")
                table["profiled_month_observations"] = index.execute("SELECT count(*) FROM records WHERE " + condition, args).fetchone()[0]
                table["outside_requested_month"] = table["valid_nonconflicting_keys"] - table["profiled_month_observations"]
                table["before_requested_month"] = index.execute("SELECT count(*) FROM records WHERE source_table=? AND valid=1 AND conflict=0 AND day<?", (name, month + "-01")).fetchone()[0]
                table["after_requested_month"] = table["outside_requested_month"] - table["before_requested_month"]
                table["lifecycle_combinations"] = [{"selector_code_refs": list(k), "rows": n} for k, n in combinations.get(name, {}).items()]
                daily = dict(index.execute("SELECT day,count(*) FROM records WHERE " + condition + " GROUP BY day", args))
                table["days"] = [{"day": d, "observations": daily.get(d, 0)} for d in days]
                table["days_without_observed_rows"] = sum(d not in daily for d in days)
                table["hour_of_day"] = [{"hour": h, "observations": n} for h, n in index.execute("SELECT hour,count(*) FROM records WHERE " + condition + " GROUP BY hour", args)]
                currencies = [r[0] for r in index.execute("SELECT DISTINCT currency FROM records WHERE " + condition + " ORDER BY currency", args)]
                table["currencies"] = [summarize(index, name, c, month, plan["amount_screens"]) for c in currencies]
                table["channel_groups"] = [{"channel_ref": ch, "currency_ref": c, "observations": n} for ch, c, n in index.execute("SELECT channel,currency,count(*) FROM records WHERE " + condition + " GROUP BY channel,currency", args)]
                check(len(table["channel_groups"]) <= MAX_GROUPS)
                check(sum(c["source_observations"] for c in table["currencies"]) == table["profiled_month_observations"])
                check(sum(d["observations"] for d in table["days"]) == table["profiled_month_observations"])
                results.append(table)
            overlaps = [{"left_table": a, "right_table": b, "equal_literal_id_requesttime_keys": n} for a, b, n in index.execute("SELECT a.source_table,b.source_table,count(*) FROM records a JOIN records b ON a.key_id=b.key_id AND a.source_stamp=b.source_stamp AND a.source_table<b.source_table WHERE a.valid=1 AND b.valid=1 AND a.conflict=0 AND b.conflict=0 AND a.day LIKE ? GROUP BY a.source_table,b.source_table", (month + "-%",))]
        check(time.monotonic() - started <= MAX_SECONDS)
        report = {"format": VERSION, "execution_mode": "offline_analysis", "requested_month": month,
            "scope": "source_observations_not_business_payments", "input_files": evidence, "input_bytes": total_bytes,
            "decoded_bytes": decoded_bytes,
            "observed_rows": total_rows, "tables": results, "cross_table_overlaps": overlaps,
            "source_semantics": "unverified", "account_identity": "unverified", "source_completeness": "unverified",
            "source_timezone": "unverified", "historical_availability": "unverified", "production_ready": False,
            "assessment_performed": False, "operational_alerts": False, "enforcement": False,
            "quantile_method": "nearest_rank_exact_recorded_amount", "code_distributions": {k: list(v.values()) for k, v in sorted(codes.items())},
            "coverage_note": "Days without observations are not proof of source gaps; full-month completeness requires independent evidence.",
            "limits": {"files": MAX_FILES, "rows": MAX_ROWS, "file_bytes": profile.MAX_BYTES,
                       "total_input_bytes": MAX_TOTAL_BYTES, "scratch_bytes": MAX_SCRATCH_BYTES, "seconds": MAX_SECONDS}}
        check(len(encoded(report)) <= MAX_REPORT_BYTES)
        return report


if __name__ == "__main__":
    try:
        check(len(sys.argv) == 1)
        raw = sys.stdin.buffer.read(1024 * 1024 + 1)
        check(len(raw) <= 1024 * 1024)
        request = json.loads(raw, object_pairs_hook=export.unique_object)
        check(exact(request, "plan scratch"))
        print(encoded(profile_plan(request["plan"], request["scratch"])).decode())
    except Exception:
        print("MONTH_PROFILE_FAILED; private diagnostics withheld.", file=sys.stderr)
        raise SystemExit(1)
