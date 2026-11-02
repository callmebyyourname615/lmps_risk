# Intake integration and production transition

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
