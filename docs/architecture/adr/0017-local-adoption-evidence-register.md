# ADR-0017 — Local adoption evidence register

Status: PROPOSED decision plan only. Date: 2026-10-25. Task: US-301 / P00-08-T1.
Named owners: TBD. Exact candidate versions/digests: TBD (unselected).
Adoption approval: PENDING for every record. Spike execution/results: NOT_RUN.

## Scope and existing evidence

This is the single evidence register for six unadopted components. Each numbered section is an independently addressable decision record. Reuse the [foundation adoption spike table and ownership roles](../engineering-foundation-gates.md#adoption-spikes) and [compatibility matrix](../compatibility-matrix.md), rather than duplicating their inventories or treating candidates as implemented. Existing runtime/application pairings, PostgreSQL history, synthetic snapshot/import, outbox and reference calculators retain their recorded boundaries. B01/B02 implementations and receipts remain historical evidence; no implementation is repeated here.

The user-owned **Web App with Add to Home Screen**, built separately, remains selected; see [ADR-0012](0012-synthetic-risk-job-flow.md). Native/mobile alternatives are conditional on a future user decision, never mandatory installs. This plan adds no application, service worker, dependency, provider or provisioning.

Production target remains Ubuntu x64; its release, resources, runtime and operational acceptance are pending. Local macOS evidence and prepared CI do not prove production compatibility. Source configuration, real fields, payment lifecycle, masking/full-account representation, stable account identity and the masking boundary remain unverified. Synthetic identifiers establish no real account linkage.

## Shared evidence protocol

Before a future spike, assign its named owner and freeze bounded synthetic fixtures with independent expected outputs, content hashes, event order/as_of, clock/seed, commands, OS/architecture/resources and finite byte/row/time/retry/storage limits. These are experimental limits, not business thresholds or capacity claims. Record stop and cleanup conditions. Real source or approved non-production data access requires separate source/privacy approval. This document authorizes no spike execution.

Reference the existing compatibility matrix baseline and record the proposed exact patch-version/digest tuple for product, runtime, client/driver, connector/serializer, provider/plugin and adjacent services. Attach upstream support, license and security-patch evidence for that exact tuple. Neighboring versions or baseline tests prove no new pairing. No pins or dependencies change here.

| Evidence field (per record) | Current state / required future evidence |
| --- | --- |
| Selection and accountability | Candidates below; selected product, exact tuple, named spike/operator/patch owners and reviewer TBD |
| Acceptance contract | Correctness invariants below; owner-approved workload, latency/freshness, resource, RPO/RTO and TCO ceilings TBD before execution |
| Compatibility | Matrix reference, exact tuple/configuration hashes, support evidence and integration cases; NOT_RUN |
| Correctness and recovery | Oracle, expected/observed hashes, failure injections, restart/replay/restore reconciliation and cleanup; NOT_RUN |
| TCO | Common workload/resources/retention/availability assumptions, dated supplied prices/currency, measurement horizon, usage and operator hours; amounts TBD |
| Rollback | Prior compatible state/config/artifacts, commands, reconciliation, elapsed time and cleanup observations; NOT_RUN |
| Governance | License/security/privacy/residency/procurement reviews and named approval references PENDING; SBOM metadata is no license sign-off |
| Decision | Evidence links/hashes, reviewer/date, rejected alternatives/reasons and revisit trigger; adoption approval PENDING |

A future PASS requires every predeclared invariant and budget, successful rehearsed rollback and required reviews on the exact tuple. Missing evidence is PENDING/NOT_RUN, never PASS. Violated correctness, lost/duplicated logical output, unrecoverable state, exceeded budgets or failed rollback means FAIL: stop and preserve redacted evidence for explicit review/resume. A technical pass grants no adoption approval. Do not choose by aggregate benchmark score.

Compare TCO on the same owner-agreed horizon/workload: compute/storage/IO/network, HA replicas, backups/DR, monitoring, support/license, upgrades, staffing/on-call, migration and exit/egress. Separate measured usage, supplied quotes and assumptions. Missing prices/staffing remain unknown, never zero; no monthly total or capacity is invented. Each record adds component-specific costs below.

## 17.1 — Event capture and backbone

- **Candidates:** retain [ADR-0004](0004-event-backbone.md)'s Debezium MariaDB connector + Kafka Connect + Apache Kafka reference branch; Avro/Apicurio conditional on encoding/registry requirements. Organization-supported alternatives need identification. Existing bounded snapshot/import is a local baseline, not CDC.
- **Owner/version:** Technical Lead with LMPS/Data Owner and SRE/Infrastructure; named owners TBD. Exact source/broker/Connect/connector/client/serializer/registry/runtime tuple TBD; adoption PENDING.
- **Spike and pass/fail:** apply ADR-0004's gates on an approved isolated copy: changing-row snapshot-to-stream handoff, insert/update/delete/DDL, duplicates, ordering, restart/replay and sink reconciliation. Independent oracle must show no missing logical changes and idempotent sink effects. Measure source load/lag against source-owner limits; demonstrate raw-zone ACLs, offset/schema recovery and expired-log re-bootstrap. No cross-system exactly-once claim.
- **TCO:** broker/Connect/registry replicas, retained logs, source impact, replay/egress and continuous on-call under the shared protocol.
- **Rollback/revisit:** stop at recorded positions, preserve offsets/schema history and committed sink evidence; rehearse restore or approved re-bootstrap with dedup/reconciliation before resuming. Snapshots cannot silently replace CDC completeness. Revisit on source compatibility, retention, support or recovery failure.

## 17.2 — Stateful stream engine

- **Candidates:** Flink vs Kafka Streams vs bounded consumer, as in the existing spike table; none selected.
- **Owner/version:** Technical Lead and SRE/Infrastructure with Risk/Model Governance for semantics; named owners TBD. Exact engine/runtime/backbone/client/state/checkpoint tuple TBD; adoption PENDING.
- **Spike and pass/fail:** same bounded golden streams for duplicates, out-of-order/late corrections, reversals, separate currencies, hot keys and unavailable evidence. Independently expected count/exact-money/window/availability outputs must match; unsupported cases stay pending. Measure state growth, lag and p95/p99; crash at checkpoint/output boundaries, restore and replay without missing or multiplying logical outputs. Verify key ordering/lateness against predeclared semantics and budgets.
- **TCO:** workers, state/checkpoint storage, replay/recovery headroom and upgrade/operator effort.
- **Rollback/revisit:** freeze output/checkpoint coordinates; restore compatible code/state or rebuild retained inputs into an isolated namespace and reconcile before switching. Savepoint compatibility across versions is unproven. Revisit on semantic drift, state growth or failed recovery.

## 17.3 — Online feature store/cache

- **Candidates:** Valkey vs Redis vs no separate cache for the selected scope; cache is optional.
- **Owner/version:** Technical Lead, SRE/Infrastructure and Security/Data Governance; named owners TBD. Exact server/client/runtime/engine tuple and persistence/replication modes TBD; adoption PENDING.
- **Spike and pass/fail:** compare authoritative reference outputs; test TTL boundaries, freshness/version fencing, stale/concurrent writes, eviction, outage, restart and rebuild. Stale/missing evidence must remain explicitly unavailable under the approved serving policy. Verify isolation and memory/latency budgets; measure loss/rebuild against approved RPO/RTO.
- **TCO:** memory, replicas, persistence, rebuild traffic, support/license and incident effort; compare no-cache behavior on the same workload.
- **Rollback/revisit:** disable cache under an explicitly approved degraded policy; rebuild authoritative data with version fencing and reconcile before re-enabling. Never silently serve stale state. Revisit on stale writes, eviction pressure, licensing or rebuild failure.

## 17.4 — Historical storage/query

- **Candidates:** object storage + Parquet + query layer (DuckDB a candidate); ClickHouse only if representative queries justify it. Existing PostgreSQL local history is retained, not reimplemented as a new analytics product.
- **Owner/version:** LMPS/Data Owner, SRE/Infrastructure and Security/Data Governance; named owners TBD. Exact writer/format/reader/query-engine/object-API/runtime tuple TBD; adoption PENDING.
- **Spike and pass/fail:** independent count/exact-money oracle by currency/status/time; test corrections, replay, schema changes, pruning and representative investigator queries. Incomplete writes must never publish complete datasets; identical retries acknowledge and changed reuse conflicts. Restore must reconcile manifests/content. Approved retention/delete/legal-hold, authorization and residency requirements are prerequisites; unknown requirements block adoption.
- **TCO:** retained versions, requests/IO, query compute, replication, backup, restore and exit/egress.
- **Rollback/revisit:** retain immutable inputs/manifests and previous readable format/reader; publish candidate outputs separately and switch only after reconciliation. Revert pointer/reader without deleting evidence; rehearse restore and cleanup. Revisit on reconciliation, retention, query or format compatibility failure.

## 17.5 — Deployment runtime

- **Candidates:** supported OCI runtime; Kubernetes only with operations support. Cloud/managed choice and production runtime remain unselected; Ubuntu x64 direction remains.
- **Owner/version:** SRE/Infrastructure and Security/Data Governance; named owners TBD. Exact Ubuntu release/kernel/runtime/image digests/architecture and optional orchestrator tuple TBD; adoption PENDING.
- **Spike and pass/fail:** reproduce builds/image provenance, verify secret/config separation, health/readiness, isolation, telemetry and graceful shutdown. Exercise failed rollout, restart, backup/restore and rollback on the stated target, including native dependencies and service/database contracts. Scaling/capacity and RPO/RTO need predeclared resources/budgets; prepared CI is insufficient.
- **TCO:** hosts/control plane, spare capacity, storage/network, observability, patching and on-call.
- **Rollback/revisit:** retain previous image/config and compatible schemas/artifacts; rehearse rollback/restore on disposable fixtures. Image rollback cannot undo incompatible data migrations. Stop if backward compatibility is absent. Revisit on unsupported patches, readiness or recovery failures.

## 17.6 — Infrastructure as Code

- **Candidates:** OpenTofu vs Terraform; provider/environment/state backend unselected.
- **Owner/version:** SRE/Infrastructure with Security/Data Governance and Procurement; named owners TBD. Exact CLI/provider/plugin/state-backend/runtime tuple TBD; adoption PENDING.
- **Spike and pass/fail:** separately authorized isolated plan/apply/destroy with least privilege and finite spend. Verify deterministic review, encrypted locked state, concurrent-writer rejection, interrupted apply/import/drift handling, audit and redaction. Restore state and reconcile actual fixture resources before proceeding; no live resource experiment is authorized here.
- **TCO:** state/locking, provider/managed features, license/support, maintenance/review and migration/exit effort.
- **Rollback/revisit:** retain encrypted versioned state and prior configuration/provider locks; rehearse state recovery plus reviewed compensating plan. State-file rollback is not resource rollback; never blindly destroy shared resources. Prove cleanup/no orphaned fixture resources. Revisit on provider drift, license/support changes or failed recovery.

## Verification and handoff boundary

This task delivers only a local decision plan and an additive foundation link. No spike was executed. Exact-version compatibility, correctness, recovery, TCO measurements, rollback demonstrations, license sign-off and adoption remain pending for all six records. No target phase closes.

The frozen docs check group has no package test commands. Actual candidate document checks belong in the task handoff. Independent host source/field/plan/Git and publication/secret guards remain pending until run; only a durable independent host receipt establishes completion. Existing implementation-status history is preserved outside this task's allowlist, not updated with invented results.
