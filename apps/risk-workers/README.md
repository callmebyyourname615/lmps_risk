# Local snapshot importer — item 11

## Offline CSV readiness — No.35.1

`pnpm --silent dataset:profile --table transfer --input /absolute/private/transfer.csv --output-dir /absolute/private/new-bundle` runs the separate Python-standard-library file profiler without databases or a Node build. It accepts only the selected export columns, caps64MiB/100,000 records, counts invalid/duplicate/conflicting keys and publishes private deterministic report/mapping files without raw row/code values. Parent directories and input require owner-private permissions; exit0=valid shape,2=needs review,1=rejected/failure. Shape validity never approves source semantics or Risk readiness. Use --silent to prevent pnpm argument echo. [Export format, fields, replay and limits](../../docs/data-dictionary/offline-dataset-profile.md). Test with `pnpm test:dataset-profile`; root verification includes it. Import/replay are separate commands below.

## Offline Risk Replay MVP — No.35.3

`pnpm --silent dataset:replay --manifest /absolute/private/replay.json --output /absolute/private/replay-reports` verifies a complete reconciled staging batch under a read-only snapshot and screens raw amounts using explicit simulation thresholds for exact source currency codes. Private JSON/CSV include per-row reasons and batch/row references; missing currency policy/member amounts yield unavailable, not negative findings. Repeating an identical run compares both reports; changed/partial output is never overwritten. Exit0=complete,2=partial published,1=rejected/failure. No schema/dependency/Alert/payment action is added. [Input, reports, CSV literals, limits and runtime prerequisites](../../docs/data-dictionary/offline-risk-replay.md).

## Offline dataset import/reconciliation — No.35.2

Use `pnpm --silent dataset:import --manifest /absolute/private/import.json --input /absolute/private/transfer.csv`, `dataset:status --workspace offline_local --batch <canonical-UUID>` and `dataset:reconcile --manifest ... --input ...`. The existing Python CSV validator checks the complete file, then sends validated rows over an internal pipe; the TypeScript worker verifies the snapshot again before opening the local intake DB. Additive0012 stores two restricted offline staging tables,500-row atomic checkpoints and exact reconciliation. Rerun the same file/manifest after interruption; canonical UUID aliases deduplicate. Complete replay still verifies target rows. Raw values/hashes/paths stay out of Node output and app/API roles cannot read staging. No synthetic provenance is changed, no Risk/canonical publication runs, and no project migration/seed is performed. [Full manifest/CLI/recovery/permissions/backup contract](../../docs/data-dictionary/offline-dataset-import.md).

## Existing synthetic database snapshot workflow — details

One-shot TypeScript CLI: **owned synthetic MariaDB → frozen private snapshot → PostgreSQL source intake**. Uses the existing mariadb3.5.4 and database package; no additional library, HTTP server, daemon, Kafka or production connector. Canonical payment/account mapping and continuous capture remain pending.

Run from the repository root after the [local MariaDB setup](../../infrastructure/mariadb/README.md) and [PostgreSQL setup](../../infrastructure/postgres/README.md):

```sh
pnpm source:start
pnpm source:seed
pnpm db:start
pnpm db:prepare-intake
pnpm db:migrate
pnpm source:snapshot
```

The last command prints a generated `capture_id` and row count, without credentials or row contents. Copy that ID into the next command:

```sh
pnpm source:import <capture_id>
pnpm source:import <capture_id>
pnpm source:stop
```

Replace `<capture_id>` with the actual UUID, without angle brackets. The first import inserts seven fixture events; replay of the **same capture** reports seven duplicates. Existing No.10 demo rows remain separate. PostgreSQL stays running for pgAdmin; `lmps_app` can SELECT `platform.source_records` and `platform.source_events`. Never print/copy the private local state or spool into Git/chat.

## Capture boundary and source load

- Source access is fixed to loopback, owned `lmps_source_local`, MariaDB11.8, verified TLS1.2+ and the distinct `lmps_snapshot` user. The CLI builds configuration from the existing private owned-server state. Remote/production configuration is rejected.
- The seed command verifies the owned server using its administrative socket, creates a separate REQUIRE SSL reader and inserts only seven invented rows. Repeated matching seed is unchanged; altered/populated fixture rows are rejected, never overwritten. It does not copy or read a real dataset. Reader provisioning uses local administration; normal capture never receives admin credentials.
- Reader grants are column-level SELECT only: transfer/hist `id,requesttime,amount,ccy,result,txtime`; old `id,amount,ccy,result,txtime`; member `code,status,member_type`. Account columns, reference/member IIN and unrelated source fields are excluded. The preflight user/tool remains unchanged.
- One connection, REPEATABLE READ, `WITH CONSISTENT SNAPSHOT, READ ONLY`; all four tables must be InnoDB. SQL is allowlisted, ordered by original typed primary keys with keyset predicates, 25 rows/page. Limit is **100 rows/table**, 400 total, 2MiB spool. An additional nonempty page beyond the cap fails the whole capture; it never silently truncates. No OFFSET, source COUNT or new source index is used by capture. Seed's count checks apply only to the tiny local fixture.
- Connect timeout1s, socket1.5s, query timeout800ms, capture watchdog10s after connection, 10ms pause between full pages. No PostgreSQL call occurs during source capture; target slowness cannot extend the source transaction. A failed capture destroys its connection and returns no usable partial snapshot. The watchdog also bounds a query that ignores the driver timeout; connection setup has its separate timeout.
- End-of-capture engine verification runs after the four table reads while their transaction metadata locks are held, rejecting nontransactional engines before publication. Snapshot consistency is tested against concurrent inserts/cross-table updates. This transaction still consumes resources and holds metadata locks; these limits do **not** demonstrate acceptable impact on the real replica.

## Identity, durability and retry

The owned local source receives a persisted random `source_generation` when the reader is first prepared. Each **new capture** gets a new random `capture_epoch/capture_id`. All events use `workspace_key=synthetic_local`, `source_namespace=synthetic_snapshot`, operation `snapshot`, mode `test`; event keys are table + ordinal within that frozen capture. Complete source PKs identify source records; equal keys across current/history tables are separate. No cross-history business deduplication or account resolution is inferred.

Amounts stay decimal strings, raw currency/result values are preserved and DATETIME values stay naive strings. `observed_at` is the capture observation time, identical on retries; it does not establish when each historical field was originally available. No currency, timezone or status codebook is invented.

After the entire source snapshot is captured, the CLI writes `.local/snapshots/<capture_id>/pending.json` with exclusive creation,0600 file/0700 directories, fsync, then atomically renames it to `snapshot.json` and fsyncs its directory. Only a completed `snapshot.json` may be imported. Directory and file ownership/permissions, symlinks, hardlinks, size, capture-ID and envelope scope are checked on reads. New captures never overwrite an earlier directory. Interrupted unpublished `pending.json` files remain private and unusable; review/remove those abandoned directories manually after confirming no importer is running. Deleting a spool loses that capture's replay source. The owner can edit/delete local files: this is not tamper-proof/WORM storage or a signed production manifest.

The importer reads and validates the whole bounded snapshot before writing, then uses the [existing atomic per-event intake](../../docs/data-dictionary/local-source-intake.md). Each event transaction commits independently; an import is **not** one cross-database transaction. It stops at the first conflict/storage failure and reports `inserted`, `duplicate`, `conflict`, `failed`, `unattempted` counts. Earlier committed events remain. Retry the same capture from its beginning: committed events deduplicate and remaining events can finish, even with MariaDB offline. No retry generates a new observation time or event identity.

A new capture is a new observation, so unchanged rows create new events linked to the existing source records. It is not a continuation/resume of a lost source snapshot, a delete detector or a live current-state projection. No broker offset/ACK, CDC checkpoint, snapshot-to-binlog handoff, ordering against future updates or source-load monitoring is implemented.

## Verification and exit codes

```sh
pnpm test:snapshot
pnpm verify
pnpm verify:fresh
```

Tests create isolated disposable native MariaDB and PG clusters. They cover exact decimal/naive time/full keys; selected-column/TLS permissions; multi-page ordering; concurrent source changes; row caps/unsupported engines; failed capture; private spool protections; target outage, partial commit/replay and conflicts; driver options and total watchdog. Root verification discovers this workspace automatically; fresh runs need only binaries/caches, never persistent source/spool credentials.

CLI exit0 = capture published/import complete; exit2 = import stopped on storage failure/conflict; exit1 = configuration/capture/spool/usage failure. Public output contains only local provenance/mode, capture UUID, bounded counts/status and fixed redacted errors. No automatic retry loop, HTTP service, production readiness or throughput SLA is claimed. API/ML readiness stays503; all real-source/identity gates remain unverified.

References: [MariaDB transactions, consistent snapshots and metadata locks](https://mariadb.com/docs/server/reference/sql-statements/transactions/start-transaction), [Node connector options and type handling](https://mariadb.com/docs/connectors/mariadb-connector-nodejs/node-js-connection-options).

## Reconciliation — item12

Run `pnpm source:reconcile <capture_id>` with an existing private capture UUID. The app-role reader executes one bounded MVCC statement on PostgreSQL; MariaDB is not reopened. Exact identity/evidence comparison includes complete source keys, table/generation, fields, schema/mode/provenance and microsecond-precise stored timestamps. JSON property order is irrelevant; decimal strings are compared exactly. Reports contain counts only, split by table: matched, missing, mismatched and unexpected. A mismatch is attributed to its expected table, while observed counts use its actual table.

PASS requires every expected event to match and no unexpected events in the same fixed synthetic workspace/namespace/capture, including unexpected generations. FAIL means a proven discrepancy (exit2). UNAVAILABLE/unknown counts on a storage failure or LIMIT_EXCEEDED on more than400 target events means verification is incomplete (exit1); truncated results never claim exact totals. PASS exits0. Invalid input/spool/configuration exits1 with a fixed redacted error. An empty capture passes only against an empty target scope. A partially committed import correctly reports missing events until replay finishes.

This is a comparison against one owner-editable frozen local snapshot, not proof of real-source completeness, business-payment uniqueness, settlement balances, CDC cutover, account identity or continuous-sync correctness. Concurrent target commits may change a later run; each run observes its own statement snapshot. There is no new table/migration, raw source reread, persistent report or source-impact claim. Tests run in the existing worker suite using a disposable PG cluster.

## Local transactional fake outbox — item14

Run `pnpm db:prepare-outbox`, `pnpm db:migrate`, then `pnpm outbox:demo` from the root. Existing private credentials and source evidence are preserved; the owned PG HBA is reloaded, not restarted. Fresh native clusters provision the role automatically. The demo persists one private stable semantic request under ignored `.local/outbox-demo.json`, enqueues it, and processes at most25 due intents from synthetic_local through a fake acceptance path with no network. Repeat returns duplicate and does not create another intent. The same fixture may already be accepted or expired. It cannot contain account fields, real provider/device/recipient or live execution mode.

Migration0003 adds local_outbox_intents/local_outbox_attempts only. Provider=fake and execution_mode=test are DB constraints. The distinct lmps_outbox role has selected-column INSERT/UPDATE and SELECT; it cannot modify payload/semantic key/provider/generated metadata, delete evidence, touch source/migration tables, create objects or escalate roles. lmps_app can SELECT for local inspection only. This is a trusted internal worker role; its permitted state/outcome columns are mutable through SQL. It is not adversarial worker isolation, tenant RLS or WORM audit evidence.

Enqueue is scoped by workspace+semantic_key and compares notification UUID/expiry exactly on a retry. Changed content conflicts. `enqueueLocalIntent(client,input)` supports a caller-owned READ COMMITTED transaction with a domain write; the caller must BEGIN/COMMIT/ROLLBACK. Standalone queue.enqueue owns that transaction itself. Domain+intent rollback is tested with a synthetic domain probe, not an actual alert/case integration.

Claim uses an atomic SQL statement with row locking/SKIP LOCKED, rotating UUID lease token,5-second lease and an unknown attempt row. Other workers can claim unlocked work. Finish uses workspace, intent, notification, attempt number, current token and unexpired lease/intent as a fence; intent status and attempt result commit together. Stale/duplicate acknowledgements cannot complete a new lease. Retry uses1–2,2–3 second exponential backoff+jitter before attempts2/3, at most3 attempts, then dead. Expired intent/permanent error is terminal. Unknown attempts survive crashes; a reclaimed lease creates a new attempt and preserves the uncertain previous outcome. No heartbeat/long provider call is supported by this5-second local lease.

An acceptance means **the fake adapter accepted**, never device delivery/open/user acknowledgement. A crash after real provider acceptance and before persistence could still cause duplicate external delivery in a future integration; this local demo does not claim exactly-once push. Actual alert+outbox creation, recipient reauthorization/revocation, real provider deadlines/idempotency, sandbox devices, inbox/ack/escalation, distributed tracing and production retention/DR remain pending. S06/P02-06 have only a local primitive (PARTIAL), not complete business notification delivery.

Native tests cover dedup/conflict, domain transaction rollback, concurrent claims/SKIP LOCKED, lease fencing/recovery, retry/expiry/permanent failure, atomic attempt failures, grants and restart/redaction. They use isolated clusters and never send messages. See [PostgreSQL row-locking reference](https://www.postgresql.org/docs/18/sql-select.html) and [data-modifying CTE semantics](https://www.postgresql.org/docs/18/queries-with.html).


## Audit coupling — item17

Migration0004 adds protected PostgreSQL triggers on the existing fake outbox tables. Existing enqueue/claim/finish callers need no extra callback: their committed state and audit share a transaction, including caller-owned enqueue transactions and the claim CTE. Audit write failure rolls back the state change and becomes the existing redacted STORAGE_FAILED. Exact duplicate/no-op/stale requests do not create successful transition evidence. Unknown attempts after a crash remain unknown; fake acceptance remains distinct from device delivery.

[Audit contract and limitations](../../docs/architecture/adr/0002-local-outbox-audit.md) explain database-role actors, intent correlation, no backfill and privileged-owner limits. No worker daemon, real provider or new dependency is added.


## Tracked import jobs — item18

`pnpm source:import <capture_id>` now registers a frozen-snapshot fingerprint, claims a leased job, imports through atomic event+checkpoint transactions and runs exact reconciliation before reporting reconciled. CLI output is now fixed status/job/capture/attempt references; detailed committed counts and attempt history are persisted in PG. Exit0 means reconciled/already_reconciled, exit2 means busy/stale/unavailable/failed/needs_review, exit1 means invalid configuration/input or changed frozen evidence. The No.11 count-based report above describes the retained lower-level reference primitive, not the current tracked CLI output.

Retry uses the same published spool from its beginning without MariaDB access. Prior committed events deduplicate; new attempts retain separate counters, while expired prior owners are fenced. Import completion and reconciliation success are distinct. At most32 attempts/job and a10-second renewed lease apply to this bounded local tool. An already_reconciled result is historical, not a fresh check. The separate source:reconcile diagnostic remains read-only and does not update job history.

See [full lifecycle, SQL fencing, audit/API and limits](../../docs/architecture/adr/0003-local-sync-jobs.md). No scheduler/daemon, production CDC checkpoint, raw payload log or new library is introduced.


## Offline data quality profile — item19

Run `pnpm source:profile <capture_id>` to describe an existing private snapshot without any MariaDB/PG connection, credentials, job registration or target reconciliation. It preserves exact BigInt amount aggregates by table/raw currency, raw code/null/empty/distinct counts and naive calendar ranges. Unknown source completeness/timezone/business/account gates remain explicit. This is a descriptive profile, not a quality PASS or whole-source/payments total.

Full payload stays at `.local/profiles/v1/<capture_id>/profile.json` with0700 directories/0600 file. Stdout contains only local mode/status/capture/count; exit0=profiled/identical duplicate, exit1=fixed failure. Replay never overwrites changed evidence or partial files. [Contract, privacy, arithmetic and publication limits](../../docs/data-dictionary/snapshot-profile.md). Existing400-row/2MiB snapshot and new1MiB report bounds apply; no new dependency/migration/service is introduced.

## Synthetic normalizer — No.25.2

normalizeSynthetic(input), exported from src/normalization.ts (compiled dist/normalization.js), classifies a separate versioned local synthetic envelope as known/unknown/invalid with fixed reasons, codebook/source lineage, detached raw input and explicit naive-time uncertainty. Lookup never creates a payment candidate; completed reversal requires linked, confirmed, same-currency, exactly bounded cumulative evidence. Identical event repeats are deduplicated only within the supplied original-payment envelope; conflicting reuse rejects the candidate. No counters or persistent cross-call state are created.

Build with pnpm --filter @lmps/risk-workers build. Focused test: pnpm --filter @lmps/risk-workers exec node --test test/normalization.test.mjs. Recursive verification includes these tests. [Input/output, money/time, context, evidence and privacy rules](../../docs/data-dictionary/synthetic-normalizer.md). No.25.3 below now calls it from a private offline report pipeline; no importer/business API or DB/network call is added. Existing snapshot schemas, grants, spools/import jobs and real-source settings are not changed. All actual source/identity gates and production readiness stay pending.

## Offline snapshot normalization — No.25.3

Run pnpm source:normalize <capture_id>. It reads the frozen private snapshot and optional .local/normalization-evidence/v1/<capture_id>/evidence.json, whose synthetic semantics must match the exact capture/source fingerprint. Missing evidence stays unknown; member records cannot become payments. Source amount/currency/time/key overrides and repeated/unknown targets are rejected before publication. Existing spools/column grants/import jobs and databases are not changed. This command calls no source/PG/network service.

The private immutable report is .local/normalization/v1/<capture_id>/normalization.json. Stdout is status/capture/evidence-status/counts only. Exit0=published/duplicate without invalid rows (unknown may exist), exit2=published/duplicate with invalid rows, exit1=rejected. A retry never adds state or overwrites source/evidence/prior output. Evidence/report files are outside PG backups. Full [binding, input/output, private publication and replay limits](../../docs/data-dictionary/synthetic-normalization-pipeline.md) apply; canonical_emission stays false and counts are observations, not business payments or quality PASS.

Tests use frozen synthetic fixtures and private temporary files. The existing profiler and pipeline share the extracted private-json.mjs reader/publisher; profiler behavior is covered by its original tests. No dependency, migration, real-source mapping or risk engine is added.


## Publish normalized synthetic revisions — item28

After preparing the approved local runtime through migration0007, supply `.local/publication-bindings/v1/<capture_id>/publication.json` beside the existing private snapshot/semantic evidence. See [ADR-0007](../../docs/architecture/adr/0007-local-normalization-publication.md) for the exact manifest and limits. Binding IDs, revision ordinals and two-decimal raw→draft currency mapping must be explicit synthetic declarations.

```sh
pnpm source:publish <capture_id>
```

The worker recomputes normalization, withholds unknown/invalid/nonpayment/unbound observations, and preflights the whole manifest before PG access. Eligible revisions commit individually with evidence. Count-only output reports inserted/duplicate/withheld/conflict/failed/unattempted; exit0 means eligible work completed, exit2 partial/conflict/storage failure, exit1 rejected inputs. A fully withheld plan may return0; it is not source-quality PASS. On failure, retain the frozen input and retry unchanged after recovery. No raw-source intake, sync job, audit/outbox or external action is written.

Cross-row/capture replay relies on explicit matching revision semantics and preserves first-publication lineage. Later private capture artifacts are not appended to a database observation ledger. Unverified time/accounts/source semantics and canonical_emission=false remain explicit. API reads need transactions:read. No real-source mapping, continuous CDC or risk engine is added.


## Offline synthetic rules/backtest — item29

Supply a private `.local/rule-backtests/v1/<run_id>/input.json` with exact transaction revision ordinals and typed rules, then run:

```sh
pnpm rules:backtest <run_id>
```

The worker uses the app DSN and one scoped SELECT; no database rows or source/job/audit/outbox state are written. Known No.28 publication proof is required for eligible inputs. Reports are private, immutable and deterministic at `.local/rule-backtest-reports/v1/<run_id>/backtest.json`. Same run/input returns duplicate; changed inputs never overwrite an existing report. Missing/unknown/corrupt input is unavailable; currency/lifecycle outside scope is not_applicable. Storage outage publishes no fabricated input report.

[ADR-0008](../../docs/architecture/adr/0008-offline-synthetic-rule-baseline.md) documents the20-rule/100-target manifest, exact cents, separate fraud/AML signals, version/content hashes, fixed reasons, private file boundaries and exit codes0 complete/2 partial/1 failure. This is an offline synthetic prototype with no arbitrary code, account/window features, temporal accuracy, production activation or alert/enforcement effects. Private inputs/reports are outside PG backups. The project DB is not prepared or seeded by this implementation.

## Persist synthetic assessments — item30

`pnpm rules:assess <run_id>` reuses `.local/rule-backtests/v1/<run_id>/input.json`, the existing restricted typed evaluator and private file checks. It needs the existing intake role and a separately approved local database migration through0008. Rule registration plus the frozen assessment commit together. Same manifest/run UUID returns the original report even after source availability changes; use a new UUID for a new evaluation and a new rule version for changed content.

Stdout is count/status-only. Exit0=complete,2=partial,1=rejected/storage failure. No private report file is dual-written; PostgreSQL backup now includes assessments/rules. `rules:backtest` remains readonly with its earlier file-replay semantics. See [ADR-0009](../../docs/architecture/adr/0009-local-rule-assessments.md). Native/restore acceptance subsequently passed in the backend-first follow-up:50 focused native tests and fresh-source offline670 tests; see current implementation status. No project migration/seed is performed by implementation.

## Synthetic per-transaction risk — item31

`pnpm risk:assess <run_id>` reads `.local/transaction-risk-inputs/v1/<run_id>/input.json` and uses the private intake profile. Separately prepare the owned runtime through0009 before use. The manifest explicitly declares policy and optional synthetic history/identity context, bound to a pinned revision hash. [Full request/metrics](../../packages/risk/README.md), [storage/replay/API semantics](../../docs/architecture/adr/0010-bilingual-transaction-risk.md).

Source proof is recomputed before scoring. All15 detectors exist; missing identity/history/baseline/flags return unavailable instead of fabricated zero scores. One transaction stores a policy version and frozen per-target result. Same-run retry preserves the original evidence; new input/context/policy evaluation requires a new UUID. Same policy version with changed content conflicts. Stdout is status/count/code-only; full bilingual results require risk:read API scope. Exit0=complete/not-applicable,2=partial/unavailable/not-evaluated,1=rejected/storage. No project seed/migration, online scheduling or payment/push action is performed by implementation.

## No.32 — Private synthetic alert generation

`pnpm alerts:generate <assessment_run_id>` reads `.local/alert-inputs/v1/<assessment_run_id>/input.json` (private directories,0600 single-link regular file, maximum16KiB). An explicit versioned policy selects among all15 triggered detector codes using minimum finding severity and explicit partial inclusion. One stored grouped alert per assessment/policy is retry-safe; policy changes require new versions. Exit0 covers inserted/duplicate/skipped, exit1 invalid/private-file/storage failures; output is only status/reason/reference. This is explicitly invoked synthetic monitoring, not continuous ingestion orchestration or notification delivery. [Manifest and replay semantics](../../docs/architecture/adr/0011-local-alert-review.md).


## No.34 — Synthetic risk jobs

Use `pnpm risk:jobs enqueue <job_ref>` with an owned private `.local/risk-job-inputs/v1/<job_ref>/input.json` containing the strict RiskJobInput contract. Enqueue returns the canonical job_ref; keep it when another UUID deduplicates to an existing job. Input/context/policies and the explicit revision observation are frozen at enqueue, including missing inputs.

`pnpm risk:jobs run <canonical_job_ref>` runs one eligible attempt through Assessment then Alert. `retry` is an alias of run and does not bypass backoff/terminal status. `pnpm risk:jobs work 20` processes at most20 due jobs per invocation; a scheduler/operator must invoke it again for future retries. Stages commit evidence and checkpoints under the same valid lease. The8-attempt cap and10-second lease prevent unbounded retries/stale-worker writes. Idle is not proof of completion: inspect the job read API. No source polling/publisher hook or scheduler deployment is installed.

Requires a separately authorized/prepared synthetic-local database through0011. No project migration or seed is performed by implementation/tests. Exit0 covers accepted/duplicate enqueue or completed/idle work;2 covers a reported retry_wait/failed/stale/unavailable outcome;1 covers invalid input/configuration or an unrecorded failure. Output excludes manifest/context/credentials. [Input/API/recovery/backup contract and acceptance](../../docs/architecture/adr/0012-synthetic-risk-job-flow.md).

## No.36.1 — Approved policy enqueue

`pnpm risk:jobs enqueue-approved <job_ref>` reads the existing private input path with an envelope `{job,selection}`. The job has `risk_request.policy=null`; selection pins an explicit active approved policy version and expected binding generation. Enqueue freezes full policy/observation and its selection receipt atomically; existing workers/retry semantics remain unchanged. [Private manifest, alias/retry behavior and limits](../../docs/architecture/adr/0013-local-risk-policy-lifecycle.md#approved-job-path). This is opt-in and does not migrate the project database or schedule work.
