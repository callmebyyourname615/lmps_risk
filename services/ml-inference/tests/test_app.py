import pytest
from fastapi.testclient import TestClient

from lmps_ml.app import create_app
from lmps_ml.config import read_config


@pytest.fixture
def client():
    with TestClient(create_app({})) as client:
        yield client


def test_live_is_not_model_readiness(client):
    response = client.get("/health/live?account=synthetic-private-canary")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "ml-inference"}
    assert response.headers["cache-control"] == "no-store"


def test_readiness_stays_unavailable_without_a_model(client):
    for _ in range(2):
        response = client.get("/health/ready")
        assert response.status_code == 503
        assert response.json() == {
            "status": "not_ready", "service": "ml-inference", "reason": "model_not_loaded"
        }
        assert response.headers["cache-control"] == "no-store"


def test_openapi_matches_health_responses(client):
    response = client.get("/openapi.json")
    assert response.status_code == 200
    spec = response.json()
    assert set(spec["paths"]) == {"/health/live", "/health/ready"}
    for path, status in (("/health/live", "200"), ("/health/ready", "503")):
        responses = spec["paths"][path]["get"]["responses"]
        assert set(responses) == {status}
        schema_ref = responses[status]["content"]["application/json"]["schema"]["$ref"]
        schema = spec["components"]["schemas"][schema_ref.rsplit("/", 1)[1]]
        for key, value in client.get(path).json().items():
            assert schema["properties"][key]["const"] == value


def test_scoring_is_not_exposed_or_faked(client):
    response = client.post("/score", json={"account": "synthetic-private-canary"})
    assert response.status_code == 404
    assert "synthetic-private-canary" not in response.text
    assert client.post("/health/ready").status_code == 405


def test_no_remote_documentation_assets(client):
    assert client.get("/docs").status_code == 404
    assert client.get("/redoc").status_code == 404


def test_config_defaults_and_explicit_test_mode():
    assert read_config({}) == 18502
    assert read_config({"LMPS_ENVIRONMENT": "test", "LMPS_EXECUTION_MODE": "test", "LMPS_ML_PORT": "65535"}) == 65535


@pytest.mark.parametrize("field,value", [
    ("LMPS_ENVIRONMENT", "production"),
    ("LMPS_ENVIRONMENT", "staging"),
    ("LMPS_ENVIRONMENT", ""),
    ("LMPS_EXECUTION_MODE", "live"),
    ("LMPS_EXECUTION_MODE", ""),
])
def test_app_rejects_unsupported_environment_or_mode(field, value):
    with pytest.raises(ValueError):
        create_app({field: value})


@pytest.mark.parametrize("value", ["", "0", "65536", "1.5", "-1", " 18502", "18502\n", "１２３", "9" * 5000, "synthetic-private-canary"])
def test_app_rejects_invalid_ports_without_echoing_input(value):
    with pytest.raises(ValueError, match="LMPS_ML_PORT must be an integer between 1 and 65535.") as error:
        create_app({"LMPS_ML_PORT": value})
    assert str(error.value) == "LMPS_ML_PORT must be an integer between 1 and 65535."
