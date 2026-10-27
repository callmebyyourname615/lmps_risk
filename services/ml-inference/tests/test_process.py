import os
from pathlib import Path
import socket
import subprocess
import sys
import time

import httpx2


def test_real_entrypoint_serves_and_stops_without_request_logging():
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    env = {
        **os.environ,
        "LMPS_ENVIRONMENT": "test",
        "LMPS_EXECUTION_MODE": "test",
        "LMPS_ML_PORT": str(port),
    }
    process = subprocess.Popen(
        [sys.executable, "-m", "lmps_ml"],
        cwd=Path(__file__).resolve().parents[1],
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    try:
        with httpx2.Client(base_url=f"http://127.0.0.1:{port}", timeout=0.5, trust_env=False) as client:
            deadline = time.monotonic() + 10
            while True:
                assert process.poll() is None, "Inference bootstrap exited before becoming live"
                try:
                    response = client.get("/health/live?account=synthetic-private-canary")
                    break
                except httpx2.TransportError:
                    assert time.monotonic() < deadline, "Inference bootstrap startup timed out"
                    time.sleep(0.05)
            assert response.status_code == 200
            assert client.get("/health/ready").status_code == 503
            assert client.get("/openapi.json").status_code == 200
            assert client.post("/score", json={"account": "synthetic-private-canary"}).status_code == 404
    finally:
        process.terminate()
        try:
            output, _ = process.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.communicate()
            raise AssertionError("Inference bootstrap failed to shut down gracefully") from None
    assert process.returncode in (0, -15)
    assert "synthetic-private-canary" not in output
    with socket.socket() as probe:
        probe.settimeout(1)
        assert probe.connect_ex(("127.0.0.1", port)) != 0


def test_entrypoint_rejects_bad_configuration_without_echoing_it():
    result = subprocess.run(
        [sys.executable, "-m", "lmps_ml"],
        cwd=Path(__file__).resolve().parents[1],
        env={
            **os.environ,
            "LMPS_ENVIRONMENT": "test",
            "LMPS_EXECUTION_MODE": "test",
            "LMPS_ML_PORT": "synthetic-private-canary",
        },
        capture_output=True,
        text=True,
        timeout=10,
    )
    assert result.returncode == 1
    assert result.stdout == ""
    assert result.stderr.strip() == "LMPS_ML_PORT must be an integer between 1 and 65535."
