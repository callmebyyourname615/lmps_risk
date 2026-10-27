# Snapshot data quality profile — item19

Local/test contract, profile_version1. This tool describes **observed validated snapshot rows**, not the whole MariaDB database, unique business payments, source readiness or model accuracy. Source/account/business gates remain unverified.

## Run and privacy

After an existing synthetic capture has been published:

```sh
pnpm source:profile <capture_id>
```

The CLI reads `.local/snapshots/<capture_id>/snapshot.json` with existing private-spool validation and writes `.local/profiles/v1/<capture_id>/profile.json`. It does not open MariaDB/PostgreSQL, read database credentials, register jobs, run reconciliation or invoke a vendor. No new library, migration, role or daemon is needed. Compilation of the database dependency in the worker build is not a database connection.

Exit0 means profiled or an exact duplicate report; stdout contains only local_synthetic/test, status, capture UUID and observed row count. It is not a data-quality PASS. Invalid/unsupported input, private-file conflict, partial publication and storage failures exit1 with fixed diagnostics. The reports contain potentially sensitive raw codes, aggregate amounts and calendar ranges, so they stay in ignored owner-private files; no report payload/fingerprint/path is printed. No HTTP/export endpoint is introduced. Do not publish these artifacts as anonymous data.

## Report semantics

| Field | Meaning and limit |
| --- | --- |
| profile_version/capture_id/snapshot_sha256 | Version1 and the canonical frozen-input identity reused from item18; formatting/object-key order is ignored, changed evidence changes the hash |
| scope/observed_rows/max_input_rows | observed_snapshot_rows, exact number of supplied valid events and existing400-event cap; no whole-source count or transaction-day estimate |
| observed_at_utc | The common capture observation timestamp, or null for no observed events; not the source transaction time or historical field-availability time |
| tables.*.observed_rows | Rows seen per projected table; zero means no rows in this artifact, not proof that the source table is empty |
| fields.* | Non-null count, null count, literal empty-string count and distinct non-null strings, including empty string; whitespace is preserved |
| raw_code_counts | Null/empty/raw frequencies for ccy/result or member status/member_type; no trimming, case folding, lookup, risk interpretation or codebook approval |
| source_naive_times | Per-table min/max requesttime/txtime strings and non-null counts; not_in_projection distinguishes unavailable columns from observed nulls |
| amounts_by_raw_currency | Count, positive/zero/negative counts and exact observed_amount_sum/min/max for one table and exact raw currency code |

Amount arithmetic converts validated two-decimal **source representations** to BigInt unscaled integers and formats results as strings. It never converts through JavaScript Number, binary floating point, a canonical currency scale or an exchange rate. Signed negative zero is numerically zero in aggregates; raw string distinct counts can still distinguish its representation. For example,0.10+0.20 produces0.30 exactly, and sums can exceed the source column's individual-row magnitude without overflowing.

There is no combined cross-currency or cross-table total. Current/history/old rows can overlap as business payments; account/transaction identity and lifecycle/reversal/status semantics are not established. These observations are not settled/legitimate/fraud/loss totals. Positive/negative/zero amounts are descriptive values, not suspicious labels.

The calendar strings have a validated fixed format, so lexical range ordering needs no timezone conversion. The report does not calculate UTC source times, elapsed capture-to-transaction delay, business date coverage, peak TPS, gaps or freshness claims. No per-row source IDs, member keys, source generation or event keys are copied into the report; aggregates/ranges/raw codes can still be sensitive.

Explicit limitations always remain:

- source_completeness, source_timezone and currency_and_status_semantics: unverified.
- account_identity: not_observed in this projection; this does not resolve masking/full-account uncertainty in the real source.
- business_payment_deduplication: not_performed.
- target_reconciliation and job_fingerprint_binding: not_checked. Offline profiling is separate from item18 registration/frozen-hash enforcement and target reconciliation. Its hash is not an authentication signature.

The profiler accepts the existing validated synthetic envelope only: max100 rows/table,400 total and2MiB input. Structurally invalid rows fail capture/input validation; this report cannot quantify rejected or unseen source rows. It is not a raw-extract DQ quarantine engine or a threshold-based quality gate. Future raw profiling needs its own approved contract, fields, retention and source-load evidence.

## Publication and replay

Each base/version/capture directory must be a non-symlink directory owned by the current UID with no group/other permissions. The exclusive capture-directory creator writes a0600 pending file, fsyncs it, renames to profile.json, and fsyncs the directory; parent creation is also synced. Later calls can only read/compare, never overwrite. An identical recomputation syncs the publication directory before returning duplicate; changed evidence/calculation/version under that same path fails closed. Change PROFILE_VERSION when report schema/calculation semantics change.

Existing report reads reject symlinks, hardlinks, nonregular files including FIFO, insecure ownership/mode, malformed/tampered content and more than1MiB. Reads are bounded during reading, not only at stat time. Concurrent readers can encounter an unpublished directory and fail safely; retry after the writer finishes. Interrupted pending files remain private and unusable for manual review, without automatic deletion/repair. Only one concurrent publisher can win a capture directory.

The owner can edit/delete the spool, report or directories; this is not encrypted/WORM/signed evidence. The offline profiler does not verify a preexisting registered job's hash or the current PostgreSQL dataset. A first report from changed-but-valid input therefore makes no job/target claim; import registration may still reject it. Source spool/retention and approved backup/archive rules remain separate. PostgreSQL database backup does not include these files, and a profile cannot reconstruct the underlying dataset.

## Verification and handoff

Tests cover exact large/negative/zero/multiple-currency amounts; per-table separation; literal raw code/null/empty distributions; naive ranges/unknown coverage; deterministic key ordering and excluded source keys; maximum-width400-row input; private publication/replay/conflict; no MariaDB/PG connections; insecure/link/FIFO/oversized/partial/tampered files; concurrent publication; invalid/real/live inputs. [Implementation status](../implementation-status/current.md) records final full/fresh counts and actual private-spool CLI results.

P01/S02 is still partial. Actual source date/peak/burst/update/query/identity/availability profiling, approved codebooks/thresholds, real-source access/security/load approval and production retention/export remain pending. No rule/model/blacklist/label or5-million-payment capacity conclusion follows from a small synthetic profile.
