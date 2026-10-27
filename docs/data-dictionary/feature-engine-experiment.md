# Bounded feature-engine experiment contract (US-901)

This is a detached, versioned `local_synthetic` experiment envelope. Import only
`@lmps/contracts/feature-engine-comparison`; the root entry point and earlier
contracts/reference/golden fixtures are unchanged. No native implementation is
added by this story. `production_ready` is always false.

## APIs and serialization

`validateFeatureEnginePlan(unknown): FeatureEnginePlan` and
`validateFeatureEngineReport(unknown): FeatureEngineReport` return detached,
mutable plain JSON copies. They never change caller input, invoke accessors or
`toJSON`, execute commands, read files or access a broker. Importing is inert.
Unknown fields, exotic prototypes, proxies, accessors, symbols, sparse arrays,
cycles, non-enumerable properties, undefined values, unsafe/nonfinite numbers,
negative zero and malformed Unicode are rejected. Descriptor-only traversal is
bounded to 32 levels, 2000 array entries and 1,048,576 encoded UTF-8 bytes for
either envelope. All invalid input raises `FeatureEngineComparisonError` with
code and message `FEATURE_ENGINE_COMPARISON_INVALID`, without a raw value/cause.

`serializeFeatureEnginePlan` and `serializeFeatureEngineReport` validate first,
then return canonical JSON: recursively sorted object keys, preserved array
order, no whitespace or trailing newline. `featureEnginePlanHash` returns the
lowercase ungrouped 64-hex SHA256 of that UTF-8 canonical plan. Hashes everywhere
in this contract use that representation. Source/compiled/evidence hashes are
hashes of independently inventoried canonical manifests; corpus hashes are of
the exact raw fixture bytes. A trial's `input_before`/`input_after` is the SHA256
of the canonical ordered `plan.corpora` array. Subsequent scripts must verify
those manifests and actual files, not merely the hashes supplied by a caller.
JSON transport must be byte-bounded before parsing; validation of an already
parsed value cannot bound the original parser's memory use or duplicate keys.

Exported types: `EngineCandidate`, `EngineQuery`, `FeatureEnginePlan`,
`EngineTrial`, `FeatureEngineReport`. Exported frozen constants:
`FEATURE_ENGINE_COMPARISON_VERSION`, `FEATURE_ENGINE_COMPARISON_LIMITS`,
`FEATURE_ENGINE_RUNTIME`, `FEATURE_ENGINE_SEMANTICS`, `FEATURE_ENGINE_SUPPORT`.

## Plan and frozen cohort

The version is `local-synthetic-engine-comparison-1`. Candidate order is exactly
`bounded_consumer`, `kafka_streams`. There is no executable, shell, Java home,
classpath, broker address, environment, destination or runner field. Trusted
parent-host code owns those choices, uses the existing verifier/supervisor and
must refuse missing/changed artifacts. No download/install or native invocation
is authorized for the coding agent.

Runtime identity is Java 21.0.10 (Java 21), Kafka and Kafka Streams 4.1.2,
RocksDB JNI 9.7.3, and the existing pinned inventory digest exported in
`FEATURE_ENGINE_RUNTIME`. Version equality is exact. The verifier must actually
verify that inventory before and after execution; this constant is not proof
that an installation exists.

`corpora` contains exactly two ordered entries: `original` /
`synthetic_golden_v1`, then `extended` / `synthetic_extended_v1`, each with raw
byte SHA256 and positive positioned record count. Baseline files are:

| File under `packages/risk/test/fixtures/feature-streams/` | Raw SHA256 | Records |
| --- | --- | --- |
| `golden.json` | `0aeff11f9d726b4be9c5197ce2e158166b3c72a307c88a91d9a7c0d318254f64` | 18 |
| `p04-extended-golden.json` | `bed15443c8d90219f800b225424570de15f7e10073a55bbd28f71198a678d20c` | 8 |

Additional finite burst/hot-key expansion requires its own exact frozen byte
hash and record count; it cannot silently replace either original fixture.
The envelope validates hash syntax and binding consistency, while scripts must
recompute bytes/counts and attest derivation against these untouched originals.
The combined positioned record count is at most 2000, in one partition.
Duplicate replay does not allocate new logical positions. Queries are a unique
ordered cohort of 1–8 IDs: corpus, synthetic key, currency, `as_of`, explicit
`anchor_at`, eligibility. Up to 32 distinct uppercase three-letter currency
buckets are admitted, with no FX or cross-currency sum. Both trials reference
this same plan hash and cover every query exactly once. Partial/missing outputs
cannot be an observed trial. Scripts must independently establish eligibility;
caller declarations alone do not authorize it. Selection of at most eight
queries from the corpora must be explicit and identical for both candidates.

Timestamps are real Gregorian UTC instants in exact `YYYY-MM-DDTHH:mm:ssZ`
format; invalid calendar days, fractional seconds, offsets and leap seconds are
rejected. The anchor cannot be later than `as_of`. Fixture policy is explicitly
synthetic-declared identity, availability `available_at <= as_of`, an explicit
occurred-time anchor, a 3600-second `(anchor - 3600s, anchor]` window, latest
available revision, explicit fixture coverage, integer minor-unit money and no
arrival-derived completeness. Original and extended semantic versions remain
separate; window/lifecycle profile versions are also pinned. Do not compare a
target-anchored query with a moving processing-time window.

Recovery declares one clean stop after a positive prefix, exact duplicate
replay of a positive number no larger than that prefix, and a positive suffix.
Prefix plus suffix equals the combined corpus records. `unclean_crash` is
explicitly unsupported. Scripts must retain per-corpus position mapping and
independently check conflicts, output/cursor/state content and restart results.

## Vectors, statuses and evidence

Expected outputs are supplied independently of the two observed trial output
arrays, keyed by the same query IDs. A result is either `{status: 'available',
vector}` or `{status: 'unavailable', reason}` using the existing feature catalog
reason vocabulary. Unavailable has no vector, so cannot become a zero vector.
Vectors have eight distinct canonical nonnegative integer decimal strings:
`attempt_count`, `attempt_amount`, `gross_count`, `gross_amount`,
`reversed_count`, `reversed_amount`, `net_active_count`, `net_amount`.
Counts are bounded by 2000; monetary minor units have at most 32 digits, without
sign, exponent, decimal point or leading zero. Zero is exactly `"0"`.
Attempt vectors include attempted activity, gross vectors represent successful
gross activity, reversal vectors track reversed activity, and net-active
vectors represent surviving activity; these are not interchangeable. Scripts
must independently assert lifecycle arithmetic using BigInteger/BigInt, rather
than accepting vector shape as arithmetic proof or copying expected to observed.

Trial states are `not_run`, `failed`, `observed`. Not-run has empty output and
null binding/recovery/observations. Failure codes are fixed `RUNTIME_MISSING`,
`EXECUTION_FAILED`, `TIMEOUT`, `LIMIT`, `CLEANUP_UNCERTAIN`; available bounded
failure evidence can be retained, but cannot count as a successful trial.
Observed requires full output, binding, clean recovery and resource observations.
Binding includes plan/runtime identity, source/compiled/input before and after
hashes (each pair equal), and evidence manifest hash. Recovery includes exact
prefix/replay/final positions, state hash and zero owned processes.

Each comparison status is checked against the independent expected and observed
JSON values: missing/failed trial yields `failure`; ineligible query or explicit
`UNSUPPORTED_FEATURE` yields `unsupported`; otherwise exact equality yields
`match`, and differing vectors or availability reasons yield `mismatch`.
Aggregate precedence is failure, mismatch, unsupported, `matched_observations`.
No status called success/completed/accepted is admitted. Acceptance is always
`pending_independent_native_verification`; forged completion fields are rejected.
Shape validation cannot detect a fabricated hash or copied engine output.
Trusted independent fresh-process evidence validation remains mandatory even
when all observations match, and unit doubles never establish native acceptance.

## Owned budgets and semantics support

Budgets are positive safe integers: at most 2 GiB owned scratch, 16 MiB retained
evidence, 180,000 ms for **each independent invocation**, 2000 logical records,
8 queries and exactly one partition. Process-output bytes cannot exceed retained
evidence budget; state bytes cannot exceed scratch budget. A positive teardown
reserve must fit strictly inside invocation time. Observations separate setup,
processing and teardown milliseconds, which sum exactly to elapsed; setup plus
processing must leave that reserve. Peak scratch, retained evidence, state and
process-output byte observations are bounded independently. OS/process metrics
not measured must remain absent, rather than fabricated as zero or inferred
from serialized state size. Failure evidence exceeding these envelope bounds
must be summarized by a fixed failure code, never accepted as an observed trial.

| Semantics | Contract / current implementation status |
| --- | --- |
| Keyed latest available revision, currency separation, exact BigInteger vectors | Planned native topology profile; implementation and actual evidence pending US-902 |
| Explicit anchored window and availability cutoff | Required matched finite query semantics; native evidence pending |
| Clean stop, same state restart, exact prefix replay and suffix | Required finite recovery profile; actual evidence pending |
| Conflicting duplicate, unknown lifecycle/reversal/coverage, future availability | Independently check rejection/unavailable or explicitly mark unsupported; never infer parity |
| Unclean crash, production watermark/lateness admission, TTL eviction, serving freshness | Unsupported native topology semantics in this profile |
| Real identity, source linkage, masking boundary, representative workload | Unverified; outside experiment |
| Flink | Untested; no trial or installation |

`FEATURE_ENGINE_SUPPORT.planned` names the profile, not a claim that a native
topology already implements it. No native topology is implemented by US-901.
Subsequent scripts must declare narrower support honestly, and cannot promote
unsupported required behavior to a match. This contract is intentionally not
an execution API, CLI, publication receipt or production engine selection.

Timing/state/resource measurements from tiny fixtures are observations only,
never capacity, throughput, latency/SLO, retention, TCO or an automatic winner.
O-013/O-008/O-006/F-LEGAL and all owner, legal/license, operator, adoption,
representative workload, source, identity, retention and SLO gates stay open.
Final promoted-source native execution, independent evidence validation,
owned-process teardown, publication guards and host receipts remain pending.
Implementation-status edits belong to US-905/host handoff, outside this story's
four-file allowlist. No target gate is closed by these contracts or unit checks.
