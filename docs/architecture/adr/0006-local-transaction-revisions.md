# ADR-0006 — Local synthetic transaction observation revisions

Status: IMPLEMENTED locally; production schema/mapping pending. Owner: TBD. Date: 2026-10-20.

## Scope and input

No.27 adds an append-only observation store and scoped read APIs after the No.26 storage experiment. It does not select the production current/partitioned design. There is no source/normalizer publication adapter, verified account/business identity, business write endpoint or deployment.

`createTransactionRevisions(intakeDsn).append(input)` accepts exactly:

| Field | Rule |
| --- | --- |
| format /provenance /execution_mode |1 /local_synthetic /test |
| workspace_key | Existing bounded synthetic workspace format |
| expected_revision | Integer0–2147483646;0 publishes ordinal1; otherwise names the preceding ordinal |
| transaction | Existing Transaction0.1.0-draft.1, restricted profile below |

The existing `@lmps/contracts` validator remains authoritative. Database now declares a dependency on that existing workspace package; standalone builds prepare it. Lock/SBOM change for that edge only; no external dependency version/artifact changes.

Only test/unknown transaction status, null occurred_at/mapping/bank/type/channel fields, and both accounts exactly unresolved/unknown with reason STABLE_IDENTITY_UNVERIFIED are accepted. Namespace and source-record/run/correlation/revision handles must be explicitly synthetic. Transaction ID remains an opaque string with significant leading zeros, scoped by workspace and namespace; it is a caller-declared fixture ID, not a source business key or account link. Known lifecycle/reversal states are rejected until a separately reviewed publisher binds normalization evidence.

Money remains an exact decimal string under the existing draft contract, including precision beyond NUMERIC(24,2); JSONB does not round it or convert minor units. Three-letter currency syntax is not source currency/unit approval. Observed time is preserved, not used as historical availability or source ordering. Inputs are detached before storage awaits. Extra fields, malformed calendars/numbers, mapped/resolved/masked assertions and nonlocal/live contexts reject before storage. Serialized payload limit7000 bytes; SQL JSONB text limit8192.

## Publication, retry and permissions

Migration0006 adds `local_transaction_revisions` with PK `(workspace_key,namespace,transaction_id,revision_number)` and unique scoped transaction_revision. Generated previous_revision is null for ordinal1 and otherwise ordinal minus1. A self-FK to the preceding scoped row prevents gaps and branches, without a mutable current-head table or timestamp winner.

Append uses one READ COMMITTED transaction. After a uniqueness conflict, a separate statement reads the committed winner and compares the complete JSONB payload. Identical retry returns duplicate, independent of object-key order and even after later revisions exist. Changed content, reused revision handle or missing predecessor returns REVISION_CONFLICT with rollback. Storage/timeout/uncertain-commit failures return fixed STORAGE_FAILED; callers must retry the same input to resolve a potentially committed outcome. No automatic retry loop or exactly-once external effect is claimed.

App SELECT only; intake SELECT plus input-column INSERT only; outbox no access. App/intake cannot update/delete/truncate history or spoof generated/default metadata. Recorded actor is the DB session role, not an employee. SQL guards enforce bounded account-free profile/identity consistency; the repository validates the full draft contract. The API validates stored payloads again and fails closed if a privileged writer corrupts them. SQL guards alone are not the full contract validator.

The migration owner/superuser can still alter history/grants. This is publication evidence, not WORM, production RLS or a complete administrative audit design. Existing outbox/job audit schemas are unchanged; no historical audit is invented. The trusted internal writer can publish across synthetic workspaces; real institution entitlements remain pending.

## Read/API contract

Existing optional local auth plus app DSN register two reads with independent **transactions:read**:

```text
GET /v1/local/transactions/{namespace}/{transaction_id}/revisions?after=0&limit=25
GET /v1/local/transactions/{namespace}/{transaction_id}/revisions/latest
```

Workspace comes only from the verified token. Namespace/ID are exact filters. Unknown/foreign identity returns empty200; unavailable/corrupt storage returns fixed503. History is ascending ordinal with exclusive string cursor0–2147483647, limit1–100 and one extra row for pagination. Latest accepts no query and returns at most one item by publication ordinal, even if observed times move backwards.

Response: provenance=local_synthetic, execution_mode=test, canonical_emission=false, source_semantics=unverified, scope/ID, view=history|latest, pagination=live_committed_view, items, nullable next_cursor. Items contain ordinal, DB-recorded UTC timestamp and validated draft payload; money/IDs stay strings and internal actor is excluded. OpenAPI describes wrapper/errors and names the shared draft contract; the payload is an object rather than a duplicate generated schema. No mutation route exists. No-store and server-generated request IDs remain enabled; readiness remains503.

Reads are live, not a frozen export or source completeness claim. Higher revisions may appear between pages. Ordinal order is publication order, not business lifecycle eligibility; an old retry receipt is not a fresh latest-head check.

## Migration, backup and checks

Reviewed0000–0005 stay unchanged.0006 and seven-entry journal are tested on disposable native clusters. The existing project PostgreSQL18503 is not migrated/seeded by this batch and retains six migrations. `pnpm db:migrate` can prepare that local runtime later; there is no destructive down migration.

Backup recognizes the exact nine-table inventory (eight platform tables plus ledger), preserving older six-migration/job, five-migration/audit and four-migration inventories. Enumeration reads one extra table beyond the largest allowed inventory so unknown tables cannot hide behind its limit. Existing1000 rows/table and32MiB bounds remain. Full frozen revision fingerprints/app permissions are checked on restore; old backups restore their original schema without auto-upgrade or invented revisions. Workers never resume during restore.

Focused checks passed: nine new repository tests, eight HTTP tests, seven backup tests including one new pre-revision compatibility case, and14 existing foundation/migration tests. They cover precision, detached input, sequential/replay/conflict/racing writes, FK/ACL boundaries, missing predecessors, paging/scoping, corrupt storage, outages/recovery and old backup inventories. Final pnpm verify:fresh passed514 offline tests with frozen cached installs, typechecks/builds, generated drift, SBOM176/0 UNKNOWN and178-file publication checks. Original source hashes stayed unchanged; temporary source/native clusters were removed. Online advisories were explicitly skipped; external dependency artifacts/versions did not change.

Run `pnpm test:database`, `pnpm --filter @lmps/risk-api test`, or `pnpm verify:fresh`. Tests use disposable native clusters, private signing fixtures and ephemeral loopback HTTP listeners; all are cleaned up.

## Next boundary

Next is a separately scoped synthetic evidence-bound normalizer-to-revision publisher: transaction/revision mapping, money/currency/time compatibility, lineage, unknown/invalid withholding, cross-row/capture duplicate/conflict handling and lifecycle/reversal eligibility. Do not bypass these checks to widen the storage profile. Production freeze still requires approved keys/workload and representative benchmark. P02/S04/P03 remain PARTIAL; all13 real-source gates remain UNVERIFIED.

## References

- [Draft contract](../../../packages/contracts/schemas/transaction.schema.json)
- [Repository](../../../packages/database/src/transaction-revisions.ts)
- [Read controller](../../../apps/risk-api/src/transactions.controller.ts)
- [Storage experiment](0005-transaction-storage-experiment.md)
- [Current status](../../implementation-status/current.md)
- [Next steps](../../../../plan/10-next-implementation-steps.md)
