"""Scan Git-visible source, including untracked files, without exposing secret values."""

from hashlib import sha1, sha256
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
SYNTHETIC_SQL = "tools/schema-metadata/tests/fixtures/schema.sql"
REVIEWED_MIGRATIONS = {"packages/database/migrations/0000_foundation.sql", "packages/database/migrations/0001_local_source_intake.sql", "packages/database/migrations/0002_intake_column_grants.sql", "packages/database/migrations/0003_local_outbox.sql", "packages/database/migrations/0004_local_audit.sql", "packages/database/migrations/0005_local_sync_jobs.sql", "packages/database/migrations/0006_local_transaction_revisions.sql", "packages/database/migrations/0007_local_normalization_publications.sql", "packages/database/migrations/0008_local_rule_assessments.sql", "packages/database/migrations/0009_local_transaction_risks.sql", "packages/database/migrations/0010_local_alerts.sql", "packages/database/migrations/0011_local_risk_jobs.sql", "packages/database/migrations/0012_offline_datasets.sql", "packages/database/migrations/0013_local_risk_policy_lifecycle.sql", "packages/database/migrations/0014_local_cases.sql", "packages/database/migrations/0015_local_model_receipts.sql", "packages/database/migrations/0016_local_label_adjudications.sql"}
PRIVATE_SUFFIXES = {".pem", ".key", ".p12", ".pfx", ".dump", ".backup", ".csv", ".parquet", ".jsonl", ".sql"}
PRIVATE_DIRECTORIES = {"secrets", "private", "data", ".local", ".venv", "node_modules", "dist", "__pycache__"}


def project_files(root):
    result = subprocess.run(["git", "rev-parse", "--show-toplevel"], cwd=root, capture_output=True, text=True)
    if result.returncode or Path(result.stdout.strip()).resolve() != root.resolve():
        raise RuntimeError("Verification requires this directory to be a Git repository root.")
    result = subprocess.run(["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], cwd=root, capture_output=True, check=True)
    return sorted({name for name in result.stdout.decode().split("\0") if name})


def forbidden_file(name):
    path = Path(name)
    if name == SYNTHETIC_SQL or name in REVIEWED_MIGRATIONS:
        return False
    if name == ".env.example":
        return False
    return (
        any(part.lower() in PRIVATE_DIRECTORIES for part in path.parts)
        or path.name.startswith(".env")
        or path.suffix.lower() in PRIVATE_SUFFIXES
        or path.name.lower() in {"credentials.json", "service-account.json", "service_account.json", "kubeconfig"}
    )


def is_public_metadata(root, name, finding):
    if name == "infrastructure/postgres/postgresql.conf" and finding["type"] == "Secret Keyword":
        line = (root / name).read_text().splitlines()[finding["line_number"] - 1]
        return line == "password_" + "encryption = 'scram-sha-256'"
    if name == "pnpm-lock.yaml" and finding["type"] == "Base64 High Entropy String":
        line = (root / name).read_text().splitlines()[finding["line_number"] - 1]
        return bool(re.fullmatch(r"\s+resolution: \{integrity: sha512-[A-Za-z0-9+/]{86}==\}", line) or re.fullmatch(r"\s+integrity: sha256-[A-Za-z0-9+/]{43}=", line))
    if name == "docs/data-dictionary/lmps-schema/metadata.json" and finding["type"] == "Hex High Entropy String":
        fingerprint = json.loads((root / name).read_text())["source"]["sha256"]
        return bool(re.fullmatch(r"[0-9a-f]{64}", fingerprint)) and finding["hashed_secret"] == sha1(fingerprint.encode()).hexdigest()
    checksum_keys = {"infrastructure/mariadb/runtime.json": "sha256", "infrastructure/mariadb/repository.json": "helper_sha256"}
    if name in checksum_keys and finding["type"] == "Hex High Entropy String":
        fingerprint = json.loads((root / name).read_text())[checksum_keys[name]]
        return bool(re.fullmatch(r"[0-9a-f]{64}", fingerprint)) and finding["hashed_secret"] == sha1(fingerprint.encode()).hexdigest()
    if name == "docs/supply-chain/local-sbom.cdx.json" and finding["type"] == "Hex High Entropy String":
        properties = json.loads((root / name).read_text())["metadata"]["properties"]
        expected = {
            "lmps:pnpm-lock-sha256": sha256((root / "pnpm-lock.yaml").read_bytes()).hexdigest(),
            "lmps:uv-lock-sha256": sha256((root / "uv.lock").read_bytes()).hexdigest(),
        }
        return any(
            property_.get("name") in expected
            and property_.get("value") == expected[property_["name"]]
            and finding["hashed_secret"] == sha1(property_["value"].encode()).hexdigest()
            for property_ in properties
        )
    return False


def scan(root, files):
    selected = []
    for name in files:
        path = root / name
        if forbidden_file(name) or path.is_symlink():
            print("FAIL publication policy:", json.dumps(name))
            return False
        if path.is_file():
            selected.append(name)
    if not selected:
        raise RuntimeError("No source files selected; refusing an empty secret scan.")
    found = []
    for start in range(0, len(selected), 100):
        command = [sys.executable, "-m", "detect_secrets", "scan", "--all-files", "--no-verify", "--disable-filter", "detect_secrets.filters.allowlist.is_line_allowlisted", *selected[start:start + 100]]
        result = subprocess.run(command, cwd=root, capture_output=True, text=True, timeout=60)
        if result.returncode:
            raise RuntimeError("Secret scanner failed; output withheld to avoid exposing values.")
        findings = json.loads(result.stdout)["results"]
        for name, entries in findings.items():
            for entry in entries:
                if not is_public_metadata(root, name, entry):
                    found.append({"file": name, "line": entry["line_number"], "type": entry["type"]})
    for item in found:
        print("FAIL secret finding:", json.dumps(item))
    if found:
        return False
    print(f"PASS publication policy and local secret scan: {len(selected)} files; key verification disabled")
    return True


def main():
    try:
        return 0 if scan(ROOT, project_files(ROOT)) else 1
    except Exception:
        print("FAIL security scan; tool details withheld. Check installation and repository state.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
