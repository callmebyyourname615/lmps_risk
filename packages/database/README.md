# Database connections and reviewed migrations — items 8/10

## Current addition — No.35.3 verified offline replay reads

`createOfflineDatasets().readComplete(workspace, batch, datasetHash)` uses a REPEATABLE READ, READ ONLY transaction to recheck frozen manifest/file bindings, complete/matched checkpoint, every typed row/key/hash, exact count and rowset digest before returning bounded evidence. It never changes staging or reuses synthetic Risk provenance. Existing intake SELECT grants suffice; app/API/reviewer/outbox raw staging denial remains. No migration/role/backup inventory change is needed. [Replay contract](../../docs/data-dictionary/offline-risk-replay.md).

## No.35.2 offline staging

Additive0012 adds offline_dataset_batches/offline_dataset_rows:13 migrations/19 platform tables total. `createOfflineDatasets` registers immutable file manifests, resolves UUID aliases, commits500-row chunks/checkpoints and reconciles exact raw evidence under one snapshot. Raw staging is restricted to trusted intake/owner roles; app/API, reviewer and outbox have no read/write access. Source semantics stay unverified; synthetic intake/revision/risk contracts are unchanged. Current backup v2/local_workspace includes staging and preserves exact v1 prefixes4–12. Actual100,000-row import/reconcile/restore and process-kill recovery passed in final fresh-source752 tests. No project migration, source connection, seed or actual LMPS file was used. [Contract, permissions, CLI and limits](../../docs/data-dictionary/offline-dataset-import.md).

Private `@lmps/database` package: `pg` **8.23.1**, `drizzle-orm` **0.45.4**, development `@types/pg` **8.23.1**. Exact requirements and transitive artifacts are in the Node lockfile. pg/types report MIT; Drizzle reports Apache-2.0. SQL migration scripts use Drizzle's node-postgres adapter/migrator at runtime; no domain ORM/schema generation or Drizzle TypeScript domain model is implemented.

Use [local setup/commands](../../infrastructure/postgres/README.md) for database creation, roles, credentials and migration operations. All new runtime paths are local/test only. The package exports `localPoolConfig`, `createDatabase`, `Database`, `DatabaseRole` and `PostgresStatus`; the API consumes the app-role connection. These are not remote/production connection adapters.

`createDatabase` returns a bounded lazy `pool`, `health()` and `close()`. Explicit config fixes host/database/user/TLS behavior and avoids implicit PGHOST/PGDATABASE credential targeting. `health` returns only availability status; pool errors do not echo SQL/parameters or credentials. Always release a checked-out client and close the pool on shutdown. Transactions must use the same client for BEGIN/work/COMMIT or ROLLBACK, not unrelated `pool.query` calls. [node-postgres transactions](https://node-postgres.com/features/transactions)

Default pg NUMERIC/BIGINT results remain strings; real database tests round-trip a large exact `NUMERIC(24,2)`, an integer above JavaScript safe precision and leading-zero text. No global parser converts financial numbers to JavaScript Number. Timestamp/calendar/source semantics, domain constraints and full ORM type mappings remain unverified. [Pool lifecycle](https://node-postgres.com/apis/pool) and [Drizzle PostgreSQL adapter](https://orm.drizzle.team/docs/get-started-postgresql) document the supported paths used here.

Run `pnpm test:database` from root for real isolated-cluster tests, or the unified verification commands for API/Python/contracts/security checks as well. Pool/statement/lock failures, role denial, auth, retry/concurrent migration, applied-SQL drift, pending-SQL rollback, shutdown/restart and logging canaries are exercised. Native integration tests use real disposable databases and no production data; item30 additionally has isolated driver stubs, explicitly separate from native evidence.

## Source intake — item 10

Exports now also include `LocalSourceEvent`, `validateSourceEvent`, `IntakeError` and `createSourceIntake`. Role `intake` is an explicit local connection profile for lmps_intake, pool max2/statement1s/lock500ms. Existing app/migration profiles remain separate. No dependency was added.

The source factory validates/copied local_synthetic/test input before acquiring a client and commits source record registration + immutable event in one transaction. Same scoped identity/content returns duplicate, contradictory content returns EVENT_CONFLICT and rolls back; storage errors are fixed/redacted. The checked-in fixture excludes accounts. See the [complete local contract, schema, commands and limitations](../../docs/data-dictionary/local-source-intake.md).

Migrations 0001 and 0002 add two synthetic intake tables and column-level writer grants; they do not change applied 0000 or create canonical payment/risk/account tables. `db:prepare-intake` prepares the owned local role, `db:migrate` applies reviewed SQL, and `db:intake-demo` writes/replays one invented event. App SELECT works in pgAdmin, with no write privilege. Native tests exercise real concurrent duplicate/conflict writes, rollback, isolation, grants and restart/replay.

Item14 adds migration0003 and a distinct local fake-outbox role/repository. See [worker operations and transaction/lease limits](../../apps/risk-workers/README.md). Source migrations0000–0002 are unchanged. Existing clusters prepare the role before migration; fresh bootstrap does so automatically. The app remains read-only; fake outbox state/outcome updates are internal worker permissions only.


## Local audit — item17

Migration0004 adds `platform.audit_events` and protected owner-executed triggers for outbox intent/attempt changes. Worker roles cannot directly insert/rewrite/delete audit; app can SELECT. Audit and queue changes share the same transaction and rollback together when either fails. Database session role is the actor; no real employee identity or old-event backfill is asserted. The existing migration owner remains a privileged trust boundary.

See [audit decision, schema, read contract and limitations](../../docs/architecture/adr/0002-local-outbox-audit.md). Existing credentials/pool limits/dependencies are unchanged. Backup/restore now includes audit and continues to accept the exact older pre-audit backup inventory.


## Snapshot job persistence — item18

Migration0005 adds local_sync_jobs/local_sync_attempts with frozen identity, scoped uniqueness, bounded attempts/counters and protected lifecycle audit version2. Existing intake credentials now have column-limited job writes; app remains SELECT-only, outbox has no job grants. No role/password/library is added. createSyncJobs owns its transactions and fences every event/progress update with the job lease; appendSourceEvent shares the existing source SQL within that same client transaction. Existing createSourceIntake behavior remains covered by its original tests.

Backup/restore now includes jobs/attempts and accepts the exact two older schema inventories. [Full job schema/transaction/permissions contract](../../docs/architecture/adr/0003-local-sync-jobs.md). This is a trusted internal local writer boundary, not protection against a privileged administrator or real-source capture approval.

## Transaction storage experiment — item26

`pnpm --silent db:transaction-design` compares a10,000-row current-table candidate with a three-month partitioned body plus global registry. It creates/stops/removes a new native scratch cluster, accepts no arguments/DSN, and leaves the project cluster and all six reviewed migrations unchanged. JSON stdout includes environment, count/fingerprint parity, warm sequential p50/p95/p99, EXPLAIN ANALYZE/BUFFERS plans, bulk load WAL and table/index bytes. The existing test glob includes native key/money/concurrency/rollback/paging/cleanup checks.

See [ADR-0005: actual local observations and limits](../../docs/architecture/adr/0005-transaction-storage-experiment.md). Keys/workspaces/currency/time are invented; this is a P02 design spike, not a production schema decision, account mapping, business writer or capacity pass. No dependency is added.


## Synthetic transaction observation revisions — item27

Migration0006 adds local_transaction_revisions with contiguous self-FK ordinals and unique scoped revision handles. createTransactionRevisions / validateTransactionRevision reuse the existing draft Transaction validator via the declared @lmps/contracts workspace dependency. Exact money/opaque IDs stay in JSONB evidence; identical retry returns duplicate, changed/missing-predecessor input returns REVISION_CONFLICT. Intake has input-column INSERT only, app SELECT only, outbox no access. Recorded actor/time are DB-generated. No external dependency/version changes.

The original No.27 profile accepts test/unknown status with unverified mapping/time and unresolved/unknown accounts. No.28 adds known synthetic states only with recomputed publication proof; production DDL remains pending. [ADR-0006: input/retry/API/backup and owner limits](../../docs/architecture/adr/0006-local-transaction-revisions.md). Eight reviewed migrations are tested in disposable clusters; the project cluster stays at its previous six migrations until prepared with db:migrate.


## Synthetic normalization evidence — item28

Migration0007 adds nullable publication JSONB and an evidence-gated known-status profile. Existing unknown rows survive with null evidence. `validateTransactionRevision` and append recompute the shared synthetic classifier and require the exact derived payload; direct SQL guards supplement the full validator. Normalized cross-row/capture replay compares explicit revision semantics, retains the first payload/proof and rejects conflicting content/generation/units or reused handles. No mutable head, new role or table is introduced. See [ADR-0007](../../docs/architecture/adr/0007-local-normalization-publication.md) for first-lineage-only behavior, complete-envelope reversal semantics and per-revision retries.

Backup tests now restore actual4/5/6/7-migration snapshots plus the current eight-migration schema with known-state evidence. Persistent project PG is not migrated by tests.

## Rule versions and assessment runs — item30 MVP

Migration0008 adds two append-only synthetic-local tables. `createRuleAssessments(intakeDsn).evaluate(manifest)` commits rule registration and assessment evidence atomically, preserving immutable version conflicts and same-run frozen replay. `validateRuleVersion`, `validateAssessmentReport` and the shared evaluator support worker/API validation. Existing readonly worker backtests keep their interface through a re-export. No dependency or old migration changed.

App/intake cannot mutate historical rows or spoof recording metadata. Complete details and known limits are in [ADR-0009](../../docs/architecture/adr/0009-local-rule-assessments.md). Native concurrency/ACL/rollback and backup/restore acceptance passed in the2026-10-22 backend-first follow-up; earlier environment-blocked runs remain historical. Driver stubs alone do not establish SQL correctness. Current/legacy backup inventories include9 and4/5/6/7/8-migration prefixes. The project database remains unmodified.

## Transaction risk storage — item31

Reviewed0009 adds `local_risk_policies` and `local_transaction_risks`, independent of the No.30 immutable backtest report. `createTransactionRisks` validates requests, proof-derived source observations and frozen results, then registers/checks the policy and stores its per-target snapshot in one transaction. The policy FK also binds its result fingerprint. App is readonly; intake has column-limited append privileges. Duplicate replay reads frozen evidence before consulting source; changed run/policy content conflicts. A missing source target remains a storable unavailable result.

Current backups include both new tables and permission checks, preserving old4/5/6/7/8/9-migration inventories. Native concurrency/FK/ACL/rollback/restore acceptance passed in the2026-10-22 backend-first follow-up. Existing applied migrations and the persistent project database are untouched. See [ADR-0010](../../docs/architecture/adr/0010-bilingual-transaction-risk.md).

## No.32 — Alert Inbox and review ledger

Reviewed0010 adds immutable alert policies/projections and a protected append-only review ledger. App reads remain SELECT-only; intake inserts grouped alerts; the separate unprivileged reviewer role can execute the fixed transition function. Fresh test bootstrap prepares that role; an existing owned project cluster requires separately approved `db:prepare-reviewer` before migration0010. No project preparation/migration/seed was performed by this implementation. Backup inventories retain original4–10 prefixes and include current three-table alert evidence. [Contract, audit limits and runtime preparation](../../docs/architecture/adr/0011-local-alert-review.md). Native acceptance passed in the2026-10-22 backend-first follow-up:50 focused tests and fresh-source offline670 tests. See current implementation status for exact evidence and remaining gates.


## No.34 — Revision/risk/Alert jobs

Additive0011 creates local_risk_jobs/local_risk_job_attempts (12 migrations/17 platform tables). `createRiskJobs` freezes explicit revision observations/context/policies and provides enqueue/claim/advance/fail; semantic input dedup excludes only UUID aliases. Shared assessment/Alert functions run within the job transaction so evidence and fenced checkpoint commit or roll back together. Public read helpers use bounded allowlisted projections. Intake can update operational state but cannot rewrite frozen input or delete attempts; app is read-only and reviewer/outbox roles have no job access.

Current backups preserve pending and Alert-stage retry jobs/attempts; original4–11 migration-prefix backups restore unchanged. No restore starts a worker. Focused64 and fresh-source offline695 checks passed. Existing project state is not migrated/prepared/seeded automatically. [Contract and limits](../../docs/architecture/adr/0012-synthetic-risk-job-flow.md).

## No.36.1 — Policy governance storage

Reviewed additive0013 stores immutable policy versions, active bindings, transactional action events and approved-job selection receipts. Separate `lmps_policy` can execute the lifecycle function but cannot directly mutate tables. Tests initialize this role only in disposable clusters. Existing owned clusters need separately authorized `db:prepare-policy` plus migration; no automatic project upgrade occurs. Current and original4–13 migration-prefix backups remain supported. [ADR-0013](../../docs/architecture/adr/0013-local-risk-policy-lifecycle.md).

## No.37.1 — Local Cases

Reviewed additive0014 adds case projections, unique Alert links, append-only events/notes and versioned outcomes. Isolated `lmps_case` executes only the mutation function; app is read-only and other service writers cannot modify cases. New disposable clusters prepare the role; an existing owned cluster needs separately authorized `db:prepare-case` and migration. Current and original4–14 migration-prefix backups remain supported. [Workflow/permissions/limits](../../docs/architecture/adr/0014-local-cases.md).
