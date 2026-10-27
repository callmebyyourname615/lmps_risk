# ADR-0010 — Bilingual synthetic per-transaction risk scoring

Status: IMPLEMENTED within approved synthetic MVP scope; native database/restore acceptance PASSED in the backend-first follow-up. Date: 2026-10-22. Owner: TBD.

## Decision

The user approved No.31 after reviewing the ordered catalog/features/scoring/response/localization/storage/API/test scope. Add a shared `@lmps/risk` workspace rather than another service. It depends only on the existing contracts package; database and API consume it. The Node lock changes only workspace importers; no external artifact/version is added. The [module contract](../../../packages/risk/README.md) defines all15 executable detector metrics, score semantics, temporal/currency/identity boundaries and Lao/English behavior.

This is a bounded reference monitor on explicit synthetic context. It does not claim that P01/P03/P04/P05 production gates passed. No verified account entity/graph is created from unknown source account fields. No stream processor/cache/model/IdP/backbone/provider is adopted. FastAPI remains a diagnostics service with model readiness503.

## Immutable storage

Reviewed additive `0009_local_transaction_risks` creates:

- `platform.local_risk_policies`: immutable synthetic policy ID/version/content/hash; changed content requires a new version.
- `platform.local_transaction_risks`: one frozen per-target result per workspace/run, request/observation/result snapshot, SHA-256, source target columns and recording metadata. The policy FK includes the generated result-policy fingerprint.

Existing source/transaction/rule/backtest tables and applied migrations are unchanged. No transaction FK is imposed on a missing explicit target: unavailable evidence must also be stored. App is readonly; intake has SELECT and column-limited INSERT without update/delete/truncate or recording-metadata privileges. The privileged owner remains outside this local immutability boundary. Intake credentials belong to trusted worker code; this is not externally tamper-proof audit storage.

`createTransactionRisks(intakeDsn).evaluate(request)` validates local/test request shape and bounded synthetic semantics before connecting. A transaction locks workspace/run, validates any existing snapshot and returns its frozen result for an identical normalized request. Changed request under the same run ID conflicts. New runs read only the explicit source revision, recompute its No.28 proof, calculate the observation/context-bound result, register/check the policy and insert the snapshot atomically. Conflicts/storage failures roll back new policy and result together. Same-run retries do not query current source or change unavailable results after data arrives. New input/context/policy evaluation requires a new UUID.

Corrupt/missing/non-normalized source becomes an explicit unavailable observation with no raw corrupt payload retained. Available observations retain only the validated amount, cumulative reversal, currency, status, observed time and source-revision hash. Original source evidence remains in its existing revision store. Stored-result reads check snapshot shape/hash and recompute the result from its frozen normalized request/observation; current database history is never consulted during replay validation. Engine/catalog semantics must retain a versioned reader before a future incompatible upgrade.

## Private worker

After a separately approved owned-runtime preparation through0009:

```sh
pnpm risk:assess <run_id>
```

Input is `.local/transaction-risk-inputs/v1/<run_id>/input.json`, read through the existing owned/private/bounded/no-link JSON reader. Use the exact fixture shape linked from the module README; real credentials/data do not belong in manifests. The worker loads the existing intake DSN privately. Stdout is limited to provenance/mode, run ID, inserted/duplicate status, assessment/business response code and triggered-type count. Exit0=complete/not-applicable;2=partial/unavailable/not-evaluated;1=input/storage failure. Full scores/reasons are read with the scoped API. No private file/DB dual write, scheduling, source connection, push or payment effect is introduced.

## Scoped read APIs

All three routes require verified local JWT scope `risk:read` and the verified workspace. Older rules/assessments/source scopes do not grant risk access.

| Route | Result |
| --- | --- |
| `GET /v1/local/risk/catalog` | Localized definitions for15 risk types, dimensions/units/statuses, score semantics and business/reason/error codes |
| `GET /v1/local/risk-assessments/:run_id` | Frozen localized assessment plus language-independent `core_sha256`; foreign/unknown run gives null |
| `GET /v1/local/transactions/:namespace/:transaction_id/revisions/:revision_number/risk-assessments` | History for one pinned revision; default5/max10, exclusive `after=<UUID>`, ascending UUID order, `next_cursor`, live committed view |

No caller-supplied workspace or extra/duplicate query parameter is accepted. Every response is no-store and declares `Content-Language` plus `Vary: Accept-Language`. Lao is `lo`, English `en`; `la` is a compatibility alias. Absent language defaults to Lao and unsupported preferences fall back to English. Guard/query/storage errors have stable codes and localized fixed messages, without raw values. The default Swagger definitions describe these reads. Global liveness/readiness behavior is unchanged; readiness remains503.

Presentation adds text without changing core codes, scores, evidence or fingerprints. No locale is part of a stored assessment identity. Existing No.29 readonly backtests, No.30 rule/assessment APIs and draft cross-runtime contracts retain their interfaces.

## Backup and verification

Current backups include both new tables and their app permission checks. Exact old4/5/6/7/8/9-migration inventories remain accepted and are never upgraded during a restore drill. Existing local backup limits (1000 rows/table,32-MiB dump) remain; this is not production DR capacity evidence.

Tests include golden metrics/threshold boundaries for every detector; weighted scores and null coverage; duplicate/correction/reversal/out-of-order/availability/currency windows; bounded temporal paths; binding/mode/schema rejection; complete Lao/English coverage and language-invariant results; driver rollback/replay/conflicts; real JWT/HTTP-injection routes with independent scope/redaction; native worker→PG→HTTP, concurrency/ACL/FK/rollback and actual backup/restore cases.

The initial native runs failed before their assertions because that sandbox forbade loopback listeners. The package cache was recovered from existing locked artifacts into writable temporary storage with file digests checked, without disabling supply-chain policies. Build/tests can run with pinned Node24.22.0; the initial frozen install could not complete online policy verification in that restricted network. The subsequent backend-first follow-up passed50 combined native tests and fresh-source offline670 tests, including actual frozen supply-chain policy verification, without changing security policy. No shared cache, package version, TLS setting, audit exemption or production runtime config was changed. Exact successful checks and pending gates belong in [current status](../../implementation-status/current.md).

The persistent project database is not migrated or seeded by this implementation. No real-source identity/semantics, model calibration, production thresholds, translation review, hosted/Linux/capacity approval, deployment, commit or push is claimed. Production activation and Portal/Mobile screens require separate approved work.
