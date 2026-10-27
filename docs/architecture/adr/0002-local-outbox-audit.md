# Local outbox service audit — item17

Status: implemented local/test slice, 2026-10-19. No production acceptance or real employee identity is implied.

## Decision

Add reviewed migration `0004_local_audit` after the existing four migrations. `platform.audit_events` records committed intent creation/state changes and attempt start/completion through PostgreSQL AFTER ROW triggers. The existing owner `lmps_migrator` owns a fixed SECURITY DEFINER trigger function with `search_path=pg_catalog` and fully qualified insert targets. PUBLIC/app/intake/outbox have no EXECUTE privilege on that function; app has SELECT on the table and workers have no direct audit write privilege. No new login/password, library, service or paid component is introduced.

Use triggers because both the existing caller-owned enqueue transaction and the claim SQL CTE must commit or roll back their audit with their state. Auditing only a repository callback would miss direct worker SQL and could leave gaps when callers forget to invoke it. A trigger failure aborts the write; it must never be swallowed to commit an unaudited transition. Existing transaction rollback/error handling remains in use.

## Evidence contract

| Field | Meaning |
| --- | --- |
| audit_id | Internal bigint identity returned as text; allocation order, not commit order |
| event_ref/schema_version | Generated UUID and version1 |
| workspace_key/execution_mode | Synthetic workspace and fixed test mode |
| actor_role/actor_type | PostgreSQL session_user, not SECURITY DEFINER current_user or caller-supplied context; lmps_outbox is service, migrator/bootstrap is database_operator |
| action | outbox.intent_created, outbox.intent_updated, outbox.attempt_started, outbox.attempt_finished |
| target_ref/correlation_id | Intent UUID; stable correlation of one intent across attempts, not an HTTP request or distributed trace ID |
| previous_state/state/attempt_number/outcome | Approved queue-state evidence only; attempt outcomes distinguish retry/permanent/unknown/fake acceptance |
| occurred_at | Database wall-clock time, exposed with UTC microseconds; not external event time or a total ordering guarantee |

No arbitrary JSON payload, account, notification reference, semantic key, device token, lease token, JWT, DSN or employee claim is copied. Intent audit covers changes to the worker-writable state/attempt/scheduling/lease columns; attempt audit covers creation and outcome/finished_at changes. No-op updates, exact duplicate enqueue, conflicting enqueue, stale finish, empty claim and rolled-back writes do not fabricate successful activity. This table does not log rejected HTTP requests/auth failures, every SELECT, source ingestion, admin DDL, deletes or privileged tampering.

The migration does not backfill old intents. An old accepted intent can have no audit events; do not infer complete historical coverage. No business alert/case/account/risk model exists yet. A future business audit contract needs its own reviewed version/migration and authenticated actor rules.

## Read and operations

With the existing private local JWT fixture enabled, `GET /v1/local/audit/events?after=0&limit=25&intent_ref=<optional UUID4>` requires independent `audit:read`. The workspace comes exclusively from the verified token. Unknown/duplicate/invalid query fields fail400, missing/invalid credentials401, missing scope403, unavailable audit storage503. No write route is exposed. Replies carry generated X-Request-ID and no-store headers; that per-request ID is separate from intent correlation.

Two indexes serve workspace+audit_id pages and workspace+target_ref+audit_id reviews. Limit is100 with one lookahead row; bigint cursors never pass through JavaScript Number. Response explicitly declares `pagination=live_committed_view`. Each page sees a new committed snapshot; concurrent lower-ID transactions can commit after a cursor advances. This is a local browsing API, **not a complete incremental audit feed or stable export**. For a settled bounded review, restart at0 after writers stop; use the consistent private database backup for frozen local evidence. A production export/stream needs an explicit completeness protocol.

`pnpm db:migrate` applies the additive migration without rotating existing credentials. `pnpm api:audit-smoke` creates one invented intent/attempt and five correlated audit events in a unique synthetic workspace per run. It checks dedup plus HTTP401/403/200, then closes the fake worker/API and removes ephemeral public-key configuration. It leaves those invented database rows for pgAdmin review; it never contacts a push provider.

Backup now fingerprints the audit table under the same exported snapshot as the other tables. Restore verifies frozen row fingerprints and app SELECT/DELETE denial for audit. The exact pre-audit inventory is also accepted for older backups; restore retains that original schema/ledger prefix without inventing events or silently applying newer migrations. Other inventories are still rejected, and existing row/file/time bounds remain unchanged.

## Limits and verification

The migration owner/superuser can edit/drop this evidence or its triggers. Writer separation here is a restricted trigger path owned by the migration role, not an independently administered audit service, WORM storage, cryptographic attestation or production database row security. App DB credentials can read all synthetic workspaces; HTTP scope enforcement is an application boundary. Production needs institution authorization, real service/user identities, admin auditing, approved retention/export/immutable archive and restore rules.

An accepted fake job produces five rows across intent/attempt activity. Audit storage/write amplification depends on alert rate, retries and retention; no five-million-payment capacity or production latency claim follows from this local implementation. Benchmark with approved workloads before choosing partitioning/retention automation.

Native tests cover additive upgrade/no backfill, protected privileges/function search path, service identity spoofing, full flow, duplicate/conflict/stale behavior, rollback, retry/expiry, audit outage atomicity, current and legacy backup restore. Real HTTP tests cover independent scopes/workspaces, bigint cursors/filtering, query rejection/redaction, storage outage, OpenAPI and unchanged readiness503. Consolidated results are recorded in [implementation status](../../implementation-status/current.md).
