# ADR0018: Bounded feature-engine candidates and finite recovery coverage

Status: PROPOSED

Date: 2026-10-27. Scope: RLP-B09 / US-904, local_synthetic candidate evidence only. production_ready=false.

## Proposal and decision boundary

Compare the existing B06 bounded consumer and B08 contribution worker with the pinned Kafka Streams candidate using unchanged original and extended golden corpora. Preserve all reference semantics, source, fixtures and old checks. This ADR proposes an experiment; it does not select a production engine. A mismatch or unsupported required behavior remains work and cannot be waived by this ADR.

The available implementation candidates are the TypeScript bounded workers and the embedded Java Kafka Streams topology in `feature-streams-candidate.mjs`. The runtime contract pins Java/Temurin 21.0.10, Kafka 4.1.2, Kafka Streams 4.1.2 and RocksDB JNI 9.7.3. Inventory SHA256 is `efd8dcc34d81f51961a1d69dc5863c7307ba90fd9de985002b7e40e2b37edc9c`. These are declared pins, not evidence that native artifacts were verified in this coding sandbox. The trusted parent must run the existing read-only inventory verifier and owned supervisor. Missing or incompatible artifacts block execution; no install, download or alternate runtime is authorized. Flink is untested.

## Correctness and recovery dimensions

The frozen comparison contains 18 original and eight extended logical records, eight queries and one partition. Both candidates receive the same positioned input: prefix 13, clean stop/restart, exact replay 13, suffix 13; 26 logical and 39 physical records. Explicit occurred-time anchors use a 3600-second open-start/closed-end window, latest available revision, available_at <= as_of, declared synthetic identity and currency isolation without FX. Completeness comes from explicit fixture policy, never arrival order. Decimal strings and BigInteger minor units preserve exact money.

| Dimension | Bounded worker evidence | Streams comparison scope |
| --- | --- | --- |
| Original net values | Independent 14.11 / 13.14 / 13.14 / 7.00 and counts 11 / 11 / 11 / 1 | Matching supported net queries only; native execution pending |
| Extended lifecycle | Attempts, gross, reversals and net independently asserted; SYN final net zero, USD 200 minor units | Latest-revision vectors require actual Java output validation |
| Unknown evidence | UNKNOWN_REVERSAL is unavailable, not zero | Frozen supported query only; arbitrary coverage semantics unsupported |
| Recovery | Durable close/reopen and replay must preserve cursor, generation and publication bytes | Clean restart only; SIGKILL/unclean crash unsupported |
| Finite burst | Eight positioned extended records, restart after three; independent values enter real comparison seam | Larger-than-frozen native burst unsupported |
| Single hot key | Eight succeeded payments of 10.00 yield count eight / net 8000; ninth delivery rejects without cursor advance; restart after four and final replay preserve publication bytes | Bounded-only regression, no native hot-key capacity claim |
| State and isolation | Persisted eight deliveries/active positions, cross-run reopen rejection and USD zero for SYN-only burst | Actual state store files, positions, source and runtime bindings still require parent proof |

The comparison seam intentionally accepts only its frozen input and plan identities. Unit tests use explicitly fabricated native-shaped evidence to test independent mismatch rejection; those objects never enter the public runner and do not establish Streams correctness. The public CLI has no injected runner, receipt or success mode. Original attempt/gross projection, missing-input/history native queries, native TTL admission, native changed-duplicate and partial-coverage trials remain unsupported. Production watermarks, serving freshness, real identity and arbitrary availability/anchor semantics remain unproven. Required target support must be implemented and measured separately without changing B06/B08 reference behavior.

## Resource observations and pending measurements

Approved ceilings are 2000 positioned records, eight queries, one partition, 2 GiB owned scratch, 16 MiB retained evidence and 180000 ms per independent native invocation including teardown reserve. The plan retains a 30000 ms teardown reserve. Specific readers and phase files impose tighter bounds. Exact/one-over unit validations exercise input count, state bytes, evidence bytes, process output, scratch and elapsed time as numeric contracts; they make no wall-clock performance assertion.

The input contract boundary test validates 2000 logical positioned records and rejects 2001; it does not execute that alternate corpus or claim native burst support. The executable frozen trial remains 26 logical records and 39 physical sends including replay. A separate arithmetic test preserves total elapsed time at 180000 ms while exceeding the processing allowance by one millisecond, proving that teardown reserve cannot be borrowed silently.

| Actual native measurement | Bounded consumer | Kafka Streams |
| --- | --- | --- |
| Setup / processing / teardown / total elapsed ms | Pending parent execution | Pending parent execution |
| Retained state count / bytes / recovery cursor | Pending parent execution | Pending parent execution |
| Peak owned scratch / retained evidence / process output bytes | Pending parent execution | Pending parent execution |
| Confirmed zero owned processes after teardown | Pending parent execution | Pending parent execution |

No native measurement was produced by US-904. Fixture record counts and asserted state counts are finite correctness observations, not throughput, latency, p95, SLO, capacity, retention or HA results. Setup and processing must be reported with their actual measurement boundaries; do not derive production capacity from these tiny fixtures. Operator staffing, operational complexity, infrastructure cost, licenses, legal approval and TCO remain external inputs.

The eventual immutable evidence location is the parent's newly created private project-local output, linked here as the [comparison evidence destination](../../../.local/feature-engine-b09-parent/comparison.json). This is a reserved future path, not an existing receipt or a success claim. The parent must record the actual unique destination and hashes if that path is already occupied. US-905 final acceptance, promoted-source validation and fresh independent evidence verification remain pending.

## Reproduction and verification

From the repository root, with existing offline dependencies and no native bindings:

```sh
pnpm --filter @lmps/contracts build
pnpm --filter @lmps/risk build
pnpm --filter @lmps/risk-workers build
pnpm --filter @lmps/risk-workers typecheck
node --test apps/risk-workers/test/feature-engine-comparison.test.mjs
node --test apps/risk-workers/test/feature-engine-compare.test.mjs apps/risk-workers/test/feature-streams-candidate.test.mjs
```

Trusted parent host only, after fixed quality/publication/source-plan-Git checks and promotion, using a new normalized absolute destination below project `.local`:

```sh
node apps/risk-workers/scripts/feature-engine-compare.mjs --output "$PWD/.local/feature-engine-b09-parent"
node --input-type=module -e 'import {verifyFeatureEngineComparison} from "./apps/risk-workers/scripts/feature-engine-compare.mjs"; await verifyFeatureEngineComparison(process.cwd()+"/.local/feature-engine-b09-parent");'
```

The default comparison must execute actual pinned implementations, independently validate persisted outputs/cursors/state and before/after source/compiled/input/runtime bindings, and confirm owned teardown before immutable publication. Use only owned loopback infrastructure; never connect to an existing broker. Neither a successful unit suite nor this comparison alone substitutes for US-905 final acceptance. Full worker/root suites, publication guards, frozen offline fresh checks and durable promotion receipts belong to host validation. No lint command exists.

Actual engine choice remains open under O-013/O-008/O-006/F-LEGAL: representative workload, owner decisions, source/identity verification, retention and SLO requirements, operator readiness and legal/license/TCO review are unresolved. Production adoption and real account linkage, graph or enforcement are outside this experiment.

## Local candidate verification

On 2026-10-28, the contracts, risk and worker build commands above and worker typecheck passed in the coding sandbox. The combined comparison regression, comparison and Streams candidate unit/subprocess suites passed all 22 tests. These checks did not invoke native Kafka/Java bindings. Full worker/root integration suites, publication/source-plan-Git guards, promoted-source validation, durable receipts and independent native acceptance remain host-only pending gates. This is local candidate evidence only; production_ready=false. The implementation-status register is reserved for the separately scoped US-905 handoff and host check evidence.
