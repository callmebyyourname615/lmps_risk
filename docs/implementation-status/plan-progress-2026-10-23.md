# Plan progress assessment — 2026-10-23

ประเมินความคืบหน้ารวมประมาณ **27.2%** (28.25/104 equivalent completed MUST items). เป็นการประเมินเชิงวิศวกรรมจากหลักฐานใน repository ไม่ใช่เปอร์เซ็นต์ความพร้อม Production, ความแม่นยำตรวจความเสี่ยง หรือเวลาที่เหลือ.

อ้างอิง [104 MUST items ใน P00–P11](../../../plan/03-implementation-phases.md) และ [actual checks](current.md). ทุกข้อมีน้ำหนักเท่ากันเพื่อให้ตรวจคำนวณซ้ำได้; ไม่อ้างว่า effort/risk ของแต่ละข้อเท่ากัน. ระดับคะแนนบางส่วนเป็น judgment ที่เปิดเผยด้านล่าง ไม่ใช่ตัวเลขที่วัดจากจำนวนไฟล์/tests. ไม่มีการลด denominator เพราะ UI ถูกเลื่อนหรือยังไม่มีข้อมูลจริง.

เกณฑ์: **0** ยังไม่มี implementation/evidence; **0.25** มี design/decision หรือ primitive เริ่มต้น; **0.5** ทำและทดสอบ local/synthetic ส่วนสำคัญแล้วแต่ยังขาด target integration; **0.75** เชื่อม scope หลักแล้วแต่ยังไม่ผ่าน exit gates บางข้อ; **1** requirement นั้นครบและยืนยันได้ตามขอบเขตที่ระบุ. Requirement ที่เป็น bootstrap โดยตรงให้1ได้; bootstrap ไม่ทำให้ business integration ข้ออื่นได้1.

ผู้ใช้เลือก Web App + Add to Home Screen และจะทำฝั่งแอปเอง. P07 ประเมินตาม capability เดิม (inbox/session/device-or-subscription/notifications/ack), ไม่ถือว่ามี native app/PWA/service worker/push ที่ทำแล้วจากการเลือกแนวทาง. Source/identity ที่ยังไม่ยืนยันไม่ถูกนับว่า verified.

| Phase | MUST items | Equivalent done | Progress |
| --- | ---: | ---: | ---: |
| P00 — New Repository และ Engineering Foundation | 8 | 5.00 | 62.5% |
| P01 — Source Profiling, Identity และ Data Semantics | 9 | 2.50 | 27.8% |
| P02 — Operational Data, API และ Security Foundation | 8 | 3.25 | 40.6% |
| P03 — Ingestion, Durable Events และ Historical Storage | 9 | 2.75 | 30.6% |
| P04 — Stateful Features และ Online Feature Serving | 9 | 2.25 | 25.0% |
| P05 — Rules, Anomaly และ Graph Baselines | 9 | 3.75 | 41.7% |
| P06 — Admin Portal, Case Management และ Labeling | 8 | 2.50 | 31.3% |
| P07 — Web App / Add to Home Screen และ High-risk Notifications | 9 | 1.00 | 11.1% |
| P08 — Evaluation, Training และ Model Lifecycle | 10 | 1.00 | 10.0% |
| P09 — Pre-transfer Decision Engine และ LMPS Integration | 9 | 1.50 | 16.7% |
| P10 — Integrated Hardening, Performance และ DR | 9 | 2.75 | 30.6% |
| P11 — Shadow, Controlled Production และ Continuous Operations | 7 | 0 | 0.0% |
| **Total** | **104** | **28.25** | **27.2%** |

ตรวจหลัง No.38.1 เสร็จ: project PG18503 มี28ตาราง/15 migrations พร้อม synthetic approved Policy→Risk job→Alert→Case; final fresh-source839 tests ผ่าน. No.35.1–35.3 เพิ่ม offline profiling/staging/replay; No.36.1 เพิ่ม governance และ No.37.1 เพิ่ม Case workflow. ไม่ได้เชื่อม source จริงหรือเพิ่ม2GB import support.

เทียบ snapshot No.34 เดิม คะแนนเพิ่ม1.00 equivalent item จาก4ข้อ: P05-03 +0.25, P06-03 +0.25, P06-05 +0.25, P06-06 +0.25. ข้ออื่นตรวจหลักฐานใหม่แล้วคงคะแนนเดิม เพราะยังไม่ข้าม rubric/target integration gate; ไม่ให้คะแนนเพิ่มตามจำนวนตาราง/tests/งานที่ทำ. [Snapshot เดิม26.2%](plan-progress-2026-10-22.md) เก็บไว้เป็นประวัติ.

สิ่งที่ยังค้างมากที่สุดคือ actual source/identity/history, online features, Case UI/attachments/label QA, installed Web App/notifications, model evaluation/training, LMPS payment integration และ production/capacity/DR. ไม่มี business/production phase ใดถูกประกาศ COMPLETE จาก synthetic demo; P11 ยังไม่เริ่ม.

ทิศทางถัดไปจากผู้ใช้คือ manual MariaDB export→copy Flash drive→offline import/reconcile ก่อน sync. ยังไม่มีไฟล์หรือ source configuration และผู้ใช้จะรัน export/copy เอง. ความตั้งใจนี้ยังไม่ใช่ผลทดสอบข้อมูลจริงหรือการอนุมัติข้าม source/identity gates.

## Evidence index

- Foundation: [toolchain](../architecture/toolchain.md), [compatibility](../architecture/compatibility-matrix.md), [CI](../../ci/README.md), [SBOM](../supply-chain/README.md).
- Source/data: [mapping and unverified gates](../data-dictionary/source-mapping.md), [synthetic publisher](../architecture/adr/0007-local-normalization-publication.md), [storage experiment](../architecture/adr/0005-transaction-storage-experiment.md).
- Latest integrated runtime: [No.38 commands/limits](../operations/local-core.md), [Policy governance](../architecture/adr/0013-local-risk-policy-lifecycle.md), [Case backend](../architecture/adr/0014-local-cases.md), [offline import](../data-dictionary/offline-dataset-import.md), [offline replay](../data-dictionary/offline-risk-replay.md).
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
| P01-01 | 0.5 | Bounded native preflight/snapshot and64MiB/100000-row CSV profiling/import tools tested; actual approved source/export absent. |
| P01-02 | 0.25 | Synthetic10k storage/100k offline boundaries measured; actual source coverage/peak/mix remain unknown. |
| P01-03 | 0 | Account masking/stable identity explicitly unverified. |
| P01-04 | 0.25 | Draft member/routing mapping; owner confirmation absent. |
| P01-05 | 0.25 | Synthetic identity/replay contracts and draft real mapping only. |
| P01-06 | 0.5 | Synthetic lifecycle normalizer/publisher tested; real codebook unconfirmed. |
| P01-07 | 0.25 | Availability/time uncertainty recorded; real provenance unavailable. |
| P01-08 | 0 | Verified account resolver/tokenizer not implemented. |
| P01-09 | 0.5 | Draft dictionary, exact raw-value DQ/private CSV and restricted staging checks exist; real field/codebook/retention approval missing. |

## P02 — item assessment

| MUST item | Score | Evidence / remaining gap |
| --- | ---: | --- |
| P02-01 | 0.5 | 15 reviewed migrations/27 platform tables plus ledger applied locally, including policies/Cases; canonical business mapping and production physical freeze missing. |
| P02-02 | 0.5 | Immutable local rules/assessments and independently approved policy versions/replay tested; target publication/governance acceptance pending. |
| P02-03 | 0.25 | Local JWT/workspace/Case/policy scopes tested; selected corporate IdP/service/institution entitlements absent. |
| P02-04 | 0.5 | Typed/OpenAPI/scoped errors, Case/policy CAS and exact retries proven over TCP; target integration/pre-transfer binding contract pending. |
| P02-05 | 0.5 | Isolated intake/outbox/reviewer/policy/Case roles and app raw-staging denial tested; production encryption/keys/admin audit incomplete. |
| P02-06 | 0.5 | Local fake outbox/lease/retry/dedup tested; real provider/business coupling incomplete. |
| P02-07 | 0.25 | Private CSV/report/staging field/role boundaries tested; approved classification/retention/exports/attachments remain incomplete. |
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
| P03-08 | 0.5 | Synthetic snapshot reconciliation and100k-row offline staging count/hash checks tested; actual currency/product/lifecycle/date reconciliation absent. |
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
| P05-03 | 0.75 | No.36/38 connect draft/submit/independent approval/activation/rollback, frozen comparison and approved jobs; effective-date scheduling/production policy and mandatory comparison gates pending. |
| P05-04 | 0.5 | Synthetic mean-ratio baselines/cold-start tested; actual peer/unsupervised baselines absent. |
| P05-05 | 0.5 | Bounded synthetic temporal paths/cycles; verified entity graph unavailable. |
| P05-06 | 0 | No graph storage/query comparative benchmark/adoption. |
| P05-07 | 0.5 | Separate synthetic indices/evidence/lo-en catalog; actual calibrated risk semantics pending. |
| P05-08 | 0.5 | Grouped Alert/dedup/review/job flow now connects to Cases over native PG/TCP; actual alert yield/capacity/threshold approval missing. |
| P05-09 | 0 | No MLflow baseline experiment records. |

## P06 — item assessment

| MUST item | Score | Evidence / remaining gap |
| --- | ---: | --- |
| P06-01 | 0.25 | Existing Overview/Alert/definitions/evidence Portal subset has local checks; full Transactions/Cases/Rules/Graph/health/audit UI integration absent. |
| P06-02 | 0.5 | Existing browser subset exercises loading/empty/error/stale/partial/permissions; full product coverage missing. |
| P06-03 | 0.5 | Case assignment/linking/notes/open-review-close-reopen/CAS/audit and Alert review integrated locally; attachments/Case UI/production membership missing. |
| P06-04 | 0.5 | Rule/risk/feature/policy evidence displayed locally; model/actual-source coverage absent. |
| P06-05 | 0.5 | Versioned Fraud/Mule/AML opinions/evidence/reviewer metadata persist; maturity stays unverified/training-false, confirmed/mature label policy absent. |
| P06-06 | 0.25 | Outcome versioning, supersession and reopen/evidence/assignee invalidation tested; independent label review/adjudication absent. |
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
| P10-06 | 0.5 | Original8-table and current28-table project backups restored/fingerprinted with app denials; original CSV/artifact/config-secret recovery incomplete. |
| P10-07 | 0.25 | Isolated restore and worker fencing primitives; measured failback/DR/RPO/RTO absent. |
| P10-08 | 0.25 | Local health/scoped operations and runnable core/API/backup runbooks tested; production traces/metrics/on-call/scaling incomplete. |
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

