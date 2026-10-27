"""Internal CSV bridge: verified rows go only to an inherited private pipe, never stdout."""

from hashlib import sha256
import json
import os
from pathlib import Path
import sys

from dataset_profile import SCHEMAS, VERSION, profile_file


def main():
    try:
        if len(sys.argv) != 4 or sys.argv[1] not in SCHEMAS:
            raise ValueError()
        if os.environ.get("NODE_ENV") == "production" or os.environ.get("LMPS_ENVIRONMENT", "local") not in ("local", "test") or os.environ.get("LMPS_EXECUTION_MODE", "test") != "test":
            raise ValueError()
        rows = []
        report = profile_file(Path(sys.argv[2]), sys.argv[1], rows)
        if report["validation_status"] != "valid" or report["dataset_sha256"] != sys.argv[3]:
            raise ValueError()
        def encode(row):
            return (json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
        digest = sha256()
        for row in rows:
            digest.update(encode(row))
        with os.fdopen(3, "wb") as pipe:
            header = {"profile_version": VERSION, "dataset_sha256": report["dataset_sha256"], "input_bytes": report["input_bytes"],
                      "expected_rows": len(rows), "rows_sha256": digest.hexdigest()}
            pipe.write(encode(header))
            for row in rows:
                pipe.write(encode(row))
        return 0
    except Exception:
        print("DATASET_FILE_REJECTED; private diagnostics withheld.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
