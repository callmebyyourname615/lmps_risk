"""Read-only monthly LMPS TSV/gzip exporter. Copy alongside export_transfer.py to the export server."""

import argparse
from datetime import datetime, timedelta
import getpass
import gzip
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import threading
import time

import export_transfer as base

VERSION = "lmps-transfer-month-tsv-gzip-1"
CHUNK_BYTES = 8 * 1024**2
MAX_MANIFEST = 8 * 1024**2
DISK_RESERVE = 1024**3
STATEMENT_SECONDS = 60
CLIENT_SECONDS = 180
TABLES = ("transfer", "transfer_hist", "transfer_old")


def check(value):
    if not value:
        raise base.ExportError("MONTH_EXPORT_INVALID")


def month_bounds(value):
    check(isinstance(value, str) and re.fullmatch(r"[1-9][0-9]{3}-(0[1-9]|1[0-2])", value))
    start = datetime.strptime(value, "%Y-%m")
    check(start.year < 9999 or start.month < 12)
    end = datetime(start.year + (start.month == 12), 1 if start.month == 12 else start.month + 1, 1)
    return start, end


def private_directory(path):
    check(path.is_absolute() and str(path.resolve(strict=True)) == str(path))
    s = path.lstat()
    check(stat.S_ISDIR(s.st_mode) and s.st_uid == os.getuid() and not s.st_mode & 0o077)


def private_file(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        s = os.fstat(fd)
        check(stat.S_ISREG(s.st_mode) and s.st_nlink == 1 and s.st_uid == os.getuid() and not s.st_mode & 0o077)
        return os.fdopen(fd, "rb")
    except BaseException:
        os.close(fd)
        raise


def columns_for(table):
    check(table in TABLES)
    return tuple(c for c in base.PILOT_COLUMNS if table == "transfer" or c != "fromchannel")


def query(table, start, end):
    check(table in TABLES)
    return base.query(start, end, columns_for(table)).replace("FROM `transfer`", f"FROM `{table}`")


def client_command(client, connection, credentials, sql, headers=False):
    databases = [a for a in connection if a.startswith("--database=")]
    check(len(databases) <= 1)
    database = databases[0].split("=", 1)[1] if databases else "lmps"
    check(re.fullmatch(r"[A-Za-z0-9_]{1,64}", database))
    command = base.client_command(client, connection, credentials, sql, headers=headers)
    return [a for a in command if not a.startswith("--database=")] + ["--database=" + database]


def metadata_rows(client, connection, credentials, sql):
    result = subprocess.run(client_command(client, connection, credentials, sql, headers=True),
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=CLIENT_SECONDS)
    check(result.returncode == 0 and len(result.stdout) <= 128 * 1024)
    import csv
    import io
    return list(csv.DictReader(io.StringIO(result.stdout.decode("utf-8")), delimiter="\t", quoting=csv.QUOTE_NONE))


def preflight(client, connection, credentials, table, start, end):
    columns = metadata_rows(client, connection, credentials, f"SHOW COLUMNS FROM `{table}`;")
    check(set(columns_for(table)) <= {r["Field"] for r in columns})
    indexes = metadata_rows(client, connection, credentials, f"SHOW INDEX FROM `{table}`;")
    allowed = {r["Key_name"] for r in indexes if r["Column_name"] == "requesttime" and r["Seq_in_index"] == "1"}
    plan = metadata_rows(client, connection, credentials, "EXPLAIN PARTITIONS " + query(table, start, end))
    check(len(plan) == 1 and plan[0].get("type") == "range" and plan[0].get("key") in allowed)


def decode_field(value):
    if value == r"\N":
        return None
    escapes = {"\\": "\\", "t": "\t", "r": "\r", "n": "\n", "0": "\0"}
    parts, i = [], 0
    while i < len(value):
        if value[i] == "\\":
            check(i + 1 < len(value) and value[i+1] in escapes)
            parts.append(escapes[value[i+1]])
            i += 2
        else:
            parts.append(value[i])
            i += 1
    return "".join(parts)


def verify_chunk(path, metadata, columns, start, end):
    check(re.fullmatch(r"part-[0-9]{5}\.tsv\.gz", path.name))
    check(type(metadata["rows"]) is int and metadata["rows"] >= 0)
    check(type(metadata["tsv_bytes"]) is int and 0 < metadata["tsv_bytes"] <= CHUNK_BYTES)
    with private_file(path) as raw:
        before = os.fstat(raw.fileno())
        check(before.st_size == metadata["gzip_bytes"])
        compressed = sha256()
        while chunk := raw.read(1024 * 1024):
            compressed.update(chunk)
        check(compressed.hexdigest() == metadata["gzip_sha256"])
        raw.seek(0)
        digest, size, rows = sha256(), 0, 0
        with gzip.GzipFile(fileobj=raw) as archive:
            header = ("\t".join(columns) + "\n").encode()
            check(archive.readline(len(header) + 1) == header)
            digest.update(header)
            size += len(header)
            while line := archive.readline(base.MAX_LINE_CHARS * 4 + 1):
                check(len(line) <= base.MAX_LINE_CHARS * 4 and line.endswith(b"\n"))
                size += len(line)
                check(size <= CHUNK_BYTES)
                values = list(map(decode_field, line[:-1].decode("utf-8").split("\t")))
                check(len(values) == len(columns) and start <= values[columns.index("requesttime")] < end)
                digest.update(line)
                rows += 1
        check((digest.hexdigest(), size, rows) == (metadata["tsv_sha256"], metadata["tsv_bytes"], metadata["rows"]))
        after = os.fstat(raw.fileno())
        check((before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
              (after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns))


def export_window(client, connection, credentials, table, directory, start, end, next_part):
    columns = columns_for(table)
    header = ("\t".join(columns) + "\n").encode()
    sql = f"SET STATEMENT max_statement_time={STATEMENT_SECONDS} FOR " + query(table, start, end)
    files = []
    with tempfile.TemporaryDirectory(prefix=".pending-window-", dir=directory) as temporary, tempfile.TemporaryFile() as errors:
        stage = Path(temporary)
        process = subprocess.Popen(client_command(client, connection, credentials, sql), stdout=subprocess.PIPE,
                                   stderr=errors, text=True, encoding="utf-8", errors="strict")
        expired = threading.Event()
        def timeout():
            expired.set()
            try:
                process.kill()
            except ProcessLookupError:
                pass
        timer = threading.Timer(CLIENT_SECONDS, timeout)
        timer.daemon = True
        timer.start()
        raw = archive = None
        rows = size = 0
        digest = sha256()

        def finish():
            nonlocal raw, archive
            archive.close()
            raw.flush()
            os.fsync(raw.fileno())
            raw.close()
            archive = raw = None
            part = {"file": name, "rows": rows, "tsv_bytes": size,
                    "gzip_bytes": (stage / name).stat().st_size,
                    "tsv_sha256": digest.hexdigest(), "gzip_sha256": base.file_sha256(stage / name)}
            verify_chunk(stage / name, part, columns, str(start), str(end))
            files.append(part)

        try:
            while line := process.stdout.readline(base.MAX_LINE_CHARS + 1):
                check(len(line) <= base.MAX_LINE_CHARS and line.endswith("\n"))
                data = base.row_bytes(line, str(start), str(end), columns)
                check(len(header) + len(data) <= CHUNK_BYTES)
                if raw is not None and size + len(data) > CHUNK_BYTES:
                    finish()
                if raw is None:
                    check(shutil.disk_usage(directory).free >= DISK_RESERVE + CHUNK_BYTES)
                    name = f"part-{next_part + len(files):05d}.tsv.gz"
                    raw = (stage / name).open("xb")
                    os.chmod(stage / name, 0o600)
                    archive = gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0)
                    archive.write(header)
                    rows, size, digest = 0, len(header), sha256(header)
                archive.write(data)
                digest.update(data)
                rows += 1
                size += len(data)
            check(process.wait() == 0 and not expired.is_set())
            if raw is None and not files:
                name = f"part-{next_part:05d}.tsv.gz"
                raw = (stage / name).open("xb")
                os.chmod(stage / name, 0o600)
                archive = gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0)
                archive.write(header)
                rows, size, digest = 0, len(header), sha256(header)
            if raw is not None:
                finish()
            for part in files:
                os.link(stage / part["file"], directory / part["file"])
            fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)
        finally:
            timer.cancel()
            if archive is not None:
                archive.close()
            if raw is not None:
                raw.close()
            process.stdout.close()
            if process.poll() is None:
                process.kill()
            process.wait()
    return {"record": "window", "start_inclusive": str(start), "end_exclusive": str(end), "files": files}


def export_month(client, connection, credentials, root, month, table="transfer", pause=2):
    start, end = month_bounds(month)
    private_directory(root)
    check(type(pause) in (int, float) and 0 <= pause <= 60)
    preflight(client, connection, credentials, table, start, start + base.HOUR)
    directory = Path(tempfile.mkdtemp(prefix=f"lmps-month-{month}-{table}-", dir=root))
    print("Output directory: " + str(directory), flush=True)
    cursor, parts, rows, windows, size, compressed = start, 0, 0, 0, 0, 0
    manifest = directory / "manifest.jsonl"
    with manifest.open("x", encoding="utf-8") as journal:
        os.chmod(manifest, 0o600)
        base.record(journal, {"record": "dataset", "format": VERSION, "month": month, "source_table": table,
            "columns": columns_for(table), "requested_start_inclusive": str(start), "requested_end_exclusive": str(end),
            "window_seconds": 3600, "chunk_bytes": CHUNK_BYTES, "account_identity": "unverified",
            "source_timezone": "unverified_raw_datetime", "snapshot_consistency": "not_guaranteed_between_selects",
            "source_history_completeness": "unverified", "business_payment_deduplication": "not_performed"})
        try:
            while cursor < end:
                stop = cursor + base.HOUR
                preflight(client, connection, credentials, table, cursor, stop)
                window = export_window(client, connection, credentials, table, directory, cursor, stop, parts)
                base.record(journal, window)
                parts += len(window["files"])
                rows += sum(p["rows"] for p in window["files"])
                size += sum(p["tsv_bytes"] for p in window["files"])
                compressed += sum(p["gzip_bytes"] for p in window["files"])
                windows += 1
                cursor = stop
                print(json.dumps({"completed_windows": windows, "files": parts, "rows": rows}), flush=True)
                check(parts <= 99999 and manifest.stat().st_size <= MAX_MANIFEST - 4096)
                if cursor < end and pause:
                    time.sleep(pause)
        except BaseException:
            base.record(journal, {"record": "summary", "status": "interrupted_or_failed", "completed_windows": windows})
            raise
        summary = {"record": "summary", "status": "range_complete", "completed_windows": windows,
                   "completed_end_exclusive": str(cursor), "files": parts, "rows": rows,
                   "tsv_bytes": size, "gzip_bytes": compressed}
        base.record(journal, summary)
    verify_month(directory)
    return directory, summary


def verify_month(directory):
    private_directory(directory)
    with private_file(directory / "manifest.jsonl") as f:
        raw = f.read(MAX_MANIFEST + 1)
    check(len(raw) <= MAX_MANIFEST and raw.endswith(b"\n"))
    records = [json.loads(line, object_pairs_hook=base.unique_object) for line in raw.splitlines()]
    metadata, *windows, summary = records
    check(metadata["record"] == "dataset" and metadata["format"] == VERSION)
    start, end = month_bounds(metadata["month"])
    columns = columns_for(metadata["source_table"])
    check(metadata["columns"] == list(columns) and metadata["requested_start_inclusive"] == str(start)
          and metadata["requested_end_exclusive"] == str(end) and metadata["window_seconds"] == 3600
          and metadata["chunk_bytes"] == CHUNK_BYTES)
    check(len(windows) == int((end - start).total_seconds()) // 3600)
    names, rows, size, compressed, cursor = {"manifest.jsonl"}, 0, 0, 0, start
    for window in windows:
        stop = cursor + base.HOUR
        check(window["record"] == "window" and window["start_inclusive"] == str(cursor)
              and window["end_exclusive"] == str(stop) and isinstance(window["files"], list) and window["files"])
        for part in window["files"]:
            name = f"part-{len(names)-1:05d}.tsv.gz"
            check(part["file"] == name)
            verify_chunk(directory / name, part, columns, str(cursor), str(stop))
            names.add(name)
            rows += part["rows"]
            size += part["tsv_bytes"]
            compressed += part["gzip_bytes"]
        cursor = stop
    check({p.name for p in directory.iterdir()} == names)
    check(summary == {"record": "summary", "status": "range_complete", "completed_windows": len(windows),
        "completed_end_exclusive": str(end), "files": len(names)-1, "rows": rows, "tsv_bytes": size, "gzip_bytes": compressed})
    return metadata, windows, summary


def readiness_plan(directory):
    metadata, windows, _summary = verify_month(directory)
    return {"format": "lmps-month-profile-1", "month": metadata["month"], "files": [
        {"path": str(directory / f["file"]), "table": metadata["source_table"], "encoding": "export_tsv_gzip",
         "sha256": f["gzip_sha256"], "expected_rows": f["rows"]} for w in windows for f in w["files"]],
        "amount_screens": []}


def main(argv=None):
    parser = base.argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument("--month")
    modes.add_argument("--verify", type=Path)
    parser.add_argument("--table", choices=TABLES, default="transfer")
    parser.add_argument("--output-root", type=Path)
    parser.add_argument("--pause-seconds", type=float, default=2)
    parser.add_argument("--db-host")
    parser.add_argument("--db-port", type=int)
    parser.add_argument("--db-user")
    parser.add_argument("--database", default="lmps")
    args = parser.parse_args(argv)
    try:
        if args.verify is not None:
            _meta, _windows, summary = verify_month(args.verify)
            print(json.dumps({"status": "verified", **summary}))
            return 0
        month_bounds(args.month)
        check(args.output_root is not None)
        private_directory(args.output_root)
        client = shutil.which("mariadb")
        check(client is not None and sys.stdin.isatty())
        host = args.db_host or input("Approved MariaDB endpoint: ").strip()
        user = args.db_user or input("MariaDB user: ").strip()
        port = args.db_port if args.db_port is not None else int(input("MariaDB port [3306]: ") or "3306")
        check(host and user and not any(c in host + user for c in "\r\n\0") and 1 <= port <= 65535)
        check(re.fullmatch(r"[A-Za-z0-9_]{1,64}", args.database))
        password = getpass.getpass("MariaDB password (hidden): ")
        old_mask = os.umask(0o077)
        try:
            with tempfile.TemporaryDirectory(prefix="lmps-month-auth-") as auth:
                credentials = Path(auth) / "client.cnf"
                fd = os.open(credentials, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
                with os.fdopen(fd, "w") as f:
                    f.write("[client]\npassword=" + base.option_value(password) + "\n")
                _directory, summary = export_month(client, [f"--host={host}", f"--user={user}", f"--port={port}", f"--database={args.database}"],
                    credentials, args.output_root, args.month, args.table, args.pause_seconds)
                print(json.dumps(summary))
        finally:
            os.umask(old_mask)
        return 0
    except KeyboardInterrupt:
        print("MONTH_EXPORT_INTERRUPTED; incomplete bundle retained.", file=sys.stderr)
        return 130
    except Exception:
        print("MONTH_EXPORT_FAILED; private diagnostics withheld; incomplete bundle is not accepted.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
