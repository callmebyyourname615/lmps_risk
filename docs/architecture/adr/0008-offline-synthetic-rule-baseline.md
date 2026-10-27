# ADR-0008 — Offline synthetic rule baseline

Status: IMPLEMENTED locally; final verification is tracked in [current status](../../implementation-status/current.md). Date: 2026-10-21. Owner: TBD.

## Why this follows No.28

No.28 supplies evidence-bound immutable synthetic revisions. No.29 uses those revisions to prove a small detection path before source/feature/stream inputs are ready. The phase plan explicitly allows offline P05 prototypes before P04; this does not waive P01/P03/P04 or production gates. P05/S11 become PARTIAL for this prototype only. No real source, account identity, velocity, graph, model accuracy, policy enforcement or production rule-management workflow is implied.

One existing worker command runs this path; no microservice, database migration, dependency, public API or runtime deployment is added.

## Restricted rule/input contract

`synthetic-rules-0.1.0-draft.1` accepts only `amount_gte` rules with explicit synthetic ID/version, fraud or AML dimension, draft three-letter currency, nonempty known-lifecycle scope and exact fixed-two-decimal threshold. Rule IDs are unique within a run. There are no expressions, scripts, arbitrary code, feature/window references or dynamic field paths. Unsupported kinds, unknown lifecycle, account/mule rules, extra fields, numeric amounts and non-JSON input reject before database access.

Rules compare original observed amount in the synthetic profile with BigInt cents. No rate/unit conversion or rounding occurs. Reversed observations use the original amount only when their lifecycle is explicitly selected; this is not net flow or transferred/reversed accumulation. Every match contains actual amount/currency/lifecycle, threshold/threshold currency, rule ID/version/content hash and a fixed reason. Fraud/AML signals remain separate; no scores/probabilities are averaged or fabricated.

The private manifest supplies at most20 rules and100 exact namespace/transaction/revision targets, with `workspace_key=synthetic_local`. Targets are explicit published ordinals, never mutable latest heads. Duplicate targets/rule IDs and scope/mode/version overrides reject. Amount strings and opaque IDs retain precision. The manifest is at most128 KiB; the observation set is at most8 MiB and output at most2 MiB.

```text
.local/rule-backtests/v1/<run_id>/input.json
.local/rule-backtest-reports/v1/<run_id>/backtest.json
```

Example input (the run UUID and revision target are invented and must match the prepared local fixture):

```json
{
  "format": 1,
  "provenance": "local_synthetic",
  "execution_mode": "test",
  "evaluator_version": "synthetic-rules-0.1.0-draft.1",
  "run_id": "11111111-1111-4111-8111-111111111111",
  "workspace_key": "synthetic_local",
  "rules": [{
    "rule_id": "synthetic_large_amount",
    "rule_version": "synthetic_v1",
    "risk_dimension": "fraud",
    "kind": "amount_gte",
    "currency": "SYN",
    "statuses": ["succeeded"],
    "threshold": "40.00"
  }],
  "targets": [{
    "namespace": "synthetic_snapshot",
    "transaction_id": "synthetic_payment_001",
    "revision_number": 1
  }]
}
```

```sh
pnpm rules:backtest <run_id>
```

## Read consistency and outcomes

The existing local app DSN is required. A single parameterized SELECT joins the bounded explicit target list to PostgreSQL revisions under the fixed local workspace. It uses one statement snapshot and reads no latest head, source table, account graph or external service. The app role remains readonly for these tables. The repository's full payload/proof validator recomputes No.28 normalization before an observation is eligible.

| Result | Meaning |
| --- | --- |
| match | Eligible synthetic observation meets this explicit threshold; a signal only |
| no_match | Eligible observation is below this rule's threshold; not a legitimate label |
| not_applicable | Currency or lifecycle is outside this rule's scope; no risk decision |
| unavailable | Missing, corrupt or legacy unknown/non-normalized observation; never a zero/negative signal |

Missing target and legacy/corrupt inputs remain distinct fixed reasons. Raw corrupt payloads are withheld; only a content fingerprint is retained. Storage failure rejects the run and publishes no invented missing-input report. A report is partial when inputs are unavailable; a complete report can still have only not_applicable results. Counts are selected revision observations and per-rule signals, not unique payments, alerts, confirmed crime or source completeness.

The local CLI manifest is a synthetic tool input, not corporate authorization. Workspace overrides reject; foreign workspace rows cannot satisfy a target. Real institution/IdP entitlements remain pending.

## Immutable, deterministic reports

Reports retain normalized rule definitions, per-rule hashes, evaluator/normalizer/codebook versions, manifest/input-set hashes and scoped per-input hashes plus first-publication lineage. Rules/statuses/targets normalize ordering; wall clock and random IDs are not generated by evaluation. Same frozen inputs and run ID yield identical reports. The explicit run UUID is supplied by the manifest/file path.

Existing private JSON publication enforces owned private directories/files, no symlinks/hardlinks/FIFO, bounded reads, exclusive publication/fsync, no overwrite and partial-output rejection. Identical rerun returns duplicate. Changed rules or source content under the same run UUID conflicts with the prior immutable report; use a new run UUID for changed inputs. Concurrent/partial-file behavior is inherited from the tested shared publisher. PostgreSQL row tampering by a privileged owner changes the input hash or availability and cannot silently replace a prior report.

Rule ID/version alone is not a deployed registry. The content hash is authoritative for this prototype; a separate run may use a changed definition under a reused label and will have a distinct hash. Draft/approval/effective date/activation/rollback governance remains unimplemented. No append-only published rule/assessment database is claimed.

The purpose is `synthetic_stateless_backtest`, with `canonical_emission=false`, `enforcement=false`, `source_semantics=unverified` and `historical_availability=unverified`. A final-state snapshot does not reconstruct past feature availability. This is not a temporal backtest, supervised evaluation or measured detection accuracy. No labels, precision/recall, real thresholds or account capabilities are inferred.

CLI stdout contains local context, run ID, evaluated/duplicate status, complete/partial status and counts only. Full reasons/evidence stay in the private report. Exit0 is complete evaluation, exit2 a partial report, exit1 rejected input/storage/report publication. Zero matches is not a low-risk verdict. Existing API/ML readiness remains503.

## Verification and boundaries

Focused tests cover exact threshold/large-money boundaries, separate dimensions, missing/unknown/invalid/out-of-scope outcomes, no executable DSL, bounded20×100 evaluation, deterministic replay, source version/hash changes and reversed-observation semantics. Native tests compare PG results with the pure reference, preserve pinned old revisions after new publications, enforce local workspace/readonly app DSN, withhold corrupt proof, verify private immutable report replay and exercise database outage/recovery and production/live rejection.

Tests create disposable clusters only and do not apply migrations, seed source data or start services in the project runtime. No source/revision/job/audit/outbox writes or alert/payment/push effects occur during a backtest. Current project PG still needs separately approved preparation through No.28 migration0007 before using these commands. Private rule inputs/reports are outside PostgreSQL backup scope.

Final test counts, security checks and Markdown link checks are recorded in [implementation status](../../implementation-status/current.md). Remaining P05 work includes feature-dependent rules, published versions/assessment storage, alert policies/grouping, online orchestration, anomaly/graph and reviewed policies. Source/Ubuntu/hosted/capacity/legal/owner gates remain open.

References: [No.28 publication](0007-local-normalization-publication.md), [phase dependency allowance](../../../../plan/03-implementation-phases.md), [next implementation steps](../../../../plan/10-next-implementation-steps.md).

Follow-up: [No.30 MVP](0009-local-rule-assessments.md) adds a separate `rules:assess` persistence path and scoped reads with native acceptance pending. The readonly backtest behavior documented here is preserved; its worker evaluator module now re-exports the shared database-package implementation.
