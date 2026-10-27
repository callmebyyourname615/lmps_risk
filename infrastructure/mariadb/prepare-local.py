"""Prepare a private verified macOS bottle; never install/link a system service."""

from hashlib import sha256
import json
from pathlib import Path
import platform
import subprocess
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[2]
SPEC = json.loads((ROOT / "infrastructure/mariadb/runtime.json").read_text())
TARGET = ROOT / ".local/mariadb-runtime"


def run(command):
    return subprocess.run(command, capture_output=True, text=True, check=True, timeout=180).stdout.strip()


def main():
    if platform.system() != "Darwin" or platform.machine() != "arm64" or int(run(["sw_vers", "-productVersion"]).split(".")[0]) < 26:
        raise RuntimeError("Use an installed native MariaDB 11.8 via LMPS_MARIADB_BASE on this platform.")
    if TARGET.exists():
        if TARGET.is_symlink() or json.loads((TARGET / ".prepared.json").read_text()) != SPEC:
            raise RuntimeError("Refusing to overwrite unowned/different runtime files.")
        binary = TARGET / SPEC["formula"] / SPEC["bottle_version"] / "bin/mariadbd"
        if SPEC["server_version"] + "-MariaDB" not in run([str(binary), "--no-defaults", "--version"]):
            raise RuntimeError("Private runtime/version check failed.")
        print("Private MariaDB runtime already prepared.")
        return
    prefix = run(["brew", "--prefix"])
    run(["brew", "fetch", "--bottle-tag=" + SPEC["bottle_tag"], SPEC["formula"]])
    archive = Path(run(["brew", "--cache", "--bottle-tag=" + SPEC["bottle_tag"], SPEC["formula"]]))
    if sha256(archive.read_bytes()).hexdigest() != SPEC["sha256"]:
        raise RuntimeError("Bottle version/checksum changed; review the manifest before preparing.")
    TARGET.parent.mkdir(mode=0o700, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="mariadb-prepare-", dir=TARGET.parent) as temp:
        staging = Path(temp) / "runtime"
        staging.mkdir(mode=0o700)
        with tarfile.open(archive) as bundle:
            for member in bundle:
                try:
                    bundle.extract(member, staging, filter="data")
                except tarfile.FilterError:
                    # Bottle service/helper links outside the private runtime are intentionally omitted.
                    continue
        base = staging / SPEC["formula"] / SPEC["bottle_version"]
        final_base = TARGET / SPEC["formula"] / SPEC["bottle_version"]
        for folder in (base / "bin", base / "lib"):
            for file in folder.rglob("*"):
                if not file.is_file() or file.is_symlink():
                    continue
                with file.open("rb") as stream:
                    magic = stream.read(4)
                if magic not in (b"\xcf\xfa\xed\xfe", b"\xfe\xed\xfa\xcf", b"\xca\xfe\xba\xbe"):
                    continue
                changes = []
                for line in run(["otool", "-L", str(file)]).splitlines()[1:]:
                    dependency = line.strip().split(" (", 1)[0]
                    relocated = dependency.replace("@@HOMEBREW_PREFIX@@", prefix).replace("@@HOMEBREW_CELLAR@@", prefix + "/Cellar")
                    relocated = relocated.replace(prefix + "/opt/" + SPEC["formula"], str(final_base)).replace(prefix + "/Cellar/" + SPEC["formula"] + "/" + SPEC["bottle_version"], str(final_base))
                    if dependency != relocated:
                        changes.extend(["-change", dependency, relocated])
                if changes:
                    run(["install_name_tool", *changes, str(file)])
                    run(["codesign", "--force", "--sign", "-", str(file)])
        (staging / ".prepared.json").write_text(json.dumps(SPEC))
        staging.rename(TARGET)
    # Runtime dependencies must already exist; never upgrade shared libraries here.
    base = TARGET / SPEC["formula"] / SPEC["bottle_version"]
    if SPEC["server_version"] + "-MariaDB" not in run([str(base / "bin/mariadbd"), "--no-defaults", "--version"]):
        raise RuntimeError("Private runtime/version check failed.")
    print("Private MariaDB runtime prepared; no brew install/link/post-install/service operation performed.")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        raise SystemExit("MariaDB runtime preparation failed; inspect tool/dependency availability and pinned manifest.")
