"""Bounded, read-only profiling of owner-private LMPS CSV exports; no database IO."""

import argparse
import csv
from datetime import datetime
from hashlib import sha256
import io
import json
import os
from pathlib import Path
import re
import stat
import sys

VERSION = "offline-dataset-profile-1"
MAX_BYTES = 64 * 1024 * 1024
MAX_ROWS = 100_000
MAX_FIELD_CHARS = 4096
MAX_COLUMNS = 64
MAX_RECORD_CHARS = MAX_COLUMNS * (MAX_FIELD_CHARS + 3) + 2
MAX_CODES = 256
MAX_REPORT_BYTES = 1024 * 1024
# kind, maximum characters, nullable; matches the selected offline DDL declarations.
TRANSFER = {"id": ("integer", 11, False), "requesttime": ("datetime", 19, False),
            "amount": ("decimal", 26, False), "ccy": ("text", 200, False),
            "result": ("text", 200, True), "txtime": ("datetime", 19, False)}
SCHEMAS = {"transfer": TRANSFER, "transfer_hist": TRANSFER,
           "transfer_old": {k: v for k, v in TRANSFER.items() if k != "requesttime"},
           "member": {"code": ("text", 100, False), "status": ("text", 16, True),
                      "member_type": ("text", 20, True)}}
KEYS = {"transfer": ("id", "requesttime"), "transfer_hist": ("id", "requesttime"),
        "transfer_old": ("id",), "member": ("code",)}


class DatasetError(Exception):
    pass


class HashedReader(io.RawIOBase):
    def __init__(self, source):
        super().__init__()
        self.source = source
        self.digest = sha256()
        self.size = 0

    def readable(self):
        return True

    def readinto(self, buffer):
        data = self.source.read(len(buffer))
        self.size += len(data)
        if self.size > MAX_BYTES:
            raise DatasetError("DATASET_LIMIT_EXCEEDED")
        self.digest.update(data)
        buffer[:len(data)] = data
        return len(data)


class RecordLines:
    def __init__(self, stream):
        self.stream = stream
        self.characters = 0

    def __iter__(self):
        return self

    def __next__(self):
        line = self.stream.readline(MAX_RECORD_CHARS - self.characters + 1)
        if not line:
            raise StopIteration
        self.characters += len(line)
        if self.characters > MAX_RECORD_CHARS:
            raise DatasetError("DATASET_LIMIT_EXCEEDED")
        return line


def private_directory(path):
    if not path.is_absolute():
        raise DatasetError("DATASET_PRIVATE_PATH_REQUIRED")
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        if info.st_uid != os.getuid() or info.st_mode & 0o077:
            raise DatasetError("DATASET_PRIVATE_PATH_REQUIRED")
        return fd
    except BaseException:
        os.close(fd)
        raise


def private_file(directory, name):
    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid != os.getuid() or info.st_mode & 0o077:
            raise DatasetError("DATASET_PRIVATE_PATH_REQUIRED")
        return os.fdopen(fd, "rb")
    except BaseException:
        os.close(fd)
        raise


def valid_value(name, value, spec):
    kind, width, nullable = spec
    if value is None:
        return nullable
    if len(value) > width or any(ord(c) < 32 or ord(c) == 127 for c in value):
        return False
    if kind == "integer":
        return bool(re.fullmatch(r"(?:0|-?[1-9][0-9]{0,9})", value)) and -2147483648 <= int(value) <= 2147483647
    if kind == "decimal":
        return bool(re.fullmatch(r"-?(?:0|[1-9][0-9]{0,21})\.[0-9]{2}", value))
    if kind == "datetime":
        if not re.fullmatch(r"[1-9][0-9]{3}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}", value):
            return False
        try:
            datetime.strptime(value, "%Y-%m-%d %H:%M:%S")
            return True
        except ValueError:
            return False
    return bool(value) or name not in ("code", "ccy")


def profile_stream(stream, table, rows=None):
    schema = SCHEMAS[table]
    lines = RecordLines(stream)
    reader = csv.reader(lines, strict=True)
    header = next(reader, [])
    lines.characters = 0
    if len(header) > MAX_COLUMNS:
        raise DatasetError("DATASET_LIMIT_EXCEEDED")
    header_check = {"missing_columns": [n for n in schema if n not in header],
                    "unexpected_column_count": sum(n not in schema for n in header),
                    "duplicate_column_count": len(header) - len(set(header))}
    report = {"format": 1, "tool_version": VERSION, "purpose": "offline_export_readiness",
              "execution_mode": "offline_analysis", "source_kind": "user_supplied_file", "source_table": table,
              "source_semantics": "unverified", "source_completeness": "unverified", "source_timezone": "unverified",
              "account_identity": "not_observed", "business_payment_deduplication": "not_performed",
              "import_eligibility": "not_evaluated", "risk_assessment": "not_performed",
              "source_key_comparison": "exact_export_strings", "raw_values_included": False,
              "limits": {"bytes": MAX_BYTES, "rows": MAX_ROWS, "field_characters": MAX_FIELD_CHARS,
                         "columns": MAX_COLUMNS, "record_characters": MAX_RECORD_CHARS, "distinct_codes_per_field": MAX_CODES},
              "header": header_check, "validation_status": "header_rejected", "observed_rows": None,
              "row_counts": None, "fields": {}, "code_distributions": {}, "amount_signs": None}
    if any(header_check.values()):
        # Hash the rest without interpreting rows from an unapproved column projection.
        while stream.read(8192):
            pass
        return report
    fields = {n: {"null_rows": 0, "empty_rows": 0, "non_null_rows": 0, "invalid_rows": 0} for n in schema}
    distinct = {n: set() for n in schema}
    code_names = ["status", "member_type"] if table == "member" else ["ccy", "result"]
    codes = {n: {} for n in code_names}
    keys = {}
    counts = {"valid_rows": 0, "invalid_rows": 0, "malformed_rows": 0, "invalid_key_rows": 0,
              "duplicate_key_rows": 0, "conflicting_key_rows": 0, "unique_complete_source_keys": 0}
    signs = {"positive_rows": 0, "zero_rows": 0, "negative_rows": 0} if table != "member" else None
    observed = 0
    for row in reader:
        lines.characters = 0
        observed += 1
        if observed > MAX_ROWS or len(row) > MAX_COLUMNS:
            raise DatasetError("DATASET_LIMIT_EXCEEDED")
        if len(row) != len(header):
            counts["malformed_rows"] += 1
            counts["invalid_rows"] += 1
            continue
        values = dict(zip(header, (None if v == "\\N" else v for v in row)))
        if rows is not None:
            rows.append([values[n] for n in schema])
        valid = {n: valid_value(n, values[n], spec) for n, spec in schema.items()}
        counts["valid_rows" if all(valid.values()) else "invalid_rows"] += 1
        for n, value in values.items():
            field = fields[n]
            if value is None:
                field["null_rows"] += 1
            else:
                field["non_null_rows"] += 1
                field["empty_rows"] += value == ""
                distinct[n].add(value)
            field["invalid_rows"] += not valid[n]
            if n in codes and value is not None and valid[n]:
                group = codes[n].get(value)
                if group is None:
                    if len(codes[n]) >= MAX_CODES:
                        raise DatasetError("DATASET_LIMIT_EXCEEDED")
                    group = {"code_ref": f"code_{len(codes[n]) + 1}", "first_data_row": observed, "rows": 0}
                    codes[n][value] = group
                group["rows"] += 1
        if all(valid[n] and values[n] is not None for n in KEYS[table]):
            key = tuple(values[n] for n in KEYS[table])
            content = tuple(values[n] for n in schema)
            if key in keys:
                counts["duplicate_key_rows"] += 1
                counts["conflicting_key_rows"] += keys[key] != content
            else:
                keys[key] = content
        else:
            counts["invalid_key_rows"] += 1
        if signs is not None and valid["amount"]:
            magnitude = int(values["amount"].replace(".", ""))
            signs["positive_rows" if magnitude > 0 else "negative_rows" if magnitude < 0 else "zero_rows"] += 1
    for n in fields:
        fields[n]["distinct_non_null"] = len(distinct[n])
    counts["unique_complete_source_keys"] = len(keys)
    report.update(observed_rows=observed, row_counts=counts, fields=fields,
                  code_distributions={n: list(groups.values()) for n, groups in codes.items()}, amount_signs=signs,
                  validation_status="no_rows" if observed == 0 else "needs_attention" if counts["invalid_rows"] or counts["duplicate_key_rows"] else "valid")
    return report


def profile_file(path, table, rows=None):
    if table not in SCHEMAS or not path.is_absolute():
        raise DatasetError("DATASET_USAGE")
    parent = private_directory(path.parent)
    old_limit = csv.field_size_limit(MAX_FIELD_CHARS)
    try:
        with private_file(parent, path.name) as source:
            before = os.fstat(source.fileno())
            if before.st_size > MAX_BYTES:
                raise DatasetError("DATASET_LIMIT_EXCEEDED")
            raw = HashedReader(source)
            with io.TextIOWrapper(io.BufferedReader(raw), encoding="utf-8-sig", errors="strict", newline="") as stream:
                report = profile_stream(stream, table) if rows is None else profile_stream(stream, table, rows)
            after = os.fstat(source.fileno())
            if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns) or raw.size != before.st_size:
                raise DatasetError("DATASET_INPUT_CHANGED")
            report.update(dataset_sha256=raw.digest.hexdigest(), input_bytes=raw.size)
            return report
    finally:
        csv.field_size_limit(old_limit)
        os.close(parent)


def mapping_template(report):
    table = report["source_table"]
    return {"format": 1, "tool_version": VERSION, "dataset_sha256": report["dataset_sha256"], "source_table": table,
            "status": "draft_unapproved", "current_database_intake": "synthetic_only",
            "columns": [{"source_column": n, "candidate_path": "source_records.source_key." + n if n in KEYS[table] else "source_events.fields." + n,
                         "approval_status": "unverified"} for n in SCHEMAS[table]],
            "codebooks": {n: [{**group, "target_value": None, "approval_status": "unverified"} for group in groups]
                          for n, groups in report["code_distributions"].items()},
            "required_reviews": ["field_access_and_retention", "source_schema", "business_identity", "history_overlap",
                                 "money_units_sign_and_fees", "currency_codebook", "status_codebook", "timezone_and_time_meaning"],
            "account_identity": "deferred", "canonical_emission": False, "enforcement": False}


def publish(output, report, template):
    parent = private_directory(output.parent)
    directory = None
    try:
        try:
            os.mkdir(output.name, 0o700, dir_fd=parent)
            created = True
            os.fsync(parent)
        except FileExistsError:
            created = False
        directory = private_directory(output)
        for name, value in (("report.json", report), ("mapping-template.json", template)):
            content = json.dumps(value, ensure_ascii=True, sort_keys=True, indent=2).encode() + b"\n"
            if len(content) > MAX_REPORT_BYTES:
                raise DatasetError("DATASET_LIMIT_EXCEEDED")
            if not created:
                with private_file(directory, name) as file:
                    if file.read(MAX_REPORT_BYTES + 1) != content:
                        raise DatasetError("DATASET_REPORT_CONFLICT")
            else:
                fd = os.open("pending-" + name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=directory)
                with os.fdopen(fd, "wb") as file:
                    file.write(content)
                    file.flush()
                    os.fsync(file.fileno())
                os.rename("pending-" + name, name, src_dir_fd=directory, dst_dir_fd=directory)
        os.fsync(directory)
        return "profiled" if created else "duplicate"
    finally:
        if directory is not None:
            os.close(directory)
        os.close(parent)


class RedactedParser(argparse.ArgumentParser):
    def error(self, message):
        raise DatasetError("DATASET_USAGE")


def main(argv=None):
    try:
        parser = RedactedParser(description=__doc__, allow_abbrev=False)
        parser.add_argument("--table", required=True, choices=tuple(SCHEMAS))
        parser.add_argument("--input", required=True, type=Path)
        parser.add_argument("--output-dir", required=True, type=Path)
        args = parser.parse_args(argv)
        if os.environ.get("NODE_ENV") == "production" or os.environ.get("LMPS_ENVIRONMENT", "local") not in ("local", "test") or os.environ.get("LMPS_EXECUTION_MODE", "test") != "test":
            raise DatasetError("DATASET_OFFLINE_ONLY")
        report = profile_file(args.input, args.table)
        status = publish(args.output_dir, report, mapping_template(report))
        print(json.dumps({"format": 1, "status": status, "validation_status": report["validation_status"], "observed_rows": report["observed_rows"]}))
        return 0 if report["validation_status"] == "valid" else 2
    except DatasetError as error:
        print(str(error) + "; dataset, values and path diagnostics withheld.", file=sys.stderr)
        return 1
    except (OSError, ValueError, csv.Error, OverflowError):
        print("DATASET_PROFILE_FAILED; dataset, values and path diagnostics withheld.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
