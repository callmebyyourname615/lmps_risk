"""Verify a temporary copy of Git-visible source with locked, cached installs."""

from hashlib import sha256
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

from security import ROOT, project_files, scan


def main():
    files = project_files(ROOT)
    if not scan(ROOT, files):
        return 1
    files = [name for name in files if (ROOT / name).is_file()]
    before = {name: sha256((ROOT / name).read_bytes()).digest() for name in files}
    env = dict(os.environ)
    if 'LMPS_MARIADB_BASE' not in env:
        spec = json.loads((ROOT / 'infrastructure/mariadb/runtime.json').read_text())
        env['LMPS_MARIADB_BASE'] = str(ROOT / '.local/mariadb-runtime' / spec['formula'] / spec['bottle_version'])
    with tempfile.TemporaryDirectory(prefix="lmps-fresh-") as temp:
        target = Path(temp)
        for name in files:
            destination = target / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(ROOT / name, destination)
        commands = [
            ["git", "init", "--quiet", "-b", "main"],
            ["pnpm", "install", "--frozen-lockfile", "--offline"],
            ["uv", "sync", "--locked", "--offline", "--all-packages", "--group", "security"],
            ["pnpm", "verify:offline"],
        ]
        for command in commands:
            subprocess.run(command, cwd=target, check=True, timeout=600 if command == commands[-1] else 300, env=env)
        if any(sha256((ROOT / name).read_bytes()).digest() != digest for name, digest in before.items()):
            raise RuntimeError("Original source changed during fresh verification.")
    print("PASS fresh-source verification; temporary workspace removed; advisory audits skipped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
