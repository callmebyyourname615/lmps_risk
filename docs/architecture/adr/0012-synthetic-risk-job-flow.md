# ADR-0012 — Synthetic revision → risk → alert jobs

Status: implemented and accepted within local/synthetic scope, 2026-10-22. Owner: TBD.

The user approved No.34 to join existing revision/risk/alert services with persisted jobs, retries, concurrency control and read APIs. Backend services are the priority. The user's application direction is a Web App with Add to Home Screen, built separately; this batch adds no native app, PWA manifest, service worker, notification provider or new Portal feature.

## Input and identity

`RiskJobInput` is defined in `packages/contracts/src/risk-job.ts`. The strict outer object contains exactly:

| Field | Meaning |
| --- | --- |
| format/provenance/execution_mode/workspace_key | 1 / local_synthetic / test / synthetic_local |
| job_ref | Explicit v4 UUID for the submission |
| risk_request | Existing strict TransactionRiskRequest: run_id must equal job_ref; explicit namespace/transaction_id/revision_number, versioned policy or null, bounded frozen context or null |
| alert_policy | Existing strict versioned AlertPolicy with included codes, minimum severity and partial-result policy |

Maximum serialized input is512KiB; the nested risk request retains its384KiB/200-event limit. Live/production, extra properties, invalid policies and mismatched revision/context bindings reject. Account identity, time/history and flagged neighbors are only synthetic declarations, never inferred from real masked account values.

Registration freezes the validated observation derived from the explicit stored revision, including its revision fingerprint. A missing/invalid/not-normalized revision is frozen as unavailable; a revision appearing later cannot silently change this job's input. Available observations preserve exact money/currency/lifecycle evidence. The job stores no mutable `latest` selector. Context and both policies are also immutable.

Canonical semantic input hashing excludes only job_ref/risk_request.run_id. Same normalized revision/context/policies with another UUID returns the first canonical job_ref, observation and assessment identity. Same job_ref with changed semantic input conflicts. New semantic input gets a new job; policy definitions still cannot change under existing immutable versions. Semantic dedup survives completion/failure and cannot bypass the retry cap by changing only the UUID.

## Execution and failure semantics

Additive0011 creates `local_risk_jobs` and `local_risk_job_attempts`, with status/lease constraints, scoped unique identity/input keys, immutable input columns and references to stored assessments/alerts. Existing schemas/migrations are unchanged. The existing intake credential registers/executes jobs; app is read-only. Reviewer/outbox roles receive no job access. The trusted intake role can update operational state, but cannot rewrite stored input/observation columns or delete attempts. These operational rows are not an externally immutable audit store; migration owner/superuser limitations remain.

Jobs move through pending → running → completed, with assessment → alert → done checkpoints. Operational failures may enter retry_wait; permanent policy/run conflicts enter failed. A completed job can create one grouped Alert or deliberately skip it with ALERT_NO_MATCH, ALERT_PARTIAL_EXCLUDED or ALERT_ASSESSMENT_INELIGIBLE. Completion does not imply a safe transaction. Missing inputs retain null scores and existing coverage/reason codes.

Workers claim due pending/retry_wait jobs or expired leases using row locks and SKIP LOCKED. Only one current attempt owns a10-second lease. Each stage holds the job row lock and rechecks token/attempt/DB-time validity after its evidence write. The existing shared assessment/alert implementations execute inside that same transaction with their checkpoint; lease expiry/checkpoint failure rolls back both. No nested independent evidence commit is used. Stage success renews the lease. A stale worker cannot save a result, mark completion or record failure after replacement.

Assessment commit can survive a process kill before Alert generation. Recovery marks the old attempt interrupted and resumes at Alert, preserving original risk scores/evidence. A crash or lost reply after completion is recovered by reading job status; repeated run is idle and cannot generate another Alert. Existing repository version/replay checks remain active for standalone commands too.

At most8 attempts are allowed. Storage errors schedule DB-time exponential backoff of1,2,4,8,16,32,60 seconds; the eighth failure is terminal. An eighth lease expiry is finalized as failed without spawning a ninth attempt. Policy/run conflicts are terminal immediately. If the database is unavailable when recording failure, the running lease remains recoverable after expiry. Only fixed operational codes are persisted; raw database diagnostics, input and credentials are not returned/logged. The worker does not claim exactly-once execution: retries are at least once with transactionally fenced/idempotent persisted effects.

## CLI

The existing project database is not prepared, migrated or seeded by implementation/tests. Run these commands only against a separately authorized/prepared local database through0011. No source connection is required.

Write the private manifest at `.local/risk-job-inputs/v1/<job_ref>/input.json` (owned0700 directories, owned0600 regular single-link file; existing private JSON boundary checks apply), then:

```sh
pnpm risk:jobs enqueue <job_ref>
pnpm risk:jobs run <canonical_job_ref>
pnpm risk:jobs retry <canonical_job_ref>
pnpm risk:jobs work 20
```

`run` makes one attempt and normally processes both stages; a recovered Alert-stage attempt only generates/reads the Alert. `retry` is the same bounded due/lease-aware operation, not a force/reset command. `work N` processes at most1–20 claimed jobs per invocation and stops when idle. A scheduler/operator invokes it again when retries are due. No daemon, cron deployment, busy-wait, new broker or automatic source-publisher hook is installed. Enqueue requires an explicit policy/context decision; it does not score every newly published revision automatically.

Output is bounded status/job/attempt/result references and fixed codes only. Exit0 means enqueue accepted/duplicate or work completed/idle;2 means a returned retry_wait/failed/stale/unavailable outcome;1 means invalid configuration/input or an operation failed without a recorded outcome. Idle may mean unknown, locked, not due, completed or terminal; inspect the read API to distinguish them. Keep the returned canonical job_ref when enqueue deduplicates a UUID alias.

## API for the separate Web App

With the existing private synthetic JWT profile and app database configuration:

| GET route | Output |
| --- | --- |
| /v1/local/risk-jobs | UUID live page; after=<v4 UUID>, limit default5/max10 |
| /v1/local/risk-jobs/:job_ref | Job metadata or job:null for unknown/foreign IDs; no query parameters |
| /v1/local/risk-jobs/:job_ref/attempts | Attempt history; after integer0–8, limit default5/max10 |

All three require independent **risk-jobs:read** and verified workspace. Existing risk/sync/alert scopes alone do not authorize them. Query workspace overrides, unknown/duplicate/malformed parameters and HTTP mutations are rejected. Lists are live committed UUID views, not stable exports or incremental feeds. Attempts are ordered by attempt number.

Responses include the explicit revision coordinates, status/effective_status/stage, attempt count, next retry time, assessment/Alert references, fixed result/error codes and times. Running expired leases are effectively interrupted without rewriting history on a GET. Manifests, observations, source/context payloads, fingerprints, lease tokens and credentials are excluded using explicit projection allowlists. Referenced assessments/alerts retain their own independent risk:read/alerts:read permissions.

Accept-Language uses the existing lo default, en and la alias; unsupported locales fall back to English. Status/stage/result/error messages localize while IDs, references, codes and numeric values remain unchanged. Content-Language, Vary, no-store, server request IDs and redacted401/403/400/503 behavior apply. Storage outage/corruption never becomes an empty-success page. Human Lao review remains pending.

## Backup and verification

Current backups include both new tables and their frozen evidence/attempt history. Original migration-prefix4–11 backups still restore their original schema without auto-upgrade. App mutation denial and fingerprints are checked after restore; no worker is started. A current backup fixture includes a pending job plus an Alert-stage retry with its saved assessment and attempt.

Focused64 tests passed, including actual child SIGKILL after Assessment commit, concurrent UUID-alias enqueue/claim, stage expiry/rollback, retry limits/backoff/permanent conflicts, frozen missing inputs, role/input immutability, private CLI boundary, worker→real PG→HTTP bilingual metadata/risk/Alert reads, scoped query denial/outages,12 current/legacy backup cases and existing repository regressions. Final fresh-source offline verification passed695 tests with frozen installs, strict builds/typechecks, generated/lock drift, SBOM199/0 UNKNOWN and publication checks. See [exact status](../../implementation-status/current.md) and [104-item progress assessment](../../implementation-status/plan-progress-2026-10-22.md).

No real source/verified account graph, production scoring policy, notification/payment action, model calibration, deployed scheduler, hosted/Linux/capacity evidence, commit/push or deployment is delivered. Local API/ML readiness remains intentionally unready. P03/P04/P05 are not closed by this bounded asynchronous synthetic path.
