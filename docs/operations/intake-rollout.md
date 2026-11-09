# Intake integration and production transition

P03 continuation: the [automated test-batch runner](automated-intake.md) now composes verified files, existing staging/revision/job checkpoints, approved detection and exact currency reconciliation in a dedicated disposable test environment. Run `pnpm intake:automated-demo` from Core. It refuses the persistent Intake/original ports, creates no production policy and does not activate a watcher or live source. Existing real-file commands and their scope below remain separate. Changed stale observations are now checked before their source event is appended; retries retain committed evidence.

The user corrected the implementation on 2026-10-30: preserve the existing monitoring modules and risk pipeline; CSV is a temporary ingestion transport. The earlier generic `IntakeMonitoringPage` route override has been removed. The nine visible views use their existing components: Overview, Monitoring overview, Live Feed, Timeline & Patterns, Heatmap & Trends, Transactions, Alerts, Network / Flow, and Data & System Health. Commented sidebar pages remain deferred.

## Runtime and database

One source tree, separate owned storage. Intake Portal is `http://localhost:18443`, API/session are 18511/18517, PostgreSQL is `127.0.0.1:18513`, database `lmps_risk_local`, schema `platform`. Original Portal/API/PostgreSQL remain 8443/18501/18503. pgAdmin display names do not establish which instance a connection uses.

Private `.local/environments/intake/runtime.env` selects the Intake state, paired proxies, and `LMPS_READ_NAMESPACE=synthetic_csv`. That app read scope excludes the retained original demo transaction from the Intake monitoring views. It supplements authenticated workspace checks; it is not an independent tenancy boundary. Privileged services retain their existing permissions. Source-file publications retain `user_supplied_file` provenance; legacy test workspace/namespace names do not assert that source rows were invented.

Migration `0020_source_intake_publications` supports source-file provenance and scoped app reads without adding tables. It was applied only to Intake (21 ledger entries, 35 tables). The original instance retains its previous migration ledger and all 35 table fingerprints. Verified backups were made before and after; private evidence is `.local/environments/intake/csv-isolation.json`.

The shared source tree still serves both previews. Intake is the tested API instance for the new migration; no original API restart or original-database migration was performed.

## Import another CSV

Use the exporter’s **six-column transfer import file**, with header `id,requesttime,amount,ccy,result,txtime`. A review CSV with extra fields is not the import contract. From `financial-crime-platform`:

```sh
pnpm intake:csv --input "/absolute/path/transfer-0000.csv"
```

To import staging and transaction revisions without configuring policies or dispatching risk evaluation, use:

    pnpm intake:csv --input "/absolute/path/transfer-0000.csv" --publish-only

This mode reports risk_dispatch=not_requested and skips manual policy/evaluation calls from this command. It uses the same deterministic file receipt and deduplication as the regular command. A separately running automatic Intake worker can still discover and assess newly published revisions under an existing binding.

This builds the worker and executes the private Intake profile. It refuses other runtime profiles, symlinks, files not owned by the local operator, and files above 64 MiB/100,000 rows. Files and receipts are retained privately under `.local/intake-csv/<sha256>/`; console output contains counts and test metadata, not source rows or credentials.

Steps use the existing modules: verified offline staging → source records/events → transaction revisions → approved policy binding → risk jobs/worker → frozen risk/Alert evidence → existing monitoring reads. The original two Portal amount rules also run through the existing stateless assessment module. CLI receipts distinguish publication and worker counts; Health shows actual queue and missing prerequisites. Committed rows survive a later step failing; exact reruns resume/deduplicate them. This is not an all-file rollback transaction.

Identity is the configured source namespace plus the composite `(id, requesttime)` key. Unchanged values do not append revisions. Changed values append a new revision; old snapshots and evidence stay frozen. Re-importing the delivered file produced 222 duplicates and zero new revisions. Known earlier observation receipts cannot overwrite later changed revisions. First-seen file receipt time is not proof of source ordering; use ordered exports and reconciliation. A future synchronizer still needs a source checkpoint and ordering contract.

## Confirmed test mapping and policies

The user explicitly confirmed `OK → succeeded`, `TRANSACTION_FAILED → failed` for Intake testing. Other statuses remain unknown. Amount and currency stay as recorded, with no FX conversion. Raw source timestamps stay in evidence; payment occurrence time/timezone and stable account identities remain unverified. No account edges are fabricated.

The existing Portal approved binding is `POL-SYN-03 v3`, LAK: Fraud amount ≥ 1,000,000.00; AML amount ≥ 200,000.00; completed lifecycle. Its policy hash is checked before use. The original two amount rules are evaluated unchanged in `local_assessment_runs` (`intake_stateless_backtest`). The CLI copies this configuration only into the owned test environment using the existing policy command lifecycle and distinct test author/checker identities. This is not production approval.

For the original 15-pattern risk module, Fraud amount maps to `FRAUD_HIGH_AMOUNT`. Other pattern settings are retained from the existing backend test policy. The Portal single-payment AML amount rule is **not** relabelled as the account/history-dependent AML patterns. Its separate amount-rule matches are not included in the 19 operational Alerts. Context-dependent patterns remain unavailable when their prerequisites are missing.

Current delivered cohort: 222 transactions (LAK 215, THB 7); 215 LAK assessments completed, including one failed-payment `not_applicable` assessment; 19 `FRAUD_HIGH_AMOUNT` Alerts. THB is imported and offered in filters, but its seven transactions wait for a THB policy. LAK thresholds are not copied to THB. Currency suggestions come from latest scoped database rows; money formatting groups decimal strings, e.g. `100,000.00 LAK`, without rounding or changing stored amounts.

## Inspection and acceptance

In pgAdmin connect to **port 18513**, then inspect:

- `platform.offline_dataset_batches` / `offline_dataset_rows`: private staging.
- `platform.source_records` / `source_events`: source evidence, `source_namespace='synthetic_csv'`.
- `platform.local_transaction_revisions`: imported transaction versions, `namespace='synthetic_csv'`.
- `platform.local_risk_jobs` / `local_transaction_risks` / `local_alerts`: original detection execution and frozen outcomes.
- `platform.local_assessment_runs`: original Portal amount-rule evaluations.
- `platform.local_risk_policy_versions` / `local_risk_policy_bindings`: test policy lifecycle/binding.

Do not grant broad table writes to the Portal reader to bypass an inspection error. Existing service roles retain separate responsibilities. Passwords remain in the private state file and are never included in documentation.

`test/intake-original-modules-native.mjs` in the Portal exercises the delivered sample through the original screens and drilldowns. Its private report/screenshots are under `.local/environments/intake/original-module-browser/`. Older `intake-sidebar-native.mjs` / generic-view acceptance belongs to the superseded presentation and is not evidence for this implementation. Native pipeline tests additionally exercise duplicates, correction revisions, stale observations, provenance tampering, unchanged snapshots, policy lifecycle, actual Alerts, amount-rule evaluation, and missing THB policy.

## Transition to production sync

Keep one codebase and the same source identity/publication boundary when changing transport. A production profile is still deliberately rejected by this local test bootstrap. Real sync cursor/checkpoints, source reconciliation/order, verified lifecycle/amount/time semantics, account identity, approved per-currency policy configuration, production auth/secrets/TLS and operational acceptance remain required. File/sync hash parity alone does not implement a sync worker.

Before switching writers, reconcile the same cohort, prove duplicate/correction/restart behavior, back up the target, and retain the source checkpoint. Stop the prior writer before starting the new transport. Rollback uses the previous compatible configuration/checkpoint and backup. Do not run two unproven writers against the same identity stream.

## Additional CSV sample — 2026-11-04

Imported the verified 201-row sample into the existing Intake staging and transaction namespace with --publish-only. All 201 were inserted; an exact rerun returned 201 duplicates and no new revisions. Exact row projections and amount totals were checked against the file. Intake now has 423 scoped transactions, including the earlier 222. New rows: 198 LAK and 3 THB, 199 succeeded under the existing test mapping and 2 unknown. The pre-existing automatic Intake worker subsequently assessed 198 new LAK rows (197 partial and 1 unavailable) and created 14 test Alerts. Policy, case and review fingerprints remained unchanged. Both original and Intake received verified backups; the original retained all 35 table fingerprints.

The user confirmed requesttime and txtime use Vientiane UTC+7, and explained OK plus shouldrevert=0 as the normal case and non-OK plus shouldrevert=1 as unsuccessful and requiring refund. This is operator-provided semantics; field-specific event meanings, refund completion, non-OK plus 0/null and OK plus 1 remain unresolved. The six-column import does not include shouldrevert, so applying the newly declared joint rule requires a separately versioned mapping bound to rich review evidence. This import retains the existing test mapping and null occurred_at; the two unknown rows were not reclassified from result alone.

The repository had been moved from financial-crime-platform to Core_LMPS_Risk while local PostgreSQL processes still used the former absolute path. Restored a compatibility symlink for those running processes and repaired only the Intake private state/runtime path after verifying the cluster system identifier. The original private state file was not rewritten. Private import and isolation receipts are under .local/environments/intake/.

## Unknown-result monitoring compatibility repair — 2026-11-04

An unnormalized source-file risk observation may pin the legacy reader envelope hash (local_synthetic) even though the revision validator upgrades that envelope from its verified source-file publication to user_supplied_file. Comparing that legacy observation hash only with the upgraded revision hash caused MONITORING_UNAVAILABLE across the full scope. The shared observationMatchesRevision check now accepts the canonical hash or the exact legacy not_normalized file observation reconstructed from the same verified revision. Available observations and mismatched content remain subject to the original strict hash checks. Monitoring, Timeline and Detection Health use this shared check. Frozen source/risk evidence is not rewritten.

Reloading the Intake API also exposed the pending existing 0021_local_core_detection migration. Verified a 35-table backup before applying that single migration to Intake only, then restarted the API/session companion. Intake has 38 tables; the three added core tables are empty. Existing business-table fingerprints and all 35 original-environment table fingerprints remained unchanged. Private migration/isolation receipts are under .local/environments/intake/.

Browser reads passed on Network / Flow and Overview, Live Feed, Trends, Timeline and Health. Network snapshot and graph returned 200 with 423 scoped transactions, all unresolved identity and no inferred account edges. Targeted regressions passed 28 checks: five risk-driver tests, one disposable PostgreSQL unknown-file scenario covering Monitoring/Timeline/Health, and 22 Portal client/contract regressions. Database build passed; full regression was not rerun.
