# Ralph requirements map — approved intake, 2026-10-25

Source of truth: the existing sibling [plan](../../../plan/README.md), especially [104 MUST requirements](../../../plan/03-implementation-phases.md). The original plan is read-only to this pilot.

This is a traceability/review map, not a new implementation score or authorization to execute all requirements. Historical scores/evidence below are explicitly the No.41 assessment from [2026-10-24](../../docs/implementation-status/plan-progress-2026-10-24.md). They are not current after No.42-51. Current reported local evidence is in [implementation status](../../docs/implementation-status/current.md) and the [No.47-51 runbook](../../docs/operations/real-shadow-foundation.md). The previously reported970 tests have not been re-run by the intake pilot.

Only US-001 in approved-batch.md is executable. None of the104 target requirements is marked complete by this map, pilot or synthetic result. A later approved batch must decompose a selected gap into small tasks, define exact acceptance/checks and keep owner/adoption/release gates separate. Deferred real2GB work and user-owned app work remain deferred.

## Original plan documents

- [01-tech-stack-and-cost.md](../../../plan/01-tech-stack-and-cost.md)
- [02-architecture-data-and-api.md](../../../plan/02-architecture-data-and-api.md)
- [03-implementation-phases.md](../../../plan/03-implementation-phases.md)
- [04-code-session-backlog.md](../../../plan/04-code-session-backlog.md)
- [05-evaluation-security-deployment.md](../../../plan/05-evaluation-security-deployment.md)
- [06-decisions-and-references.md](../../../plan/06-decisions-and-references.md)
- [07-mariadb-replica-bootstrap.md](../../../plan/07-mariadb-replica-bootstrap.md)
- [08-postgresql-enterprise-design.md](../../../plan/08-postgresql-enterprise-design.md)
- [09-missing-inputs-and-foundation-readiness.md](../../../plan/09-missing-inputs-and-foundation-readiness.md)
- [10-next-implementation-steps.md](../../../plan/10-next-implementation-steps.md)
- [README.md](../../../plan/README.md)

## P00

Dependencies: Approved foundation scope.

Existing implementation locations to review: [package.json](../../package.json), [ci/verify.py](../../ci/verify.py), [docs/architecture/engineering-foundation-gates.md](../../docs/architecture/engineering-foundation-gates.md). These links establish location, not verification or target-gate completion.

Next target gate: Named owners, SLOs, approved platform/legal/publication and hosted evidence.

| Requirement | Plan line / source checkbox | Historical No.41 score | Historical evidence / remaining gap |
| --- | --- | ---: | --- |
| P00-01 | 43 / checked | 1 | Workspace/fresh bootstrap verified. |
| P00-02 | 44 / checked | 1 | Strict TS and locked Node/Python environments verified. |
| P00-03 | 45 / unchecked | 0.5 | Pinned Mac toolchain/SBOM199; Ubuntu release/runtime, hosted/Linux, release-image and legal acceptance remain unverified. |
| P00-04 | 46 / unchecked | 1 | Actual API/worker/FastAPI/contracts entrypoints and honest readiness verified. |
| P00-05 | 47 / unchecked | 0.5 | Fixtures/mode/private files tested; deployed environment separation pending. |
| P00-06 | 48 / unchecked | 0.5 | Local/fresh CI plus the new bulk suites run against invented data; hosted/image acceptance remains unverified. |
| P00-07 | 49 / unchecked | 0.25 | ADR/handoff records exist; named owners/SLOs missing. |
| P00-08 | 50 / unchecked | 0.25 | Spikes/ADR queue exist; adoption decisions incomplete. |

## P01

Dependencies: P00; owner evidence for real-data gates.

Existing implementation locations to review: [packages/source-preflight/src](../../packages/source-preflight/src), [apps/risk-workers/scripts/source-semantics.mjs](../../apps/risk-workers/scripts/source-semantics.mjs), [docs/operations/source-semantics.md](../../docs/operations/source-semantics.md). These links establish location, not verification or target-gate completion.

Next target gate: Owner-confirmed source access, codebook, identity, money/time and historical availability.

| Requirement | Plan line / source checkbox | Historical No.41 score | Historical evidence / remaining gap |
| --- | --- | ---: | --- |
| P01-01 | 70 / unchecked | 0.75 | No.39/40/41 integrate operator SELECT/SHOW/EXPLAIN-bounded export, manifest/DQ checks and an actual271-row approved extract; replica operational/load/security sign-off and broader source profiling remain pending. Raised0.5→0.75. |
| P01-02 | 71 / unchecked | 0.25 | Actual one-minute271-row sample reveals4 lifecycle combinations/2 currency codes;1m scale is invented. No measured actual daily/peak/burst/update/query/hot-account envelope; keep0.25. |
| P01-03 | 72 / unchecked | 0 | Account masking/stable identity explicitly unverified. |
| P01-04 | 73 / unchecked | 0.25 | Draft member/routing mapping; owner confirmation absent. |
| P01-05 | 74 / unchecked | 0.25 | Full literal(id,requesttime) dedup/conflict is tested across staging chunks; reference/current-history business-payment identity remains unverified, so keep0.25. |
| P01-06 | 75 / unchecked | 0.5 | Synthetic normalizer plus strict real-source declaration validator exists; actual owner codebook is still unconfirmed, so keep0.5. |
| P01-07 | 76 / unchecked | 0.25 | Raw naive times and explicit unavailable declaration/provenance gates are preserved; no verified source timezone/availability/change history. |
| P01-08 | 77 / unchecked | 0 | Verified account resolver/tokenizer not implemented. |
| P01-09 | 78 / unchecked | 0.5 | Real271-row DQ/lineage plus private draft mapping/versioned evidence validation tested; approved dictionary/retention/classification remain missing, so keep0.5. |

## P02

Dependencies: P00; P01 for actual mapping.

Existing implementation locations to review: [packages/database/migrations](../../packages/database/migrations), [apps/risk-api/src](../../apps/risk-api/src), [packages/contracts/src](../../packages/contracts/src). These links establish location, not verification or target-gate completion.

Next target gate: Canonical source mapping, production schema/auth/retention/security acceptance.

| Requirement | Plan line / source checkbox | Historical No.41 score | Historical evidence / remaining gap |
| --- | --- | ---: | --- |
| P02-01 | 102 / unchecked | 0.5 | Owned project remains28 tables/15 migrations; No.41 uses existing staging and an isolated trial. Canonical business/production physical freeze remains pending. |
| P02-02 | 103 / unchecked | 0.5 | Immutable local rules/assessments and independently approved policy versions/replay tested; target publication/governance acceptance pending. |
| P02-03 | 104 / unchecked | 0.25 | Local JWT/workspace/Case/policy scopes tested; selected corporate IdP/service/institution entitlements absent. |
| P02-04 | 105 / unchecked | 0.5 | Typed/OpenAPI/scoped errors, Case/policy CAS and exact retries proven over TCP; target integration/pre-transfer binding contract pending. |
| P02-05 | 106 / unchecked | 0.5 | Isolated intake/outbox/reviewer/policy/Case roles and app raw-staging denial tested; production encryption/keys/admin audit incomplete. |
| P02-06 | 107 / unchecked | 0.5 | Local fake outbox/lease/retry/dedup tested; real provider/business coupling incomplete. |
| P02-07 | 108 / unchecked | 0.25 | Private CSV/report/staging field/role boundaries tested; approved classification/retention/exports/attachments remain incomplete. |
| P02-08 | 109 / unchecked | 0.25 | Bounded pools/health/audit APIs; production metrics/traces/PgBouncer incomplete. |

## P03

Dependencies: P01, P02.

Existing implementation locations to review: [apps/risk-workers/src](../../apps/risk-workers/src), [apps/risk-workers/scripts/dataset-bulk.mjs](../../apps/risk-workers/scripts/dataset-bulk.mjs), [docs/architecture/adr/0004-event-backbone.md](../../docs/architecture/adr/0004-event-backbone.md). These links establish location, not verification or target-gate completion.

Next target gate: Approved connector/backbone adoption, real-source cutover, historical sink and reconciliation.

| Requirement | Plan line / source checkbox | Historical No.41 score | Historical evidence / remaining gap |
| --- | --- | ---: | --- |
| P03-01 | 129 / unchecked | 0.25 | Backbone ADR proposed; owner adoption/operations sign-off missing. |
| P03-02 | 130 / unchecked | 0.25 | SELECT-only manual exports and native fixtures work; no adopted real CDC connector/replica runtime or snapshot-to-stream bridge. |
| P03-03 | 131 / unchecked | 0.5 | Synthetic normalizer and publisher integrated; approved backbone/tokenization absent. |
| P03-04 | 132 / unchecked | 0.5 | No.41 composes immutable19/22-field plans, disk-backed full-source-key/hash dedup, native500-row/25k-file checkpoints, process fencing and actual crash/resume through verified million-row trials. Stream handoff/update/delete/history/reversal semantics remain absent. Raised0.25→0.5. |
| P03-05 | 133 / unchecked | 0.25 | Typed contracts/validation exist; selected registry/DLQ/remediation absent. |
| P03-06 | 134 / unchecked | 0 | Private CSV/gzip chunk manifests/lineage exist; no implemented Parquet/object-storage historical sink. Keep0 for this specific writer requirement. |
| P03-07 | 135 / unchecked | 0.25 | Storage/key experiment and query proposal; historical workload ADR missing. |
| P03-08 | 136 / unchecked | 0.5 | Real271-row and invented1m row/key/value/hash reconciliation/restore passed; actual product/lifecycle/date/normalized-money totals and late/quarantine semantics remain missing. |
| P03-09 | 137 / unchecked | 0.5 | Local/test guards plus physically isolated bulk trials preserve all28 primary fingerprints; deployed live/shadow/backfill sinks/permissions remain absent. |

## P04

Dependencies: P03; approved draft for pre-transfer simulation.

Existing implementation locations to review: [packages/risk/src](../../packages/risk/src), [services/ml-inference/lmps_ml/replay.py](../../services/ml-inference/lmps_ml/replay.py). These links establish location, not verification or target-gate completion.

Next target gate: Adopted online engine/cache, source availability, concurrency and serving evidence.

Latest reported local overlay: No.42/48 report local temporal datasets and checkpointed feature replay; this is not adopted online serving. See current status; historical statements below are retained as dated evidence, not present-day absence claims.

| Requirement | Plan line / source checkbox | Historical No.41 score | Historical evidence / remaining gap |
| --- | --- | ---: | --- |
| P04-01 | 157 / unchecked | 0.5 | 15-detector bounded synthetic feature catalog; actual-source freshness contracts pending. |
| P04-02 | 158 / unchecked | 0.25 | Candidate comparison/spike criteria documented; no same-stream benchmark. |
| P04-03 | 159 / unchecked | 0 | No adopted online stateful feature engine. |
| P04-04 | 160 / unchecked | 0 | No adopted cache/atomic feature serving implementation. |
| P04-05 | 161 / unchecked | 0.25 | Typed frozen feature evidence and missing-data contract; no online service. |
| P04-06 | 162 / unchecked | 0.5 | Synthetic revision/reversal/currency corrections tested; actual stream integration missing. |
| P04-07 | 163 / unchecked | 0 | No concurrent pre-transfer reservation simulator. |
| P04-08 | 164 / unchecked | 0.25 | Point-in-time filtering in synthetic reference; proven historical parity pipeline missing. |
| P04-09 | 165 / unchecked | 0.5 | Frozen synthetic evidence persists; retained online feature metrics/service incomplete. |

## P05

Dependencies: P01, P04; bounded offline prototypes permitted separately.

Existing implementation locations to review: [packages/risk/src](../../packages/risk/src), [apps/risk-workers/src/rule-backtest.ts](../../apps/risk-workers/src/rule-backtest.ts), [services/ml-inference/lmps_ml/training.py](../../services/ml-inference/lmps_ml/training.py). These links establish location, not verification or target-gate completion.

Next target gate: Actual-source/policy-reviewed features, verified identity for account graphs and capacity.

Latest reported local overlay: No.43/50 report actual local baselines and same-cohort comparisons; real detection/identity gates stay open. See current status; historical statements below are retained as dated evidence, not present-day absence claims.

| Requirement | Plan line / source checkbox | Historical No.41 score | Historical evidence / remaining gap |
| --- | --- | ---: | --- |
| P05-01 | 186 / unchecked | 0.5 | Restricted shared rules and job path tested locally; online approved scopes absent. |
| P05-02 | 187 / unchecked | 0.5 | All15 reference detectors executable; real-source policy review pending. |
| P05-03 | 188 / unchecked | 0.75 | No.36/38 connect draft/submit/independent approval/activation/rollback, frozen comparison and approved jobs; effective-date scheduling/production policy and mandatory comparison gates pending. |
| P05-04 | 189 / unchecked | 0.5 | Synthetic mean-ratio baselines/cold-start tested; actual peer/unsupervised baselines absent. |
| P05-05 | 190 / unchecked | 0.5 | Bounded synthetic temporal paths/cycles; verified entity graph unavailable. |
| P05-06 | 191 / unchecked | 0 | No graph storage/query comparative benchmark/adoption. |
| P05-07 | 192 / unchecked | 0.5 | Separate synthetic indices/evidence/lo-en catalog; actual calibrated risk semantics pending. |
| P05-08 | 193 / unchecked | 0.5 | Grouped Alert/dedup/review/job flow now connects to Cases over native PG/TCP; actual alert yield/capacity/threshold approval missing. |
| P05-09 | 194 / unchecked | 0 | No MLflow baseline experiment records. |

## P06

Dependencies: P02, P05 integration.

Existing implementation locations to review: [apps/risk-portal/src](../../apps/risk-portal/src), [apps/risk-api/src/cases.controller.ts](../../apps/risk-api/src/cases.controller.ts), [apps/risk-api/src/labels.controller.ts](../../apps/risk-api/src/labels.controller.ts). These links establish location, not verification or target-gate completion.

Next target gate: Approved workflow, authenticated full UI, attachments, real label maturity/sampling and export policy.

Latest reported local overlay: No.49 reports independent append-only synthetic label adjudication/revocation/export; real truth remains unavailable. See current status; historical statements below are retained as dated evidence, not present-day absence claims.

| Requirement | Plan line / source checkbox | Historical No.41 score | Historical evidence / remaining gap |
| --- | --- | ---: | --- |
| P06-01 | 214 / unchecked | 0.25 | Reviewed target Portal plus sibling Portal1/Portal2 sources: broader screens/actions use fixtures/mock state; target NestJS typed API integration remains limited to the existing subset. Keep0.25; no new browser acceptance. |
| P06-02 | 215 / unchecked | 0.5 | Prior local Portal state/permission evidence plus sibling source-level demo state handling exists; no new browser tests or full product acceptance in this batch. |
| P06-03 | 216 / unchecked | 0.5 | Local backend Cases/Alert workflow exists and sibling UIs simulate actions; target authenticated Case UI/attachments/production membership remain incomplete. |
| P06-04 | 217 / unchecked | 0.5 | Rule/risk/feature/policy evidence displayed locally; model/actual-source coverage absent. |
| P06-05 | 218 / unchecked | 0.5 | Versioned Fraud/Mule/AML opinions/evidence/reviewer metadata persist; maturity stays unverified/training-false, confirmed/mature label policy absent. |
| P06-06 | 219 / unchecked | 0.25 | Outcome versioning, supersession and reopen/evidence/assignee invalidation tested; independent label review/adjudication absent. |
| P06-07 | 220 / unchecked | 0 | No non-alert sampling/QA dataset workflow. |
| P06-08 | 221 / unchecked | 0 | Sibling prototypes export invented masked CSV/audit previews; no authorized business-data export/attachment backend and access-audit lifecycle. Keep0. |

## P07

Dependencies: P02, P06; mobile/provider decisions.

Existing implementation locations to review: [packages/database/src](../../packages/database/src), [docs/architecture/engineering-foundation-gates.md](../../docs/architecture/engineering-foundation-gates.md). These links establish location, not verification or target-gate completion.

Next target gate: User-owned Web App, recipients, browser/device targets and sandbox provider approval.

| Requirement | Plan line / source checkbox | Historical No.41 score | Historical evidence / remaining gap |
| --- | --- | ---: | --- |
| P07-01 | 240 / unchecked | 0.25 | User chose Web App + Add to Home Screen, implemented by user; recipients/browser targets/distribution pending. |
| P07-02 | 241 / unchecked | 0 | No verified installed Web App/PWA session/inbox/offline flow. |
| P07-03 | 242 / unchecked | 0 | No device/subscription registration/rotation/revocation. |
| P07-04 | 243 / unchecked | 0 | No recipient-aware notification policy. |
| P07-05 | 244 / unchecked | 0.5 | Existing fake outbox worker/retry/dedup local foundation; notification integration incomplete. |
| P07-06 | 245 / unchecked | 0.25 | Fake provider primitive exists; selected Web App sandbox provider absent. |
| P07-07 | 246 / unchecked | 0 | No installed-app deep-link/push payload flow. |
| P07-08 | 247 / unchecked | 0 | No acknowledgement escalation/assignment timer. |
| P07-09 | 248 / unchecked | 0 | No provider/device/opened/ack delivery observation workflow. |

## P08

Dependencies: P05, P06; supervised claims require eligible labels.

Existing implementation locations to review: [services/ml-inference/lmps_ml/dataset.py](../../services/ml-inference/lmps_ml/dataset.py), [services/ml-inference/lmps_ml/evaluation.py](../../services/ml-inference/lmps_ml/evaluation.py), [services/ml-inference/lmps_ml/serving.py](../../services/ml-inference/lmps_ml/serving.py). These links establish location, not verification or target-gate completion.

Next target gate: Eligible real features/labels, temporal evidence, governance and selected registry deployment.

Latest reported local overlay: No.42-50 report real local fitting/calibration, MLflow pins/signatures/FastAPI and evaluation; real271-row evaluation remains unavailable. See current status; historical statements below are retained as dated evidence, not present-day absence claims.

| Requirement | Plan line / source checkbox | Historical No.41 score | Historical evidence / remaining gap |
| --- | --- | ---: | --- |
| P08-01 | 268 / unchecked | 0 | No versioned training/evaluation dataset/split pipeline. |
| P08-02 | 269 / unchecked | 0 | No labeled population/segment performance metrics. |
| P08-03 | 270 / unchecked | 0.25 | Reference detector/baseline designs; same-cohort comparative evaluation absent. |
| P08-04 | 271 / unchecked | 0 | No supervised training/calibration; labels unavailable. |
| P08-05 | 272 / unchecked | 0 | No deployed MLflow registry/approval/signature lifecycle. |
| P08-06 | 273 / unchecked | 0.25 | FastAPI remains an honest503 model_not_loaded bootstrap; no trained/pinned serving adapter, warmup or model rollback. |
| P08-07 | 274 / unchecked | 0.25 | Synthetic jobs/versioned evidence only; training/data batch orchestration absent. |
| P08-08 | 275 / unchecked | 0 | No champion/challenger or drift operations. |
| P08-09 | 276 / unchecked | 0 | No implemented vendor/GNN evaluation adapter. |
| P08-10 | 277 / unchecked | 0.25 | Evaluation/limitations planning exists; no measured model card/report. |

## P09

Dependencies: P04, P05, P08; LMPS owner.

Existing implementation locations to review: [packages/contracts/src](../../packages/contracts/src), [apps/risk-api/src](../../apps/risk-api/src). These links establish location, not verification or target-gate completion.

Next target gate: Actual LMPS pre-transfer contract, payment authority, deadlines and approved degraded policy.

| Requirement | Plan line / source checkbox | Historical No.41 score | Historical evidence / remaining gap |
| --- | --- | ---: | --- |
| P09-01 | 298 / unchecked | 0.25 | Draft decision binding/lifecycle contracts; LMPS authority/deadlines unconfirmed. |
| P09-02 | 299 / unchecked | 0.25 | Rules/features orchestration design; no synchronous pre-transfer path. |
| P09-03 | 300 / unchecked | 0.25 | Durable synthetic assessment primitives; no bound durable payment decision. |
| P09-04 | 301 / unchecked | 0 | No payment decision/enforcement state machine. |
| P09-05 | 302 / unchecked | 0.25 | Missing/unavailable semantics specified; approved degraded payment policy absent. |
| P09-06 | 303 / unchecked | 0.25 | Local pool/timeouts/retry bounds; end-to-end circuit/deadline/backpressure absent. |
| P09-07 | 304 / unchecked | 0.25 | Explicit new immutable assessment convention; actual payment rescore policy absent. |
| P09-08 | 305 / unchecked | 0 | No LMPS simulator/staging integration. |
| P09-09 | 306 / unchecked | 0 | No payment kill switch/per-product enforcement. |

## P10

Dependencies: Release-scope P03-P09 integrations.

Existing implementation locations to review: [ci/verify.py](../../ci/verify.py), [packages/database/scripts/backup.mjs](../../packages/database/scripts/backup.mjs), [services/ml-inference/lmps_ml/backup.py](../../services/ml-inference/lmps_ml/backup.py). These links establish location, not verification or target-gate completion.

Next target gate: Selected platform, security review, actual/target capacity, RPO/RTO and production DR.

Latest reported local overlay: No.51 reports owned31-table/three-model restore, local overload metrics and Vite patching; no production capacity/DR claim. See current status; historical statements below are retained as dated evidence, not present-day absence claims.

| Requirement | Plan line / source checkbox | Historical No.41 score | Historical evidence / remaining gap |
| --- | --- | ---: | --- |
| P10-01 | 326 / unchecked | 0.25 | Platform/stack/ADR planning only; no reproducible deployment IaC. |
| P10-02 | 327 / unchecked | 0.25 | Local secrets/scope/isolation primitives; deployed security/retention incomplete. |
| P10-03 | 328 / unchecked | 0.5 | Frozen locks/SBOM/publication checks; verified images/release process absent. |
| P10-04 | 329 / unchecked | 0.25 | Invented100k→1m bulk timings/RSS/disk/restore measured; this is not actual online full-flow peak/burst/hot-account/p95/p99/cost/G-CAP5M evidence. Keep0.25. |
| P10-05 | 330 / unchecked | 0.5 | Native source/PG/jobs/crash tests plus new bulk SIGKILL/fencing/corruption tests passed; adopted broker/engine/model/provider failures remain untested. |
| P10-06 | 331 / unchecked | 0.5 | Primary28-table preservation and isolated1m-row v2 dump/restore proven within1m/128MiB caps; dataset/artifact/config-secret recovery strategy remains incomplete. |
| P10-07 | 332 / unchecked | 0.25 | OS single-writer lock, committed checkpoints and isolated restore work locally; full business DR/failback with approved RPO/RTO and payment/notification evidence remains absent. |
| P10-08 | 333 / unchecked | 0.25 | Runnable local core/bulk/recovery runbooks and private batch metrics exist; production traces/on-call/autoscaling/growth budgets remain missing. |
| P10-09 | 334 / unchecked | 0 | No formal threat model/penetration-test evidence. |

## P11

Dependencies: P10 and release sign-offs.

Existing implementation locations to review: [apps/risk-api/scripts/shadow-runtime.mjs](../../apps/risk-api/scripts/shadow-runtime.mjs), [docs/operations/real-shadow-foundation.md](../../docs/operations/real-shadow-foundation.md). These links establish location, not verification or target-gate completion.

Next target gate: Live-data/release authorization, named operations owners and scope-specific sign-offs.

Latest reported local overlay: No.51 persistent shadow is local/synthetic only, not approved-live shadow or production release. See current status; historical statements below are retained as dated evidence, not present-day absence claims.

| Requirement | Plan line / source checkbox | Historical No.41 score | Historical evidence / remaining gap |
| --- | --- | ---: | --- |
| P11-01 | 354 / unchecked | 0 | No approved operational release/sign-offs. |
| P11-02 | 355 / unchecked | 0 | No approved-live shadow run. |
| P11-03 | 356 / unchecked | 0 | No analyst live alert/push rollout. |
| P11-04 | 357 / unchecked | 0 | No approved controlled payment action. |
| P11-05 | 358 / unchecked | 0 | No production canary/rollback/error-budget evidence. |
| P11-06 | 359 / unchecked | 0 | No operational scheduled policy/model drift review. |
| P11-07 | 360 / unchecked | 0 | No ongoing post-release adoption reassessment evidence. |

## Queue boundaries

- Source/identity/availability/real-label gates require actual owner evidence; unknown stays unknown.
- No original database migrations, real-source connection, real provider, payment action, commit/push or deployment is authorized by this queue.
- A later code batch needs its own approved task list. Multiple tasks can be approved together and executed sequentially within that scope.
- No account rotation or quota-reset polling is implemented; retain the task and use the same selected CODEX_HOME after availability returns.
