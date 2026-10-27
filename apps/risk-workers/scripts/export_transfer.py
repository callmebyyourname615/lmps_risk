"""Manual SELECT-only LMPS transfer export; Python 3.12+, no third-party packages."""

import argparse
import csv
from datetime import datetime, timedelta
import getpass
import gzip
import io
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time

COLUMNS = tuple((
    "id requesttime txtime reference frommember tomember totype amount ccy "
    "result responsetime txtype originalreference shouldrevert isreconciled "
    "issettled settletime qrtype fromchannel"
).split())
NUMBERS = {"id", "shouldrevert", "isreconciled", "issettled"}
NULLABLE = {"result", "responsetime", "txtype", "originalreference", "shouldrevert",
            "settletime", "qrtype", "fromchannel"}
HEADER = ("\t".join(COLUMNS) + "\n").encode("utf-8")
PILOT_COLUMNS = COLUMNS + ("fromaccount", "toaccount", "fee")
PILOT_LIMIT = 1000
PILOT_FORMAT = "lmps-transfer-pilot-tsv-gzip-2"
MONEY = re.compile(r"-?(?:0|[1-9][0-9]{0,21})\.[0-9]{2}\Z")
HOUR = timedelta(hours=1)
TARGET_BYTES = 2_000_000_000
MAX_LINE_CHARS = 65_536


class ExportError(Exception):
    pass


def hour(value):
    try:
        parsed = datetime.fromisoformat(value)
        if (parsed.year < 1000 or parsed.tzinfo is not None or parsed.minute
                or parsed.second or parsed.microsecond):
            raise ValueError
        return parsed
    except ValueError:
        raise argparse.ArgumentTypeError("Use a naive date or whole hour, e.g. 2026-10-01") from None


def query(start, end, columns=COLUMNS, limit=None):
    fields = []
    for name in columns:
        expression = f"t.`{name}`"
        if name in {"amount", "fee", "requesttime", "txtime", "responsetime", "settletime"}:
            expression = f"CAST({expression} AS CHAR)"
        fields.append(f"    '{name}', {expression}")
    return ("SELECT JSON_OBJECT(\n" + ",\n".join(fields) + ")\n"
            "FROM `transfer` AS t\n"
            f"WHERE t.requesttime >= '{start:%Y-%m-%d %H:%M:%S}'\n"
            f"  AND t.requesttime <  '{end:%Y-%m-%d %H:%M:%S}'"
            + (f"\nLIMIT {limit + 1}" if limit is not None else "") + ";")


def field(value):
    if value is None:
        return r"\N"
    return (str(value).replace("\\", "\\\\").replace("\t", r"\t")
            .replace("\r", r"\r").replace("\n", r"\n").replace("\0", r"\0"))


def unique_object(pairs):
    result = dict(pairs)
    if len(result) != len(pairs):
        raise ExportError("DUPLICATE_JSON_COLUMNS")
    return result


def row_bytes(line, start, end, columns=COLUMNS):
    try:
        row = json.loads(line, object_pairs_hook=unique_object)
    except (ValueError, RecursionError):
        raise ExportError("INVALID_JSON_ROW") from None
    if not isinstance(row, dict) or set(row) != set(columns):
        raise ExportError("INVALID_ROW_COLUMNS")
    for name, value in row.items():
        if value is None and name in NULLABLE | {"fee"}:
            continue
        if type(value) is not (int if name in NUMBERS else str):
            raise ExportError("INVALID_ROW_TYPE")
    if not MONEY.fullmatch(row["amount"]) or row.get("fee") is not None and not MONEY.fullmatch(row["fee"]):
        raise ExportError("INVALID_EXACT_AMOUNT")
    stamp = row["requesttime"]
    if len(stamp) != 19 or not start <= stamp < end:
        raise ExportError("ROW_OUTSIDE_WINDOW")
    return ("\t".join(field(row[name]) for name in columns) + "\n").encode("utf-8")


def file_sha256(path):
    with path.open("rb") as stream:
        return sha256_stream(stream)[0]


def sha256_stream(stream, prefix=b""):
    digest, size, lines = sha256(prefix), len(prefix), prefix.count(b"\n")
    while chunk := stream.read(1024 * 1024):
        digest.update(chunk)
        size += len(chunk)
        lines += chunk.count(b"\n")
    return digest.hexdigest(), size, lines


def client_failure(errors):
    errors.seek(0)
    diagnostic = errors.read(16_384)
    code = re.search(rb"\bERROR\s+([0-9]{3,5})\b", diagnostic)
    if code:
        return "MARIADB_SELECT_FAILED_ERROR_" + code[1].decode("ascii")
    if re.search(rb"unknown (?:option|variable)", diagnostic, re.IGNORECASE):
        return "MARIADB_CLIENT_OPTION_UNSUPPORTED"
    return "MARIADB_SELECT_FAILED"


def client_command(client, connection, credentials, sql, headers=False):
    return [client, f"--defaults-extra-file={credentials}", *connection,
            "--database=lmps", "--default-character-set=utf8mb4", "--quick", "--batch", "--raw",
            "--column-names" if headers else "--skip-column-names", "--skip-reconnect",
            "--skip-safe-updates", "--skip-show-warnings", "--init-command=SELECT 1",
            "--connect-timeout=10", f"--execute={sql}"]


def export_hour(client, connection, credentials, directory, start, end, columns=COLUMNS, limit=None, profile=None):
    name = f"transfer_{start:%Y%m%d_%H%M}_{end:%Y%m%d_%H%M}.tsv.gz"
    output = directory / name
    partial = directory / (name + ".part")
    if output.exists():
        raise ExportError("OUTPUT_ALREADY_EXISTS")
    sql = query(start, end) if columns == COLUMNS and limit is None else query(start, end, columns, limit)
    command = client_command(client, connection, credentials, sql)
    header = ("\t".join(columns) + "\n").encode("utf-8")
    rows, size, digest, truncated = 0, len(header), sha256(header), False
    lower, upper = str(start), str(end)
    with partial.open("xb") as raw, tempfile.TemporaryFile() as errors:
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=errors,
                                   text=True, encoding="utf-8", errors="strict")
        try:
            with process.stdout, gzip.GzipFile(filename=name[:-3], mode="wb", fileobj=raw,
                                               compresslevel=6, mtime=0) as archive:
                archive.write(header)
                while line := process.stdout.readline(MAX_LINE_CHARS + 1):
                    if len(line) > MAX_LINE_CHARS or not line.endswith("\n"):
                        raise ExportError("INVALID_OR_OVERSIZE_JSON_LINE")
                    encoded = row_bytes(line, lower, upper, columns)
                    if limit is not None and rows >= limit:
                        truncated = True
                        continue
                    archive.write(encoded)
                    digest.update(encoded)
                    size += len(encoded)
                    rows += 1
                    if profile is not None:
                        profile_row(profile, json.loads(line))
                if process.wait() != 0:
                    raise ExportError(client_failure(errors))
            raw.flush()
            os.fsync(raw.fileno())
        finally:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
    with gzip.open(partial, "rb") as archive:
        actual_digest, actual_size, lines = sha256_stream(archive)
    if (actual_digest, actual_size, lines) != (digest.hexdigest(), size, rows + 1):
        raise ExportError("GZIP_VERIFICATION_FAILED")
    compressed_digest = file_sha256(partial)
    os.link(partial, output)  # Publish without overwriting an existing file.
    partial.unlink()
    result = {"record": "window", "file": name, "status": "complete",
            "start_inclusive": lower, "end_exclusive": upper,
            "rows": rows, "tsv_bytes": size, "gzip_bytes": output.stat().st_size,
            "tsv_sha256": actual_digest, "gzip_sha256": compressed_digest}
    if limit is not None:
        result.update(sample_limit=limit, sample_truncated=truncated)
    return result


def option_value(value):
    if "\0" in value:
        raise ExportError("INVALID_CONNECTION_VALUE")
    for original, escaped in (("\\", "\\\\"), ('"', '\\"'), ("\n", r"\n"),
                              ("\r", r"\r"), ("\t", r"\t"), ("\b", r"\b")):
        value = value.replace(original, escaped)
    return '"' + value + '"'


def record(journal, value):
    journal.write(json.dumps(value, ensure_ascii=True) + "\n")
    journal.flush()
    os.fsync(journal.fileno())


def export_dataset(client, host, port, user, password, start, end, target, root, pause=2):
    directory = Path(tempfile.mkdtemp(prefix="lmps-export-2gb-", dir=root))
    print(f"Output directory: {directory}", flush=True)
    rows, size, compressed, windows = 0, 0, 0, 0
    cursor = start
    with (directory / "manifest.jsonl").open("x", encoding="utf-8") as journal:
        record(journal, {"record": "dataset", "format": "lmps-transfer-escaped-tsv-gzip-1",
                         "source_table": "transfer", "columns": COLUMNS,
                         "encoding": "UTF-8", "null": r"\N", "header_per_file": True,
                         "target_tsv_bytes": target, "tsv_bytes_include_headers": True,
                         "requested_start_inclusive": str(start), "requested_end_exclusive": str(end),
                         "snapshot_consistency": "not_guaranteed_between_selects",
                         "source_timezone": "unverified_raw_datetime",
                         "business_payment_deduplication": "not_performed",
                         "account_identity": "not_observed"})
        try:
            with tempfile.TemporaryDirectory(prefix="lmps-export-auth-") as private:
                credentials = Path(private) / "client.cnf"
                with credentials.open("x", encoding="utf-8") as secret:
                    secret.write("[client]\npassword=" + option_value(password) + "\n")
                credentials.chmod(0o600)
                connection = [f"--host={host}", f"--port={port}", f"--user={user}"]
                while cursor < end and size < target:
                    stop = cursor + HOUR
                    print(f"Exporting [{cursor}, {stop})", flush=True)
                    window = export_hour(client, connection, credentials, directory, cursor, stop)
                    record(journal, window)
                    rows += window["rows"]
                    size += window["tsv_bytes"]
                    compressed += window["gzip_bytes"]
                    windows += 1
                    cursor = stop
                    print(f"Rows: {rows:,} | TSV: {size:,}/{target:,} bytes | gzip: {compressed:,} bytes",
                          flush=True)
                    if cursor < end and size < target:
                        time.sleep(pause)
        except BaseException:
            record(journal, {"record": "summary", "status": "interrupted_or_failed",
                             "completed_windows": windows, "rows": rows, "tsv_bytes": size,
                             "gzip_bytes": compressed, "completed_end_exclusive": str(cursor)})
            raise
        reached = size >= target
        summary = {"record": "summary", "status": "target_reached" if reached else "range_exhausted",
                   "completed_windows": windows, "rows": rows, "tsv_bytes": size,
                   "gzip_bytes": compressed, "completed_end_exclusive": str(cursor)}
        record(journal, summary)
    print(json.dumps(summary), flush=True)
    return 0 if reached else 2


def metadata_rows(client, connection, credentials, sql):
    result = subprocess.run(client_command(client, connection, credentials, sql, headers=True),
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        raise ExportError(client_failure(io.BytesIO(result.stderr)))
    if len(result.stdout) > 128 * 1024:
        raise ExportError("PILOT_METADATA_TOO_LARGE")
    return list(csv.DictReader(io.StringIO(result.stdout.decode("utf-8")),
                               delimiter="\t", quoting=csv.QUOTE_NONE))


def pilot_preflight(client, connection, credentials, start, end):
    columns = metadata_rows(client, connection, credentials, "SHOW COLUMNS FROM `transfer`;")
    schema = {row["Field"]: {"type": row["Type"], "nullable": row["Null"]}
              for row in columns if row["Field"] in PILOT_COLUMNS}
    if set(schema) != set(PILOT_COLUMNS):
        raise ExportError("PILOT_REQUIRED_COLUMNS_MISSING")
    indexes = metadata_rows(client, connection, credentials, "SHOW INDEX FROM `transfer`;")
    time_indexes = {row["Key_name"] for row in indexes
                    if row["Column_name"] == "requesttime" and row["Seq_in_index"] == "1"}
    plan = metadata_rows(client, connection, credentials,
                         "EXPLAIN PARTITIONS " + query(start, end, PILOT_COLUMNS, PILOT_LIMIT))
    if len(plan) != 1 or plan[0].get("type") != "range" or plan[0].get("key") not in time_indexes:
        raise ExportError("PILOT_INDEXED_RANGE_PLAN_REQUIRED")
    return {"format": "lmps-pilot-preflight-2", "columns": schema,
            "plan": {name: plan[0].get(name) for name in ("partitions", "type", "key", "rows", "Extra")},
            "row_estimate_is_not_actual_count": True}


def profile_row(profile, row):
    profile["rows"] += 1
    for name in PILOT_COLUMNS:
        value = row[name]
        profile["fields"][name]["null_rows"] += value is None
        profile["fields"][name]["empty_rows"] += value == ""
    for name in ("fromaccount", "toaccount"):
        value = row[name]
        counts = profile["account_field_shapes"][name]
        counts["max_characters"] = max(counts["max_characters"], len(value))
        if not value:
            continue
        kind = "other_text"
        if re.fullmatch(r"[0-9]+", value):
            kind = "ascii_digits"
        elif value.lstrip().startswith(("{", "[")):
            try:
                if isinstance(json.loads(value), (dict, list)):
                    kind = "json_object_or_array"
            except (ValueError, RecursionError):
                pass
        counts[kind] += 1
        counts["contains_mask_markers"] += bool(re.search(r"[*•●]|[Xx]{4}", value))
        counts["starts_with_000201"] += value.startswith("000201")


def write_json(path, value):
    with path.open("x", encoding="utf-8") as output:
        output.write(json.dumps(value, ensure_ascii=True) + "\n")
        output.flush()
        os.fsync(output.fileno())


def export_pilot(client, host, port, user, password, start, root):
    end = start + timedelta(minutes=1)
    directory = Path(tempfile.mkdtemp(prefix="lmps-export-pilot-v2-", dir=root))
    print(f"Output directory: {directory}", flush=True)
    profile = {"format": "lmps-pilot-profile-2", "rows": 0, "account_identity": "unverified",
               "heuristics_are_not_identity_validation": True, "raw_values_included": False,
               "fields": {name: {"null_rows": 0, "empty_rows": 0} for name in PILOT_COLUMNS},
               "account_field_shapes": {name: {key: 0 for key in (
                   "max_characters", "ascii_digits", "json_object_or_array", "other_text",
                   "contains_mask_markers", "starts_with_000201")}
                   for name in ("fromaccount", "toaccount")}}
    with (directory / "manifest.jsonl").open("x", encoding="utf-8") as journal:
        record(journal, {"record": "dataset", "format": PILOT_FORMAT, "source_table": "transfer",
                         "columns": PILOT_COLUMNS, "encoding": "UTF-8", "null": r"\N",
                         "header_per_file": True, "sample_only": True, "sample_limit": PILOT_LIMIT,
                         "requested_start_inclusive": str(start), "requested_end_exclusive": str(end),
                         "account_identity": "unverified", "risk_assessment": "not_performed",
                         "flagged_account_source": "unverified", "source_timezone": "unverified_raw_datetime"})
        try:
            with tempfile.TemporaryDirectory(prefix="lmps-export-auth-") as private:
                credentials = Path(private) / "client.cnf"
                with credentials.open("x", encoding="utf-8") as secret:
                    secret.write("[client]\npassword=" + option_value(password) + "\n")
                credentials.chmod(0o600)
                connection = [f"--host={host}", f"--port={port}", f"--user={user}"]
                preflight = pilot_preflight(client, connection, credentials, start, end)
                write_json(directory / "preflight.json", preflight)
                print("Preflight passed. Exporting one minute, at most 1,000 sample rows.", flush=True)
                window = export_hour(client, connection, credentials, directory, start, end,
                                     PILOT_COLUMNS, PILOT_LIMIT, profile)
            record(journal, window)
            write_json(directory / "profile.json", profile)
            summary = {"record": "summary", "status": "pilot_complete", "completed_windows": 1,
                       "rows": window["rows"], "tsv_bytes": window["tsv_bytes"],
                       "gzip_bytes": window["gzip_bytes"], "completed_end_exclusive": str(end),
                       "sample_only": True, "sample_limit": PILOT_LIMIT,
                       "sample_truncated": window["sample_truncated"],
                       "artifacts": {name: file_sha256(directory / name)
                                     for name in ("preflight.json", "profile.json")}}
            record(journal, summary)
        except BaseException:
            record(journal, {"record": "summary", "status": "interrupted_or_failed", "sample_only": True})
            raise
    print(json.dumps(summary), flush=True)
    return 0


def verify_dataset(directory):
    try:
        if directory.is_symlink() or (directory / "manifest.jsonl").is_symlink():
            raise ValueError
        with (directory / "manifest.jsonl").open("rb") as source:
            data = source.read(1024 * 1024 + 1)
        if len(data) > 1024 * 1024 or not data.endswith(b"\n"):
            raise ValueError
        entries = [json.loads(line, object_pairs_hook=unique_object) for line in data.splitlines()]
        metadata, *windows, summary = entries
        pilot = metadata["format"] == PILOT_FORMAT
        columns = PILOT_COLUMNS if pilot else COLUMNS
        header = ("\t".join(columns) + "\n").encode("utf-8")
        if (metadata["record"] != "dataset"
                or metadata["format"] not in {PILOT_FORMAT, "lmps-transfer-escaped-tsv-gzip-1"}
                or metadata["columns"] != list(columns) or summary["record"] != "summary"):
            raise ValueError
        if not pilot and (type(metadata["target_tsv_bytes"]) is not int or metadata["target_tsv_bytes"] <= 0):
            raise ValueError
        cursor = hour(metadata["requested_start_inclusive"])
        requested_end = datetime.fromisoformat(metadata["requested_end_exclusive"]) if pilot else hour(metadata["requested_end_exclusive"])
        if pilot and (requested_end != cursor + timedelta(minutes=1) or len(windows) != 1
                      or metadata.get("sample_only") is not True or metadata.get("sample_limit") != PILOT_LIMIT
                      or metadata.get("account_identity") != "unverified"):
            raise ValueError
        rows, size, compressed = 0, 0, 0
        for window in windows:
            stop = cursor + (timedelta(minutes=1) if pilot else HOUR)
            expected = f"transfer_{cursor:%Y%m%d_%H%M}_{stop:%Y%m%d_%H%M}.tsv.gz"
            if (window["record"] != "window" or window["status"] != "complete"
                    or window["file"] != expected or window["start_inclusive"] != str(cursor)
                    or window["end_exclusive"] != str(stop) or stop > requested_end):
                raise ValueError
            path = directory / expected
            if path.is_symlink() or not path.is_file():
                raise ValueError
            if (path.stat().st_size != window["gzip_bytes"]
                    or file_sha256(path) != window["gzip_sha256"]):
                raise ValueError
            with gzip.open(path, "rb") as archive:
                if archive.read(len(header)) != header:
                    raise ValueError
                digest, count, lines = sha256_stream(archive, header)
            if (digest, count, lines) != (window["tsv_sha256"], window["tsv_bytes"], window["rows"] + 1):
                raise ValueError
            rows += window["rows"]
            size += count
            compressed += window["gzip_bytes"]
            cursor = stop
        if pilot:
            window = windows[0]
            if (type(window["rows"]) is not int or not 0 <= rows <= PILOT_LIMIT
                    or window.get("sample_limit") != PILOT_LIMIT
                    or type(window.get("sample_truncated")) is not bool
                    or window["sample_truncated"] and rows != PILOT_LIMIT
                    or set(summary.get("artifacts", {})) != {"preflight.json", "profile.json"}):
                raise ValueError
            for name, expected_hash in summary["artifacts"].items():
                artifact = directory / name
                if artifact.is_symlink() or artifact.stat().st_size > 128 * 1024 or file_sha256(artifact) != expected_hash:
                    raise ValueError
            profile = json.loads((directory / "profile.json").read_text(encoding="utf-8"))
            if (profile["rows"] != rows or profile["account_identity"] != "unverified"
                    or profile["raw_values_included"] is not False):
                raise ValueError
            expected = {"record": "summary", "status": "pilot_complete", "completed_windows": 1,
                        "rows": rows, "tsv_bytes": size, "gzip_bytes": compressed,
                        "completed_end_exclusive": str(cursor), "sample_only": True,
                        "sample_limit": PILOT_LIMIT, "sample_truncated": window["sample_truncated"],
                        "artifacts": summary["artifacts"]}
            if summary != expected:
                raise ValueError
            return summary
        reached = size >= metadata["target_tsv_bytes"]
        if (not windows or summary != {
                "record": "summary", "status": "target_reached" if reached else "range_exhausted",
                "completed_windows": len(windows), "rows": rows, "tsv_bytes": size,
                "gzip_bytes": compressed, "completed_end_exclusive": str(cursor)}
                or not reached and cursor != requested_end):
            raise ValueError
        return summary
    except Exception:
        raise ExportError("DATASET_VERIFICATION_FAILED") from None


def cleanup_copy(directory, verified_manifest_sha256):
    directory = directory.absolute()
    home = Path.home().resolve()
    parents = {home}
    desktop = home / "Desktop"
    if desktop.is_dir() and not desktop.is_symlink() and not os.path.ismount(desktop):
        parents.add(desktop)
    if (directory.parent.resolve() not in parents or directory.is_symlink()
            or not re.fullmatch(r"lmps-export-(?:2gb|pilot-v2)-[A-Za-z0-9_-]+", directory.name)
            or not re.fullmatch(r"[0-9a-f]{64}", verified_manifest_sha256 or "")):
        raise ExportError("CLEANUP_REQUIRES_HOME_EXPORT_AND_VERIFIED_COPY_HASH")
    manifest = directory / "manifest.jsonl"
    if manifest.is_symlink() or file_sha256(manifest) != verified_manifest_sha256:
        raise ExportError("CLEANUP_COPY_HASH_MISMATCH")
    summary = verify_dataset(directory)
    if summary["status"] not in {"target_reached", "pilot_complete"}:
        raise ExportError("CLEANUP_TARGET_NOT_REACHED")
    entries = [json.loads(line) for line in manifest.read_text(encoding="utf-8").splitlines()]
    names = [entry["file"] for entry in entries[1:-1]] + list(summary.get("artifacts", {}))
    if set(p.name for p in directory.iterdir()) != {*names, "manifest.jsonl"}:
        raise ExportError("CLEANUP_UNEXPECTED_FILES")
    for name in names:
        (directory / name).unlink()
    manifest.unlink()
    directory.rmdir()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", help="Actual MariaDB endpoint, not the export server by assumption")
    parser.add_argument("--port", type=int)
    parser.add_argument("--user", help="Existing read-only MariaDB user")
    parser.add_argument("--start", type=hour, default="2026-10-01")
    parser.add_argument("--end", type=hour, default="2026-10-23", help="Exclusive whole-hour boundary")
    parser.add_argument("--target-bytes", type=int, default=TARGET_BYTES)
    parser.add_argument("--output-root", type=Path, default=Path.home())
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument("--pilot-v2", action="store_true", help="22 fields, one minute from --start, at most 1,000 rows; no risk assessment")
    modes.add_argument("--verify", type=Path, help="Verify a copied bundle offline; no DB or password")
    modes.add_argument("--cleanup-copy", type=Path, help="Remove a home/Desktop copy after verifying flash backup")
    parser.add_argument("--verified-manifest-sha256", help="SHA-256 from the already verified flash-drive manifest")
    args = parser.parse_args(argv)
    try:
        if args.verify is not None:
            summary = verify_dataset(args.verify)
            print("VERIFIED: " + json.dumps(summary), flush=True)
            return 0 if summary["status"] in {"target_reached", "pilot_complete"} else 2
        if args.cleanup_copy is not None:
            cleanup_copy(args.cleanup_copy, args.verified_manifest_sha256)
            print(f"CLEANED: {args.cleanup_copy}", flush=True)
            return 0
        if args.verified_manifest_sha256 is not None:
            raise ExportError("COPY_HASH_IS_FOR_CLEANUP_ONLY")
        if not args.pilot_v2 and (args.start >= args.end or args.end - args.start > timedelta(days=31)
                                 or args.target_bytes <= 0):
            raise ExportError("INVALID_RANGE_OR_TARGET")
        if not args.output_root.is_dir():
            raise ExportError("OUTPUT_PARENT_MUST_EXIST")
        client = shutil.which("mariadb") or shutil.which("mysql")
        if client is None:
            raise ExportError("MARIADB_CLIENT_NOT_FOUND")
        if not sys.stdin.isatty():
            raise ExportError("RUN_FROM_INTERACTIVE_TERMINAL")
        host = args.host or input("Actual MariaDB host: ").strip()
        user = args.user or input("Read-only MariaDB username: ").strip()
        port = args.port if args.port is not None else int(input("MariaDB port [3306]: ") or "3306")
        if not host or not user or any(c in host + user for c in "\r\n\0") or not 1 <= port <= 65535:
            raise ExportError("INVALID_CONNECTION_VALUE")
        password = getpass.getpass("MariaDB password (hidden): ")
        old_mask = os.umask(0o077)
        try:
            if args.pilot_v2:
                return export_pilot(client, host, port, user, password, args.start, args.output_root)
            return export_dataset(client, host, port, user, password, args.start, args.end,
                                  args.target_bytes, args.output_root)
        finally:
            os.umask(old_mask)
    except KeyboardInterrupt:
        print("EXPORT_INTERRUPTED: completed windows remain in manifest.jsonl.", file=sys.stderr)
        return 130
    except (ExportError, OSError, ValueError, UnicodeError, EOFError) as error:
        code = str(error) if isinstance(error, ExportError) else "EXPORT_FAILED"
        print(f"{code}: check connection/settings; incomplete .part files are not complete exports.",
              file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
