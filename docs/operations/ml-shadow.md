# No.42.1–46.1 — local ML datasets, experiments and shadow review

Follow-on No.47.1–51.1 now provide a [persistent owned runtime, checkpointed replay, adjudication/evaluation and recovery](real-shadow-foundation.md). The2000-row limit below still applies to training/reference datasets; the new replay engine has separate explicit limits. The original instructions remain supported.

These five batches implement an executable **local/synthetic experimental and shadow foundation**. They do not establish LMPS detection accuracy, verified account identity, crime labels, historical model availability, a production release or payment decisions. The existing real271-row extract remains unverified and produces unavailable features/models. The user deferred the real2GB flash-drive trial.

| Batch | Implemented behavior | Acceptance evidence |
| --- | --- | --- |
|42.1|Immutable versioned input/dataset,6 declared features, provenance/availability, time splits and one-hour embargo; repeated business payments purged|Future/late correction, known reversal, superseded target, label exclusion, frozen-dataset rebuild and Python/TypeScript hash parity checks|
|43.1|Train-only median/MAD and Isolation Forest; threshold from calibration only; same test cohort reference rule; actual MLflow SQLite runs/parameters/metrics/artifacts|Actual fitting, recorded run ID, deterministic private publication and exact retries|
|44.1|Adjudication/evidence/reviewer/maturity eligibility; actual Logistic Regression and LightGBM; separate Fraud/Mule/AML Platt calibration and held-out metrics|Invented eligible labels train all3 tasks; unknown/unreviewed/future/unverified labels cannot become negatives; no eligible cohort returns unavailable|
|45.1|Actual MLflow registry versions; pinned SHA/package/feature signature, safe model loading, warmup, readiness, bounded authenticated FastAPI shadow, signed results, generation-CAS activation/rollback|Actual version1→2→1, independent old process remains pinned; forged/tampered artifacts, cutoff/currency, auth and timeout checks|
|46.1|Explicit task-specific model confirmation of matching rule Alert candidates; append-only receipts, scoped typed API and existing Case/Outcome/Audit|Actual FastAPI TCP→Node→PostgreSQL→Alert→Case→unknown outcome→close; rollback, retries, permissions, corruption and backup/restore checks|

## Reproduce the invented CPU demonstration

Use the repository's pinned Node/Python/uv/pnpm toolchain. Initial dependencies require network and an approved TLS chain. Runtime dependencies are pinned in `uv.lock`. `mlflow-skinny` uses the explicitly local SQLite tracking/registry through pinned SQLAlchemy/Alembic. No external tracking server or vendor credentials are required.

```sh
cd /Users/macbookpro/Documents/LMPS_Risk/financial-crime-platform
uv sync --locked --all-packages --group security --system-certs
mkdir -m 700 .local/ml-demo
uv run --locked --directory services/ml-inference python -m lmps_ml.demo \
  --root /Users/macbookpro/Documents/LMPS_Risk/financial-crime-platform/.local/ml-demo
```

The demo stores480 invented rows,192 training/132 calibration/132 test decisions and24 embargo rows; actual3 learners; MLflow runs;2 registered supervised versions; an explicit rollback to version1 at deployment generation3; and private authentication/signing files. Metrics use invented fixture truths and must not be presented as LMPS performance. Repeating an unchanged completed demo validates immutable evidence; changed input/code requires a new directory/version. No global `libomp` installation is needed: this reference build disables LightGBM OpenMP. This bounds the local CPU example, not production throughput. A clean Mac source build may require the SDK's C++ headers:

```sh
CXXFLAGS='-isystem /Library/Developer/CommandLineTools/SDKs/MacOSX.sdk/usr/include/c++/v1' \
  uv sync --locked --all-packages --group security --system-certs
```

Run the pinned shadow service in a terminal:

```sh
LMPS_ML_ROOT="$PWD/.local/ml-demo" \
LMPS_ML_TOKEN_FILE="$PWD/.local/ml-demo/auth.token" \
LMPS_ML_SIGNING_KEY_FILE="$PWD/.local/ml-demo/signing.key" \
  uv run --locked --directory services/ml-inference python -m lmps_ml
```

The entrypoint binds only127.0.0.1:18502; use `LMPS_ML_PORT` to change it. Stop with Ctrl+C. Bearer authentication is required for `POST /v1/shadow/score`. Configured readiness is200 only after a verified pinned artifact loads and warms up. A missing/invalid model or unavailable feature/currency/cutoff returns signed unavailable evidence with an empty probability map. Timeouts and admission overload return fixed503 errors. The inference pool has1 worker and2 admitted calls; a timeout does not release capacity until work actually finishes. It does not kill native model work. Do not expose this local service publicly.

Without model configuration, the original health-only bootstrap still returns503 `model_not_loaded`. Interactive documentation and request access logs remain disabled. No model inference endpoint is enabled in that mode.

## Dataset and experiment contract

`lmps_ml.pipeline --help` exposes `dataset`, `from-bulk`, `train`, `register`, `deploy` and `init-shadow`. All paths must be absolute private owned files/directories:0700 directories,0600 single-link regular files, no file symlinks. CLI errors withhold input/credentials; outputs contain counts/status/references. Dataset/model publication refuses changed or partial existing evidence. Keep `.local/` outside Git and exported public artifacts.

```sh
pnpm ml:pipeline dataset --input /absolute/private/input.json --output /absolute/private/dataset
pnpm ml:pipeline train --dataset /absolute/private/dataset \
  --output /absolute/private/model --tracking /absolute/private/tracking --algorithm logistic
```

`DatasetInput` in `services/ml-inference/lmps_ml/dataset.py` is the strict input definition. The runnable demo generates a complete example. The CLI rebuilds `dataset.json` from `input.json` before fitting, rather than trusting a caller's replacement feature hash. Model bundles bind dataset/code/feature/package versions and file hashes. The CPU reference intentionally caps a dataset at2000 rows/8MiB input and uses a bounded reference feature calculation; it is not a million-row feature engine.

All6 features require synthetic declared semantics/identity, complete one-hour history and known target availability: net-amount log transform, UTC hour sine/cosine, earlier outgoing count, earlier same-currency outgoing amount log transform, and receiver-unseen-in-one-hour indicator. Earlier means `[as_of-1h,as_of)` after availability filtering and latest-known revision selection; the current payment is excluded. A correction replaces one contribution. Signed feature wires use9-decimal strings with exact separate net cents, not floating-point monetary totals. Model transforms are approximate; no FX or balance inference is performed. A model accepts one currency only.

Training ends at `train_end`; calibration/validation begins after an explicit embargo of at least1h, ends at `calibration_end`; test starts after another embargo and ends at `test_end`. Rows outside the range and repeated business-payment decisions (including repetitions within one partition) cannot enter fitting or held-out evaluation. Input and label timestamps are explicit UTC. Label information is excluded from feature hashes. Imputation, scalers and estimators are not fitted on test rows. Platt calibration uses only the calibration partition and the fixed threshold0.5 is not tuned on test outcomes. A serving request earlier than the calibration cutoff is unavailable. This remains a retrospective experiment: it does not prove the model was deployed at the historical transaction time.

Each task needs at least20 eligible rows and5 examples of each class in **every** train/calibration/test partition. Eligibility requires known0/1 outcome, adjudicated review, synthetic declared provenance, reviewer/evidence hash, coherent review/availability/maturity timestamps and maturity before that partition's cutoff. Unknown is never negative. Reports separate Fraud/Mule/AML confusion counts, precision/recall and Wilson intervals, ROC/AP, Brier, alert rate and reference-rule results on exactly the same labeled cohort. Reviewed-only selection does not support population claims. If any task lacks a cohort, its report is unavailable and the incomplete model bundle cannot serve.

`from-bulk` verifies the existing private bulk plan and samples at most2000 rows. It retains opaque source-plan lineage and exact amount but does not infer UTC decisions, accounts, business-payment identities, execution semantics or labels from raw LMPS fields. Consequently the current271-row real pilot produces0 available feature rows and all learners return unavailable. The adapter is a provenance/readiness bridge, not an identity bypass. The physical2GB data is not needed to reproduce the synthetic acceptance path.

## Registry, activation and rollback

```sh
pnpm ml:pipeline register --root /absolute/private/ml-root \
  --model /absolute/private/ml-root/logistic --name synthetic_risk_model
pnpm ml:pipeline deploy --root /absolute/private/ml-root \
  --name synthetic_risk_model --version 1 --sha256 HASH_FROM_REGISTER --expected-generation 0
```

Deploy verifies the actual registry record, local file URI, expected artifact SHA, feature signature, exact runtime versions, safe serialization, model dimensions and warmup. It writes immutable generation history and an atomic pinned pointer under an OS lock; exact retries recover the committed pointer/alias. Rollback selects an old explicit version/hash using the current generation. Restart the shadow process after activation/rollback: a running process deliberately keeps its loaded pin. The mutable MLflow `shadow` alias is descriptive; serving never follows it. Only safe built-in skops types and native LightGBM text are loaded; no pickle loading or network artifact fetch occurs. Scores carry an Ed25519 signature verified against a separately configured public key, never a key supplied in the inference response.

## Rule/model policy and Portal handoff

`ModelGateRequest`/`ModelGatePolicy`/`ModelReceiptView` are exported from `@lmps/contracts/model-signal`; Pydantic generates both shadow wire schemas and TypeScript DTOs. `pnpm generate:contracts` updates them; drift/parity checks fail on changes. A gate policy declares exactly one task, canonical9-decimal probability threshold, pinned model name/version/artifact SHA, matching-dimension Alert rule policy and `missing_model: skip|rules_only`.

The Node worker rebuilds the feature snapshot from validated frozen rule evidence, verifies the signed model reply and binds payment/revision/as-of/currency/features. It never accepts an unrelated caller vector. A rule candidate **and** sufficient calibrated model probability are needed for `MODEL_CONFIRMED`. Missing probability defaults to `MODEL_UNAVAILABLE`/skip; only an explicit versioned `rules_only` policy allows `EXPLICIT_RULES_FALLBACK`. Isolation Forest novelty stays observational and cannot masquerade as a calibrated probability. Rule risk indices are not averaged with probabilities. This gate controls its own Alert-generation path; it does not retract Alerts created through other explicit rule-only paths.

```sh
LMPS_LOCAL_STATE_DIR=/absolute/private/disposable-pg \
LMPS_ML_TOKEN_FILE=/absolute/private/ml-root/auth.token \
LMPS_ML_PUBLIC_KEY_FILE=/absolute/private/ml-root/public.json \
LMPS_MODEL_ENDPOINT=http://127.0.0.1:18502/v1/shadow/score \
  pnpm model:review /absolute/private/model-gate-request.json
```

The selected owned local PostgreSQL instance must already have migration0015. This command does not migrate it. Use an isolated initialized instance for experiments. A request UUID freezes one outcome: exact retry reads its saved receipt before another HTTP call, even after a model deployment changes. A new assessment or policy version requires a new request UUID. The receipt and any generated Alert commit atomically; failures roll back their new evidence. Independent requests can refer to the same existing Alert; stored review/case state is not rewritten.

`GET /v1/local/model-receipts/:request_id` requires both `risk:read` and `alerts:read`, verified workspace scope, app-role database and `LMPS_ML_PUBLIC_KEY_FILE`. The typed uncached response includes receipt hash, model/dataset/artifact identity, task probabilities, policy, gate reason, Alert reference and recorded actor/time; it excludes raw vectors/signing secrets. Unknown/foreign IDs return `receipt:null`; missing trust or invalid stored evidence returns503. Nest OpenAPI documents the route. Existing independently scoped Alert and Case routes provide investigation, assignment, notes, separate outcomes and audit history. An outcome remains a reviewer opinion with `training_eligible:false` until the separate evidence/maturity gate is met; there is no automatic feedback promotion.

Migration0015 adds `platform.local_model_gate_policies` and `platform.local_model_receipts`, making30 total tables including the migration ledger on a fully upgraded fixture. Intake receives column-limited inserts; app receives reads; ordinary roles cannot update/delete/truncate the ledgers or spoof recording metadata. Backup/restore supports both this inventory and the older28-table/15-migration inventory. As with existing local ledgers, a migration owner/superuser can alter evidence; production immutable retention/key governance remain outstanding. The original persistent28-table PostgreSQL runtime was not migrated for this batch.

## Verification and remaining target gates

```sh
pnpm --filter @lmps/risk-workers build
pnpm exec node --test apps/risk-workers/test/model-shadow-native.test.mjs
uv run --locked --directory services/ml-inference python -m pytest -W error
pnpm verify:fresh
```

The native test trains actual estimators, starts actual FastAPI TCP, migrates a disposable PostgreSQL cluster, records signed model/rule evidence, completes a Case with unknown outcomes, injects failures/tampering and restores a backup. The confirmation threshold0 in that invented acceptance fixture is a plumbing demonstration, not a recommended risk policy. All temporary test listeners/clusters are stopped. The regular full suite also tests missing signal, suppression, opt-in fallback, scoped API, independent privilege boundaries, old-backup compatibility and deterministic feature contracts. No Playwright/browser work is required.

Private actual evidence for the current run lives under `.local/no42-46/`: `acceptance.json`, `final-ml/` invented MLflow/models/demo, `final-real/`271-row unavailable experiments and original-runtime fingerprint acceptance. Final counts are recorded in [implementation status](../implementation-status/current.md). No source MariaDB connection or write, original PostgreSQL migration, payment action, deployment or real-data detection-quality claim is made. Remaining gates are verified semantics/availability/identity/history, adjudicated mature real labels, representative longer evaluation, measured scale/latency, actual operations/key governance and production approvals. Deep learning/GNN is not part of these five baseline phases.

References: [MLflow local SQLite tracking](https://mlflow.org/docs/latest/ml/tracking/tutorials/local-database), [registry backend requirements](https://mlflow.org/docs/latest/self-hosting/architecture/backend-store/), [LightGBM installation](https://lightgbm.readthedocs.io/en/stable/Installation-Guide.html), [uv configuration](https://docs.astral.sh/uv/reference/settings/).

Final2026-10-25 verification: fresh-source offline948 tests (Node665/Python283),387 scanned source files, SBOM235 components/0 UNKNOWN; separate online Python audit67 packages/0 vulnerabilities. Node audit reports2 high/0 critical in pre-existing Portal Vite8.0.5 development tooling ([Windows alternate-path issue](https://github.com/advisories/GHSA-fx2h-pf6j-xcff), [Windows launch-editor issue](https://github.com/advisories/GHSA-587h-7wmj-h5pm)); no Portal dependency was changed by these backend phases. This is recorded as an existing unresolved advisory finding, not an all-clear repository audit.
