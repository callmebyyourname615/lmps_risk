# No.39.1 — Real LMPS pilot integration

This local-only pipeline verifies a v2 gzip pilot, preserves its 22 fields as private evidence, projects six fields into the existing offline staging contract, reconciles every row and runs an explicit simulation amount screen. It does not connect to LMPS MariaDB. No new schema or external dependency is needed.

## Run

From `financial-crime-platform/`, with the locked workspace installed and the owned local PostgreSQL runtime running with migrations0000–0014:

```sh
pnpm --silent dataset:pilot \
  --bundle /Users/macbookpro/Desktop/lmps-export-pilot-v2-aaf39bfn \
  --output "$PWD/.local/no39-real-pilot" \
  --amount-gte 100.00
```

Use absolute paths. Local/test mode is required; production mode is rejected. Input directories must be owned/private0700 and files private0600, regular and single-link. Symlinks, overlapping source/output paths, malformed encoding, duplicate complete source keys and invalid CSV values fail closed. Each file and decompressed archive is bounded at64MiB; at most1000 pilot rows are accepted. The earlier2GB export is outside this command's scope.

The threshold is an explicitly chosen smoke-test value, in each exact source currency's recorded units. It is not an approved/calibrated risk policy or an FX conversion. It screens all recorded rows, without asserting successful execution, net settlement, reversal handling or verified event time.

## Evidence and storage

The original bundle remains untouched. The output contains:

- `adapted/evidence/`: exact gzip, manifest, preflight and profile copies retaining all22 source fields, including unverified account candidates.
- `adapted/transfer.csv`: only `id,requesttime,amount,ccy,result,txtime`, matching the existing staging contract. Account fields and fee are not staged in PostgreSQL.
- `adapted/lineage.jsonl`: complete `(id,requesttime)` source key, row ordinal, source TSV row SHA-256 and projected staging row SHA-256 for every row.
- `adapted/receipt.json`, `input.json` and `csv-profile.json`: immutable hashes, byte/row counts, persisted batch/run UUIDs and validation evidence.
- `context/v1/<run_id>/`: frozen requested simulation policy, source/adapter hash binding and readiness report for all15 catalog patterns.
- `replay/v1/<run_id>/replay.json` and `replay.csv`: deterministic private simulation output.

TSV escapes are decoded exactly. SQL NULL, empty text, Unicode, decimal strings, signs and leading zeroes are preserved. A non-NULL literal `\N` in one of the six projected fields is rejected because the existing CSV contract cannot distinguish it from NULL; the original22-field evidence remains lossless.

Before each database import attempt the command verifies the owned local runtime and creates a private backup under `.local/backups/<backup_id>/`. Only `platform.offline_dataset_batches` and `platform.offline_dataset_rows` are written. A whole-database backup does not include the original gzip/CSV/report files: retain those separately as private evidence. Errors print a fixed stage code and withhold raw values/connection details.

## Retry and recovery

Repeat the exact command to resume/reconcile the same batch and retain the same run/report. Existing files must match; changed source, policy or output content is rejected rather than overwritten. A byte-identical staged dataset in another output directory resolves to the canonical existing batch. Retry can refresh reconciliation timestamps, but creates no extra staged rows or operational alerts. A backup failure stops database writes; later import/publication failures retain evidence and committed checkpoints for the existing importer to resume.

Use a new output directory for a deliberately different simulation policy. Do not delete/rewrite evidence to bypass a conflict. Cleanup of server/Mac exports remains a separate operator task after verifying the flash-drive copy; this pipeline performs no export cleanup.

## Actual local acceptance — 2026-10-24

The operator-verified real v2 bundle supplied271 rows for `[2026-10-01 00:00:00, 00:01:00)`,80,977 uncompressed TSV bytes and18,090 gzip bytes. Local import and exact row reconciliation passed271/271. An actual repeat returned duplicate registration/publication with one batch and271 staged rows.

The explicit `100.00` simulation screen returned269 matched and2 below threshold,0 unavailable. These are criterion matches, not fraud labels or results from the15-pattern risk engine.

Before/after verified backups show that only the two offline staging tables changed; all26 other table fingerprints remained identical, including the original synthetic Policy→Risk→Alert→Case records. The post-import backup restored successfully into a disposable PostgreSQL18 cluster with table fingerprints and application-role access controls checked. Private machine-specific acceptance evidence is `.local/no39-real-pilot/acceptance.json`.

Final fresh-source offline verification passed880 tests, frozen installation, typecheck/build, generated/lock drift, publication339 files and SBOM199/0 UNKNOWN. Online dependency advisories were skipped. CI uses invented files and disposable clusters; real acceptance above is a separate local run.

All15 catalog patterns remain blocked for real assessment. Source lifecycle/status/time semantics, business identity, stable account representation and the required history/baselines/graph/flags are not yet verified. Account-looking digits or QR-like text do not establish an account entity. No verified entity/graph, canonical emission, real assessment, operational Alert or enforcement is produced. This one-minute sample demonstrates integration and integrity; it cannot establish pattern coverage or detection quality.
