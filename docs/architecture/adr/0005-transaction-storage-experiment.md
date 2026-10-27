# ADR-0005 — Transaction keys and storage experiment

Status: EXPERIMENTAL — local spike complete; production choice and physical schema freeze pending. Owner: TBD. Date: 2026-10-20.

## Purpose and decision

P02-01 requires query/key/partition evidence before freezing business migrations. No.26 implements a repeatable native PostgreSQL comparison, using invented data only. Keep both candidates open. This small warm run does not select a production schema or close P02/S04. Real business keys, institution entitlements, source timezone/currency semantics, retention, workload, SLOs and production resources remain unverified.

## Run and isolation

From the repository root, with the pinned Node/pnpm and local PostgreSQL18 binaries prepared:

```sh
pnpm --silent db:transaction-design
pnpm test:database
```

The command accepts no arguments or external DSN. It creates a new private scratch cluster on an available loopback port, uses existing initialization/ownership checks, then stops and removes it before printing the JSON report. Callback failures also clean up; unverifiable/unstoppable cluster state is retained rather than recursively deleting a potentially live database. CLI failures print a fixed message. Local/test mode only; no source, project PostgreSQL, snapshot, migration ledger, service configuration or production role is changed.

Experimental DDL remains inside [transaction-design.mjs](../../../packages/database/scripts/transaction-design.mjs), outside the production migration set. The scratch migration-role pool allows two connections to test competing writes; normal application/migration pool budgets are unchanged. Both writer and benchmark run as the scratch migration owner, not a production least-privilege ingest role.

## Candidates and invariants

| Candidate | Storage and keys | Cost / boundary |
| --- | --- | --- |
| A — current | One unpartitioned body, global BIGINT PK; unique `(workspace, synthetic_namespace, synthetic_key)` | One body insert; no separate registry |
| B — partitioned | Three monthly body partitions; unpartitioned registry has global BIGINT PK, the same scoped synthetic-key constraint and unique `(id, routing_day, workspace)`; body PK `(routing_day,id)` and composite FK to registry | Registry + body writes must share a transaction; extra registry/index bytes; missing partitions reject |

Both bodies have `(workspace, occurred_at DESC, id DESC)` indexes. Candidate A has no separate routing-day index in this experiment; routed-query results compare these exact candidates, not the best achievable indexed alternatives. Registry lookup supplies the physical routing day for B. Scope is an invented workspace label, not an institution entitlement or account identifier. No real source row/reference has been promoted to a verified business key.

The fixed dataset has10,000 records per candidate,90 invented UTC routing days from January through March2026,90% `synthetic_alpha` and10% `synthetic_beta`, deterministic leading-zero keys, BIGINTs above JavaScript safe integer precision, NUMERIC(24,2) amounts and fictional currency `SYN`. Workspace and routing-day distributions are correlated by this fixture generator; it is not representative production skew. Body count and ordered MD5 checksums must match before a comparison is returned. MD5 here compares invented datasets, not security integrity or source completeness.

Money and BIGINTs remain strings through pg and JSON. These SQL prototypes are not an input validator: PostgreSQL NUMERIC(24,2) can round excess fractional digits, so upstream exact-scale validation is still required before any future business writer. Nonnegative money is only a synthetic fixture constraint, not an approved LMPS sign/unit rule.

Keyset pagination uses `(occurred_at,id)` and the full workspace filter. Tests read every page and compare it with the complete sorted dataset, including identical timestamps spanning a page boundary with BIGINT tie-breakers. These are live pages, not an as-of export. Correction-between-pages can change membership; the benchmark measures fixed data. A corrected occurrence time can lie outside the routing month; the tested lookup/timeline retains it without inventing a routing predicate. Partition-date relocation, immutable revisions/events, lifecycle ordering, retention/holds and reconciliation are not implemented by these tables.

Native tests cover complete-key uniqueness across dates, namespace/workspace separation, null-key rejection, global IDs, composite FK date/workspace enforcement, exact money/overflow/leading-zero round-trip, atomic rollback, missing partitions, two competing insert transactions, late corrections, query pruning and scratch cleanup on success/failure. Duplicate writes reject with SQL uniqueness errors; this experiment does not implement application idempotency or input-hash conflict responses.

## Actual local measurement

Standalone measurement recorded at2026-10-20T12:31:25Z. Apple M1,8 logical CPUs,8GiB host RAM, macOS/Darwin25.2.0 arm64, Node24.22.0, PostgreSQL18.3(Homebrew). Shared buffers32MB, work_mem4MB, max_connections30, fsync/synchronous_commit/partition_pruning/jit on. No CPU/memory resource isolation or storage-device throughput measurement. The target Ubuntu x64 environment has not been tested.

Each query has3 warmups then50 sequential pool round trips, A before B, concurrency1. Percentiles use nearest rank; p99 is the maximum of50 observations, not a production tail estimate. EXPLAIN ANALYZE/BUFFERS JSON is recorded separately after sampling. No cache reset, randomized ordering, repeated trials or background-load control is claimed.

| Query | A p95 / p99 ms | B p95 / p99 ms |
| --- | --- | --- |
| Scoped synthetic-key lookup | 0.220 /0.273 | 0.327 /0.511 |
| Hot workspace first page | 0.316 /0.456 | 0.261 /0.272 |
| Hot workspace next page | 0.257 /0.386 | 0.380 /0.787 |
| Cold workspace first page | 0.188 /0.377 | 0.234 /0.316 |
| Explicit routing-day query | 0.802 /0.854 | 0.240 /0.271 |

| Load/storage observation | A | B, including registry |
| --- | --- | --- |
| Bulk load, one transaction | 58.089ms;1 INSERT | 113.301ms;2 INSERTs |
| WAL insert-LSN delta | 4,812,336 bytes | 8,065,168 bytes |
| Table bytes including auxiliary storage | 1,130,496 | 1,843,200 |
| Index bytes | 2,146,304 | 3,284,992 |
| Total relation bytes | 3,276,800 | 5,128,192 |

B's routing-day plan accesses only `body_feb`; the unbounded hot timeline considers all three partitions. Registry adds writes/storage in this run, while an explicit routing predicate helps prune. These observations do not establish a winner: routing-date predicates must first be valid for the actual query and correction contract. WAL is the cluster-wide insert-LSN difference during bulk load, including any concurrent internal work; it is not a durable/retained WAL or per-event write-amplification benchmark.

Focused native/CLI tests11 passed. Final `pnpm verify:fresh` passed496 offline tests with frozen cached installs, typechecks/builds, generated drift, SBOM176/0 UNKNOWN and publication checks. Original source hashes stayed unchanged during the run; temporary source and clusters were removed. Online advisories were explicitly skipped; no dependency changed.

## Remaining acceptance gates

Before production selection/freeze, supply approved complete business keys and unresolved handling, timezone/physical routing rules, query/scoping catalogue, actual and target volumes/skew, retention/holds, SLOs and resource configuration. Compare daily/monthly alternatives and optimized indexes using representative data on Ubuntu x64. Measure mixed ingest/read concurrency, per-event transaction costs, steady-state maintenance, cold/warm caches, corrections, source/version ordering, recovery/rebuild and retention dependencies. The five-million-payments/day figure remains an untested target.

Next P02 work remains separately scoped synthetic transaction revision persistence and business API contracts, followed by approved real mapping and physical constraints. This experiment creates no production business tables, canonical events, account graph, risk decision, deployment or publication.

## References

- [PostgreSQL design and acceptance matrix](../../../../plan/08-postgresql-enterprise-design.md)
- [Next implementation steps](../../../../plan/10-next-implementation-steps.md)
- [Actual implementation status](../../implementation-status/current.md)
- [Native experiment tests](../../../packages/database/test/transaction-design.test.mjs)
