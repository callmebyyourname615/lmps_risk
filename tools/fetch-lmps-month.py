"""Download an operator-selected monthly bundle through SSH, verify locally, and prepare a private profiling plan."""

import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "apps/risk-workers/scripts"))
import export_month as month


def fetch(host, remote, output):
    month.check(isinstance(host, str) and re.fullmatch(r"[A-Za-z0-9_][A-Za-z0-9_.@-]{0,200}", host))
    month.check(isinstance(remote, str) and re.fullmatch(r"/[A-Za-z0-9_./-]+", remote)
                and ".." not in remote.split("/") and remote != "/")
    month.check(output.is_absolute() and output.parent.is_dir())
    if not output.exists():
        output.mkdir(mode=0o700)
    month.private_directory(output)
    destination = Path(tempfile.mkdtemp(prefix="lmps-month-download-", dir=output))
    bundle = destination / "bundle"
    bundle.mkdir(mode=0o700)
    # Fixed argument vector; standard OpenSSH host verification/interactive authentication remain enabled.
    result = subprocess.run(["scp", "-p", "-r", "--", host + ":" + remote.rstrip("/") + "/.", str(bundle)],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    month.check(result.returncode == 0)
    plan = month.readiness_plan(bundle)
    fd = os.open(destination / "readiness-plan.json", os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(plan, f, sort_keys=True, indent=2)
        f.write("\n")
        f.flush()
        os.fsync(f.fileno())
    return destination


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument("--ssh-host", required=True, help="Existing SSH alias, or user@host; credentials stay in SSH")
    parser.add_argument("--remote-dir", required=True, help="Absolute export directory; no spaces or shell metacharacters")
    parser.add_argument("--output-root", required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        destination = fetch(args.ssh_host, args.remote_dir, args.output_root)
        print("VERIFIED_MONTH_DOWNLOAD " + str(destination))
        return 0
    except KeyboardInterrupt:
        print("MONTH_DOWNLOAD_INTERRUPTED; private partial download retained.", file=sys.stderr)
        return 130
    except Exception:
        print("MONTH_DOWNLOAD_FAILED; private partial download retained; no source files deleted.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
