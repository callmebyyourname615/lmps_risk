# No.35.1 — Offline LMPS CSV intake readiness

This is a read-only, bounded **file profiler**, not a database importer or Risk replay. It examines a user-supplied export without claiming source authority, business identity, codebook meaning, timezone, historical completeness or verified accounts. [No.35.2](offline-dataset-import.md) adds a separate offline staging importer that reuses this parser/profile; No.35.3 Risk replay remains unimplemented. No.34 contracts remain synthetic-only.

## Run

Use an approved export containing only the selected columns below. Copy it from removable media to an owner-private local directory first: this version requires POSIX ownership/modes, which some flash-drive filesystems cannot provide. It does not change permissions, repair, move or delete the original file.

From the repository root, prepare private directories and place the file there:

```sh
mkdir -p .local/dataset-inputs .local/dataset-reports
chmod 700 .local/dataset-inputs .local/dataset-reports
chmod 600 .local/dataset-inputs/transfer.csv
pnpm --silent dataset:profile --table transfer --input "$PWD/.local/dataset-inputs/transfer.csv" --output-dir "$PWD/.local/dataset-reports/transfer-batch-001"
```

The input must already exist before chmod/profile. Both paths must be absolute. Input/output parent directories must exist, be current-UID-owned, have no group/other permissions and not be symlinks. Input must be an owner-private single-link regular file, not a symlink/FIFO/device. Output is an exclusively created0700 bundle with0600 files. Use a new output directory for changed input/tool versions.

Use `pnpm --silent` to suppress pnpm's command/argument echo. Alternatively invoke `uv run --locked --offline --all-packages python apps/risk-workers/scripts/dataset_profile.py` with the same arguments. Profiler stdout contains only format/status/validation_status/observed_rows; stderr uses fixed codes without values, paths or parser diagnostics. Shell history/process arguments are outside that output guarantee.

No Node build, database driver/credentials, SQL, source connection or network operation is involved. The existing pinned Python3.13 standard library supplies CSV parsing. Root `pnpm test` and `verify:offline`/`verify:fresh` include `pnpm test:dataset-profile`. No dependency or migration is added.

## Export contract v1

One source table per file. Header order may vary; names must match exactly without trimming/case folding, duplicates, missing or extra columns. Full-table exports containing account/payload columns are rejected at header review: rows are not interpreted and unknown header names are not reflected. The remainder is read only for fingerprint/encoding verification.

| `--table` | Required columns | Source key |
| --- | --- | --- |
| `transfer` | id, requesttime, amount, ccy, result, txtime | `(id, requesttime)` |
| `transfer_hist` | id, requesttime, amount, ccy, result, txtime | `(id, requesttime)` |
| `transfer_old` | id, amount, ccy, result, txtime | `(id)` |
| `member` | code, status, member_type | `(code)` |

Invented transfer example:

```text
id,requesttime,amount,ccy,result,txtime
1,2026-10-01 12:00:00,123.45,SYNTHETIC_CCY,\N,2026-10-01 12:00:00
```

- UTF-8, optional initial BOM, comma separator and Python CSV dialect with double quotes/doubled quote escaping; LF/CRLF and a missing final newline are supported. Quoted commas/quotes/newlines parse correctly; control characters in the selected scalar fields are invalid. No XLSX/SQL/TSV/ZIP autodetection.
- Exact `\N` means NULL even when quoted. A literal `\N` value cannot be represented separately in v1. Empty strings and whitespace remain distinct from NULL. Source nullable declarations apply: result/status/member_type may be NULL; keys, amount/ccy and transfer txtime may not. This is stricter than the older synthetic intake's nullable txtime profile.
- Integer IDs must be canonical signed32-bit integer strings. Member code is a nonempty string up to100 characters; preserve leading zeros/case. No account-token normalization or source-collation equivalence is inferred.
- Amount: signed exact decimal string, exactly2 decimal places, at most22 integral digits, matching DECIMAL(24,2). No float/rounding/abs/currency conversion/inferred minor units. Only valid positive/zero/negative counts are exported, without amounts/sums/min/max.
- Currency: nonempty string up to200 characters. Result permits empty strings up to200; member status/member_type permit empty strings up to16/20. Raw codes are not interpreted.
- Time: valid naive `YYYY-MM-DD HH:MM:SS`, years1000–9999. Zero/invalid dates or UTC offsets are invalid for this export contract. No UTC conversion, invented occurred_at or backdated capture time.

Limits:64MiB raw bytes,100,000 data records,4,096 characters/field,64 columns/record,262,338 characters/logical CSV record and256 distinct valid non-null codes/field. Limits apply during reading, including before CSV can accumulate an unbounded record. Sets are bounded by these caps; this is not a constant-memory whole-source scanner. The process handles one file; csv.field_size_limit is restored after profiling, without concurrent in-process parsing.

## Report contract v1 — report.json

| Fields | Meaning |
| --- | --- |
| format, tool_version, purpose | 1 / offline-dataset-profile-1 / offline_export_readiness |
| execution_mode, source_kind, source_table | offline_analysis / user_supplied_file / selected table; not trusted LMPS provenance |
| dataset_sha256, input_bytes | Exact original bytes, including BOM/header order/newlines; not an authenticity signature or payment identity |
| source_semantics, source_completeness, source_timezone | Always unverified |
| account_identity, business_payment_deduplication | not_observed / not_performed |
| import_eligibility, risk_assessment | not_evaluated / not_performed |
| source_key_comparison, raw_values_included | exact_export_strings / false |
| limits | Actual caps used |
| header | Known missing_columns; unexpected_column_count; duplicate_column_count. No unknown names |
| validation_status | valid / needs_attention / no_rows / header_rejected; never source/production approval |
| observed_rows | Data records examined, excluding header, or null for rejected header. Multiline quoted data is one record |
| row_counts.valid_rows / invalid_rows | Aligned rows with valid values / rows with invalid values or malformed width; sum equals observed_rows |
| row_counts.malformed_rows | Wrong-width records included in invalid_rows; no field/key attribution |
| row_counts.invalid_key_rows | Aligned rows with invalid/null key parts, excluded from key grouping; malformed rows are separate |
| row_counts.unique_complete_source_keys | Distinct complete format-valid keys in one file; includes rows with invalid non-key values |
| row_counts.duplicate_key_rows | Every subsequent record with a previously seen complete key; not business-payment dedup |
| row_counts.conflicting_key_rows | Subset of duplicates whose selected values differ from the first row with that key |
| fields.* | null_rows, empty_rows, non_null_rows, invalid_rows, distinct_non_null on aligned rows; NULL excluded from distinct counts |
| code_distributions.* | Valid non-null code counts using file-local code_1/code_2 and first_data_row, without raw values. Nullable empty strings are codes; NULL/invalid remain in field counters |
| amount_signs | Valid amount sign counts on aligned rows, including duplicates/rows with other invalid fields; null for member |

For header_rejected, observed_rows/row_counts/amount_signs are null; fields/code_distributions are empty. Uninterpreted rows have no fabricated counts. Malformed CSV syntax, invalid UTF-8, caps and input modification during reading are fatal and publish no new report bundle.

Code references follow first occurrence within each file/column and are not stable cross-file codebook IDs. first_data_row is the1-based data-record ordinal, not a physical line number: an authorized reviewer can inspect the original privately. Even a mislabeled currency containing an account value cannot copy it into artifacts.

## Mapping contract — mapping-template.json

The template repeats format/tool_version/dataset_sha256/source_table, sets status=draft_unapproved/current_database_intake=synthetic_only, and lists each selected source column with candidate raw-intake path/approval_status=unverified. This v1 field describes the original canonical/synthetic intake boundary; No.35.2 stages exports in separate offline_dataset_rows paths and never uses it to send real data to synthetic intake. The profiler's version1 output remains unchanged.

Codebook candidates contain code_ref/first_data_row/rows, target_value=null and approval_status=unverified. Required reviews: field access/retention, source schema, business identity/history overlap, money units/sign/fees, currency/status codebooks and timezone/time meaning. Account identity remains deferred; canonical_emission/enforcement are false. Copy the template elsewhere for review; this tool does not consume approvals or overwrite edited artifacts.

## Publication, replay and exit codes

Profiling/encoding/fingerprint verification finishes before output creation. No timestamps/UUIDs/input paths/raw row values are embedded: identical file bytes/table/tool reproduce identical content. Different header order/bytes change dataset identity; this is not semantic file dedup.

The exclusive bundle creator writes private pending files, fsyncs/renames each, then fsyncs the directory. The two-file bundle is not one atomic rename: concurrent callers can see an incomplete bundle and must fail/retry after completion. Complete existing bundles require exact file contents, ownership/modes and link checks; changed/edited/partial bundles are preserved and rejected. No automatic repair/deletion/replacement. Same-owner modification/deletion is possible; this is not encrypted/signed/WORM evidence or a durable job queue.

| Exit | Meaning |
| --- | --- |
| 0 | Published or identical replay with validation_status=valid; no import/risk/source-semantic approval |
| 2 | Published or identical replay needing review: invalid/malformed/duplicate rows, no_rows or header_rejected |
| 1 | Usage/private-file/input-change/encoding/CSV/cap/conflict/storage failure; no complete success claimed |

No current/history files are merged and no source key/fingerprint becomes a global payment ID. The tool cannot prove a consistent source snapshot or modification before opening. Actual exports still require source-owner access/retention approval; development/tests use invented files only. Fingerprints/counts/cardinality can be sensitive even without raw values, so artifacts remain private/ignored. PostgreSQL backup does not include these files.

## Verification

Run `pnpm test:dataset-profile`. Temporary synthetic tests cover offline-DDL declarations, exact money/integer/calendar boundaries, NULL/empty/leading zeros, quoted/multiline CSV, duplicates/conflicts, all4 profiles, actual100,000-row cap/one-over, bounded reads, changed input, non-disclosure/no network, private/link/FIFO/partial/tamper/concurrent publication and direct/root CLI replay. Final full/fresh results belong in [implementation status](../implementation-status/current.md).

References: [table/column lineage](table-column-lineage-catalog.md), [source mapping/gates](source-mapping.md), [older synthetic profiler](snapshot-profile.md), [No.34 jobs](../architecture/adr/0012-synthetic-risk-job-flow.md).
