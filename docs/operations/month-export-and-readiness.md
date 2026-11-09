# Monthly LMPS export and Phase 1 readiness

The operator selected October 2026 and server-side export followed by SSH download to the Mac. The October transfer bundle has arrived and was verified; the full-month streaming analysis is recorded separately in the implementation status. These tools do not import data, change policy, activate detectors, or certify source/account semantics.

## Server export

Copy **both** `apps/risk-workers/scripts/export_month.py` and the unchanged `export_transfer.py` into the same server directory. The private prepared ZIP contains both scripts and this guide. Python 3.9+ and a `mariadb` client are required; no Python packages are installed. Use the SSH account that will own/download the files. Connecting to MariaDB over TCP does not require running the exporter as Linux root.

From the Mac, using an existing SSH login:

```sh
scp .local/month-export-202610/lmps-month-export.zip YOUR_SSH_LOGIN:~/
ssh YOUR_SSH_LOGIN
```

On the server, replace the endpoint/user placeholders with the authorized connection. The password is requested once with hidden input, never as a command-line option. The database name is configurable.

```sh
umask 077
mkdir -p "$HOME/lmps-month-tools-202610" "$HOME/LMPS_Exports"
python3 -m zipfile -e "$HOME/lmps-month-export.zip" "$HOME/lmps-month-tools-202610"
python3 "$HOME/lmps-month-tools-202610/export_month.py" \
  --month 2026-10 --table transfer \
  --db-host APPROVED_DB_ENDPOINT --db-port 3306 --db-user EXISTING_READER \
  --database lmps --output-root "$HOME/LMPS_Exports"
```

The range is raw source `requesttime >= '2026-10-01 00:00:00' AND requesttime < '2026-11-01 00:00:00'`: 744 adjacent hourly windows, without inferring timezone. Every window checks required columns, a leading requesttime index and an actual EXPLAIN range plan before SELECT. MariaDB `SET STATEMENT max_statement_time=60 FOR SELECT ...` limits each data query; an independent 180-second client timer terminates a stalled client. No table/role/persistent configuration is changed. The script does not certify grants or source authority. Existing client TLS settings are retained without adding a verification bypass. [MariaDB statement limits](https://mariadb.com/docs/server/reference/sql-statements/administrative-sql-statements/set-commands/set-statement).

Rows stream into gzip parts of at most 8 MiB **uncompressed**, with a 1 GiB free disk reserve at part creation. Each part has a header and compressed/decoded SHA-256. NULL, empty strings, escaped controls/backslashes, leading zeros and exact decimal strings are preserved. Completion requires the full month, rather than the old 2 GB target or 1,000-row pilot limit.

The unique output directory is printed. Only `range_complete` plus successful verification is a complete requested-range bundle. Query/plan/disk/time failure or interruption leaves an incomplete bundle that verification rejects. Retry starts a new directory; this version does not resume or overwrite prior evidence. Hourly SELECTs are not one consistent month-wide snapshot and do not establish authoritative history completeness or known-at times.

`transfer` exports the existing 22-column pilot projection:

```text
id requesttime txtime reference frommember tomember totype amount ccy
result responsetime txtype originalreference shouldrevert isreconciled
issettled settletime qrtype fromchannel fromaccount toaccount fee
```

If the month is in history, use `--table transfer_hist` or `--table transfer_old`. These export 21 columns because the supplied schema has no `fromchannel` there. Each table has its own bundle; the script never UNIONs history or deduplicates business payments. Live columns/plans may differ from the supplied dump. Dictionary/reference/flag/outcome feeds remain separate.

## Download and verify on the Mac

Use the **absolute output directory printed on the server**, owned by the SSH login. From Core:

```sh
python3 tools/fetch-lmps-month.py \
  --ssh-host YOUR_SSH_LOGIN \
  --remote-dir /ABSOLUTE/SERVER/EXPORT/DIRECTORY \
  --output-root "$PWD/.local/month-data"
```

The downloader uses normal OpenSSH host verification and interactive authentication. It accepts a host/alias and restricted absolute path, not a shell command. A new private local directory receives `scp` data; all 744 windows, inventory, hashes, headers, record widths and requesttime bounds must verify before `readiness-plan.json` is written beside `bundle/`. Failure retains a private partial download without a plan. No remote files are deleted. Real SSH/source access was not exercised by local fixture acceptance.

## Prepared profiling path

After the files arrive, a file-only Phase 1 profiler is available:

```sh
pnpm --silent dataset:readiness \
  --plan /ABSOLUTE/PRIVATE/readiness-plan.json \
  --output "$PWD/.local/month-readiness"
```

The output parent must exist and be private. The plan specifies `format: lmps-month-profile-1`, `month: 2026-10`, and `files` containing `path`, `table`, `encoding` (`csv` or `export_tsv_gzip`), exact `sha256` and `expected_rows`. It initially has `amount_screens: []`. A copied private plan can request a scenario such as `[{"currency":"LAK","threshold":"1000000.00"}]`; this is review-only and does not verify an active policy or executed funds.

Supported projections are six-column CSV and existing 19/22-column exports, with 18/21 columns for history. Canonical absolute paths and private owned regular single-link files are required. Analysis caps are 1,000 files, 1,000,000 physical rows, 64 MiB compressed and decoded per file, 4 GiB total compressed/decoded bytes, 2 GiB scratch and 300 seconds. Export/download can produce larger bundles; those require a reviewed capacity extension or different scope, never silent sampling or a false full-month result. Invalid/extra columns, mutation, corruption and exceeded bounds fail without a published report.

Scratch SQLite stores table-scoped source keys, row commitments and selected aggregate inputs, never raw account values. It is removed after success or handled failure; forced machine/process death can retain private scratch. Keys are `(id,requesttime)` for current/history and `id` for archive. Exact duplicates count once; conflicting keys are withheld entirely. Cross-table equal literal `(id,requesttime)` observations are reported separately, not merged as business payments. Mixed projections for one table are refused.

### Explicit streaming capacity extension

Use `--streaming --hourly` for the downloaded October bundle; the default SQLite limits above remain unchanged:

```sh
pnpm --silent dataset:readiness \
  --plan /ABSOLUTE/PRIVATE/readiness-plan.json \
  --output "$PWD/.local/month-readiness" --streaming --hourly
```

The streaming modes accept **one source table per run**, up to 4,096 files, 30 million physical rows, 16 GiB total compressed/decoded input, and two hours. The existing 64 MiB compressed/decoded per-file limits and exact private-file/projection/escaping checks apply. Mixed source tables are rejected; use the bounded SQLite path for small cross-table comparisons. No history/current observations are merged as payments.

`--hourly` requires `--streaming` and current/history composite keys; archive ID-only keys are rejected. Every complete valid source key in one file must share its literal requesttime hour. Hours across files must be nondecreasing; a closed hour cannot reappear, and no timestamp timezone is inferred. These checks establish that equal composite keys cannot cross hour partitions. The profiler therefore sorts full 68-byte key/ordinal/payload-SHA-256 records one hour at a time, compares exact duplicates/conflicts and deletes each hour's runs before continuing. Unsorted rows within an hour are supported. Invalid keys remain explicitly excluded. Mixed-hour files or reordered hours fail without a report. There are two full hash-verified source passes, including the final aggregation pass described below.

Hourly mode preflight reserves space for the larger of one 250,000-record key run or `physical_rows * 12` amount bytes, plus 1 GiB reserve and 64 MiB headroom. Actual per-hour key usage remains subject to the same disk/scratch checks, so an oversized hour fails safely rather than evicting evidence. The final amount spool for all 26,784,062 October rows is at most 321,408,744 bytes; this permits processing on the constrained Mac without a full-month key index or decompressing archives. Reports identify `capacity_mode: streaming_hourly_v1`.

Without `--hourly`, the general single-table streaming mode supports mixed-hour files and uses this whole-table algorithm:

There are two complete source passes when keys are unique, or three when repeated keys require payload comparison. The first validates fields, builds aggregate code/quality counts and writes sorted runs of fixed 36-byte table-scoped literal-key SHA-256 commitment and physical ordinal. Merging those runs identifies repeated keys and the first physical observation. If keys repeat, an extra verified source pass writes 68-byte key/ordinal/payload-SHA-256 records only for those occurrences, after all original key runs are deleted. Their merge distinguishes exact duplicates from conflicting revisions and excludes every occurrence of conflicting keys with bounded bitsets. Source-key equality in this mode depends on SHA-256 collision resistance; these commitments do not establish account or business-payment identity. No account or source-key text is written to scratch.

All key/conflict runs are deleted before the final pass, which verifies the full source bytes/hashes again and aggregates eligible rows. Fixed 12-byte records contain a report-local currency ID and an exact signed integer-cent amount. A final bounded external merge computes exact nearest-rank quantiles without floating point, rounding, sampling or approximate quantiles. All amount totals are arbitrary-precision integers, formatted as exact decimal strings. All input evidence must match between passes before any report is published.

At most 250,000 records are sorted in memory per run, with no merged disk copy. Scratch is capped at 2 GiB; preflight requires `physical_rows * 36 + 1 GiB reserve + 64 MiB headroom` free. The October bundle needs 964,226,232 bytes for key runs. A repeated-key phase separately requires `repeated_occurrences * 68` bytes plus the same reserve; a large conflict cohort can therefore require more space than the initial key phase and may fail safely. Each flush and periodic processing/merge checks enforce the scratch, time and 1 GiB free-space reserve. Exceeded limits or failed verification publish no report. The private `.month-stream-*/progress.json` under the output parent contains only phase/file/row/scratch counts; no source values or paths. Handled failure removes the temporary directory; forced process/machine death may retain private scratch for operator review. Source exports are never deleted.

The output retains the same exact summaries and 15-pattern readiness gates, with `capacity_mode: streaming_single_table_v1`, the actual verification-pass count and measured peak scratch bytes. A completed processing range is not proof of source historical completeness, verified lifecycle/identity, operational risk readiness or detection accuracy.

Reports include exact recorded-amount totals and nearest-rank min/p50/p90/p95/p99/max per table/currency, requested-month day/hour counts, before/after-month observations, anonymized source-code/channel/lifecycle groups and field quality. LAK/THB/USD/CNY/SYN are literal observed code labels, not verified units; others become report-local opaque codes. Code distributions count physical aligned rows; amount/day summaries use valid nonconflicting unique source keys. Empty days indicate no observed rows, not proven source gaps. Account values, per-row evidence, original paths and arbitrary raw codes are excluded. Aggregates and hashes remain private.

The JS wrapper binds the canonical 15-pattern catalog and lists candidate column coverage plus unresolved gates for every pattern. Amount scenarios use the explicit operator `OK`/`TRANSACTION_FAILED` test interpretation and raw recorded amounts. They create no Assessments/Alerts and certify no settlement/refund, account identity, fraud accuracy or production readiness. All target patterns stay blocked pending independently reviewed inputs and accepted integration. Accuracy remains null without representative reviewed labels and held-out evaluation.

Actual checks and pending data/source/download gates are recorded in `docs/implementation-status/current.md`. Local fixtures exercise real client subprocesses and gzip, calendar coverage, failure/timeout teardown, table projections, fake SSH copying with real local verification, exact profiling/dedup and canonical catalog binding. Fixture success is distinct from access to the actual LMPS environment.
