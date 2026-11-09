# B13 local graph benchmark operations

Use the existing user-selected plusb profile and prepared offline Node/pnpm, Python `.venv` and installed pinned PostgreSQL runtime. No dependencies, downloads, credentials, configured database, provider or real data are required. This is local synthetic support for P05-05/06 only. The fifteen detectors and all original P05 target gates remain unchanged and open. ADR0020 remains PROPOSED; Neo4j/GDS is untested and conditional.

## Trusted parent sequence

The following application checks may be run directly with the prepared tools, retaining bounded logs, exit codes and source hashes. The former Ralph automation command was retired; its historical results remain recorded below.

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm verify:fresh
.venv/bin/python -B ci/security.py
```

Required worker/Python/legacy/native suites and publication checks remain mandatory. B13 worker routing first builds the existing API prerequisite, then runs unchanged worker typecheck/tests. Online advisories: SKIP (offline). No root lint script exists. Never lower original disk/reserve/deadline guards or bypass MariaDB fixture bootstrap failures.

Create a private owned `.local` parent if absent, then select a never-used destination:

```sh
node apps/risk-workers/scripts/p05-graph-acceptance.mjs --output "$PWD/.local/p05-b13-final-UNIQUE"
node apps/risk-workers/scripts/p05-graph-acceptance.mjs --verify "$PWD/.local/p05-b13-final-UNIQUE"
```

The second command must be a separate fresh process. It opens evidence read-only, binds current source/compiled/Python/runtime bytes, rebuilds corpus/query plans and reruns the actual independent Python and TS overlap semantics. It checks persisted SQL observations against those results and fixed independent oracles. It does not rerun SQL. Before/after evidence byte hashes, sizes, mtime, inode and device must match. Parent must independently inspect actual OS processes, loopback listeners and scratch resources associated with the trial before and after, confirm no owned process/listener/lock survives and retain those observations. Do not stop unrelated processes. Only successful promoted native execution, fresh verification, all trusted checks and confirmed OS cleanup permit B13 closure.

## Evidence and measurements

`acceptance.json` binds immutable private `comparison/comparison.json` and `comparison/sql/sql.json`, including sizes, hashes and file identity. Existing paths, symlink ancestors, writable evidence, extra/missing artifacts and overwrites fail closed. Publication is exclusive; permissions prevent accidental writes, not a privileged owner's deliberate rewrite. Hashes are integrity bindings, not authentication or proof that a database ran. Only the parent's actual execution receipt establishes native provenance. A forged receipt or caller success flag is never accepted as a substitute.

The comparison records actual runtime versions and PostgreSQL binary hashes, source/compiled/SQL/Python/corpus/query bindings, deterministic observations, selected counts and elapsed milliseconds. Setup and per-query measurements are distinct; one observation and one EXPLAIN ANALYZE per query, no-index only. Indexed trials remain pending. No candidate measurement is published in this runbook: native measurements and independent host receipts are pending. Do not infer p95, production capacity, accuracy, enforcement, same-funds flow, performance winner or TCO from this finite fixture.

Supported cases include fan-in/out, strict-time chain/cycle, equal-time exclusion, duplicates/corrections, partial/full reversal, pending/failed/zero, future availability and revision/prefix versions, missing/partial history, identity and currency/namespace isolation, plus burst/skew/dense profiles. Money uses exact integer cents; windows are explicit UTC `(start,end]`, with frozen as-of and positioned source-prefix availability. Missing identity/history yields unavailable, never invented zero. Masked strings establish no identity or linkage.

Caps: 2000 deliveries, 8 queries per corpus, 256 selected nodes, 1024 edges, 4 hops, 5000 emitted states. Hard input/byte violations reject before native execution; traversal overflow is explicit unavailable rather than partial success. Native lifecycle is at most 180 seconds including teardown reserve; scratch at most 2GiB; total retained evidence at most 16MiB. Benchmark emitted-state budget differs from TS detector work budget; TS comparison covers documented overlap only.

## Failure and retry

CLI failure emits only `GRAPH_ACCEPTANCE_UNAVAILABLE` and exits nonzero. Missing runtime/build, semantic mismatch, changed source, unsafe destination, exhausted bounds or uncertain cleanup prevents acceptance. Preserve failed evidence for bounded inspection; do not edit it into success. Verify owned resource cleanup through the trusted parent before retrying to a new private destination. A failed partial destination is never reused. Preserve earlier receipts and source; do not repair historical evidence. Root/legacy verification failures require resolution under original guards and rerun, not a skipped mandatory check.

## Remaining phase gates

B12 is sealed in the isolated continuation. B12/B13 main-checkout integration is separate and unperformed here. Next is a separately approved P06 monitoring/evidence gap review against canonical Portal and the actual integration status, not automatic P06 execution. Keep source configuration/history/timezone/revision attestation, stable identity/masking/linkage, historical eligibility, policy ownership/legal/retention, representative workload/SLO and production adoption open. Original plan/master/104-item score definitions remain unchanged. Parent appends actual receipts to current.md only after checks pass; this story grants no production readiness.


Independent RLP-B13 host acceptance — 2026-10-31T09:49:18.574Z:

- PASS: automation (/Users/macbookpro/Documents/LMPS_Risk/financial-crime-platform/.local/ralph/workspaces/p04-b09-20261027/repo/node_modules/.bin/node --test --test-concurrency=1 /Users/macbookpro/Documents/LMPS_Risk/financial-crime-platform/.local/ralph/workspaces/p04-b09-20261027/repo/tools/ralph/automation.test.mjs)
- PASS: quality-1 (/Users/macbookpro/.nvm/versions/node/v24.19.0/bin/pnpm typecheck)
- PASS: quality-2 (/Users/macbookpro/.nvm/versions/node/v24.19.0/bin/pnpm test)
- PASS: quality-3 (/Users/macbookpro/.nvm/versions/node/v24.19.0/bin/pnpm build)
- PASS: quality-4 (/Users/macbookpro/.nvm/versions/node/v24.19.0/bin/pnpm verify:fresh)
- PASS: publication-and-secrets (/Users/macbookpro/Documents/LMPS_Risk/financial-crime-platform/.local/ralph/workspaces/p04-b09-20261027/repo/.venv/bin/python -B ci/security.py)

All listed commands completed with exit0 using private local fixtures. Actual full outputs and hashes are retained in the task's private checks directory. Online advisory audit: SKIP (offline batch). Synthetic simulation only; production readiness, real source semantics/identity/labels and the real2GB trial remain unverified/deferred. Task completion is controlled by a durable host receipt after guarded promotion.


## Parent acceptance — 2026-10-31

All five B13 task receipts and full trusted host checks passed. Parent rebuilt promoted source and ran actual final CLI plus a separate read-only fresh-process verifier; all 15 fixture comparisons matched, evidence bytes/inodes/mtime stayed unchanged and OS inspection found zero owned processes. Final evidence is .local/p05-b13-final-20261031; durable parent acceptance and hashes are in .local/ralph/batches/rlp-b13/completion-audit.json and parent-final-20261031/. The immutable CLI manifest remains parent_acceptance=pending by design; parent closure is a separate audited decision. See ../implementation-status/current.md for scope and remaining target/production gates. Main-checkout integration is separate; no new phase is activated by this closure.
