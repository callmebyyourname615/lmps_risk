"""Internal bounded private-file bridge; parent captures stdout, no database/network IO."""

import gzip
from hashlib import sha256
import io
import json
import os
from pathlib import Path
import re
import sys

import dataset_pilot as pilot
import export_transfer as export

FIELDS = ("result txtype totype shouldrevert isreconciled issettled ccy amount fee "
          "requesttime txtime responsetime settletime qrtype fromchannel").split()


def evidence(adapted):
    pilot.mode()
    if not adapted.is_absolute() or adapted.is_symlink():
        raise ValueError()
    receipt_bytes = pilot.read_private(adapted / "receipt.json", 64 * 1024)
    receipt = json.loads(receipt_bytes)
    archive_path = receipt.get("evidence_archive", "")
    if not isinstance(archive_path, str) or not re.fullmatch(r"evidence/transfer_[0-9]{8}_[0-9]{4}_[0-9]{8}_[0-9]{4}\.tsv\.gz", archive_path):
        raise ValueError()
    for folder, allowed in (
        (adapted, {"evidence", "receipt.json", "input.json", "csv-profile.json", "transfer.csv", "lineage.jsonl"}),
        (adapted / "evidence", {"manifest.jsonl", "profile.json", "preflight.json", archive_path.split("/")[1]}),
    ):
        fd = pilot.csv_profile.private_directory(folder)
        os.close(fd)
        seen = set()
        for child in folder.iterdir():
            if child.name not in allowed or child.is_symlink():
                raise ValueError()
            if not (folder == adapted and child.name == "evidence") and not child.is_file():
                raise ValueError()
            seen.add(child.name)
        if seen != allowed:
            raise ValueError()
    actual = pilot.tree_files(adapted)
    actual.pop("receipt.json")
    if (receipt.get("format") != pilot.VERSION or actual != receipt.get("files")
            or receipt.get("source_columns") != list(export.PILOT_COLUMNS)
            or receipt.get("staging_columns") != list(pilot.STAGING_COLUMNS)
            or receipt.get("account_fields_in_staging") is not False
            or receipt.get("source_semantics") != "unverified"
            or receipt.get("account_identity") != "unverified"):
        raise ValueError()
    root = adapted / "evidence"
    manifest = pilot.read_private(root / "manifest.jsonl", 64 * 1024)
    if sha256(manifest).hexdigest() != receipt["source_manifest_sha256"]:
        raise ValueError()
    entries = [json.loads(line, object_pairs_hook=export.unique_object) for line in manifest.splitlines()]
    if len(entries) != 3 or entries[0].get("format") != export.PILOT_FORMAT:
        raise ValueError()
    name = entries[1].get("file", "")
    if receipt.get("evidence_archive") != "evidence/" + name or "/" in name or "\\" in name:
        raise ValueError()
    compressed = pilot.read_private(root / name)
    with gzip.GzipFile(fileobj=io.BytesIO(compressed)) as archive:
        raw = archive.read(pilot.MAX_BYTES + 1)
    if len(raw) > pilot.MAX_BYTES:
        raise ValueError()
    summary = export.verify_dataset(root)
    csv_data, lineage, rows = pilot.project(raw, entries[0])
    if (not 1 <= rows <= export.PILOT_LIMIT or rows != receipt["source_rows"] or rows != receipt["staged_rows"] or rows != summary["rows"]
            or csv_data != pilot.read_private(adapted / "transfer.csv")
            or lineage != pilot.read_private(adapted / "lineage.jsonl")):
        raise ValueError()
    records = []
    for i, line in enumerate(raw.split(b"\n")[1:-1], 1):
        row = dict(zip(export.PILOT_COLUMNS, map(pilot.decode_field, line.decode().split("\t"))))
        record = {key: row[key] for key in FIELDS}
        record.update(row_number=i, source_row_sha256=sha256(line + b"\n").hexdigest(),
                      originalreference_presence="null" if row["originalreference"] is None
                      else "empty" if row["originalreference"] == "" else "present")
        records.append(record)
    if pilot.tree_files(adapted) != {**actual, "receipt.json": {"bytes": len(receipt_bytes), "sha256": sha256(receipt_bytes).hexdigest()}}:
        raise ValueError()
    return {"format": "lmps-semantic-evidence-1", "source_manifest_sha256": receipt["source_manifest_sha256"],
            "adapter_receipt_sha256": sha256(receipt_bytes).hexdigest(),
            "source_archive_sha256": sha256(compressed).hexdigest(), "source_rows": rows,
            "sample_only": True, "records": records}


def main():
    try:
        if len(sys.argv) != 2:
            raise ValueError()
        print(json.dumps(evidence(Path(sys.argv[1])), ensure_ascii=False, separators=(",", ":")))
        return 0
    except Exception:
        print("SEMANTICS_EVIDENCE_REJECTED; private diagnostics withheld.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
