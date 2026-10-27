# No.35.2 — Offline dataset import and reconciliation

Offline CSV → verified bounded in-memory snapshot → restricted PostgreSQL staging → exact reconciliation. This is raw export evidence, not a canonical payment, verified account, Risk assessment or Alert. Source semantics, timezone, business identity and current/history overlap remain unverified. [No.35.3 offline replay](offline-risk-replay.md) is a separate simulation-only amount screening command.

## Run

Use the [No.35.1 export contract](offline-dataset-profile.md): one selected transfer/transfer_hist/transfer_old/member projection, UTF-8 CSV, explicit NULL representation, maximum64MiB/100,000 records. The importer recomputes the profile from the entire original file and checks the declared fingerprint, byte count and record count. Invalid/empty/duplicate/conflicting-key files reject before DB credentials are loaded or any batch is registered. A prior JSON report is a convenience for filling the manifest, not a trusted validation assertion.

The local database needs a separately authorized migration through0012 and the existing intake credential. Implementation/tests do not migrate, seed, prepare roles or modify the persistent project DB. Native tests create disposable clusters. This tool does not open LMPS/MariaDB or discover credentials for a real source.

Write an owner-private0600 manifest under an owner-private0700 directory, e.g. `.local/dataset-inputs/import.json`:

```json
{
  "format": 1,
  "execution_mode": "offline_analysis",
  "batch_ref": "<new v4 UUID>",
  "workspace_key": "offline_local",
  "source_namespace": "offline_lmps_export",
  "source_table": "transfer",
  "profile_version": "offline-dataset-profile-1",
  "dataset_sha256": "<dataset_sha256 from report.json>",
  "input_bytes": 123,
  "expected_rows": 1
}
```

Replace the placeholders and copy input_bytes/observed_rows from the profile. These sample numbers are not defaults. workspace_key/source_namespace must match `offline_[a-z0-9_]{1,40}`: explicit operator scope labels, not proof of stable LMPS identity/source generation or institution entitlement. Keep the same scope/manifest on resume. Do not add source/account values, DSNs, file paths, codebooks or rows_sha256 to this input.

```sh
pnpm --silent dataset:import --manifest "$PWD/.local/dataset-inputs/import.json" --input "$PWD/.local/dataset-inputs/transfer.csv"
pnpm --silent dataset:status --workspace offline_local --batch <canonical-batch-UUID>
pnpm --silent dataset:reconcile --manifest "$PWD/.local/dataset-inputs/import.json" --input "$PWD/.local/dataset-inputs/transfer.csv"
```

Input/manifest absolute paths must have owner-private, nonsymlink parent directories and owner-private single-link regular files. Use --silent to suppress pnpm's argument echo; build output contains tool commands, while the Node entrypoint prints count/status/reference-only JSON. Direct compiled entrypoint: `pnpm exec node apps/risk-workers/scripts/dataset-import.mjs import|status|reconcile ...`. Shell history/process arguments remain outside the application's redaction guarantee.

No new package, Python DB driver or second CSV parser is installed. The existing Python profiler collects candidate rows through a shared callback, verifies the whole file and checks before/after file metadata. Only a valid matching file is sent through inherited pipe FD3; helper stdout/stderr are suppressed by the Node caller. Direct helper invocation has no raw stdout API. The Node reader validates UTF-8/frames/typed values, max4096-byte frames, max192MiB bridge output, exact row count and derived rowset hash under a30-second helper watchdog. A partial/failed child never becomes an import snapshot. Arrays are copied and the complete snapshot/unique keys are revalidated before registration.

## Contracts and identity

`packages/contracts/src/offline-dataset.ts` owns the strict manifest/row limits. Input has exactly the10 fields shown above. The frozen database manifest additionally has rows_sha256, derived by hashing canonical UTF-8 JSON value arrays with one LF after each row. Individual row_sha256 hashes the same array without LF. Values follow the fixed DATASET_COLUMNS order, regardless of CSV header order; money stays a decimal string, NULL stays null and naive time stays a source string. Calendar validation never assigns a timezone to the source.

Canonical batch identity hashes the complete frozen manifest except batch_ref. Same file/rowset/profile/workspace/source namespace/table/declared counts with another UUID returns the first canonical batch_ref. Store that returned reference for status. Changed input under an existing UUID conflicts; changing scope/table/file/profile creates a different batch. File-byte formatting differences are different datasets. These are staging identities, not business-payment dedup keys; current/history files are never merged or inferred to describe the same payment.

## Two additive tables

| Table | Contents |
| --- | --- |
| platform.offline_dataset_batches | Frozen manifest/integrity hashes and scope; expected/loaded counts; importing/complete/blocked; reconciliation status/time; service recording identity |
| platform.offline_dataset_rows | Scoped batch +1-based record number; source table; complete source_key; selected raw fields; row integrity hash; recorded_at |

All source facts are in offline_dataset_rows.source_key/fields. E.g. transfer id/requesttime → source_key.id/requesttime; amount/ccy/result/txtime → fields.*. Member code → source_key.code; status/member_type → fields.*. Unlike the old source_events slice, these observations have source_kind=user_supplied_file/execution_mode=offline_analysis/source_semantics=unverified and never borrow local_synthetic provenance. SQL requires scoped FKs, unique source keys within a batch and allowlisted JSON field names/types. Node/Python apply the stricter source range/calendar/control-character checks too.

The existing trusted lmps_intake service role can read staging, insert selected immutable evidence columns and update batch progress/reconciliation. It cannot update/delete raw rows or frozen manifest/recording columns. App/API, outbox and reviewer roles have no SELECT or mutation rights on either staging table. This is not institution RLS or adversarial separation from an intake credential holder/DB owner; no new public HTTP/raw-data endpoint exists. New schema alone does not approve real-data access/retention.

## Checkpoint, concurrency and recovery

Registration serializes semantic identity and compares frozen evidence. Each append locks the batch and inserts at most500 records plus loaded_rows in the **same transaction**. Chunk replay compares exact saved keys/fields/hashes. Out-of-order, overlapping partial or changed chunks reject. Row locks serialize concurrent writers without a long lease or daemon; a process/connection death releases its transaction, while committed prefixes remain.

Rerun the import with the same original file/manifest. The worker validates the whole file again, resolves the canonical batch and resumes from loaded_rows. A complete batch still runs reconciliation on replay; it does not blindly return a cached PASS. Storage/lock/serialization conflicts exit1 and may be retried by repeating the command; no automatic unbounded retry or hidden reset is provided. A bounded progress guard rejects a checkpoint that fails to advance.

Reconciliation locks the batch in a REPEATABLE READ transaction and scans ordered pages of500 against the validated frozen snapshot. It compares exact source keys, every projected value and per-row hashes rather than trusting count/hash columns alone. Its state update commits with that verification snapshot:

| Outcome | Batch/reconciliation | Meaning |
| --- | --- | --- |
| Exact full dataset and matching checkpoint | complete / matched | Staging matches this one file at verification time |
| Intact committed prefix with an unimported suffix | importing / incomplete | Resume can finish missing suffix |
| Changed values/hash, missing committed rows, unexpected rows or checkpoint discrepancy | blocked / mismatch | Preserve evidence; no automatic repair/replacement |

Counts are expected, observed, matched, missing, mismatched, unexpected. Missing and mismatched are separate; duplicate/extra business payments are not inferred. A complete status records the last verification and is not a guarantee against later owner modification. If verification/storage fails, no fabricated complete result is returned. Operator/DB-owner remediation is outside the tool; there is no force/unblock/delete command.

Public output includes canonical batch_ref, workspace_key, source_table, expected_rows/loaded_rows, status/reconciliation_status, execution_mode/source_semantics, optional registration and reconciliation counts. Raw keys/values/codes, filenames/paths, fingerprints, manifests, credentials and driver diagnostics are excluded. CLI exit0=complete/matched,2=incomplete/blocked,1=invalid/file/storage failure. Library errors use fixed DATASET_* codes.

## Backup and verification

Backup now includes both tables, frozen manifest and committed prefixes. Current schema backups use local_pg_backup_v2/provenance=local_workspace so a user-supplied export is not labeled synthetic. Exact pre-offline migration-prefix4–12 inventories still use/accept v1 local_synthetic and restore their original ledger/tables without upgrades. Manifest validation binds format/provenance to the table inventory.

Fingerprints stream500 ordered records at a time under the same exported snapshot used by pg_dump; restore fingerprints use one read-only snapshot too. Current local bounds:1,000,000 total staging rows,1000 rows for each other table (including batch metadata),128MiB archive,10 seconds/native tool. Exceeding these bounds fails closed; this is not a production backup/retention/capacity design. App raw-staging SELECT denial is checked after restore. No worker starts. PostgreSQL backup includes stored row evidence, but not the original CSV/private profile/input manifests; retain those separately under approved policy. A backup cannot reconstruct byte-identical CSV formatting or establish source authenticity.

Tests use invented private exports and disposable native PG only: all4 CSV profiles, source string/NULL/Unicode/decimal boundaries, actual100,000-record bridge/import/reconcile/restore, aliases/cross-scope/concurrent writers, checkpoint rollback, actual SIGKILL after chunk commit/resume, DB outage, input tamper/rejection before registration, row/checkpoint corruption, grants, direct CLI and older backup compatibility. Full/fresh results are recorded in [implementation status](../implementation-status/current.md).

Real file access/retention/export context and approved business mapping/codebooks/time remain pending. No LMPS connection, project migration/seed, verified identity/graph, canonical publication, Risk/Alert generation, payment action, UI, scheduler or deployment is part of No.35.2.
