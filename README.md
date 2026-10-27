# LMPS Financial Crime Platform

**No.47.1–51.1** extend the ML foundation with DDL/evidence-bound observations, checkpointed temporal replay, independent append-only label adjudication, same-cohort rule/model evaluation and an owned persistent shadow runtime with metrics and PG/ML recovery. [Commands, acceptance evidence and real-data gates](docs/operations/real-shadow-foundation.md). Actual100k invented SIGKILL/resume and31-table isolated restore passed; original28-table project database is preserved. Real271-row features/evaluation remain unavailable. Portal Vite is8.1.6; separate Node audit has0 high/0 critical,5 low/4 moderate. Final fresh-source verification is recorded in [current status](docs/implementation-status/current.md).

New TypeScript/Python workspace. **Items1–22 delivered within local scope:** toolchain/diagnostics/contracts/verification, draft source/PG designs, isolated PostgreSQL/MariaDB, bounded synthetic snapshot intake/reconciliation, optional JWT/workspace source and operations APIs, fake transactional outbox, protected service audit, tracked snapshot import jobs, private offline snapshot profiles, backup/isolated restore, a proposed event-backbone ADR, a local compatibility matrix and a lock-bound local SBOM/license inventory. Real source/continuous CDC/canonical business mapping/production models/mobile/hosted CI/production remain pending. Local CPU ML and shadow inference are delivered in No.42.1–46.1 below. See [actual status](docs/implementation-status/current.md).

**No.34** connects explicit synthetic transaction revisions to frozen Risk Assessments and Alerts using persisted jobs, fenced leases, semantic dedup, bounded due retries and scoped Lao/English job/attempt reads. Focused64 and fresh-source offline695 tests passed; see [job contract](docs/architecture/adr/0012-synthetic-risk-job-flow.md) and [current status](docs/implementation-status/current.md). The updated assessment after No.38.1 estimates27.2% against all104 MUST items, using the [disclosed scoring ledger](docs/implementation-status/plan-progress-2026-10-23.md); this is not production readiness. Backend is the priority; the user will build a Web App with Add to Home Screen. Actual source/identity/production gates remain pending.

**No.35.1** adds a separate bounded, owner-private CSV export profiler: `pnpm --silent dataset:profile --table transfer --input /absolute/private/transfer.csv --output-dir /absolute/private/new-bundle`. It reports schema/value/key quality without raw values and creates an unapproved mapping template. Focused30 and fresh-source offline725 tests passed. [Exact export format, limits and exit codes](docs/data-dictionary/offline-dataset-profile.md). It does not import or run Risk.

**No.35.2** adds `dataset:import`, `dataset:status` and `dataset:reconcile`: verified private CSV → restricted offline staging with500-row atomic checkpoints, UUID-alias dedup, exact target reconciliation and interrupted-run recovery. Final fresh-source offline752 tests passed, including100,000-row import/reconciliation/restore. [Manifest/CLI/permissions/backup contract](docs/data-dictionary/offline-dataset-import.md). No real file/source or persistent project database is touched by development; acceptance is recorded in current status.

**No.35.3** adds `dataset:replay`: verified complete staging → explicit simulation amount thresholds by literal source currency → private deterministic JSON/CSV with row references, reasons and unavailable outcomes. [Policy, CLI, privacy and limits](docs/data-dictionary/offline-risk-replay.md). It does not create operational Alerts or claim Fraud/Mule/AML scores.

**No.36.1** adds local Risk Policy lifecycle (draft/submission/independent approval), explicit namespace/currency activation/rollback, read-only comparison on frozen synthetic assessment inputs, isolated scoped policy APIs and opt-in `risk:jobs enqueue-approved`. Jobs pin the selected approved version/hash and keep it across retries and later activation changes. [Contract, API, permissions and limits](docs/architecture/adr/0013-local-risk-policy-lifecycle.md). Acceptance is tracked in current status; production governance/source/identity remain pending.

**No.37.1** adds a local Case backend: unique Alert linking, open/in-review/closed/reopen workflow, assignment/notes, versioned Fraud/Mule/AML analyst opinions, frozen evidence references and scoped audit. Outcomes remain unverified and never training-eligible. No UI or project DB migration is performed. [API, workflow, permissions and limits](docs/architecture/adr/0014-local-cases.md); acceptance is recorded in current status.

**No.38.1** adds `core:demo` and `start:api:core` for the separately approved local runtime upgrade and approved Policy→Risk job→Alert→Case flow with exact retries and normal short-lived scoped JWTs. [Commands, roles, token files and limits](docs/operations/local-core.md). Actual project migration/backup/demo results are in current status; real-source access, UI and production readiness remain outside this batch.

**No.39.1** adds the real pilot import/reconcile/offline simulation pipeline; [commands and evidence](docs/operations/real-pilot.md). **No.40.1** adds file-only `dataset:semantics` for versioned source-owner declarations, exact sample coverage and15-pattern readiness. [Contract, private artifacts and review workflow](docs/operations/source-semantics.md). All source/account/business gates remain explicit; declarations do not enable real risk assessment.

**No.42.1–46.1** add actual CPU ML datasets/training/calibration, MLflow tracking/registry, pinned signed FastAPI shadow serving and explicit rules/model→Alert→Case/Outcome evidence with typed reads. [Runbook and acceptance boundaries](docs/operations/ml-shadow.md). This is a local/synthetic experimental foundation; the existing271-row LMPS file produces unavailable features/models while source/identity/labels remain unverified. No payment action is enabled.

**No.41.1** adds `dataset:bulk` for verified multi-gzip preparation, disk-backed source-key dedup, resumable existing staging checkpoints and isolated PostgreSQL trials with backup/restore gates. [Commands, scale evidence and limits](docs/operations/bulk-import.md). The1m scale evidence uses invented data; the actual2GB flash-drive trial is deferred by the user.

## Bootstrap

Install pnpm **11.20.0**, uv **0.12.5**, and a Node.js 24 bootstrap runtime satisfying `package.json`. Then run from this directory:

```sh
pnpm install --frozen-lockfile
uv sync --all-packages --locked --group security
```

pnpm provisions Node.js **24.22.0** for project scripts through `devEngines.runtime`; `.node-version` also records it for compatible runtime managers. Check the project runtime with `pnpm exec node --version`, rather than assuming the shell's global `node` changed. uv uses Python **3.13.15** from `.python-version` and creates an isolated `.venv`. Initial downloads require network access. For an approved corporate certificate chain, uv supports `--system-certs`; keep TLS verification enabled.

## Run and verify the API

```sh
pnpm build
pnpm start:api
```

Swagger UI: `http://127.0.0.1:18501/docs`; OpenAPI: `/openapi.json`. Liveness `/health/live` returns 200; readiness `/health/ready` intentionally returns **503** because the real source sync/online risk workflow is not implemented; PostgreSQL diagnostics are optional. See [API usage](apps/risk-api/README.md). Stop with Ctrl+C; the bootstrap is limited to local/test mode and binds to loopback.

```sh
pnpm typecheck
pnpm test
pnpm audit --audit-level high
pnpm sbom:check
```

The API uses Node's built-in test runner; GitHub CI is prepared, with hosted execution still pending. No source/model integration, latency SLA or 5-million-payments/day capacity is claimed.

## Run and verify the ML service

```sh
uv run --locked --directory services/ml-inference python -m lmps_ml
```

Without model configuration, the ML bootstrap listens on `http://127.0.0.1:18502`, exposes health endpoints and returns **503 `model_not_loaded`** readiness. The configured pinned shadow mode adds authenticated inference and warm readiness; see [ML workflow](docs/operations/ml-shadow.md). Stop with Ctrl+C. See [ML service usage](services/ml-inference/README.md) for environment settings and scope.

```sh
uv run --locked --directory services/ml-inference python -m pytest
uv audit --locked --directory services/ml-inference
```

## Generate and verify draft contracts

```sh
pnpm generate:contracts
pnpm test:contracts
```

Pydantic models generate the shared JSON Schemas and TypeScript types for Transaction, Risk Assessment and Alert. Both runtimes validate the same synthetic corpus. See [contract rules, source uncertainties and versioning](packages/contracts/README.md). These are local draft contracts; neither service exposes business endpoints or performs scoring/enforcement/delivery.

## Analyze local source DDL

```sh
pnpm schema:metadata --input ../../../lmps_schema.sql --output-dir ../../docs/data-dictionary/lmps-schema
pnpm test:schema
```

The command runs from `tools/schema-metadata`, so those paths are relative to that directory. Generated reports already exist; add `--overwrite` to refresh them. Current LMPS coverage is intentionally **partial (exit 2)**: core table/column/key counts are reconciled, while omitted constructs are explicitly reported. See [source observations](docs/data-dictionary/README.md) and [tool limits/exit codes](tools/schema-metadata/README.md). No SQL is executed and no database is contacted.

## Verify the toolchain

```sh
pnpm exec node --version
pnpm exec tsc --version
uv run --locked python --version
uv lock --check
pnpm audit --audit-level high
```

These commands check toolchain/install consistency; the API checks above verify its current behavior separately.

## Workspace layout

- `pnpm-workspace.yaml`: root Node tooling, `apps/risk-api`, `apps/risk-workers`, `packages/contracts`, `packages/database` and `packages/source-preflight`; other members are added when their item is approved.
- `pyproject.toml`: virtual Python workspace with `services/ml-inference` and `tools/schema-metadata`. The service pins FastAPI/Pydantic/Uvicorn, with pytest/HTTPX2 in its dev group; the tool pins SQLGlot and uses standard-library tests. Pinned CPU ML dependencies now support the local/synthetic dataset/training/shadow workflow; see the ML runbook.
- `tsconfig.base.json`: strict TypeScript baseline for future packages; it is not a standalone application build.
- `docs/implementation-status/current.md`: actual progress and deferred work.
- `docs/architecture/toolchain.md`: pins, dependency scope and remaining compatibility checks.
- `docs/architecture/engineering-foundation-gates.md`: named-owner `TBD` register, capacity/SLO inputs and adoption-spike acceptance records.

Read [working rules](AGENTS.md) before implementation. The existing Portal remains separate. The project architecture plan is maintained in the sibling `../plan/` directory; no legacy runtime or database is imported here.

Never put credentials or real transaction/account datasets in Git. `.env.example` has local/test/port settings and an optional local PostgreSQL DSN plus a reserved MariaDB DSN; no service connects to payment systems. Local credentials stay in ignored `.local/postgres/app.env` plus `.local/postgres/intake.env` and `.local/mariadb/` files.

## Unified verification and handoff

Run `pnpm verify` for the full local suite plus online advisories, `pnpm verify:offline` without advisories, or `pnpm verify:fresh` for a cached temporary-source run. `pnpm sbom:write` refreshes the tracked local inventory and `pnpm sbom:check` detects dependency/license-metadata drift. See [checks, security scope and CI](ci/README.md), [local supply-chain inventory](docs/supply-chain/README.md), [actual status](docs/implementation-status/current.md) and [DB/Sync prerequisites](docs/implementation-status/db-sync-readiness.md). Local PostgreSQL and synthetic MariaDB snapshot intake exist; no real-source connection has been created.

## Source and PostgreSQL design drafts

Item 7 supplies [field mapping and identity gates](docs/data-dictionary/source-mapping.md), a [machine-readable review artifact](docs/data-dictionary/source-mapping.json) and [PostgreSQL logical model/query proposals](docs/architecture/postgresql-logical-model.md). They are drafts pending owner evidence/sign-off. Existing Node/Python runners include the new synthetic design checks; there is no canonical source normalizer, business database schema or real-source connection.

## Local PostgreSQL foundation

The project database has been initialized at `127.0.0.1:18503/lmps_risk_local` and is running for pgAdmin after item10. It now contains `platform.source_records` and `platform.source_events` for synthetic intake, plus fake outbox intents/attempts, audit_events and the migration ledger; canonical payment/account tables do not exist. Native PostgreSQL 18 and MariaDB 11.8 binaries are required for the complete test suite. See [setup, roles, commands and patch boundary](infrastructure/postgres/README.md).

```sh
pnpm db:start
pnpm db:migration-status
pnpm build
pnpm start:api:db
```

Stop the API with Ctrl+C and run `pnpm db:stop` when finished. For a fresh workspace use `pnpm db:init`, then start and `pnpm db:migrate`. Database integration tests create their own disposable clusters and never require the persistent project database to run. Do not print/copy ignored credential files into source or chat.

## Local MariaDB metadata preflight

Item 9 creates an isolated **synthetic** MariaDB at loopback port 18504 and a bounded TLS/read-only metadata inspector. Initialization creates four empty tables with 65 selected mapping columns and primary/unique keys; item11 can seed seven synthetic rows. It is not the real LMPS replica or a full dump import. The inspector never reads transaction rows or writes to PostgreSQL.

```sh
pnpm source:prepare
pnpm source:init
pnpm source:start
pnpm source:preflight
pnpm source:stop
```

See [native preparation, report semantics and operations](infrastructure/mariadb/README.md) and [package](packages/source-preflight/README.md). Preparation isolates the checksum-verified macOS arm64 Homebrew bottle without changing the existing MySQL installation; other systems supply `LMPS_MARIADB_BASE`. Successful local reports keep CDC and account identity unverified. `pnpm test:preflight` uses a disposable separate fixture. Item9 left both persistent databases stopped. The subsequent pgAdmin request started PostgreSQL; item10 preserves that running state. MariaDB remains stopped.

## Local source intake — item 10

The strict local-only event contract and `createSourceIntake` repository write source records/events atomically with scoped deduplication and conflict checks. lmps_intake can append approved input columns; lmps_app can read the two synthetic tables in pgAdmin. A repeated demo adds no duplicate row. This item10 JSON demo has no source reader; item11 adds the separate local snapshot importer below. No canonical payment mapping or real data is included.

```sh
pnpm db:start
pnpm db:prepare-intake
pnpm db:migrate
pnpm db:intake-demo
```

Fresh `db:init` prepares the writer role automatically; existing owned clusters use `db:prepare-intake` before the new migrations. See [contract, tables, permissions and failure semantics](docs/data-dictionary/local-source-intake.md). The project PG cluster remains running for pgAdmin; use `pnpm db:stop` when finished.

## Local MariaDB → PostgreSQL snapshot — item 11

See [importer operations and replay limits](apps/risk-workers/README.md). Start the owned local MariaDB, run `pnpm source:seed`, then `pnpm source:snapshot`; import the printed UUID with `pnpm source:import <capture_id>`. Rerun that same UUID for idempotent replay. Source capture reads only bounded selected columns; a complete private spool is published before any PG write. New capture UUIDs create new observations, rather than resume an old snapshot. No real replica/CDC/account mapping or production capacity is implied. The importer is automatically included in `pnpm test`/verification.

## Local continuation — items12–16

- `pnpm source:reconcile <capture_id>` compares frozen snapshot evidence to PG with count-only PASS/FAIL/UNAVAILABLE results.
- `pnpm api:source-smoke <capture_id>` checks JWT-scoped HTTP reads and operations diagnostics using an ephemeral fixture; no token/private key is printed or retained.
- `pnpm db:prepare-outbox`, `pnpm db:migrate`, `pnpm outbox:demo` exercise fake-only intent/lease/attempt processing. No actual push is sent.
- `pnpm db:backup`, then `pnpm db:restore-drill <backup_id>` checks a private small local backup by restoring into a separate disposable cluster. The project DB is never overwritten.

See [worker operations](apps/risk-workers/README.md), [API/auth](apps/risk-api/README.md) and [backup runbook](infrastructure/postgres/README.md). Local tables/roles/fixtures are not production account/notification/DR guarantees.


## Local outbox audit

Item17 adds database-triggered service evidence with restricted write permissions and independent audit:read API scope. After `pnpm db:migrate`, `pnpm api:audit-smoke` checks a fake flow and scoped reads using temporary credentials/listeners; each run leaves one invented intent/attempt and five correlated audit rows for pgAdmin review. It sends no mobile push. See [audit schema, actor/correlation meanings and limits](docs/architecture/adr/0002-local-outbox-audit.md). This is local browsing/rollback evidence, not production immutable storage or a complete incremental audit feed.


## Tracked snapshot imports

Item18 makes source:import <capture_id> persist leased jobs/attempts, commit source evidence and progress together, then reconcile before success. Retry reuses the frozen private spool with no MariaDB query. Scoped sync:read endpoints expose job status/history; api:sync-smoke <capture_id> verifies an already reconciled capture using temporary HTTP fixtures. See [job lifecycle and limitations](docs/architecture/adr/0003-local-sync-jobs.md). These are bounded local snapshot jobs, not production continuous CDC.


## Offline snapshot data quality

Item19 adds `pnpm source:profile <capture_id>` for private bounded snapshot observations: field completeness/raw code frequencies, exact amounts by table/raw currency and naive date ranges. It makes no DB connection and does not infer risk, whole-source quality or account identity. Full results remain in private `.local/profiles/v1/`; only status/counts are printed. See [profile contract and limits](docs/data-dictionary/snapshot-profile.md).

## Transaction storage design spike

`pnpm --silent db:transaction-design` runs a synthetic current-table vs partitioned-body/global-registry experiment in a new disposable native PostgreSQL cluster. It prints measurement/plan/storage JSON after cleanup and never uses the project DB. See [ADR-0005](docs/architecture/adr/0005-transaction-storage-experiment.md) for the actual local measurements, key/concurrency tests and pending production schema gates.


## Synthetic transaction revisions

Item27 adds an append-only local draft-transaction observation repository and scoped history/latest read APIs with transactions:read. Native tests cover revision races/replay/precision/permissions and backup compatibility; HTTP tests verify scoping/paging/errors. See [ADR-0006](docs/architecture/adr/0006-local-transaction-revisions.md). Status/account/time/source mapping remain unknown or unresolved; No.28 adds evidence-bound local normalizer publication; production schema remains pending. The project DB is not migrated automatically.


## Evidence-bound synthetic publication — item28

`pnpm source:publish <capture_id>` connects a frozen synthetic snapshot plus semantic evidence and an explicit private publication binding to append-only transaction revisions. Known payment states require recomputed proof; unknown/invalid/lookup/unbound rows are withheld. Scoped history/latest responses now include additive first-publication evidence. Replay compares declared revision semantics and keeps the first lineage; it does not create an account entity or accumulate financial effects. See [binding format, retry/CLI/restore limits](docs/architecture/adr/0007-local-normalization-publication.md).

The current runtime needs additive migration0007. Tests use disposable clusters and do not migrate/seed the project database. No real-source connection, risk engine, production deployment or external dependency version is added. Actual verification is in [current status](docs/implementation-status/current.md).


## Offline synthetic rule baseline — item29

`pnpm rules:backtest <run_id>` reads an explicit bounded revision set with the app DSN, validates No.28 normalization proof and evaluates typed amount/currency/lifecycle rules using exact cents. It writes an immutable private report with versioned reasons and rule/input fingerprints. Missing/unknown/corrupt inputs are unavailable, not negative risk signals; currency/lifecycle mismatches are not_applicable. [Manifest, outcomes, replay and limitations](docs/architecture/adr/0008-offline-synthetic-rule-baseline.md).

This is a local offline P05 prototype, with no online engine, alert/assessment DB writes, account features, production policy or accuracy claim. The runtime is not migrated/seeded by tests; API/ML readiness stays503.

## Stored synthetic assessments — item30

After separately approved local preparation through migration0008, `pnpm rules:assess <run_id>` consumes the existing private backtest manifest and atomically stores immutable rule versions and a frozen assessment. Same-run retries return stored evidence; a new evaluation needs a new UUID. Read through `rules:read` and `assessments:read` routes documented in [ADR-0009](docs/architecture/adr/0009-local-rule-assessments.md). The existing `rules:backtest` stays readonly. No production rule approval/activation, online scheduling or alert/payment effect is added. The implementation does not migrate/seed the project database.

## Per-transaction risk and Lao/English — item31

After separately approved runtime preparation through0009, `pnpm risk:assess <run_id>` uses a private synthetic manifest bound to one explicit transaction revision. Read full results with `risk:read` at `/v1/local/risk-assessments/:run_id`, history under the pinned transaction revision and definitions at `/v1/local/risk/catalog`. `Accept-Language: lo` selects Lao, `en` English; `la` is a compatibility alias. Stable codes, score values and core hashes do not change with language.

The module implements all15 catalog detectors on declared synthetic context, with unavailable/not-evaluated results when inputs are missing. Scores are policy-weighted indices, not probabilities or permission to act on a payment. No.29/30 interfaces remain unchanged. The legacy Portal, real source/account identity, online features, model calibration and production activation are outside this batch. See [the complete contract](packages/risk/README.md).

No.32 adds the synthetic Alert Inbox backend: explicit versioned creation policy, one grouped alert per assessment/policy, immutable evidence, scoped reads and protected acknowledgement/review audit in Lao/English. Use `alerts:generate <assessment_run_id>` with a private manifest; review writes require an isolated optional credential. [API/manifest/state/permission contract](docs/architecture/adr/0011-local-alert-review.md). Local native/full-frozen acceptance now passes; project runtime preparation and real-source/production gates remain pending. Existing No.33 Portal code is preserved with further UI work deferred; no notification or payment action is added.
