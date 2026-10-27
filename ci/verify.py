"""One verification entrypoint for local work and prepared CI workflows."""

import argparse
from hashlib import sha256
import json
import os
import signal
from pathlib import Path
import subprocess
import sys
import tempfile

from security import ROOT, project_files, scan


def run(label, command, cwd=ROOT, capture=False, timeout=180):
    print(f"CHECK {label}", flush=True)
    # A timeout must reap the entire command group before fresh.py removes its
    # workspace. Killing only pnpm leaves Node/database children using deleted files.
    with subprocess.Popen(command, cwd=cwd, stdout=subprocess.PIPE if capture else None,
                          stderr=subprocess.PIPE if capture else None, text=True,
                          start_new_session=True) as process:
        try:
            stdout, _ = process.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                process.communicate(timeout=5)
            except subprocess.TimeoutExpired:
                pass
            # The direct parent may exit on TERM while a child ignores it.
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.communicate()
            raise RuntimeError(f"{label} timed out; command group stopped; do not mark verification complete.") from None
        if process.returncode:
            raise RuntimeError(f"{label} failed (exit {process.returncode}); do not mark verification complete.")
    return stdout if capture else None


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--offline", action="store_true", help="Run local checks; explicitly skip online advisory audits.")
    args = parser.parse_args(argv)
    try:
        if not scan(ROOT, project_files(ROOT)):
            return 1
        pins = ((["pnpm", "--version"], "11.20.0"), (["pnpm", "exec", "node", "--version"], "v" + (ROOT / ".node-version").read_text().strip()), ([sys.executable, "--version"], "Python " + (ROOT / ".python-version").read_text().strip()))
        for command, expected in pins:
            if run("runtime pin", command, capture=True).strip() != expected:
                raise RuntimeError("Runtime version does not match the repository pin.")
        watched = [ROOT / "pnpm-lock.yaml", ROOT / "uv.lock", *sorted((ROOT / "packages/contracts/schemas").glob("*.json")), *sorted((ROOT / "packages/contracts/src/generated").glob("*.ts"))]
        before = {str(path): sha256(path.read_bytes()).hexdigest() for path in watched}
        run("frozen Node lock/install", ["pnpm", "install", "--frozen-lockfile", "--offline"])
        run("Python lock consistency", ["uv", "lock", "--check", "--offline"])
        run("local SBOM/license inventory", [sys.executable, "ci/sbom.py", "--check"])
        run("PostgreSQL major/binary consistency", ["pnpm", "exec", "node", "--input-type=module", "-e", "import { binaryDirectory } from './packages/database/scripts/local.mjs'; console.log(binaryDirectory().version);"])
        run("MariaDB native runtime consistency", ["pnpm", "exec", "node", "--input-type=module", "-e", "import { nativeDirectory } from './packages/source-preflight/scripts/local.mjs'; nativeDirectory(); console.log('MariaDB 11.8 runtime available.');"])
        run("verification/security tests", [sys.executable, "-m", "unittest", "discover", "-s", "ci/tests", "-v"])
        run("TypeScript typecheck", ["pnpm", "typecheck"])
        # Native database recovery and actual model/runtime fitting share this one command.
        run("Node builds/tests and generated-type drift", ["pnpm", "test"], timeout=480)
        run("ML and schema drift tests", [sys.executable, "-m", "pytest", "-W", "error"], ROOT / "services/ml-inference")
        run("DDL metadata tests", [sys.executable, "-m", "unittest", "discover", "-s", "tests", "-v"], ROOT / "tools/schema-metadata")
        with tempfile.TemporaryDirectory(prefix="lmps-verify-ddl-") as temp:
            run("synthetic DDL CLI", [sys.executable, "-m", "lmps_schema", "--input", "tests/fixtures/schema.sql", "--output-dir", temp], ROOT / "tools/schema-metadata")
        if {str(path): sha256(path.read_bytes()).hexdigest() for path in watched} != before:
            raise RuntimeError("Verification changed a lockfile or generated contract artifact.")
        if args.offline:
            print("SKIP online dependency advisories (--offline); this is a local-check result only.")
        else:
            node_audit = json.loads(run("Node dependency audit", ["pnpm", "audit", "--audit-level", "high", "--json"], capture=True))
            print("Node advisory counts:", json.dumps(node_audit["metadata"]["vulnerabilities"]))
            python_audit = json.loads(run("Python dependency audit", ["uv", "audit", "--locked", "--output-format", "json"], capture=True))
            print("Python advisory counts:", json.dumps(python_audit["summary"]))
        print("PASS verification" + (" (offline; advisory audits skipped)" if args.offline else " (including advisory audits)"))
        return 0
    except Exception as error:
        print(str(error) if isinstance(error, RuntimeError) else "Verification failed; diagnostic details withheld.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
