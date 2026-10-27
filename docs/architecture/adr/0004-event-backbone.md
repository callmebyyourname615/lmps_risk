# ADR-0004 — Event backbone and change capture

Status: PROPOSED — no production product adoption or provisioning approved. Owner: TBD. Date: 2026-10-19.

## Context

The platform needs a durable path for future source changes, replay, independent consumers and historical/stream processing. The current implementation captures only a bounded synthetic MariaDB snapshot into a private local spool and PostgreSQL. It has no CDC position, connector, broker, schema registry or snapshot-to-stream handoff. The real LMPS replica has not been contacted.

The source schema reference does not establish the MariaDB version, binlog configuration, row-image settings, retention, replica privileges, source ownership, safe read budget or payment lifecycle. `fromaccount`/`toaccount` identity and masking semantics remain unverified. No field is approved for a production event contract yet.

## Proposed direction

Keep **MariaDB Debezium connector + Kafka Connect + Apache Kafka** as the reference branch for a non-production compatibility spike. This fits the existing plan for durable replay and multiple downstream consumers, but no measured LMPS workload or operations evidence establishes that it is the best or final choice. Avro/Apicurio remain versioned candidates for contract encoding/registry only after their compatibility, operations and license gates pass.

Do not provision or connect any of these components until an owner accepts the operational model and the source/replica owner approves a bounded test. A product already operated by the organization may be a better fit if it passes the same correctness, privacy, recovery and cost gates; record it as an alternative with product-specific tests before adoption.

## Candidate flow and trust boundaries

```text
approved non-production source copy
  → Debezium / Kafka Connect capture
  → restricted raw CDC zone (short, owner-approved retention and narrow ACL)
  → allowlisted normalization / identity resolution / tokenization
  → versioned canonical events on approved topics
  → idempotent PostgreSQL, historical and stream consumers
```

Raw CDC may contain sensitive values, including full account identifiers. Keep it isolated from general consumers, dashboards and logs. The normalizer may publish only owner-approved fields. Until account identity is verified, it must preserve unresolved/partial identity states; it must not treat masked strings or transaction row keys as account identity. Do not place real rows, account values, credentials or binlog fragments in this ADR, fixtures or ordinary application logs.

The event key used to deduplicate a source change is not a canonical payment ID or account ID. Define it only after actual source key and log-position semantics are verified. Preserve the source position, operation, snapshot marker and before/after availability needed for audit and replay, subject to approved data classification. Keep payment lifecycle interpretation in a later approved normalizer contract.

## Options considered

| Option | Fit | Limit / decision |
| --- | --- | --- |
| Debezium + Kafka Connect + Kafka (reference branch) | Provides a planned CDC and replay path for several consumers | Adds connector, broker, registry and on-call work; exact source/version compatibility, privacy controls, retention and recovery are unproven. Spike only. |
| Repeated bounded snapshots into the existing spool/import path | Reuses the tested local snapshot and replay boundary | Does not establish a continuous change position or prove that updates/deletes between captures are complete. Keep for approved backfill/snapshot work, not as evidence of CDC. |
| Organization-supported broker/change-feed alternative | Could reduce duplicated operations if the organization already supports it | No candidate is known. Must prove source-offset continuity, replay, ordering, schema changes, access control, privacy, failure recovery and sink idempotency with equivalent tests. |

## Correctness and recovery gates

Before adoption, an isolated non-production spike must prove, for exact pinned versions:

1. Source-version, connector, Kafka Connect, broker and serializer/registry compatibility, including license and security-patch ownership.
2. Snapshot-to-log handoff while rows change; restart and replay; inserts, updates, deletes, duplicate delivery, transaction ordering, DDL evolution and tombstones; no gap or silent reorder within the required key scope.
3. Durable offset/schema-history recovery and a documented re-bootstrap path if the source log expires before a consumer recovers.
4. Idempotent target writes and reconciliation. Do not claim end-to-end exactly-once across Kafka and PostgreSQL or external side effects.
5. Measured capture impact on an isolated replica/copy against limits set by its owner; include burst, lag, disk/IO and recovery catch-up. Never run a full snapshot on the payment primary as a test.
6. Least-privilege credentials, transport/storage encryption, private raw-topic ACLs, retention/deletion, secret rotation, redacted observability and an operator for incidents/replay.
7. Cost and staffing for broker/connect/registry high availability, retained data, backups, upgrades, monitoring, on-call and disaster recovery. No monthly price can be stated before deployment shape and retention are known.

## Blockers and inputs

- MariaDB version and actual topology; whether the approved replica permits CDC and what load/lag budget its owner sets.
- Binlog enabled state, format/row image, transaction metadata, retention headroom, privileges and restart/recovery procedure.
- Source key stability, snapshot consistency and change-history behavior for each approved table; payment identity/lifecycle mappings remain separate gates.
- Data owner/security approval for captured columns, raw-zone access, retention, residency and tokenization boundary.
- Operations owner, target availability/recovery objectives, broker/registry support, environment and cost inputs.
- Exact product/runtime versions, patch process and organization-supported alternatives.

Until these are resolved, P03-01 remains a draft proposal and P03-02 compatibility is NOT_STARTED. No Kafka, connector, registry, network path, database access or new dependency was added by this ADR.

## References

- [Implementation phases — P03](../../../../plan/03-implementation-phases.md)
- [Tech stack and cost — data platform](../../../../plan/01-tech-stack-and-cost.md)
- [Local sync jobs ADR](0003-local-sync-jobs.md)
- [Current implementation status](../../implementation-status/current.md)

Revisit when source/replica owners provide the compatibility and operating inputs above, or when an organization-supported backbone becomes available.
