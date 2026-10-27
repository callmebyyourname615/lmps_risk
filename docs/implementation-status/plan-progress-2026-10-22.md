# Plan progress assessment — 2026-10-22

ประเมินความคืบหน้ารวมประมาณ **26.2%** (27.25/104 equivalent completed MUST items). เป็นการประเมินเชิงวิศวกรรมจากหลักฐานใน repository ไม่ใช่เปอร์เซ็นต์ความพร้อม Production, ความแม่นยำตรวจความเสี่ยง หรือเวลาที่เหลือ.

อ้างอิง [104 MUST items ใน P00–P11](../../../plan/03-implementation-phases.md) และ [actual checks](current.md). ทุกข้อมีน้ำหนักเท่ากันเพื่อให้ตรวจคำนวณซ้ำได้; ไม่อ้างว่า effort/risk ของแต่ละข้อเท่ากัน. ระดับคะแนนบางส่วนเป็น judgment ที่เปิดเผยด้านล่าง ไม่ใช่ตัวเลขที่วัดจากจำนวนไฟล์/tests. ไม่มีการลด denominator เพราะ UI ถูกเลื่อนหรือยังไม่มีข้อมูลจริง.

เกณฑ์: **0** ยังไม่มี implementation/evidence; **0.25** มี design/decision หรือ primitive เริ่มต้น; **0.5** ทำและทดสอบ local/synthetic ส่วนสำคัญแล้วแต่ยังขาด target integration; **0.75** เชื่อม scope หลักแล้วแต่ยังไม่ผ่าน exit gates บางข้อ; **1** requirement นั้นครบและยืนยันได้ตามขอบเขตที่ระบุ. Requirement ที่เป็น bootstrap โดยตรงให้1ได้; bootstrap ไม่ทำให้ business integration ข้ออื่นได้1.

ผู้ใช้เลือก Web App + Add to Home Screen และจะทำฝั่งแอปเอง. P07 ประเมินตาม capability เดิม (inbox/session/device-or-subscription/notifications/ack), ไม่ถือว่ามี native app/PWA/service worker/push ที่ทำแล้วจากการเลือกแนวทาง. Source/identity ที่ยังไม่ยืนยันไม่ถูกนับว่า verified.

| Phase | MUST items | Equivalent done | Progress |
| --- | ---: | ---: | ---: |
| P00 — New Repository และ Engineering Foundation | 8 | 5 | 62.5% |
| P01 — Source Profiling, Identity และ Data Semantics | 9 | 2.5 | 27.8% |
| P02 — Operational Data, API และ Security Foundation | 8 | 3.25 | 40.6% |
| P03 — Ingestion, Durable Events และ Historical Storage | 9 | 2.75 | 30.6% |
| P04 — Stateful Features และ Online Feature Serving | 9 | 2.25 | 25.0% |
| P05 — Rules, Anomaly และ Graph Baselines | 9 | 3.5 | 38.9% |
| P06 — Admin Portal, Case Management และ Labeling | 8 | 1.75 | 21.9% |
| P07 — Web App / Add to Home Screen และ High-risk Notifications | 9 | 1 | 11.1% |
| P08 — Evaluation, Training และ Model Lifecycle | 10 | 1 | 10.0% |
| P09 — Pre-transfer Decision Engine และ LMPS Integration | 9 | 1.5 | 16.7% |
| P10 — Integrated Hardening, Performance และ DR | 9 | 2.75 | 30.6% |
| P11 — Shadow, Controlled Production และ Continuous Operations | 7 | 0 | 0.0% |
| **Total** | **104** | **27.25** | **26.2%** |

สิ่งที่ลดคะแนนรวมมากที่สุดคือ actual source/identity/history, online feature serving, Cases/label QA, installed Web App/notification integration, model evaluation/training, LMPS payment decisions และ production/DR/capacity/rollout. No.34 เชื่อม local asynchronous job path; ไม่ปิด P03 backbone, P04 online service หรือ P09 payment orchestration.

## Evidence index

- Foundation: [toolchain](../architecture/toolchain.md), [compatibility](../architecture/compatibility-matrix.md), [CI](../../ci/README.md), [SBOM](../supply-chain/README.md).
- Source/data: [mapping and unverified gates](../data-dictionary/source-mapping.md), [synthetic publisher](../architecture/adr/0007-local-normalization-publication.md), [storage experiment](../architecture/adr/0005-transaction-storage-experiment.md).
- Backend/risk: [risk features](../../packages/risk/src/features.ts), [scoring](../../packages/risk/README.md), [immutable assessments](../architecture/adr/0009-local-rule-assessments.md), [alerts/reviews](../architecture/adr/0011-local-alert-review.md), [No.34 jobs](../architecture/adr/0012-synthetic-risk-job-flow.md).
- UI/ML: [existing Portal](../../apps/risk-portal/src/App.tsx), [ML service](../../services/ml-inference/lmps_ml/app.py), [remaining decisions](../../../plan/09-missing-inputs-and-foundation-readiness.md).

## P00 — item assessment

| MUST item | Score | Evidence / remaining gap |
| --- | ---: | --- |
| P00-01 | 1 | Workspace/fresh bootstrap verified. |
| P00-02 | 1 | Strict TS and locked Node/Python environments verified. |
| P00-03 | 0.5 | Pinned local matrix/SBOM; Linux, release and legal gates pending. |
| P00-04 | 1 | Actual API/worker/FastAPI/contracts entrypoints and honest readiness verified. |
| P00-05 | 0.5 | Fixtures/mode/private files tested; deployed environment separation pending. |
| P00-06 | 0.5 | Local/fresh CI passes; hosted/image verification pending. |
| P00-07 | 0.25 | ADR/handoff records exist; named owners/SLOs missing. |
| P00-08 | 0.25 | Spikes/ADR queue exist; adoption decisions incomplete. |

## P01 — item assessment

| MUST item | Score | Evidence / remaining gap |
| --- | ---: | --- |
| P01-01 | 0.5 | Bounded local/source-preflight and snapshot profiler; approved real source absent. |
| P01-02 | 0.25 | Synthetic storage profiling; actual source coverage/TPS/mix unknown. |
| P01-03 | 0 | Account masking/stable identity explicitly unverified. |
| P01-04 | 0.25 | Draft member/routing mapping; owner confirmation absent. |
| P01-05 | 0.25 | Synthetic identity/replay contracts and draft real mapping only. |
| P01-06 | 0.5 | Synthetic lifecycle normalizer/publisher tested; real codebook unconfirmed. |
| P01-07 | 0.25 | Availability/time uncertainty recorded; real provenance unavailable. |
| P01-08 | 0 | Verified account resolver/tokenizer not implemented. |
| P01-09 | 0.5 | Draft dictionary/local DQ tests; approved real field/retention controls missing. |

## P02 — item assessment

| MUST item | Score | Evidence / remaining gap |
| --- | ---: | --- |
| P02-01 | 0.5 | Local schemas/revisions/risk/alerts/jobs tested; canonical business/Cases/physical freeze incomplete. |
| P02-02 | 0.5 | Immutable local rules/assessments and replay tested; production publication pending. |
| P02-03 | 0.25 | Local JWT/workspace scopes; selected real IdP/service/institution/case integration missing. |
| P02-04 | 0.5 | Typed/OpenAPI/scoped error/idempotency/concurrency tested locally; target integration pending. |
| P02-05 | 0.5 | Native local roles/reader isolation tested; production encryption/key/audit design incomplete. |
| P02-06 | 0.5 | Local fake outbox/lease/retry/dedup tested; real provider/business coupling incomplete. |
| P02-07 | 0.25 | Private-artifact controls/design exist; approved retention/exports/attachments absent. |
| P02-08 | 0.25 | Bounded pools/health/audit APIs; production metrics/traces/PgBouncer incomplete. |

## P03 — item assessment

| MUST item | Score | Evidence / remaining gap |
| --- | ---: | --- |
| P03-01 | 0.25 | Backbone ADR proposed; owner adoption/operations sign-off missing. |
| P03-02 | 0.25 | Local native source fixture/snapshot strategy; selected real connector absent. |
| P03-03 | 0.5 | Synthetic normalizer and publisher integrated; approved backbone/tokenization absent. |
| P03-04 | 0.25 | Local job/revision checkpoint/dedup primitives; snapshot-to-stream handoff missing. |
| P03-05 | 0.25 | Typed contracts/validation exist; selected registry/DLQ/remediation absent. |
| P03-06 | 0 | No historical Parquet/object dataset writer. |
| P03-07 | 0.25 | Storage/key experiment and query proposal; historical workload ADR missing. |
| P03-08 | 0.5 | Synthetic exact count/amount reconciliation tested; approved source reconciliation absent. |
| P03-09 | 0.5 | Local/test guards/replay isolation tested; live/shadow/backfill deployment modes absent. |

## P04 — item assessment

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

## P05 — item assessment

| MUST item | Score | Evidence / remaining gap |
| --- | ---: | --- |
| P05-01 | 0.5 | Restricted shared rules and job path tested locally; online approved scopes absent. |
| P05-02 | 0.5 | All15 reference detectors executable; real-source policy review pending. |
| P05-03 | 0.5 | Immutable versions/replay tested; draft/approval/effective-date/rollback workflow absent. |
| P05-04 | 0.5 | Synthetic mean-ratio baselines/cold-start tested; actual peer/unsupervised baselines absent. |
| P05-05 | 0.5 | Bounded synthetic temporal paths/cycles; verified entity graph unavailable. |
| P05-06 | 0 | No graph storage/query comparative benchmark/adoption. |
| P05-07 | 0.5 | Separate synthetic indices/evidence/lo-en catalog; actual calibrated risk semantics pending. |
| P05-08 | 0.5 | Versioned local grouped-alert/job dedup tested; real capacity/threshold governance missing. |
| P05-09 | 0 | No MLflow baseline experiment records. |

## P06 — item assessment

| MUST item | Score | Evidence / remaining gap |
| --- | ---: | --- |
| P06-01 | 0.25 | Partial Alert Portal exists; full navigation/views and final acceptance deferred. |
| P06-02 | 0.5 | Existing browser subset exercises loading/empty/error/stale/partial/permissions; full product coverage missing. |
| P06-03 | 0.25 | Acknowledge/review/notes/concurrency ledger exists; assignment/Cases/attachments absent. |
| P06-04 | 0.5 | Rule/risk/feature/policy evidence displayed locally; model/actual-source coverage absent. |
| P06-05 | 0.25 | Reviewer opinions stored; no confirmed per-dimension/mature label workflow. |
| P06-06 | 0 | No label adjudication/versioning workflow. |
| P06-07 | 0 | No non-alert sampling/QA dataset workflow. |
| P06-08 | 0 | No bounded authorized business export/attachment flow. |

## P07 — item assessment

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

## P08 — item assessment

| MUST item | Score | Evidence / remaining gap |
| --- | ---: | --- |
| P08-01 | 0 | No versioned training/evaluation dataset/split pipeline. |
| P08-02 | 0 | No labeled population/segment performance metrics. |
| P08-03 | 0.25 | Reference detector/baseline designs; same-cohort comparative evaluation absent. |
| P08-04 | 0 | No supervised training/calibration; labels unavailable. |
| P08-05 | 0 | No deployed MLflow registry/approval/signature lifecycle. |
| P08-06 | 0.25 | FastAPI bootstrap/contracts/honest unready state; real inference adapters/warmup/rollback absent. |
| P08-07 | 0.25 | Synthetic jobs/versioned evidence only; training/data batch orchestration absent. |
| P08-08 | 0 | No champion/challenger or drift operations. |
| P08-09 | 0 | No implemented vendor/GNN evaluation adapter. |
| P08-10 | 0.25 | Evaluation/limitations planning exists; no measured model card/report. |

## P09 — item assessment

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

## P10 — item assessment

| MUST item | Score | Evidence / remaining gap |
| --- | ---: | --- |
| P10-01 | 0.25 | Platform/stack/ADR planning only; no reproducible deployment IaC. |
| P10-02 | 0.25 | Local secrets/scope/isolation primitives; deployed security/retention incomplete. |
| P10-03 | 0.5 | Frozen locks/SBOM/publication checks; verified images/release process absent. |
| P10-04 | 0.25 | Synthetic 10k-row storage experiment; no agreed full-flow growth/stress envelope. |
| P10-05 | 0.5 | Native local source/PG/worker/outage/crash tests; broker/engine/model/provider integration absent. |
| P10-06 | 0.5 | Actual local current/legacy DB restore tested; datasets/artifacts/config-secret recovery incomplete. |
| P10-07 | 0.25 | Isolated restore and worker fencing primitives; measured failback/DR/RPO/RTO absent. |
| P10-08 | 0.25 | Local health/status/runbooks; production observability/on-call/scaling incomplete. |
| P10-09 | 0 | No formal threat model/penetration-test evidence. |

## P11 — item assessment

| MUST item | Score | Evidence / remaining gap |
| --- | ---: | --- |
| P11-01 | 0 | No approved operational release/sign-offs. |
| P11-02 | 0 | No approved-live shadow run. |
| P11-03 | 0 | No analyst live alert/push rollout. |
| P11-04 | 0 | No approved controlled payment action. |
| P11-05 | 0 | No production canary/rollback/error-budget evidence. |
| P11-06 | 0 | No operational scheduled policy/model drift review. |
| P11-07 | 0 | No ongoing post-release adoption reassessment evidence. |

