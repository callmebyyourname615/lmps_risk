# Six-column Intake source contract

## Current published revision audit

Run `pnpm intake:inspect` from Core to build the existing worker and inspect the owned local Intake database using its private runtime environment. This is a read-only command, not source synchronization or policy activation. It requires the Intake profile/port 18513, verifies cluster ownership, then uses the app reader scoped to `synthetic_csv` in a READ ONLY REPEATABLE READ transaction. Arguments, alternate profiles and production mode are refused. Fixed diagnostics exclude source values and credentials.

The new `analyzeIntakeRevisionHistory` worker function verifies every supplied stored payload/publication with the shared transaction/source contracts, checks scope, contiguous revision numbers and uniqueness, and reconstructs each v2 publication against its actual predecessor commitments. It counts only the latest source observation per composite key. Hashes bind local stored evidence, not source-owner authority or historical completeness. A bound rich review row is not independently authenticated by this audit.

The command reads at most 10,000 revisions and 64 MiB of serialized evidence. Database metadata is checked before fetching payloads, a bounded query detects overlarge reads, and the detached JSON boundary rejects accessors/proxies, sparse arrays and oversize records. Exceeding a limit or encountering corrupt/missing evidence rejects the entire report. Rollback failure discards the connection. A concurrent append is excluded from the original repeatable-read report and appears on the next audit.

Output contains aggregate currency/lifecycle/mapping/refund-instruction and unresolved-account-slot counts plus a canonical evidence hash. It excludes transaction IDs, source result strings, account values, amounts and source clocks. Source observations do not establish unique business-payment identity. Account identity, payment time, source-history coverage and refund completion remain unverified; the command never invokes a tokenizer, evaluates risk or grants source-connection/production authority. A v1 publication has no joint `shouldrevert` evidence, so its refund instruction remains unknown even when its lifecycle is succeeded/failed. It is not classified as refund-completed or refund-not-required.

Actual scoped read on 2026-11-04: 423 source observations / 427 stored revisions; four revised observations; latest mappings are 419 v1 and four v2. LAK: 413 observations (411 succeeded, two failed); THB: ten (seven succeeded, one failed, two unknown). Two v2 refund instructions are required; the other 421 instructions remain unknown. All 423 sender slots and 423 receiver slots are unresolved. These counts cover both imported cohorts, not just the bound 201-row sample or all database namespaces. No import, migration, policy/job/assessment/Alert write or source connection was performed.

The older staging audit below intentionally remains a six-column v1 capability analysis. It describes a staged batch, not the effective latest status after a later v2 interpretation. Use the published revision audit for the latter.

The six-column `transfer` import (`id,requesttime,amount,ccy,result,txtime`) has a different evidence boundary from the older22-field [source-semantics workflow](source-semantics.md). Neither workflow verifies real account identity or source-owner semantics.

`@lmps/contracts/intake-source-contract` exports `intakeSourceFacts(values)`. The existing source publisher now calls this shared contract. It preserves literal decimal amounts and uppercase currency codes, maps exactly `OK → succeeded` and `TRANSACTION_FAILED → failed` under the user-confirmed `operator_intake_test_ok_failed_v1` mapping, and leaves all other results unknown. It rejects negative amounts, unsupported currency representations, malformed six-column rows and production mode. It never assigns payment occurrence time or account identity. These are Intake test interpretations, not an owner-approved lifecycle/reversal/settlement codebook.

`apps/risk-workers/src/intake-source-contract.ts` exports `analyzeIntakeSourceContract(rows, policy = null)`. Policy validation reuses the existing risk-policy validator; requirements come from the existing15-pattern risk catalog. This is a capability audit, not a new detector or a policy activation command. Every pattern partitions the cohort into:

| Count | Meaning |
| --- | --- |
| `eligible_for_test` | Valid succeeded, positive recorded amount; enabled rule and matching test currency. Only High Amount can reach this state with six-column evidence. |
| `waiting_policy` | No supplied policy for this currency. No fallback or FX conversion. |
| `disabled` | Matching currency policy disables this rule. |
| `unavailable` | Unknown lifecycle or required context is absent. |
| `not_applicable` | Failed payment or zero executed amount in this test profile. |

Currency policy absence takes precedence over other row conditions, matching the existing job dispatch gate. Within a matching enabled policy, unknown lifecycle remains unavailable. Per-pattern `source_blockers` independently retains unverified declarations/net execution and catalog-specific time, identity, history, baseline, graph and flags requirements, including when a policy is missing. A supplied policy's hash records its content; `caller_supplied_test_only` explicitly does not certify its lifecycle approval.

The report contains aggregate currency/lifecycle/pattern counts and content hashes. It excludes source IDs, row values, clocks, result codes, account values and per-row evidence. Duplicate or conflicting complete `(id,requesttime)` keys reject the whole audit. Different request times with the same ID are distinct source observations; this does not establish business-payment or account identity. Row count and serialized input bytes are bounded by the existing100,000-row/64MiB limits.

`inspectOfflineSourceContract(dsn, { source_workspace, batch_ref, dataset_sha256 }, policy)` in `apps/risk-workers/src/offline-publication.ts` reads an existing completed, reconciled `transfer` staging batch through `readComplete`. This rechecks the manifest, ordered row/key/value hashes and complete snapshot in a PostgreSQL READ ONLY REPEATABLE READ transaction. It performs no import, publication, migration, policy command, job dispatch or assessment. The caller must supply its authorized local Intake connection privately; never paste DSNs into commands or documentation. Other dataset tables and mismatched/tampered evidence are rejected with value-free errors.

Actual read-only verification on2026-11-04 used the existing222-row Intake batch and the existing LAK binding's policy content:215 LAK (214 succeeded,1 failed),7 THB succeeded. High Amount:214 eligible for Intake testing,1 not applicable,7 waiting policy. Each of the other14 patterns:214 unavailable,1 not applicable,7 waiting policy. Production-ready patterns remain0. This audit created no assessments or Alerts; it does not replace the previously recorded215 assessments/19 Alerts.

## Source schema review (supplied SQL dump)

The provided LMPS schema dump defines `transfer` with primary key `(id, requesttime)` and a separate unique key `(reference, requesttime)`. Both keys are composite; neither individual column is proven globally unique. The existing six-column Intake publisher uses the former as its source observation key, preserving the original naive `requesttime` string. The dump alone does not establish whether that key remains stable across corrections, the identity of a business payment, or the semantics of source-side updates and deletions.

`amount` is `DECIMAL(24,2)` and `fee` is nullable `DECIMAL(24,2)`. The six-column contract preserves amount as a decimal string, and only supports non-negative values in this test profile. It does not import fee, infer minor/major units, convert currencies, or certify a source amount as executed value. `requesttime`, `txtime`, `responsetime` and `settletime` are `DATETIME`; their timezone and business meanings remain unverified. The stored generated `requesttime_dt` derives from `requesttime`; it is not independent time evidence. A range partition and indexes on `requesttime` are present in the supplied dump, not proof of the live source schema, permissions, query plan, historical completeness, or acceptable source load.

The dump contains account and member fields, but does not establish account identity, tokenization, masking, cross-row linkage, reference authority or the real lifecycle/reversal codebook. The Intake snapshot does not provide a verified mutation feed or deletion history. Existing correction/replay behavior is local test behavior and must not be represented as an owner-confirmed source change protocol. Raw source/account values and private datasets are excluded from this report.

Pending gates remain source-owner lifecycle/reversal/net execution and time/timezone declarations, stable identity and masking boundary, historical coverage/known-at evidence, references/baselines/graph as applicable, approved THB policy and authorized live synchronization. These gates cannot be supplied by a six-column snapshot or by increasing test counts.
