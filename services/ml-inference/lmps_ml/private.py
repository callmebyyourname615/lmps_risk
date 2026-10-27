"""Bounded private local artifacts shared by dataset, training and shadow serving."""
from hashlib import sha256
import json
import os
from pathlib import Path
import stat

MAX_BYTES = 16 * 1024 * 1024


def mode():
    if (os.environ.get("NODE_ENV") == "production" or os.environ.get("LMPS_ENVIRONMENT", "local") not in {"local", "test"}
            or os.environ.get("LMPS_EXECUTION_MODE", "test") != "test"):
        raise ValueError("ML_LOCAL_MODE_REQUIRED")


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode()


def digest(value):
    return sha256(encoded(value)).hexdigest()


def directory(path, create=False):
    path = Path(path)
    if not path.is_absolute():
        raise ValueError("ML_PRIVATE_PATH_REQUIRED")
    if create:
        path.mkdir(mode=0o700, exist_ok=True)
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise ValueError("ML_PRIVATE_PATH_REQUIRED")
    return path


def read_bytes(path, maximum=MAX_BYTES):
    path = Path(path)
    directory(path.parent)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as stream:
        before = os.fstat(stream.fileno())
        if (not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_uid != os.getuid()
                or before.st_mode & 0o077 or before.st_size > maximum):
            raise ValueError("ML_ARTIFACT_REJECTED")
        data = stream.read(maximum + 1)
        after = os.fstat(stream.fileno())
        if len(data) != before.st_size or any(getattr(before,k) != getattr(after,k) for k in ("st_dev","st_ino","st_size","st_mtime_ns","st_ctime_ns")):
            raise ValueError("ML_ARTIFACT_CHANGED")
        return data


def read_json(path, maximum=MAX_BYTES):
    def unique(pairs):
        value = dict(pairs)
        if len(value) != len(pairs):
            raise ValueError("ML_DUPLICATE_KEYS")
        return value
    return json.loads(read_bytes(path, maximum), object_pairs_hook=unique, parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))


def write(path, data):
    path = Path(path)
    directory(path.parent)
    fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "wb") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())


def publish(path, files):
    path = Path(path)
    directory(path.parent)
    try:
        path.mkdir(mode=0o700)
    except FileExistsError:
        directory(path)
        if {p.name for p in path.iterdir()} != set(files) or any(read_bytes(path / name) != data for name, data in files.items()):
            raise ValueError("ML_ARTIFACT_CONFLICT")
        return False
    for name, data in files.items():
        if Path(name).name != name:
            raise ValueError("ML_ARTIFACT_REJECTED")
        write(path / name, data)
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)
    return True
