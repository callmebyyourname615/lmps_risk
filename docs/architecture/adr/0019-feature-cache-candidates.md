# ADR0019: Compare the no-separate-cache baseline and installed Redis

Status: PROPOSED

Scope: bounded local_synthetic fixtures only. No target cache selection or production adoption is approved. Valkey is uninstalled and untested.

The B07 durable filesystem serving adapter is the baseline. The comparison executes that adapter's original acceptance runner without modifying its input, then publishes the same retained generations into a newly owned Redis 8.10.1 runtime. Six fixed query results independently assert exact decimal counts/amounts and missing/partial availability, generation and scope. A second generation, identical retry, stale publication and stale rebuild refusal exercise actual server-side CAS. Explicit fixture time exercises source staleness and logical expiry. Outage returns unavailable with null values; it never silently serves an empty safe result or falls back to the durable store.

Redis keeps one bounded generation head after logical expiry. The fixture disables both RDB and AOF. Stop deletes exclusively owned scratch after process closure. Restart here means a newly owned runtime, whose empty database is asserted before explicit rebuild from independently verified retained generation 2. This demonstrates loss of volatile fixture cache state, not persistent restart recovery or production failover. Older generation 1 cannot rebuild over generation 2.

Reproduction, from repository root after the standard offline workspace build, with a pre-existing private mode-0700 project `.local` directory:

```sh
node apps/risk-workers/scripts/feature-serving-acceptance.mjs --output "$PWD/.local/b07-baseline-new"
node apps/risk-workers/scripts/feature-cache-compare.mjs --output "$PWD/.local/b10-comparison-new"
node --input-type=module -e 'import {verifyFeatureCacheComparison} from "./apps/risk-workers/scripts/feature-cache-compare.mjs"; await verifyFeatureCacheComparison(process.argv[1]);' "$PWD/.local/b10-comparison-new"
```

Each output must be absent. The default API accepts only `{output}`; there is no injected runner, environment success mode, receipt input or remote configuration. Imports and malformed CLI inputs are inert. Only the parent host runs native commands. Coding-agent unit tests cannot establish native acceptance.

Source, compiled modules, package bindings, frozen corpus, runtime script and pin hashes are checked before/after execution and by the read-only verifier. B07 validates actual persisted consumer checkpoint and store/rebuilt publications. Live Redis head publication is compared to the durable store, with one key and bounded value bytes. Final evidence publication follows successful stop receipts and zero runtime-owned process handles. JSON alone cannot establish historical execution: the parent must independently run promoted source, verify evidence/provenance and establish no owned processes before acceptance.

| Input / decision | Evidence or pending gate |
| --- | --- |
| Correctness | Fixed six-query arithmetic, unavailable nulls, scope/generation, CAS, expiry and rebuild assertions; native measurements pending parent execution |
| Resources | At most 2000 records / 8 queries; original fixture 18 deliveries / 6 snapshots; 1MiB cache value, 2MiB JSON state/input ceiling; runtime 16MiB maxmemory/noeviction, 8 clients, bounded requests and output |
| Recovery | Volatile cache loss, explicit generation-preserving durable rebuild; no implicit dual commit or failover |
| Timing / key / bytes | Elapsed baseline/comparison and actual key/value bytes are finite fixture observations only; no throughput, capacity or SLO claims |
| Operational cost | Separate runtime ownership, monitoring, teardown, durable/cache commit reconciliation, retained evidence and recovery procedures; target operational costs unmeasured |
| License | Installed Redis 8.10.1 host artifact pin is an input, not license permission; distribution/usage/legal review remains open; no Valkey license comparison inferred |
| Ownership / target | Cache owner, legal, retention, target engine, HA, SLO and production adoption remain open |

Runtime uses the existing approved installed binary and verified private executable copy; no download or installation. No other Redis, configuration or data directory is reused. Native scratch ceiling is 2GiB; retained evidence ceiling 16MiB; native trial ceiling 180 seconds including teardown reserve. The runtime independently enforces its shorter lifetime and bounded stop. No real account identity, masking, source permission, graph or enforcement decision is inferred.

Current checks and limitations: native Redis execution and measurements remain pending parent-host execution. Full worker/root checks, promotion/source/plan/Git guards, fresh-process evidence verification and independent no-owned-process proof remain mandatory. `production_ready=false`.

Coding-agent checks on 2026-10-28: the new comparison test file passed all four test groups; `pnpm --filter @lmps/risk-workers typecheck` and `pnpm --filter @lmps/risk-workers build` passed. No native Redis fixture was started. These results do not substitute for host checks or native acceptance. The protected implementation-status baseline remains unchanged in this isolated story; the parent records final host evidence during handoff.
