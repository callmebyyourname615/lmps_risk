# Local synthetic source intake — item 10

Implemented local-only contract, two PostgreSQL intake tables, scoped deduplication and an atomic append repository. This is a test fixture protocol, not an approved LMPS CDC envelope or canonical Transaction. All 13 source/access/semantic gates from [source mapping](source-mapping.md) remain UNVERIFIED. No live source connection, collector/worker, account identity, normalized payment, risk score or notification is introduced.

## Contract

[LocalSourceEvent and validator](../../packages/database/src/source-intake.ts) are the TypeScript authoring/runtime boundary; [source-event.json](../../packages/database/fixtures/source-event.json) is an invented fixture. Existing Pydantic-authored shared Transaction/RiskAssessment/Alert schemas remain unchanged. No new framework/dependency was added.

| Field | Local rule |
| --- | --- |
| schema_version / provenance / execution_mode | Exactly 1 / local_synthetic / test |
| workspace_key / source_namespace | `synthetic_` plus 1–40 lowercase ASCII letters/digits/underscores |
| source_generation / capture_epoch / event_key | 1–80 bounded ASCII token characters, persisted consistently across retries |
| source_table | transfer, transfer_hist, transfer_old or member |
| source_key | Complete typed-as-text fixture key: id+requesttime for transfer/hist, id for old, code for member; extra/missing components rejected |
| operation | snapshot, insert, update or delete, describing an input observation only |
| observed_at | First fixture-capture instant, canonical UTC with milliseconds; immutable on redelivery |
| fields | Required allowlisted object for non-delete; SQL NULL for delete |

The whole envelope is capped at 4096 UTF-8 bytes. Unknown envelope/key/field properties, nested values, controls, invalid Unicode surrogates, noncanonical numeric ID text, invalid calendars and unsupported shapes are rejected before acquiring a connection. Validation returns a detached snapshot so caller mutation during an awaited write cannot change the validated input.

For the transfer-family fixture, fields are exactly amount, ccy, result and txtime. Amount remains a decimal **string**, at most 22 integral digits and exactly two fractional digits, signed values allowed; excess scale/range and Number input are rejected without rounding. This preserves representation and does not assert amount units, financial direction, currency mapping or successful movement of funds. ccy/result remain unverified raw code strings; no LAK/success defaults are assigned. result and txtime may be null. Source DATETIME strings remain naive text; UTC is used internally solely to check calendar validity, never to assign a source timezone. The fixture key's int range comes from the declared signed INT, not account semantics; member code retains leading zeros and case. Source zero/incomplete dates are unsupported by this local contract and need a later explicit source disposition.

For member, fields are exactly nullable status and member_type strings. The fixture does not capture iin or establish bank identity. Account, fromuser, purpose, receipt and other arbitrary source columns are excluded everywhere. A synthetic marker is not DLP: callers must not place real sensitive values inside an otherwise allowed string. Real source classification, protected key storage, field approval/encryption and access review are still prerequisites.

## Tables and identity

Both tables live in `platform`, created by [0001](../../packages/database/migrations/0001_local_source_intake.sql). [0002](../../packages/database/migrations/0002_intake_column_grants.sql) narrows column INSERT grants without modifying already applied SQL. Existing 0000 and its hash remain unchanged.

- `source_records`: BIGINT generated primary key, generated UUID record_ref, workspace/source namespace/generation/table/complete key, explicit local_synthetic/test flags and server created_at. Unique scoped full key distinguishes source tables, epochs of source identity and complete composite keys. JSONB key equality and C-collated scope strings are explicit **synthetic comparison rules**, not proof of real MariaDB collation semantics.
- `source_events`: generated BIGINT event_id, workspace/source/generation, capture epoch + event key, record FK, operation, first observed_at, bounded allowlisted fields, version1 and server recorded_at. The unique event tuple is independent of changing process/run IDs. A composite FK prevents referencing a record from another workspace/source/generation. History lookup uses `(workspace_key, record_id, event_id)`; event_id is local append identity, not source commit order or payment revision.

One record can have multiple observations. Distinct event keys with identical content remain distinct. A source PK change is a different source record here; no business-payment linkage or history-overlap resolution is inferred. A delete remains an append-only observation, not a physical deletion or a payment reversal. No latest/current projection is maintained.

DB constraints enforce nonnull identities, local scopes/mode, key structure, allowed operations/field names, scalar field shapes, finite observed times and referential integrity. The TypeScript validator additionally enforces the full table-specific field set, exact decimal/calendar/length rules; direct SQL must not be treated as a second equivalent validator. These JSONB columns are small fixed fixture envelopes, not unrestricted raw-row storage. No GIN, partitioning or sharding was added; the model remains a local slice pending real protocol, retention and workload evidence. No 5-million-payments/day capacity claim is made.

## Atomic append and failures

`createSourceIntake(dsn)` fixes the dedicated lmps_intake role, loopback database and local/test environment, pool max2, connect wait1s, statement1s, lock500ms, query1.5s and idle transaction5s. Its `append(unknown)` uses one client and explicit READ COMMITTED transaction:

1. Validate/copy the envelope; register the full source record with ON CONFLICT DO NOTHING.
2. In a separate statement, read the committed record winner if a concurrent insert won. This avoids relying on a single statement snapshot to see a conflicting row.
3. Insert the scoped event. For an existing identity, compare actual record ID, operation, observed_at and JSONB fields; no content hash is used as identity or proof of equality.
4. Commit and return inserted/duplicate with lossless string IDs. On contradictory evidence, roll back and return EVENT_CONFLICT; any newly registered losing record disappears too. Storage failures are redacted and roll back. Failed rollback discards the connection.

No automatic retry, ACK protocol, broker checkpoint, ordering/current-state update, quarantine queue or external side effect is implemented. A transport failure during COMMIT can leave the result uncertain; retry the **same** immutable event identity/content to resolve it. Retry timing, capture_epoch and observed_at must not be regenerated on process restart. Conflict returns an error without overwriting evidence; persisting a quarantine/disposition workflow is a later batch. Deduplication depends on retaining its rows and the agreed identity; no TTL/drop job is enabled and no end-to-end exactly-once guarantee is claimed.

Public errors are INVALID_EVENT, EVENT_CONFLICT and STORAGE_FAILED with fixed messages. Underlying SQL/parameters/credentials are not exposed. Logs retain the earlier local error-suppression policy; tested canary paths are not a complete production logging solution.

## Roles, commands and pgAdmin

lmps_migrator owns the schema/tables and reviewed migration ledger. lmps_intake has CONNECT/schema USAGE, SELECT and INSERT on only the intake input columns, plus sequence USAGE. It cannot supply generated IDs/UUIDs, provenance/mode or server timestamps; UPDATE/DELETE/TRUNCATE, object creation, ledger access and role escalation are denied. lmps_app can SELECT these two **synthetic-only** tables and cannot write. No role is granted via membership. This does not implement tenant-specific read authorization/RLS; the local reader sees all synthetic workspaces. Database owner/bootstrap administration can still alter evidence, so this is not WORM audit storage.

For an existing owned cluster (such as the one opened in pgAdmin):

```sh
pnpm db:start
pnpm db:prepare-intake
pnpm db:migration-status
pnpm db:migrate
pnpm db:intake-demo
pnpm db:intake-demo
```

First demo reports inserted; the repeated demo reports duplicate with the same IDs. It uses only the checked-in synthetic fixture. `prepare-intake` verifies the owned cluster, creates/reuses its generated private writer credential, grants DB CONNECT and extends only its dedicated loopback HBA rule. It reloads this cluster, without a restart or shared service/configuration change. Repeated preparation preserves existing passwords; unrecognized/privileged/membership-bearing roles are rejected. Fresh `db:init` prepares the role automatically. Incomplete preparation retains private state; retry the same preparation rather than erasing or rotating credentials by guesswork. State/intake.env remain ignored and restricted to 0600; no password is printed.

Refresh **Databases → lmps_risk_local → Schemas → platform → Tables** in pgAdmin using the existing lmps_app connection. source_records and source_events are readable; the migration ledger remains inaccessible to this reader. All sample rows are labeled synthetic. The persistent cluster was already running for the user's pgAdmin request and remains running after this batch; tests use separate disposable clusters. Use `pnpm db:stop` when finished.

## Verification

Existing native DB tests now expect three migration entries and two intake tables. New tests cover strict validation/mutation isolation, complete keys, decimal strings, concurrent duplicate/conflict winners, no orphan after rollback, distinct equal-content events, scope/generation/epoch separation, append-only and generated-column permissions, cross-workspace FK, account-key rejection, bounded lock failure, restart/replay and redacted canary paths. Unified/fresh verification also runs existing API/ML/contracts/MariaDB/DDL/security tests. SQL publication exemptions cover only the three exact reviewed migration paths, never arbitrary SQL/source dumps.

References: [PostgreSQL INSERT/ON CONFLICT](https://www.postgresql.org/docs/18/sql-insert.html), [READ COMMITTED snapshots](https://www.postgresql.org/docs/18/transaction-iso.html), [constraints](https://www.postgresql.org/docs/18/ddl-constraints.html). Real CDC protocol, normalization/business entities, record-level authorization, retention/DR and performance remain later gates.
