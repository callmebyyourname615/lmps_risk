# ADR-0011 — Synthetic Alert Inbox and protected review ledger

Status: implemented local/test MVP; native acceptance passed in the2026-10-22 backend-first follow-up. Production activation is not approved.

## Decision and boundaries

Reuse `@lmps/contracts`, `@lmps/risk`, the existing worker and NestJS API. Add no service, workspace or external dependency. The draft generated cross-runtime `Alert` schema is unchanged; the strict `@lmps/contracts/local-alert` profile is a separate synthetic contract. All15 No.31 detector codes can participate. No real-source/account identity, trained model, notification or payment action is introduced. Review outcomes do not change frozen scores or grant payment authority.

An alert is one immutable grouped projection of one stored assessment and one explicit versioned alert policy. Detail reads revalidate/recompute the No.31 frozen assessment and alert projection, then localize the original findings, metrics, thresholds, evidence references, coverage and response code. Raw request/context/source rows are not returned. Inbox summaries retain null scores and partial/unavailable indicators.

## Creation policy and replay

The private worker command is `pnpm alerts:generate <assessment_run_id>`. Its manifest is `.local/alert-inputs/v1/<assessment_run_id>/input.json`, with private owned directories and a regular, single-link,0600 file, at most16KiB. These are the existing private-file boundaries; symlinks/FIFOs/unsafe files reject before storage. Example only; substitute an assessment UUID that already exists in the separately prepared synthetic database:

```json
{
  "format": 1,
  "provenance": "local_synthetic",
  "execution_mode": "test",
  "workspace_key": "synthetic_local",
  "assessment_run_id": "11111111-1111-4111-8111-111111111111",
  "policy": {
    "policy_id": "synthetic_alerts",
    "version": "synthetic_v1",
    "minimum_severity": "high",
    "include_partial": true,
    "included_codes": ["FRAUD_HIGH_AMOUNT", "FRAUD_COUNT_VELOCITY", "FRAUD_AMOUNT_VELOCITY", "FRAUD_NEW_COUNTERPARTY", "FRAUD_AMOUNT_DEVIATION", "FRAUD_FREQUENCY_DEVIATION", "MULE_FAN_IN", "MULE_FAN_OUT", "MULE_RAPID_PASS_THROUGH", "MULE_NETWORK_CYCLE", "MULE_FLAGGED_NEIGHBOR", "AML_STRUCTURING_PATTERN", "AML_REPEATED_HIGH_VALUE", "AML_MULTI_HOP_FLOW", "AML_NETWORK_DEVIATION"]
  }
}
```

Every policy field is required. There is no default production threshold or policy. Code order is canonicalized; unknown/duplicate codes, coercions and extra fields reject. Selection requires a triggered finding whose original configured severity meets `low < medium < high < critical` and whose code is included. Alert severity is the maximum selected finding severity, separate from dimension index severity. Grouping keeps one alert for all selected findings of that assessment/policy.

Only complete assessments, or partial assessments explicitly allowed by `include_partial`, can match. Missing signals never become negative signals, unavailable dimension scores remain null, and no-match is not a safety guarantee. Worker output is status/reason/reference only:

| Reason code | Meaning |
| --- | --- |
| `ALERT_CREATED` | At least one configured triggered finding qualifies; inserted or duplicate alert reference returned |
| `ALERT_NO_MATCH` | No triggered finding meets this policy |
| `ALERT_PARTIAL_EXCLUDED` | Policy explicitly excludes partial assessments |
| `ALERT_ASSESSMENT_INELIGIBLE` | Assessment is unavailable, not evaluated or not applicable |

Policy registration and matching alert insertion commit/roll back together. The registration persists even for a skipped match, so reusing an ID/version with changed content conflicts consistently. A scoped advisory lock plus unique `(workspace, assessment_run_id, policy_id, policy_version)` prevents retry duplication. An immutable policy fingerprint FK and assessment FK retain lineage. Duplicate reads validate existing evidence, not current source data. Different assessment UUIDs or policy versions may deliberately create separate alerts; cross-run/business-transaction suppression is not implemented. The worker does not continuously scan or automatically run after ingestion/scoring.

## Read and review API

Routes require configured local JWT auth. Workspace and actor come from the verified token; neither is accepted in body/query overrides. Reads require `alerts:read`. Mutation requires **both** `alerts:read alerts:review`. Existing risk/source/audit scopes do not implicitly grant these permissions.

| Method/path | Behavior |
| --- | --- |
| GET `/v1/local/alerts/catalog` | Localized statuses, severities, outcomes, codes and review semantics |
| GET `/v1/local/alerts` | Bounded inbox, default5/max10; optional `after`, `state`, `severity`, `risk_code` |
| GET `/v1/local/alerts/:alert_id` | Frozen risk evidence and complete bounded review history; unknown/foreign IDs return `alert:null` |
| POST `/v1/local/alerts/:alert_id/reviews` | Acknowledge or record review, using the isolated review credential |

Inbox pages use UUID order and a live committed view, not chronological order or a stable snapshot. Concurrent new rows below a cursor or state/filter changes can be missed during traversal; reload for the current inbox. Lists omit notes/history and raw assessment contexts; details include reviewer notes as entered, not machine-translated. Localization is presentation-only: default `lo`, `la` alias, negotiated English and unsupported-language fallback follow No.31. Responses use no-store, Content-Language and Vary. `assessment_sha256` and `alert_snapshot_sha256` are immutable; detail `core_sha256` additionally covers review history and changes when review advances.

First acknowledge, using the displayed version0:

```json
{"request_id":"22222222-2222-4222-8222-222222222222","expected_version":0,"action":"acknowledge","outcome":null,"note":null}
```

Then review version1 with an explicit outcome and nonblank note, at most1000 Unicode characters:

```json
{"request_id":"33333333-3333-4333-8333-333333333333","expected_version":1,"action":"review","outcome":"unknown","note":"Synthetic evidence is insufficient."}
```

The terminal version2 state is `reviewed`. Outcomes are `suspicious`, `legitimate`, `unknown`: recorded reviewer opinions, not verified crime labels, model-training ground truth or payment decisions. Unknown is never a negative label; no training-label export is implemented. No assignment/case/reopen workflow is added.

Retries must reuse the exact request ID, actor and content; they return `duplicate` with the current alert/history, even if an earlier acknowledgement is retried after review. A new request with a stale version or reuse with changed content returns409 `ALERT_REVIEW_CONFLICT`. Concurrent actions serialize on the scoped alert lock. Unknown/foreign mutations return404 `ALERT_NOT_FOUND`; reads treat both alike. Invalid requests return400 `INVALID_ALERT_INPUT`; missing JWT/scope401/403; unavailable/corrupt evidence503 `ALERT_STORAGE_UNAVAILABLE`; missing review configuration503 `ALERT_REVIEW_NOT_CONFIGURED`. Parser failures are redacted/localized before route handling. Review/generation never changes risk evidence or sends a notification.

## Storage, isolation and audit

Reviewed additive migration0010 creates `local_alert_policies`, `local_alerts`, `local_alert_reviews` and the fixed `review_local_alert` function. App remains SELECT-only; intake has column-limited INSERT/SELECT for policies/alerts and cannot spoof generated recording metadata. The new `lmps_reviewer` role can read required frozen evidence and EXECUTE only the review function; it cannot INSERT directly into the ledger, update/delete/truncate state, write assessments/source rows or call arbitrary privileged SQL.

Review state is the protected append-only two-event ledger itself, so a state transition cannot commit without its audit entry. It records request ID, version, action/outcome/note, JWT subject, database `session_user` and database time. The SECURITY DEFINER function fixes search_path, validates transitions, serializes concurrent commands and checks exact retries. Reviewer subject is asserted by the trusted authenticated API; the database login does not independently verify end-user JWTs. Migration owner/superuser tampering is outside this local audit boundary; production needs approved immutable retention/identity governance.

Fresh disposable test bootstrap prepares the unprivileged reviewer role and a narrow SCRAM loopback HBA rule. Existing owned clusters need a **separately approved** `pnpm db:prepare-reviewer` before migration0010. This implementation does not run that command or migrate/seed the project cluster. Private credentials are written only to ignored `.local/postgres/reviewer.env` as `LMPS_LOCAL_REVIEW_DSN`. API configuration accepts only the reviewer role, requires local auth/app reads and enforces the same database instance as the app DSN. Missing review DSN keeps read APIs usable and review disabled.

After approved runtime preparation, load the existing private auth configuration and the two private DSN files; for example, with `LMPS_LOCAL_AUTH_CONFIG` already exported:

```sh
pnpm --filter @lmps/risk-api exec node --env-file=../../.local/postgres/app.env --env-file=../../.local/postgres/reviewer.env dist/main.js
```

Backups include all three new tables and preserve original migration-prefix4–10 inventories without upgrading restored history. Current restores verify row fingerprints, ledger contents, read privileges and app mutation/function denial. Existing1000-row/table and32MiB dump limits remain. No background worker is started during restore.

## Validation and remaining acceptance

Pure/driver/injection suites exercise all15 grouped signals, policy severity equality/no-match/partial handling, strict input/local-mode boundaries, frozen hash validation, rollback paths, scope/actor checks, UUID/filter bounds, bilingual parity and malformed JSON. Native suites cover actual PostgreSQL uniqueness/locks/ACLs/rollback/recovery, private risk-worker→assessment→alert-worker→HTTP→review and current/legacy backup restoration. Driver mocks are not SQL/concurrency evidence.

Native/full-frozen acceptance subsequently passed:50 combined native tests and fresh-source offline670 tests. Exact results and remaining limitations are recorded in [current status](../../implementation-status/current.md). No dependency version/lockfile change, production policy, project migration/seed, live source, Portal/Mobile, notification, payment action, deployment, commit or push is part of this batch. Fluent Lao review, project runtime preparation, production roles/policies and actual source/identity remain pending.
