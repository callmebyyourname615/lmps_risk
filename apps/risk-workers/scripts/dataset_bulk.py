"""Private streaming export-bundle preparation; SQLite is a temporary disk index only."""
import csv
import fcntl
import gzip
from hashlib import sha256
import json
import os
from pathlib import Path
import resource
import shutil
import sqlite3
import sys
import tempfile
import time
import uuid

import dataset_pilot as pilot
import export_transfer as export

VERSION = "lmps-bulk-plan-1"
CHUNK_ROWS = 25000
MAX_ROWS = 1000000
MAX_SOURCE_BYTES = 4 * 1024**3


def private_dir(path):
    fd = pilot.csv_profile.private_directory(path)
    os.close(fd)


def inventory(bundle):
    private_dir(bundle)
    raw = pilot.read_private(bundle / "manifest.jsonl", 1024 * 1024)
    entries = [json.loads(line, object_pairs_hook=export.unique_object) for line in raw.splitlines()]
    metadata, *windows, summary = entries
    columns = export.PILOT_COLUMNS if metadata.get("format") == export.PILOT_FORMAT else export.COLUMNS
    allowed = {"manifest.jsonl", *(window["file"] for window in windows)}
    if columns == export.PILOT_COLUMNS:
        allowed |= {"preflight.json", "profile.json"}
    if (not windows or len(windows) > 1000 or len(set(window["file"] for window in windows)) != len(windows)
            or metadata.get("columns") != list(columns) or summary.get("tsv_bytes", MAX_SOURCE_BYTES + 1) > MAX_SOURCE_BYTES
            or sum(window.get("tsv_bytes", MAX_SOURCE_BYTES + 1) for window in windows) > MAX_SOURCE_BYTES):
        raise ValueError()
    for window in windows:
        name = window["file"]
        if not isinstance(name, str) or not export.re.fullmatch(r"transfer_[0-9]{8}_[0-9]{4}_[0-9]{8}_[0-9]{4}\.tsv\.gz", name):
            raise ValueError()
        # Check file type/permissions without loading the compressed export into memory.
        fd = pilot.csv_profile.private_directory(bundle)
        try:
            with pilot.csv_profile.private_file(fd, name) as stream:
                if os.fstat(stream.fileno()).st_size != window["gzip_bytes"]:
                    raise ValueError()
        finally:
            os.close(fd)
    seen = set()
    for child in bundle.iterdir():
        if child.name not in allowed or child.is_symlink() or not child.is_file():
            raise ValueError()
        seen.add(child.name)
    if seen != allowed:
        raise ValueError()
    return raw, metadata, windows, columns


def bound_archives(bundle, windows, columns):
    header = ("\t".join(columns) + "\n").encode()
    for window in windows:
        maximum = window["tsv_bytes"]
        if type(maximum) is not int or not len(header) <= maximum <= MAX_SOURCE_BYTES:
            raise ValueError()
        directory = pilot.csv_profile.private_directory(bundle)
        try:
            with pilot.csv_profile.private_file(directory, window["file"]) as raw:
                with gzip.GzipFile(fileobj=raw) as stream:
                    count = 0
                    while data := stream.read(min(1024 * 1024, maximum + 1 - count)):
                        count += len(data)
                        if count > maximum:
                            raise ValueError()
                    if count != maximum:
                        raise ValueError()
        finally:
            os.close(directory)


def verify_prepared(output):
    pilot.mode()
    private_dir(output)
    plan = json.loads(pilot.read_private(output / "plan.json", 512 * 1024))
    expected = {"plan.json", "source-manifest.jsonl"}
    if (plan.get("format") != VERSION or not 1 <= plan.get("unique_rows", 0) <= MAX_ROWS
            or not isinstance(plan.get("chunks"), list) or not 1 <= len(plan["chunks"]) <= 40):
        raise ValueError()
    manifest = pilot.read_private(output / "source-manifest.jsonl", 1024 * 1024)
    if sha256(manifest).hexdigest() != plan["source_manifest_sha256"]:
        raise ValueError()
    total = 0
    for i, chunk in enumerate(plan["chunks"]):
        name = f"chunk-{i:05d}"
        if chunk["number"] != i or chunk["csv"] != name + ".csv" or chunk["lineage"] != name + ".jsonl":
            raise ValueError()
        for file, digest in ((chunk["csv"], chunk["input"]["dataset_sha256"]), (chunk["lineage"], chunk["lineage_sha256"])):
            if sha256(pilot.read_private(output / file)).hexdigest() != digest:
                raise ValueError()
            expected.add(file)
        total += chunk["input"]["expected_rows"]
    if total != plan["unique_rows"] or {p.name for p in output.iterdir()} != expected:
        raise ValueError()
    return plan


def prepare(bundle, output, maximum):
    pilot.mode()
    started = time.monotonic()
    if (not bundle.is_absolute() or not output.is_absolute() or bundle.is_symlink() or output.is_symlink()
            or not 1 <= maximum <= MAX_ROWS or bundle.resolve().is_relative_to(output.resolve())
            or output.resolve().is_relative_to(bundle.resolve())):
        raise ValueError()
    private_dir(output.parent)
    raw_manifest, metadata, windows, columns = inventory(bundle)
    bound_archives(bundle, windows, columns)
    # The published source verifier streams every gzip, including unselected windows.
    source_summary = export.verify_dataset(bundle)
    source_hash = sha256(raw_manifest).hexdigest()
    identity = sha256((VERSION + source_hash + str(maximum)).encode()).hexdigest()
    if output.exists():
        plan = verify_prepared(output)
        if plan["source_manifest_sha256"] != source_hash or plan["requested_rows"] != maximum:
            raise ValueError()
        return {"format": VERSION, "publication": "duplicate", "rows": plan["unique_rows"], "source_rows": plan["source_rows"]}
    with tempfile.TemporaryDirectory(prefix=".bulk-prepare-", dir=output.parent) as temporary:
        stage = Path(temporary)
        index_path = stage / "index.sqlite"
        pilot.write_private(index_path, b"")
        index = sqlite3.connect(index_path)
        index.execute("PRAGMA cache_size=-16384")
        index.execute("CREATE TABLE source_keys (id TEXT, stamp TEXT, hash TEXT NOT NULL, PRIMARY KEY(id,stamp)) WITHOUT ROWID")
        chunks, selected, duplicates, unique, values, lineage = [], 0, 0, 0, [], []

        def flush():
            if not values:
                return
            number = len(chunks)
            name = f"chunk-{number:05d}"
            with (stage / (name + ".csv")).open("x", encoding="utf-8", newline="") as stream:
                os.chmod(stream.name, 0o600)
                writer = csv.writer(stream, lineterminator="\n", quoting=csv.QUOTE_ALL)
                writer.writerow(pilot.STAGING_COLUMNS)
                writer.writerows([[r"\N" if value is None else value for value in row] for row in values])
            report = pilot.csv_profile.profile_file(stage / (name + ".csv"), "transfer")
            if report["validation_status"] != "valid":
                raise ValueError()
            line_data = b"".join(lineage)
            pilot.write_private(stage / (name + ".jsonl"), line_data)
            batch = str(uuid.UUID(bytes=sha256((identity + str(number)).encode()).digest()[:16], version=4))
            request = {"format": 1, "execution_mode": "offline_analysis", "batch_ref": batch,
                       "workspace_key": "offline_bulk_trial", "source_namespace": "offline_bulk_" + identity[:16],
                       "source_table": "transfer", "profile_version": pilot.csv_profile.VERSION,
                       "dataset_sha256": report["dataset_sha256"], "input_bytes": report["input_bytes"], "expected_rows": len(values)}
            chunks.append({"number": number, "csv": name + ".csv", "lineage": name + ".jsonl",
                           "lineage_sha256": sha256(line_data).hexdigest(), "input": request})
            values.clear()
            lineage.clear()
            index.commit()

        try:
            for window_number, window in enumerate(windows):
                if selected >= maximum:
                    break
                with gzip.open(bundle / window["file"], "rb") as stream:
                    header = ("\t".join(columns) + "\n").encode()
                    if stream.readline(pilot.MAX_LINE_BYTES + 1) != header:
                        raise ValueError()
                    row_number = 0
                    while selected < maximum:
                        line = stream.readline(pilot.MAX_LINE_BYTES + 1)
                        if not line:
                            break
                        if len(line) > pilot.MAX_LINE_BYTES or not line.endswith(b"\n"):
                            raise ValueError()
                        row_number += 1
                        fields = line[:-1].decode("utf-8").split("\t")
                        if len(fields) != len(columns):
                            raise ValueError()
                        row = dict(zip(columns, map(pilot.decode_field, fields)))
                        projected = [row[name] for name in pilot.STAGING_COLUMNS]
                        if any(v == r"\N" for v in projected):
                            raise ValueError()
                        for name, value in zip(pilot.STAGING_COLUMNS, projected):
                            if not pilot.csv_profile.valid_value(name, value, pilot.csv_profile.SCHEMAS["transfer"][name]):
                                raise ValueError()
                        typed = {key: int(value) if key in export.NUMBERS and value is not None else value for key, value in row.items()}
                        if export.row_bytes(json.dumps(typed), window["start_inclusive"], window["end_exclusive"], columns) != line:
                            raise ValueError()
                        row_hash = sha256(line).hexdigest()
                        prior = index.execute("SELECT hash FROM source_keys WHERE id=? AND stamp=?", (row["id"], row["requesttime"])).fetchone()
                        selected += 1
                        if prior:
                            if prior[0] != row_hash:
                                raise ValueError("BULK_SOURCE_KEY_CONFLICT")
                            duplicates += 1
                            continue
                        index.execute("INSERT INTO source_keys VALUES (?,?,?)", (row["id"], row["requesttime"], row_hash))
                        unique += 1
                        values.append(projected)
                        lineage.append(pilot.encoded({"window": window_number, "source_row": row_number, "source_row_sha256": row_hash}))
                        if len(values) == CHUNK_ROWS:
                            flush()
            flush()
        finally:
            index.close()
        index_path.unlink()
        if not unique or pilot.read_private(bundle / "manifest.jsonl", 1024 * 1024) != raw_manifest:
            raise ValueError()
        # Reverify source hashes to detect replacement between verification and row selection.
        if export.verify_dataset(bundle) != source_summary:
            raise ValueError()
        plan = {"format": VERSION, "execution_mode": "offline_analysis", "source_semantics": "unverified",
                "source_manifest_sha256": source_hash, "source_format": metadata["format"], "source_rows": source_summary["rows"],
                "source_windows": len(windows), "requested_rows": maximum, "selected_rows": selected,
                "unique_rows": unique, "duplicate_rows": duplicates, "conflicting_rows": 0,
                "selection": "source_file_order_prefix_not_random", "chunks": chunks}
        pilot.write_private(stage / "source-manifest.jsonl", raw_manifest)
        pilot.write_private(stage / "plan.json", pilot.encoded(plan))
        verify_prepared(stage)
        shutil.copytree(stage, output)
        verify_prepared(output)
    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return {"format": VERSION, "publication": "created", "rows": unique, "selected_rows": selected,
            "duplicate_rows": duplicates, "elapsed_ms": round((time.monotonic() - started) * 1000),
            "peak_rss_bytes": rss if sys.platform == "darwin" else rss * 1024}


def lock(path):
    private_dir(path.parent)
    fd = os.open(path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        st = os.fstat(fd)
        if not export.os.path.isfile(path) or st.st_nlink != 1 or st.st_mode & 0o077 or st.st_uid != os.getuid():
            raise ValueError()
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        print("LOCKED", flush=True)
        sys.stdin.buffer.read()
    finally:
        os.close(fd)


def main():
    try:
        pilot.mode()
        if len(sys.argv) == 3 and sys.argv[1] == "lock":
            lock(Path(sys.argv[2]))
        elif len(sys.argv) == 5 and sys.argv[1] == "prepare":
            print(json.dumps(prepare(Path(sys.argv[2]), Path(sys.argv[3]), int(sys.argv[4]))))
        elif len(sys.argv) == 3 and sys.argv[1] == "verify":
            print(json.dumps(verify_prepared(Path(sys.argv[2]))))
        else:
            raise ValueError()
        return 0
    except Exception:
        print("BULK_FILE_REJECTED; private diagnostics withheld.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
