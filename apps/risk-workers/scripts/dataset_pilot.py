"""Offline, private v2-pilot → six-column staging adapter; no DB or network IO."""

import csv
import gzip
from hashlib import sha256
import io
import json
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile
import uuid

import dataset_profile as csv_profile
import export_transfer as export

VERSION = "lmps-pilot-adapter-1"
STAGING_COLUMNS = tuple(csv_profile.SCHEMAS["transfer"])
MAX_BYTES = 64 * 1024 * 1024
MAX_LINE_BYTES = export.MAX_LINE_CHARS * 4


class PilotError(Exception):
    pass


def mode():
    if (os.environ.get("NODE_ENV") == "production"
            or os.environ.get("LMPS_ENVIRONMENT", "local") not in {"local", "test"}
            or os.environ.get("LMPS_EXECUTION_MODE", "test") != "test"):
        raise PilotError("PILOT_LOCAL_MODE_REQUIRED")


def read_private(path, maximum=MAX_BYTES):
    parent = csv_profile.private_directory(path.parent)
    try:
        with csv_profile.private_file(parent, path.name) as stream:
            before = os.fstat(stream.fileno())
            if before.st_size > maximum:
                raise PilotError("PILOT_FILE_LIMIT")
            data = stream.read(maximum + 1)
            after = os.fstat(stream.fileno())
            attributes = ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns")
            if (len(data) != before.st_size or len(data) > maximum
                    or any(getattr(before, key) != getattr(after, key) for key in attributes)):
                raise PilotError("PILOT_INPUT_CHANGED")
            return data
    finally:
        os.close(parent)


def write_private(path, data):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "wb") as output:
        output.write(data)
        output.flush()
        os.fsync(output.fileno())


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n").encode()


def decode_field(value):
    if value == r"\N":
        return None
    escapes = {"\\": "\\", "t": "\t", "n": "\n", "r": "\r", "0": "\0"}
    result, i = [], 0
    while i < len(value):
        if value[i] != "\\":
            result.append(value[i])
            i += 1
        else:
            if i + 1 == len(value) or value[i + 1] not in escapes:
                raise PilotError("PILOT_TSV_ESCAPE_INVALID")
            result.append(escapes[value[i + 1]])
            i += 2
    return "".join(result)


def project(raw, metadata):
    stream = io.BytesIO(raw)
    header = ("\t".join(export.PILOT_COLUMNS) + "\n").encode()
    if stream.readline(MAX_LINE_BYTES + 1) != header:
        raise PilotError("PILOT_HEADER_INVALID")
    output = io.StringIO(newline="")
    writer = csv.writer(output, lineterminator="\n", quoting=csv.QUOTE_ALL)
    writer.writerow(STAGING_COLUMNS)
    lineage, count = [], 0
    while line := stream.readline(MAX_LINE_BYTES + 1):
        count += 1
        if count > export.PILOT_LIMIT or len(line) > MAX_LINE_BYTES or not line.endswith(b"\n"):
            raise PilotError("PILOT_RECORD_LIMIT")
        fields = line[:-1].decode("utf-8").split("\t")
        if len(fields) != len(export.PILOT_COLUMNS):
            raise PilotError("PILOT_ROW_WIDTH_INVALID")
        row = dict(zip(export.PILOT_COLUMNS, map(decode_field, fields)))
        source_key = {name: row[name] for name in ("id", "requesttime")}
        values = [row[name] for name in STAGING_COLUMNS]
        if any(value == r"\N" for value in values):
            raise PilotError("PILOT_LITERAL_NULL_NOT_REPRESENTABLE")
        for name in export.NUMBERS:
            if row[name] is not None:
                if not re.fullmatch(r"0|-?[1-9][0-9]*", row[name]):
                    raise PilotError("PILOT_INTEGER_INVALID")
                row[name] = int(row[name])
        canonical = export.row_bytes(json.dumps(row), metadata["requested_start_inclusive"],
                                     metadata["requested_end_exclusive"], export.PILOT_COLUMNS)
        if canonical != line:
            raise PilotError("PILOT_NONCANONICAL_ENCODING")
        writer.writerow([r"\N" if value is None else value for value in values])
        projected = json.dumps(values, ensure_ascii=False, separators=(",", ":")).encode()
        lineage.append(encoded({"row_number": count, "source_table": "transfer", "source_key": source_key,
                                "source_tsv_row_sha256": sha256(line).hexdigest(),
                                "staged_row_sha256": sha256(projected).hexdigest()}))
    return output.getvalue().encode(), b"".join(lineage), count


def tree_files(root):
    result = {}
    for path in root.rglob("*"):
        if path.is_dir():
            fd = csv_profile.private_directory(path)
            os.close(fd)
        else:
            data = read_private(path)
            result[str(path.relative_to(root))] = {"bytes": len(data), "sha256": sha256(data).hexdigest()}
    return result


def adapt(bundle, output):
    mode()
    if not bundle.is_absolute() or not output.is_absolute():
        raise PilotError("PILOT_ABSOLUTE_PATH_REQUIRED")
    source, target = bundle.resolve(), output.resolve()
    if source.is_relative_to(target) or target.is_relative_to(source) or bundle.is_symlink() or output.is_symlink():
        raise PilotError("PILOT_PATH_OVERLAP_OR_LINK")
    for path in (bundle, output.parent):
        fd = csv_profile.private_directory(path)
        os.close(fd)
    source_manifest = read_private(bundle / "manifest.jsonl", 64 * 1024)
    entries = [json.loads(line, object_pairs_hook=export.unique_object) for line in source_manifest.splitlines()]
    if (len(entries) != 3 or entries[0].get("format") != export.PILOT_FORMAT
            or entries[0].get("source_table") != "transfer"
            or entries[-1].get("status") != "pilot_complete"):
        raise PilotError("PILOT_V2_BUNDLE_REQUIRED")
    archive = entries[1].get("file", "")
    if not re.fullmatch(r"transfer_[0-9]{8}_[0-9]{4}_[0-9]{8}_[0-9]{4}\.tsv\.gz", archive):
        raise PilotError("PILOT_ARCHIVE_NAME_INVALID")
    ids = {"batch_ref": str(uuid.uuid4()), "replay_run_id": str(uuid.uuid4())}
    existed = output.exists()
    if existed:
        fd = csv_profile.private_directory(output)
        os.close(fd)
        prior = json.loads(read_private(output / "receipt.json", 64 * 1024))
        if prior.get("format") != VERSION:
            raise PilotError("PILOT_OUTPUT_CONFLICT")
        ids = {name: prior[name] for name in ids}
        for value in ids.values():
            parsed = uuid.UUID(value)
            if parsed.version != 4 or str(parsed) != value:
                raise PilotError("PILOT_OUTPUT_CONFLICT")
    with tempfile.TemporaryDirectory(prefix=".pilot-adapter-", dir=output.parent) as temporary:
        stage = Path(temporary)
        evidence = stage / "evidence"
        evidence.mkdir(mode=0o700)
        write_private(evidence / "manifest.jsonl", source_manifest)
        for name in (archive, "profile.json", "preflight.json"):
            write_private(evidence / name, read_private(bundle / name))
        with gzip.open(evidence / archive, "rb") as compressed:
            raw = compressed.read(MAX_BYTES + 1)
        if len(raw) > MAX_BYTES:
            raise PilotError("PILOT_DECOMPRESSED_LIMIT")
        summary = export.verify_dataset(evidence)
        csv_data, lineage, rows = project(raw, entries[0])
        if not rows or rows != summary["rows"]:
            raise PilotError("PILOT_ROW_COUNT_MISMATCH")
        write_private(stage / "transfer.csv", csv_data)
        report = csv_profile.profile_file(stage / "transfer.csv", "transfer")
        if report["validation_status"] != "valid" or report["observed_rows"] != rows:
            raise PilotError("PILOT_CSV_PROFILE_REJECTED")
        write_private(stage / "csv-profile.json", encoded(report))
        write_private(stage / "lineage.jsonl", lineage)
        request = {"format": 1, "execution_mode": "offline_analysis", "batch_ref": ids["batch_ref"],
                   "workspace_key": "offline_lmps_pilot", "source_namespace": "offline_lmps_pilot_v2",
                   "source_table": "transfer", "profile_version": csv_profile.VERSION,
                   "dataset_sha256": report["dataset_sha256"], "input_bytes": report["input_bytes"],
                   "expected_rows": rows}
        write_private(stage / "input.json", encoded(request))
        receipt = {"format": VERSION, **ids, "source_manifest_sha256": sha256(source_manifest).hexdigest(),
                   "source_rows": rows, "staged_rows": rows, "sample_only": True,
                   "source_columns": list(export.PILOT_COLUMNS), "staging_columns": list(STAGING_COLUMNS),
                   "evidence_archive": "evidence/" + archive, "source_semantics": "unverified",
                   "account_identity": "unverified", "account_fields_in_staging": False,
                   "canonical_emission": False, "files": tree_files(stage)}
        write_private(stage / "receipt.json", encoded(receipt))
        if existed:
            if tree_files(output) != tree_files(stage):
                raise PilotError("PILOT_OUTPUT_CONFLICT")
        else:
            shutil.copytree(stage, output)
            if tree_files(output) != tree_files(stage):
                raise PilotError("PILOT_PUBLICATION_FAILED")
    return {"format": VERSION, "status": "duplicate" if existed else "created", "rows": rows}


def main(argv=None):
    try:
        mode()
        parser = csv_profile.RedactedParser(description=__doc__)
        parser.add_argument("--bundle", type=Path, required=True)
        parser.add_argument("--output", type=Path, required=True)
        args = parser.parse_args(argv)
        print(json.dumps(adapt(args.bundle, args.output)))
        return 0
    except Exception as error:
        code = str(error) if isinstance(error, PilotError) else "PILOT_ADAPTER_REJECTED"
        print(code + "; private diagnostics withheld.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
