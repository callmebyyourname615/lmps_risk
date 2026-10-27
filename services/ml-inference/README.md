# Local ML datasets and shadow inference

No.47.1–51.1 add evidence-bound source observations, SQLite-backed temporal replay, frozen adjudicated-label attachment, same-cohort evaluation, aggregate drift metrics and private MLflow/artifact/key recovery. [Extended runbook and persistent Core API/FastAPI/PostgreSQL runtime](../../docs/operations/real-shadow-foundation.md). Streaming replay supports bounded larger inputs; fitting/evaluation still use cohorts of at most2000 rows. Real source/identity/labels remain unverified.

No.42.1–46.1 implement versioned point-in-time datasets, actual statistical/Isolation Forest/Logistic Regression/LightGBM experiments, MLflow tracking/registry, pinned safe artifacts, calibrated task probabilities and authenticated signed FastAPI shadow serving. [Full commands, contracts, rule/Alert/Case integration, acceptance and limitations](../../docs/operations/ml-shadow.md).

From the repository root:

```sh
uv sync --locked --all-packages --group security --system-certs
mkdir -m 700 .local/ml-demo
uv run --locked --directory services/ml-inference python -m lmps_ml.demo \
  --root "$PWD/.local/ml-demo"
LMPS_ML_ROOT="$PWD/.local/ml-demo" \
LMPS_ML_TOKEN_FILE="$PWD/.local/ml-demo/auth.token" \
LMPS_ML_SIGNING_KEY_FILE="$PWD/.local/ml-demo/signing.key" \
  uv run --locked --directory services/ml-inference python -m lmps_ml
```

The configured entrypoint binds127.0.0.1:18502. `GET /health/live` checks the process; `GET /health/ready` returns200 only after pinned loading/warmup; `POST /v1/shadow/score` requires the private bearer token and a strict feature snapshot. Results are Ed25519-signed, shadow-only and never payment actions. Unavailable scores remain absent. A process keeps its loaded version until restarted. Stop with Ctrl+C.

Without `LMPS_ML_ROOT`, the original health-only bootstrap remains: readiness503 `model_not_loaded`, no inference endpoint. Configuration requires local/test and `LMPS_EXECUTION_MODE=test`; no public deployment or source connection is configured. Request access logs and interactive CDN docs remain disabled.

The demo uses invented labels/entities; its metrics are not LMPS detection quality. Real-source semantics, identity, historical availability and mature labels remain unverified; the existing271-row real-file adapter correctly returns unavailable. Deep learning/GNN is not included. The reference caps datasets at2000 rows and uses a single-currency CPU model; production throughput is unmeasured. LightGBM is compiled without OpenMP; the runbook includes the Mac SDK header setting when a clean source build needs it.

```sh
uv run --locked --directory services/ml-inference python -m pytest -W error
pnpm generate:contracts
pnpm verify:fresh
```

The full suite additionally trains actual models and tests real FastAPI TCP→Node→disposable PostgreSQL→Alert→Case→Outcome/Audit plus backup/restore. No original persistent database migration or MariaDB write is performed.
