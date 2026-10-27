# Plan progress assessment — 2026-10-24

> Historical full-plan assessment after No.41.1. No.42.1–46.1 subsequently implement a local/synthetic ML foundation; see [current status](current.md) and [ML acceptance](../operations/ml-shadow.md). The figures/ML-absent statements below describe the earlier assessment, not the present ML code. No updated104-item score is claimed here.

หลัง No.41.1 ประเมินความคืบหน้ารวมประมาณ **27.6%** = **28.75/104 equivalent completed MUST items** จากเดิม27.2% หลัง No.38.1. เป็น engineering scope/evidence estimate ไม่ใช่ production readiness, fraud accuracy, elapsed effort หรือเวลาที่เหลือ.

ตรวจเทียบ IDs ครบ104ข้อใน [P00–P11](../../../plan/03-implementation-phases.md) กับสถานะ/code/tests/operational evidence ปัจจุบัน รวม source-only review ของ sibling Portal1/Portal2. ใช้ denominator และ equal-weight rubric เดิม; ไม่เพิ่มคะแนนตามจำนวน tests/rows/files และไม่ลด scope เพราะ UI/labels/identity/source ถูกเลื่อน. ไม่ได้ตรวจ remote deployment/hosted CI หรือรัน browser/Playwright รอบนี้.

Rubric: **0** ไม่มี implementation/evidence ของ requirement นั้น; **0.25** design/decision/primitive; **0.5** ส่วนสำคัญทำและทดสอบ local/synthetic แล้วแต่ขาด target integration; **0.75** scope หลักเชื่อมแล้วแต่ exit gates บางส่วนยังไม่ผ่าน; **1** requirement ครบตามขอบเขตและยืนยันได้. คะแนนบางส่วนเป็น judgment ที่เปิดเผยรายข้อ; แสดงเปอร์เซ็นต์หนึ่งตำแหน่งด้วย half-up rounding.

| Phase | MUST items | Equivalent done | Progress |
| --- | ---: | ---: | ---: |
| P00 — New Repository และ Engineering Foundation | 8 | 5.00 | 62.5% |
| P01 — Source Profiling, Identity และ Data Semantics | 9 | 2.75 | 30.6% |
| P02 — Operational Data, API และ Security Foundation | 8 | 3.25 | 40.6% |
| P03 — Ingestion, Durable Events และ Historical Storage | 9 | 3.00 | 33.3% |
| P04 — Stateful Features และ Online Feature Serving | 9 | 2.25 | 25.0% |
| P05 — Rules, Anomaly และ Graph Baselines | 9 | 3.75 | 41.7% |
| P06 — Admin Portal, Case Management และ Labeling | 8 | 2.50 | 31.3% |
| P07 — Web App / Add to Home Screen และ High-risk Notifications | 9 | 1.00 | 11.1% |
| P08 — Evaluation, Training และ Model Lifecycle | 10 | 1.00 | 10.0% |
| P09 — Pre-transfer Decision Engine และ LMPS Integration | 9 | 1.50 | 16.7% |
| P10 — Integrated Hardening, Performance และ DR | 9 | 2.75 | 30.6% |
| P11 — Shadow, Controlled Production และ Continuous Operations | 7 | 0.00 | 0.0% |
| **Total** | **104** | **28.75** | **27.6%** |

เพิ่ม0.50 equivalent item จาก2ข้อเท่านั้น: **P01-01 +0.25** เพราะ bounded tool เชื่อม approved operator extract/real pilot แล้ว และ **P03-04 +0.25** เพราะประกอบ multi-file position/checkpoints/dedup/format validation/fencing/recovery เป็น local pipeline ที่ทดสอบจริงแล้ว. อีก102ข้อตรวจใหม่และคงคะแนนเมื่อยังไม่ข้าม target gate.

No.39/40/41 มีหลักฐานจริง271แถว; No.41 scale100k→1m ใช้ข้อมูลแต่งขึ้น พร้อม restore ทั้งสองระดับ. ไฟล์จริง2GB/14.25m อยู่ flash drive และผู้ใช้สั่งข้ามการทดลองไว้ก่อน. ไม่เพิ่ม P10-04 จากการขยายจำนวนแถวอย่างเดียว เพราะ target full-flow5-million/day/p95/p99/actual peak ยังไม่ผ่าน. การกรอก owner-declared mapping ก็ไม่ใช่ independently verified semantics หรือ permission เปิด15 patterns.

## Current evidence and limits

- [No.39 real pilot](../operations/real-pilot.md):271/271 exact staging reconciliation, raw simulation only; original core data retained.
- [No.40 source semantics](../operations/source-semantics.md):4 selector combinations/2 raw currency codes,271 unavailable under draft,15 patterns blocked.
- [No.41 bulk/recovery](../operations/bulk-import.md): invented1m scale, actual271-row bulk trial,25k SIGKILL→50001 resume, writer fencing/corruption checks; unchanged28-table primary fingerprints.
- Existing [Policy](../architecture/adr/0013-local-risk-policy-lifecycle.md), [Cases](../architecture/adr/0014-local-cases.md), [core](../operations/local-core.md), [risk engine](../../packages/risk/README.md) remain local/synthetic integrations.
- Source-only frontend review: [Portal1 README](../../../LMPS_Risk_Portal1/README.md), Portal1 local proxy targets18081; [Portal2](../../../LMPS_Risk_Portal2/src/App.tsx) imports fixtures/mock access/workflow. These are not accepted integration with the new target backend. Old Go/local runtime is not counted as the new backend.
- ML source still returns model_not_loaded; backbone ADR is PROPOSED; no adopted online engine/cache, training/labels, actual LMPS payment path, installed-app push or production release evidence.
- Final fresh-source offline verification passed915 tests (Node656/Python259), frozen installs/typecheck/build/generated-lock drift, publication355 files and SBOM199/0 UNKNOWN. Online advisory audits were skipped. Opt-in100k→1m scale/restore is separate from the ordinary test total; [current status](current.md) records actual checks.

## Item ledger — all104 MUST items

### P00 — New Repository และ Engineering Foundation

| MUST item | Score | Evidence / remaining gap |
| --- | ---: | --- |
| P00-01 | 1 | Workspace/fresh bootstrap verified. |
| P00-02 | 1 | Strict TS and locked Node/Python environments verified. |
| P00-03 | 0.5 | Pinned Mac toolchain/SBOM199; Ubuntu release/runtime, hosted/Linux, release-image and legal acceptance remain unverified. |
| P00-04 | 1 | Actual API/worker/FastAPI/contracts entrypoints and honest readiness verified. |
| P00-05 | 0.5 | Fixtures/mode/private files tested; deployed environment separation pending. |
| P00-06 | 0.5 | Local/fresh CI plus the new bulk suites run against invented data; hosted/image acceptance remains unverified. |
| P00-07 | 0.25 | ADR/handoff records exist; named owners/SLOs missing. |
| P00-08 | 0.25 | Spikes/ADR queue exist; adoption decisions incomplete. |

### P01 — Source Profiling, Identity และ Data Semantics

| MUST item | Score | Evidence / remaining gap |
| --- | ---: | --- |
| P01-01 | 0.75 | No.39/40/41 integrate operator SELECT/SHOW/EXPLAIN-bounded export, manifest/DQ checks and an actual271-row approved extract; replica operational/load/security sign-off and broader source profiling remain pending. Raised0.5→0.75. |
| P01-02 | 0.25 | Actual one-minute271-row sample reveals4 lifecycle combinations/2 currency codes;1m scale is invented. No measured actual daily/peak/burst/update/query/hot-account envelope; keep0.25. |
| P01-03 | 0 | Account masking/stable identity explicitly unverified. |
| P01-04 | 0.25 | Draft member/routing mapping; owner confirmation absent. |
| P01-05 | 0.25 | Full literal(id,requesttime) dedup/conflict is tested across staging chunks; reference/current-history business-payment identity remains unverified, so keep0.25. |
| P01-06 | 0.5 | Synthetic normalizer plus strict real-source declaration validator exists; actual owner codebook is still unconfirmed, so keep0.5. |
| P01-07 | 0.25 | Raw naive times and explicit unavailable declaration/provenance gates are preserved; no verified source timezone/availability/change history. |
| P01-08 | 0 | Verified account resolver/tokenizer not implemented. |
| P01-09 | 0.5 | Real271-row DQ/lineage plus private draft mapping/versioned evidence validation tested; approved dictionary/retention/classification remain missing, so keep0.5. |

### P02 — Operational Data, API และ Security Foundation

| MUST item | Score | Evidence / remaining gap |
| --- | ---: | --- |
| P02-01 | 0.5 | Owned project remains28 tables/15 migrations; No.41 uses existing staging and an isolated trial. Canonical business/production physical freeze remains pending. |
| P02-02 | 0.5 | Immutable local rules/assessments and independently approved policy versions/replay tested; target publication/governance acceptance pending. |
| P02-03 | 0.25 | Local JWT/workspace/Case/policy scopes tested; selected corporate IdP/service/institution entitlements absent. |
| P02-04 | 0.5 | Typed/OpenAPI/scoped errors, Case/policy CAS and exact retries proven over TCP; target integration/pre-transfer binding contract pending. |
| P02-05 | 0.5 | Isolated intake/outbox/reviewer/policy/Case roles and app raw-staging denial tested; production encryption/keys/admin audit incomplete. |
| P02-06 | 0.5 | Local fake outbox/lease/retry/dedup tested; real provider/business coupling incomplete. |
| P02-07 | 0.25 | Private CSV/report/staging field/role boundaries tested; approved classification/retention/exports/attachments remain incomplete. |
| P02-08 | 0.25 | Bounded pools/health/audit APIs; production metrics/traces/PgBouncer incomplete. |

### P03 — Ingestion, Durable Events และ Historical Storage

| MUST item | Score | Evidence / remaining gap |
| --- | ---: | --- |
| P03-01 | 0.25 | Backbone ADR proposed; owner adoption/operations sign-off missing. |
| P03-02 | 0.25 | SELECT-only manual exports and native fixtures work; no adopted real CDC connector/replica runtime or snapshot-to-stream bridge. |
| P03-03 | 0.5 | Synthetic normalizer and publisher integrated; approved backbone/tokenization absent. |
| P03-04 | 0.5 | No.41 composes immutable19/22-field plans, disk-backed full-source-key/hash dedup, native500-row/25k-file checkpoints, process fencing and actual crash/resume through verified million-row trials. Stream handoff/update/delete/history/reversal semantics remain absent. Raised0.25→0.5. |
| P03-05 | 0.25 | Typed contracts/validation exist; selected registry/DLQ/remediation absent. |
| P03-06 | 0 | Private CSV/gzip chunk manifests/lineage exist; no implemented Parquet/object-storage historical sink. Keep0 for this specific writer requirement. |
| P03-07 | 0.25 | Storage/key experiment and query proposal; historical workload ADR missing. |
| P03-08 | 0.5 | Real271-row and invented1m row/key/value/hash reconciliation/restore passed; actual product/lifecycle/date/normalized-money totals and late/quarantine semantics remain missing. |
| P03-09 | 0.5 | Local/test guards plus physically isolated bulk trials preserve all28 primary fingerprints; deployed live/shadow/backfill sinks/permissions remain absent. |

### P04 — Stateful Features และ Online Feature Serving

| MUST item | Score | Evidence / remaining gap |
| --- | ---: | --- |
| P04-01 | 0.5 | 15-detector bounded synthetic feature catalog; actual-source freshness contracts pending. |
| P04-02 | 0.25 | Candidate comparison/spike criteria documented; no same-stream benchmark. |
| P04-03 | 0 | No adopted online stateful feature engine. |
| P04-04 | 0 | No adopted cache/atomic feature serving implementation. |
| P04-05 | 0.25 | Typed frozen feature evidence and missing-data contract; no online service. |
| P04-06 | 0.5 | Synthetic revision/reversal/currency corrections tested; actual stream integration missing. |
| P04-07 | 0 | No concurrent pre-transfer reservation simulator. |
| P04-08 | 0.25 | Point-in-time filtering in synthetic reference; proven historical parity pipeline missing. |
| P04-09 | 0.5 | Frozen synthetic evidence persists; retained online feature metrics/service incomplete. |

### P05 — Rules, Anomaly และ Graph Baselines

| MUST item | Score | Evidence / remaining gap |
| --- | ---: | --- |
| P05-01 | 0.5 | Restricted shared rules and job path tested locally; online approved scopes absent. |
| P05-02 | 0.5 | All15 reference detectors executable; real-source policy review pending. |
| P05-03 | 0.75 | No.36/38 connect draft/submit/independent approval/activation/rollback, frozen comparison and approved jobs; effective-date scheduling/production policy and mandatory comparison gates pending. |
| P05-04 | 0.5 | Synthetic mean-ratio baselines/cold-start tested; actual peer/unsupervised baselines absent. |
| P05-05 | 0.5 | Bounded synthetic temporal paths/cycles; verified entity graph unavailable. |
| P05-06 | 0 | No graph storage/query comparative benchmark/adoption. |
| P05-07 | 0.5 | Separate synthetic indices/evidence/lo-en catalog; actual calibrated risk semantics pending. |
| P05-08 | 0.5 | Grouped Alert/dedup/review/job flow now connects to Cases over native PG/TCP; actual alert yield/capacity/threshold approval missing. |
| P05-09 | 0 | No MLflow baseline experiment records. |

### P06 — Admin Portal, Case Management และ Labeling

| MUST item | Score | Evidence / remaining gap |
| --- | ---: | --- |
| P06-01 | 0.25 | Reviewed target Portal plus sibling Portal1/Portal2 sources: broader screens/actions use fixtures/mock state; target NestJS typed API integration remains limited to the existing subset. Keep0.25; no new browser acceptance. |
| P06-02 | 0.5 | Prior local Portal state/permission evidence plus sibling source-level demo state handling exists; no new browser tests or full product acceptance in this batch. |
| P06-03 | 0.5 | Local backend Cases/Alert workflow exists and sibling UIs simulate actions; target authenticated Case UI/attachments/production membership remain incomplete. |
| P06-04 | 0.5 | Rule/risk/feature/policy evidence displayed locally; model/actual-source coverage absent. |
| P06-05 | 0.5 | Versioned Fraud/Mule/AML opinions/evidence/reviewer metadata persist; maturity stays unverified/training-false, confirmed/mature label policy absent. |
| P06-06 | 0.25 | Outcome versioning, supersession and reopen/evidence/assignee invalidation tested; independent label review/adjudication absent. |
| P06-07 | 0 | No non-alert sampling/QA dataset workflow. |
| P06-08 | 0 | Sibling prototypes export invented masked CSV/audit previews; no authorized business-data export/attachment backend and access-audit lifecycle. Keep0. |

### P07 — Web App / Add to Home Screen และ High-risk Notifications

| MUST item | Score | Evidence / remaining gap |
| --- | ---: | --- |
| P07-01 | 0.25 | User chose Web App + Add to Home Screen, implemented by user; recipients/browser targets/distribution pending. |
| P07-02 | 0 | No verified installed Web App/PWA session/inbox/offline flow. |
| P07-03 | 0 | No device/subscription registration/rotation/revocation. |
| P07-04 | 0 | No recipient-aware notification policy. |
| P07-05 | 0.5 | Existing fake outbox worker/retry/dedup local foundation; notification integration incomplete. |
| P07-06 | 0.25 | Fake provider primitive exists; selected Web App sandbox provider absent. |
| P07-07 | 0 | No installed-app deep-link/push payload flow. |
| P07-08 | 0 | No acknowledgement escalation/assignment timer. |
| P07-09 | 0 | No provider/device/opened/ack delivery observation workflow. |

### P08 — Evaluation, Training และ Model Lifecycle

| MUST item | Score | Evidence / remaining gap |
| --- | ---: | --- |
| P08-01 | 0 | No versioned training/evaluation dataset/split pipeline. |
| P08-02 | 0 | No labeled population/segment performance metrics. |
| P08-03 | 0.25 | Reference detector/baseline designs; same-cohort comparative evaluation absent. |
| P08-04 | 0 | No supervised training/calibration; labels unavailable. |
| P08-05 | 0 | No deployed MLflow registry/approval/signature lifecycle. |
| P08-06 | 0.25 | FastAPI remains an honest503 model_not_loaded bootstrap; no trained/pinned serving adapter, warmup or model rollback. |
| P08-07 | 0.25 | Synthetic jobs/versioned evidence only; training/data batch orchestration absent. |
| P08-08 | 0 | No champion/challenger or drift operations. |
| P08-09 | 0 | No implemented vendor/GNN evaluation adapter. |
| P08-10 | 0.25 | Evaluation/limitations planning exists; no measured model card/report. |

### P09 — Pre-transfer Decision Engine และ LMPS Integration

| MUST item | Score | Evidence / remaining gap |
| --- | ---: | --- |
| P09-01 | 0.25 | Draft decision binding/lifecycle contracts; LMPS authority/deadlines unconfirmed. |
| P09-02 | 0.25 | Rules/features orchestration design; no synchronous pre-transfer path. |
| P09-03 | 0.25 | Durable synthetic assessment primitives; no bound durable payment decision. |
| P09-04 | 0 | No payment decision/enforcement state machine. |
| P09-05 | 0.25 | Missing/unavailable semantics specified; approved degraded payment policy absent. |
| P09-06 | 0.25 | Local pool/timeouts/retry bounds; end-to-end circuit/deadline/backpressure absent. |
| P09-07 | 0.25 | Explicit new immutable assessment convention; actual payment rescore policy absent. |
| P09-08 | 0 | No LMPS simulator/staging integration. |
| P09-09 | 0 | No payment kill switch/per-product enforcement. |

### P10 — Integrated Hardening, Performance และ DR

| MUST item | Score | Evidence / remaining gap |
| --- | ---: | --- |
| P10-01 | 0.25 | Platform/stack/ADR planning only; no reproducible deployment IaC. |
| P10-02 | 0.25 | Local secrets/scope/isolation primitives; deployed security/retention incomplete. |
| P10-03 | 0.5 | Frozen locks/SBOM/publication checks; verified images/release process absent. |
| P10-04 | 0.25 | Invented100k→1m bulk timings/RSS/disk/restore measured; this is not actual online full-flow peak/burst/hot-account/p95/p99/cost/G-CAP5M evidence. Keep0.25. |
| P10-05 | 0.5 | Native source/PG/jobs/crash tests plus new bulk SIGKILL/fencing/corruption tests passed; adopted broker/engine/model/provider failures remain untested. |
| P10-06 | 0.5 | Primary28-table preservation and isolated1m-row v2 dump/restore proven within1m/128MiB caps; dataset/artifact/config-secret recovery strategy remains incomplete. |
| P10-07 | 0.25 | OS single-writer lock, committed checkpoints and isolated restore work locally; full business DR/failback with approved RPO/RTO and payment/notification evidence remains absent. |
| P10-08 | 0.25 | Runnable local core/bulk/recovery runbooks and private batch metrics exist; production traces/on-call/autoscaling/growth budgets remain missing. |
| P10-09 | 0 | No formal threat model/penetration-test evidence. |

### P11 — Shadow, Controlled Production และ Continuous Operations

| MUST item | Score | Evidence / remaining gap |
| --- | ---: | --- |
| P11-01 | 0 | No approved operational release/sign-offs. |
| P11-02 | 0 | No approved-live shadow run. |
| P11-03 | 0 | No analyst live alert/push rollout. |
| P11-04 | 0 | No approved controlled payment action. |
| P11-05 | 0 | No production canary/rollback/error-budget evidence. |
| P11-06 | 0 | No operational scheduled policy/model drift review. |
| P11-07 | 0 | No ongoing post-release adoption reassessment evidence. |

## What remains largest

Source-owner lifecycle/money/time confirmation, stable identity/history and actual capture integration block real risk evaluation. Online stateful features, model evaluation/training, full authenticated user workflows/Web App notifications, pre-transfer decisions and production capacity/DR/release remain substantial. No business/production phase is marked complete from a sample, a local million-row restore or a mock UI.

[Historical27.2% snapshot](plan-progress-2026-10-23.md) is preserved; all percentage changes above use its same rubric/denominator.
