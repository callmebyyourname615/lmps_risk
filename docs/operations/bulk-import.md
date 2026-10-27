# No.41.1 — Resumable bulk offline import and scale trial

This local/test-only workflow prepares v1 nineteen-field or v2 twenty-two-field transfer exports, then imports their six-field projection into a dedicated owned PostgreSQL18 trial. It reuses existing staging/checkpoints/reconciliation and all15 migrations; no new PostgreSQL table, external dependency, source connection, account entity or operational side effect is added. SQLite from Python's standard library is a temporary disk index during preparation, not a platform database.

## Prepare a private export bundle

The input must contain exactly the exporter manifest and its listed gzip files; v2 additionally requires the manifest-bound preflight/profile JSON. All input directories must be private0700 and files owned0600, regular, single-link and non-symlink. Extracted TSV copies and Finder metadata are not part of a verified bundle. Leave the original directory untouched and use a private verified copy containing only the listed artifacts, such as No.39.1's evidence directory:

```sh
pnpm --silent dataset:bulk prepare \
  --bundle "$PWD/.local/no39-real-pilot/adapted/evidence" \
  --prepared "$PWD/.local/example-bulk-prepared" \
  --rows 100000
```

All paths are absolute and the destination parent must exist/private. The ordinary project PostgreSQL directory and overlapping input/output paths are rejected. Preparation verifies all source windows, including unselected ones. It validates bounded gzip sizes, manifest/hash/count/header/range evidence, then selects a deterministic file-order prefix of at most the requested source occurrences. Limits:1000 windows,4GiB declared uncompressed input and1,000,000 selected source rows. This is not random sampling or proof of complete history. A pilot with271 rows still produces271 rows when `--rows 100000` is requested.

All windows receive archive/hash/count/header and manifest-range checks; full field/canonical/row-range parsing is limited to the selected prefix. Unselected payloads are not semantically parsed.

A disk-backed exact `(id,requesttime)` index compares the full19/22-field canonical source row SHA-256, including fields outside staging. Identical source-key repetitions are counted once; changed content fails before any PostgreSQL import. Same id at a different requesttime remains a separate source record. Hourly source window bounds remain enforced; invalid overlap/out-of-window rows are rejected. Independent capture manifests and transfer/history tables are not unioned or assigned a business-payment identity.

Output is an immutable plan, verbatim source manifest, quoted CSV chunks of at most25,000 unique rows and per-chunk JSONL lineage containing source window/row/full-row hash. Each chunk uses the existing `id,requesttime,amount,ccy,result,txtime` staging contract. Exact decimals, NULL/empty, code case and naive time are retained; an unrepresentable non-NULL literal `\N` in the six-field CSV projection fails closed. Account values/fee are not projected into PostgreSQL. Keep the original gzip evidence separately; the plan/CSV/database backup cannot reconstruct all19/22 fields by themselves.

The SQLite index is removed before publication. Preparation is memory-bounded by one25k-row chunk and a16MiB SQLite page cache, not by the total selected rows. Existing limits of the shared CSV profile still apply per chunk. Source hashes are checked again after selection. Exact retries verify existing output; changed inputs/limits/partial output fail without overwrite. SIGKILL during preparation can leave a private temporary/partial directory; use a new reviewed output path rather than overwrite it. Durable resume applies after a complete plan exists and import has committed checkpoints.

## Import and resume in an isolated trial

```sh
pnpm --silent dataset:bulk import \
  --prepared "$PWD/.local/example-bulk-prepared" \
  --trial "$PWD/.local/example-bulk-trial"
```

The command owns a new private trial cluster on an available loopback port, identifies its data directory, and binds its owner file to the plan hash. It accepts no arbitrary target DSN and refuses the primary project cluster/path/port18503. An OS advisory file lock fences the whole operation; never remove its lock file while a worker is active. The Python guard releases automatically when a killed parent closes its pipe. Incomplete/unowned initialization is refused rather than replaced.

A verified backup precedes imports. Native staging commits500-row checkpoints atomically; file/dataset progress is written atomically from reconciled database results. Resume reruns verification/reconciliation of committed chunks and continues missing rows, without trusting a progress file as proof. SIGKILL can leave the owned trial server running; the exact command resumes it. Normal completion/error stops the owned server. Existing project data/credentials are not migrated, seeded, replaced or stopped.

For a one-million-row prepared plan, stage the trial explicitly:

```sh
pnpm --silent dataset:bulk import --prepared "$PWD/.local/large-prepared" --trial "$PWD/.local/large-trial" --through-rows 100000
pnpm --silent dataset:bulk import --prepared "$PWD/.local/large-prepared" --trial "$PWD/.local/large-trial" --through-rows 1000000
```

Partial targets must align with25k chunk boundaries. A direct1m run also checks backup/restore at100k before proceeding. A resumed run with at least100k existing rows verifies/restores that baseline before more imports. Trial completion requires exact per-chunk reconciliation, no unexpected total rows/batches, a verified final backup and a successful isolated restore with fingerprints/role access checks. Corruption is blocked, never repaired silently.

Existing backup caps stay at1,000,000 staging rows,1000 rows per other table and128MiB compressed dump. For inventories over100k staging rows only, native dump/restore gets a bounded120-second budget and the snapshot idle budget becomes180 seconds; existing v1/v2 backup formats and small-inventory budgets remain compatible. A cap/disk/backup/restore failure withholds completion and retains the isolated trial/evidence for review. Free-space admission requires at least512MiB or4096 bytes per target row, whichever is greater; it is a conservative starting gate, not a measured final capacity guarantee.

Outputs include immutable `reports/v1/<phase_id>/bulk.json`, private per-attempt `runs/v1/<run_id>/run.json`, progress and backups under the trial. Console emits counts, status, timing/RSS and opaque IDs; no row values/source paths/plan hashes. A successful partial target is `checkpointed`; `complete` covers the selected plan only, not every row in the original export. Same-plan retries publish duplicate phase reports while retaining distinct attempt metrics. Exit0 is a successful verified trial/checkpoint; exit1 is a fixed redacted failure. Modes remain offline_analysis/source_semantics=unverified, with no canonical emission, assessment, Alert or enforcement.

## Opt-in synthetic scale acceptance

```sh
pnpm test:bulk:scale --output "$PWD/.local/new-bulk-scale-trial"
```

This creates one million invented rows in40 hourly gzip files, prepares40 chunks, imports/restores100k, then resumes through1m and restores again. It writes a private acceptance report and retains the stopped trial. It is separate from ordinary CI because of its resource/runtime cost. Ordinary tests exercise contracts, disk-index boundaries, format compatibility, corruption/grants, actual process kill/recovery and fencing with invented smaller bundles. No browser test is used.

## Actual acceptance — 2026-10-24

- Invented1m scale: preparation96.396s; initial100k import/reconcile/backup/restore16.837s; resumed100k→1m run124.894s including baseline/final restore. These are local batch timings, not online p95/p99 or full-system TPS.
- Peak Python RSS238,813,184 bytes; peak Node RSS321,421,312 bytes. PostgreSQL/OS-cache memory is not included. Retained artifacts1,705,361,316 bytes; post1m dump54,614,003 bytes, below134,217,728-byte cap.
- Actual real v2 pilot:271 rows passed this bulk workflow and isolated restore, using the verified No.39.1 evidence copy. The operator's Desktop folder also contains extracted/Finder files; those were left untouched.
- Original project cluster: verified before/after backups have identical fingerprints for all28 tables. No extra migrations were applied there.
- SIGKILL after a committed25k checkpoint resumed to50,001 exact rows and passed restore; target corruption and a competing worker failed closed.
- The real2GB/14.25-million-row export is on the user's flash drive and its trial is explicitly DEFERRED_BY_USER. No real2GB import,15-pattern readiness, identity verification,5-million-payments/day capacity, production DR or deployment is claimed.

Private evidence: `.local/no41-scale/acceptance.json`, `.local/no41-pilot/acceptance.json` and their trial backups/reports. Source business identity, masking, lifecycle/currency/time semantics, complete history and production security/retention gates remain unresolved.

Final ordinary fresh-source offline verification passed915 tests (656 Node +259 Python), including15 new focused checks. Frozen installs/typecheck/build/generated-lock drift, publication355 files and SBOM199/0 UNKNOWN passed; online advisory audits were skipped. The resource-heavy100k→1m acceptance above is separate from that test count.
