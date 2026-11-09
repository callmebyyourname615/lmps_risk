# ADR0020: bounded graph query baselines

Status: **PROPOSED**

## Decision under evaluation

Compare the existing genuine PostgreSQL runner with the independent standard-library Python reference on the frozen B13 local synthetic fixture. The comparator is import-inert and accepts only an absent private output destination. It has no runner, result, corpus, runtime or success injection interface. Supplementary assertion helpers provide diagnostics only; they cannot publish comparison proof.

## Reproduction

On the trusted parent host, after source promotion and the existing guards:

```sh
pnpm --filter @lmps/risk-api build
pnpm --filter @lmps/risk-workers build
node --test apps/risk-workers/test/graph-benchmark-compare.test.mjs
node apps/risk-workers/scripts/graph-benchmark-compare.mjs --output "$PWD/.local/graph-comparison-new"
```

The parent `.local` directory must already be private and owned. The output must be absent, have no symlink ancestors, and lie outside the configured PostgreSQL directory. Never use an existing database or pass a DSN. The genuine runner owns a fresh disposable loopback cluster, enforces its original <=180 second lifecycle including teardown, <=2 GiB scratch and disk reserve, and confirms shutdown/removal before returning. Failed or uncertain cleanup cannot yield a comparison. Inspect retained failure directories on the parent host before retrying with a new destination; do not treat their contents as accepted evidence.

`comparison.json` binds before/after source, compiled artifact and executable hashes, raw fixture and serialized corpus/query identities, exact observations, Python startup-inclusive elapsed milliseconds, SQL setup/load/query/EXPLAIN observations, runtime versions and confirmed cleanup. SQL reads the same immutable frozen fixture and profile recipes; its load values are raw positioned deliveries and its query values are the frozen queries. Python consumes serialized corpus bytes without oracle fields. Complete observation objects, including availability/reason, namespace, currency, prefix, coverage, truncation, arithmetic and ordered witnesses, must match. Independent fixed assertions additionally reject mutually consistent wrong answers. Caller-supplied hashes cannot establish acceptance.

One finite run executes one Python process per case/profile, one SQL observation and one EXPLAIN ANALYZE per query. EXPLAIN executes the query a second time. SQL timings describe client round trips; Python timings include process startup, validation and serialization. They are not equivalent engine-only timings. Index creation/query timing is pending because the preserved runner measures only `no_index`. No p95, representative throughput, SLO or production TCO is inferred.

## Correctness and support matrix

| Cases | PostgreSQL / Python | Unchanged TS detector |
|---|---|---|
| Small fan and strict-time chain/cycle | Full observations and independent fixed values | Executed for each target; earlier target windows precede declared coverage, yielding HISTORY_INCOMPLETE; no coverage fabricated |
| Equal time | Strictly increasing times; no equal-time chain | Outside overlap |
| Correction, replay, partial/full reversal, failed/pending/zero | Latest eligible revision and exact integer cents | Outside overlap |
| Future availability, frozen prefix, window endpoints | Explicit as-of/prefix and (start,end] | Outside overlap |
| Currency/namespace isolation | Separate scopes | Outside overlap |
| Unverified identity, missing/partial history, future-only target | Explicit unavailable reasons; no fabricated zero | Outside overlap |
| Burst 128 deliveries | 129 nodes, 128 edges/states, 128000 cents | Outside overlap |
| Single hot key 2000 replay deliveries | 2 nodes, 1 edge/state, 1000 cents | Outside overlap |
| Dense bipartite 64 deliveries | 16 nodes, 64 edges/states, 64000 cents | Outside overlap |

The dense fixture is equal-time bipartite and has no multi-hop continuation. It is a bounded traversal profile, not evidence about arbitrary dense graph workloads. Caps remain 2000 deliveries, 8 queries per corpus, 256 selected nodes, 1024 edges, 4 hops and 5000 emitted path states. Traversal exhaustion is unavailable without partial metrics. The TS edge-inspection budget is a different limit. Its detector code and thresholds are unchanged; differences are exposed in the report, not coerced into parity. Paths do not prove movement of the same funds.

## Measurements and tradeoffs

| Observation | Current evidence |
|---|---|
| Actual PostgreSQL version, lifecycle/setup/load/query timings, selected rows, nodes, edges, paths | Pending trusted parent native execution |
| Actual Python/Node versions and executable/source/compiled/input/query hashes | Recorded by actual comparison invocation; pending parent receipt |
| Indexed storage/build/query tradeoff | Pending; no index benefit asserted |
| Neo4j/GDS | Untested; no download or adoption |

PostgreSQL temporary tables retain raw deliveries and select revisions with exact numeric arithmetic and parameterized recursive SQL. This offers relational auditability but repeated revision selection and recursive state enumeration incur query work; no measured winner is declared. Python provides an independent small-fixture reference with process and in-memory traversal costs. Neither establishes production capacity. Neo4j/GDS consideration requires measured benefit plus owner, legal, workload and adoption approval.

Source configuration/history/timezone/revision attestation, stable identity, masking/linkage, real coverage, historical eligibility, policy/ownership/legal, representative workload/SLO, retention and production adoption remain open. Synthetic identity means namespace plus declared handle only. B12 receipts and original plans remain unchanged. This supports P05-05/P05-06 locally, replaces none of the fifteen detectors and closes neither target. B12/B13 main-checkout integration and final US-1305 immutable/fresh-verifier acceptance are separate gates.

## Verification handoff

Coding sandbox checks cover current-story units and actual bounded Python subprocesses only. Native SQL comparison, cleanup inspection, full unchanged worker suites, API prerequisite, publication/security and trusted promotion remain parent-only pending gates. Mocked or copied expected evidence never counts as native proof. Current implementation-status updates belong to the separately authorized US-1305 file scope.
