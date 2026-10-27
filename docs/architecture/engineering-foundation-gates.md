# Engineering foundation: ownership, target inputs and adoption spikes

Status: local planning record, 2026-10-19. It fulfils the record-keeping part of P00-07/P00-08; it does not assign a named owner, approve a product, establish an SLO or pass a production gate. See [P00](../../../plan/03-implementation-phases.md), the [decision register](../../../plan/06-decisions-and-references.md) and [release gates](../../../plan/05-evaluation-security-deployment.md).

Update 2026-10-20: the user confirmed Ubuntu x64 as the Production target and stated that named owners/SLO inputs are not yet available. Keep them pending. The [missing-input summary](../../../plan/09-missing-inputs-and-foundation-readiness.md) records the exact requested inputs and affected gates. No Production Ubuntu release, runtime/resources or SLO has been inferred from the existing ubuntu-24.04 CI configuration.

## Ownership register

The roles below are accountable roles only. Every **named owner** is `TBD` until the organisation assigns one; an ADR, test result or local code does not substitute for that assignment.

| Area | Accountable role | Named owner | Required before | Decision/evidence to maintain |
| --- | --- | --- | --- | --- |
| Architecture, service boundaries and ADRs | Technical Lead | TBD | Product adoption or cross-service integration | ADR status, version/patch compatibility, rollback/revisit trigger |
| LMPS source, replica budget and data semantics | LMPS/Data Owner | TBD | Any real extract, snapshot or CDC | O-001–O-006/O-017 source mapping, safe query/binlog budget, reconciliation scope |
| Risk typologies, labels and action policy | Risk/Model Governance | TBD | Alerts, scores, review outcomes or enforcement | O-004/O-010/O-012, thresholds, human-review and degraded-policy evidence |
| Identity, privacy, residency and access | Security/Data Governance | TBD | Identity resolution, retained raw data, vendor or push data | O-002/O-007/O-008/O-009/O-016, approval and retention evidence |
| Platform, resilience and capacity | SRE/Infrastructure | TBD | Shared runtime, staging or release | O-006–O-008/O-013/O-015/O-016, SLOs, capacity envelope, DR/on-call runbooks |
| Mobile recipient and user experience | Product/Risk/Mobile | TBD | Any sandbox or real push delivery | O-009, recipient authority, inbox/ack/escalation and distribution evidence |
| Procurement and commercial terms | Procurement | TBD | Paid vendor, managed platform or enterprise edition | O-011/O-015, quote, DPA/residency, support and renewal/exit terms |

## Actual, target and stress inputs

| Profile | Known fact | Still required before sizing/claiming capacity |
| --- | --- | --- |
| Actual | Initial context stated about 1,000,000 transactions/day. A reported interval of 50–100 transactions per 5 seconds is an observation from the user, not a measured peak or source row-change rate. | Measurement period, peak/burst duration, source rows/bytes per payment, retry/reversal mix, hot keys, concurrent users/devices and query mix |
| Target | The approved design/benchmark target is 5,000,000 business payments/day. | Target arrival shape, peak multiplier, retention, assessments/alerts per payment, active-account/graph state and a named resource configuration |
| Stress/recovery | No approved stress profile exists. | Dependency failures, backlog/replay volume, source/target outage, recovery time, error/admission policy and data-correctness checks |

Every service or future spike must record, before an acceptance claim: p95/p99 end-to-end latency budget; availability/error definition; freshness/lag bound where applicable; RPO/RTO; correctness/reconciliation measure; retained volume; cost boundary; alert/review capacity; owner; and stop/rollback condition. Leave values `TBD` until the owner agrees them. Daily average must never become a TPS, node-count or SLO claim.

`G-CAP5M` remains pending until the full target profile, end-to-end correctness/SLO and recovery pass on a stated resource configuration. A lower-capacity release may have its own measured envelope, admission policy and stop conditions; it is not evidence for the 5-million target.

## Adoption spikes

All spikes use an isolated synthetic or explicitly approved non-production dataset. Each has a named owner, exact version/digest and license/security-patch record before it starts. A passing spike selects nothing until its decision is recorded in an ADR; a failing spike retains evidence and removes test resources.

| Spike | Candidate decision | Minimum experiment and acceptance evidence | Blocks adoption until |
| --- | --- | --- | --- |
| Event capture/backbone | Kafka + Kafka Connect/Debezium + Avro/registry reference branch, or an organisation-supported alternative | Snapshot-to-stream handoff; update/delete/DDL/restart/replay; bounded replica load/lag; offset/schema recovery; ACL/retention; PostgreSQL idempotency and cost/on-call record | Source owner approval, exact version matrix and [ADR-0004](adr/0004-event-backbone.md) gates |
| Stateful stream engine | Flink vs Kafka Streams vs bounded consumer | Same golden event stream; event-time/lateness/reversal semantics; state growth/checkpoint/restore; key ordering; correctness, p95/p99, cost and operator recovery | Selected backbone, target feature contract and operations owner |
| Online feature store/cache | Valkey vs Redis or no separate cache for the selected scope | Deterministic feature parity; TTL/version/freshness; stale-write prevention; outage/rebuild; authorization; memory/latency and license/support comparison | Selected serving workload, recovery/RPO and security review |
| Historical storage/query | Object/Parquet plus query layer; ClickHouse only if justified | Correction/replay and partition pruning; exact money/count reconciliation by currency/status/time; retention/delete; representative investigator queries; restore/cost test | Historical query/retention requirements, residency and operations owner |
| IaC | OpenTofu vs Terraform | Isolated plan/apply/destroy; encrypted locked state; least privilege; review/audit; rollback/recovery and provider/support/license record | Environment/provider, state owner and approved spend scope |
| Deployment runtime | Supported OCI runtime; Kubernetes only if operations support it | Reproducible image/digest; non-secret config; rollout/rollback; health/readiness; scaling; logs/traces/metrics; backup/DR and image SBOM/scan | Environment, platform SLO/RPO/RTO, on-call and security approval |
| Mobile/push | React Native/mobile decision; FCM/APNs delivery path | Recipient authority; sandbox tokens; durable inbox/outbox; retry/dedup; device revoke; acknowledgement/escalation; delivery/notification privacy and residency | O-009, mobile owner, provider/data terms and G-PUSH evidence |

## Required record for every spike

Create/update one ADR with: problem and alternatives; exact versions/digests; test dataset and environment; owner; expected and observed correctness/latency/resource/cost; threat/privacy review; recovery/cleanup result; rejected alternatives; decision; rollback path; and revisit trigger. Do not use a benchmark score total to select a fraud/AML/mule method or infrastructure product.

No real LMPS connection, mobile recipient, cloud resource, provider call, purchase or deployment is authorized by this document.

## Consolidated adoption evidence register — US-301, 2026-10-25

[ADR-0017](adr/0017-local-adoption-evidence-register.md) provides one decision record per unadopted backbone, stream engine, cache, history, deployment and IaC component. It maps to the existing Adoption spikes table above and reuses the [compatibility matrix](compatibility-matrix.md); neither inventory nor historical evidence is replaced. Exact versions, named owners, observations and adoption approval remain pending. This is a local decision plan only.

The selected application direction remains the user-owned **Web App with Add to Home Screen**, built separately, as recorded in [ADR-0012](adr/0012-synthetic-risk-job-flow.md). The historical Mobile/push spike row is a conditional alternative, not a requirement to install React Native, native tooling or providers. Any alternative requires a separate user decision and does not supersede the Web App direction.

The frozen docs check group defines no package test commands. Candidate checks are reported in the task handoff; independent host source/field/plan/Git and publication/secret guards and a durable host receipt remain pending. The implementation-status history is preserved outside this task's two-file allowlist. No target requirement or production gate closes here.
