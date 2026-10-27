import re
from collections.abc import Mapping


def read_config(env: Mapping[str, str]) -> int:
    """Validate local-only configuration and return the listener port."""
    if env.get("LMPS_ENVIRONMENT", "local") not in {"local", "test"}:
        raise ValueError("This bootstrap service supports local/test environments only.")
    if env.get("LMPS_EXECUTION_MODE", "test") != "test":
        raise ValueError("This bootstrap service supports test execution mode only.")
    raw_port = env.get("LMPS_ML_PORT", "18502")
    if not re.fullmatch(r"[0-9]{1,5}", raw_port) or not 1 <= int(raw_port) <= 65535:
        raise ValueError("LMPS_ML_PORT must be an integer between 1 and 65535.")
    return int(raw_port)
