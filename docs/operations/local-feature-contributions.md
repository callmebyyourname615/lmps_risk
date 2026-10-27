# Local synthetic contribution acceptance

This is bounded fixture acceptance for RLP-B08, US-805. `production_ready=false`.
It verifies no real source, account/payment/attempt linkage, masking, clock,
currency/units/FX, owner adoption, retention or SLO. B09 is a separate registered
batch; stop this queue after US-805.

## Commands and acceptance boundary

From the repository root, using prepared offline dependencies:

```sh
pnpm --filter @lmps/risk build
pnpm --filter @lmps/risk-workers build
pnpm --filter @lmps/risk-workers typecheck
node --test apps/risk-workers/test/feature-contributions-acceptance.test.mjs
```

The same test runs from `apps/risk-workers` with
`node --test test/feature-contributions-acceptance.test.mjs`; fixture paths are
resolved using `import.meta.url`. For an actual run, choose a NEW absolute,
normalized destination below the project's `.local`, whose existing parent is
owned and mode 0700:

```sh
node apps/risk-workers/scripts/feature-contributions-acceptance.mjs --output "$PWD/.local/b08-final-unique"
node --input-type=module -e 'import {verifyFeatureContributionEvidence as verify} from "./apps/risk-workers/scripts/feature-contributions-acceptance.mjs"; await verify(process.argv[1]);' "$PWD/.local/b08-final-unique"
```

There are no other CLI arguments, injected runners, sources, receipts, configuration,
environment fake modes or service startup. Import and invalid arguments perform no
fixture/service work. Existing destinations (including partial runs), symlinks,
non-normalized paths and writable-by-other ancestors fail. Project-local ancestors
must be private. Stable ancestors and cooperating writers are required; this is not
a hostile concurrent namespace or distributed storage protocol.

The CLI uses the actual compiled default modules. It binds source and compiled
trees, package resolution, original/extended corpora, reference fixture, batch
manifest/document and P04 phase document hashes before and after assertions. The
reviewed proposal digest supplied by the batch contract is separately recorded;
it is not a claim that the phase document has that digest. Source hashes describe
current bytes; trusted host promotion guards establish their approved provenance.

Before publishing, it recomputes the entire persisted worker generation and
predecessor chain, cursor, window state and frozen outputs independently of worker
receipts. It checks private evidence ownership/modes/size, replay invariance,
and independently fixed final vectors (including unknown reversal and valid zero)
during the standalone host recheck as well as the initial invocation. It checks
closed handles and absence of locks/stages. Report contents are counts, hashes,
versions and timing only. `acceptance.json` is a fsynced private stage linked
exclusively to the final name, stage unlinked and directory fsynced; an existing
final name cannot be replaced. A failure produces no success message. Do not
adopt partial evidence or treat an uncertain fsync as a successful invocation.
Use a new destination for another acceptance run; never overwrite the evidence.

Retained evidence including report is at most 16MiB, and complete invocation must
finish within 180 seconds. Checks enforce elapsed bounds before and after final
publication; the host must also enforce its external invocation deadline. This
does not claim a representative throughput or capacity SLO.

## APIs and persistence

Contracts are `@lmps/contracts/feature-catalog`. See
[the catalog](../data-dictionary/feature-catalog.md) for exact validation, money,
canonical JSON and grouped hash rules. Pure risk APIs are
`initializeFeatureContributions(policy)`, `restoreFeatureContributions(state, policy)`,
`applyFeatureContribution(state, delivery, as_of?)`,
`evaluateFeatureContributions(state, query)` and
`materializeFeatureContributions(state, query)`.

Window APIs are `initializeFeatureWindowState(policy)`,
`restoreFeatureWindowState(state, policy)`, `applyFeatureWindowState(state, delivery)`,
`advanceFeatureWatermark(state, utc)` and `snapshotFeatureWindowState(state, query)`.
All state and failed-operation inputs remain detached/immutable. Restore recomputes
lineage, totals, active entries, frozen results and hashes; caller success flags or
hashes do not establish correctness.

`openFeatureContributionWorker(directory, policy)` from
`apps/risk-workers/dist/feature-contribution-worker.js` exposes `consume(delivery)`,
`watermark(utc)`, `materialize(query)`, `receipt()` and `close()`.
Consume acknowledges only after atomic checkpoint replacement and directory fsync.
The owned directory contains private `owner.json` and `publication.json`; a live
writer owns `writer.lock`. No-follow bounded descriptor reads, exclusive creation,
private modes and one cooperating writer are required. There is no PID takeover.

Close/reopen validates policy and durable evidence. Exact positioned replay does
not rewrite bytes or add effects. Changed replay, gaps, corrupted/missing recovery
evidence or changed config fail closed. Before/after publication fault callbacks
exist only in the trusted worker unit API; they are never CLI inputs. A poisoned
handle requires close and validated reopen: before-publication failure retains the
old cursor; after-publication uncertainty may have durably advanced it, so replay
the identical delivery. Stranded stages/locks or ambiguous ownership require manual
investigation, never automatic deletion or stale-PID takeover. Frozen history and
replay lineage cannot be deleted to recover admission capacity.

## Fixture semantics and limits

The frozen extended corpus has eight deliveries and four queries. It declares
`occurred_at` anchor, a 3600-second window, supplied initial watermark
`2026-01-01T12:00:00Z`, 3600-second allowed lateness, 7200-second active TTL,
3600-second freshness and coverage from `08:00:00Z` that day. UTC fixture evidence
is explicit, never inferred from wall clock, Kafka arrival or delivery position.

Window membership is `(as_of-window, as_of]`; availability equality is eligible,
and `as_of` cannot exceed watermark. Watermark advances monotonically. A new
position with occurrence strictly before `watermark-lateness` is rejected without
cursor advancement; equality is admitted. Exact positioned replay is checked
against retained history before admission. Future occurrence/availability remains
retained and invisible until eligible. TTL expires active entries strictly after
`occurred_at+TTL`; equality remains active. Future-unavailable entries remain until
eligible. Expiry preserves frozen snapshots and all dedup/revision history.

The frozen policy caps retained deliveries/payments/attempts/revisions at 32,
deliveries per account/currency key at eight, queries at eight, and complete
serialized state at 2MiB. Global independent caps are 2000 deliveries, eight
queries, 2MiB input/state, and 32 deliveries/64KiB for the extended golden bundle.
Key/history/byte caps reject explicitly, with no eviction or truncation. New-position
duplicates count against retained history and hot-key admission; TTL does not
replenish those limits. Rejection is not an acknowledgement.

Input money is unsigned exact two-place decimal; internal arithmetic is BigInt,
persisted counts and minor-unit amounts are canonical decimal strings. Latest
eligible explicit attempt revisions determine attempts, while payment revisions
determine execution/reversal/net. Vectors are separate per currency. Corrections
are signed new-minus-old deltas; no cross-currency sum or FX exists.

| Supported surface | Actual acceptance assertion |
| --- | --- |
| Pending, failed retry, success, correction, partial/full reversal | Six independent fixed prefix vectors and signed deltas; final gross 800, reversed 800, net 0 minor units |
| Explicit attempts | Two attempts, total requested 2000 minor units; no double execution |
| Currency isolation | Separate USD vector with net 200 minor units |
| Unknown reversal vs empty covered key | Typed `UNKNOWN_REVERSAL` vs available all-zero vector |
| Window, lateness, future availability | Left boundary excluded, equality admitted, one-second late rejected; future output invisible until supplied watermark |
| TTL and hot key | Equality retains eight active positions, next second expires; eight retained deliveries admitted, ninth rejected |
| Local durability | Prefix close/reopen, byte-identical replay, independent final chain/cursor/frozen-state reconstruction |
| Old net overlap | Unchanged reference yields three net-active payments and 2650.00 amount at matching occurred-time anchor |

Attempt/gross/reversal counts and incompatible B06 target anchors have no parity
claim. Counterparty, institution, baseline and graph summaries are unsupported;
unknown identity/coverage/lifecycle/reversal never becomes guessed zero. Unrelated
original detectors and original corpus are preserved. These are synthetic
declarations, never verification of real business identity or availability.

## Required handoff gates

Local scoped checks do not seal B08. Trusted host must run the unchanged full
automation, root typecheck/test/build, every required worker/legacy suite, frozen
offline `verify:fresh`, publication/security checks, exact file/source/plan/Git and
whole-status-prefix guards, with durable receipts. No lint command exists.
Guarded promotion must precede parent execution of the actual final CLI on promoted
source and independent verification of current hashes, evidence and cleanup. All
these host and final acceptance gates remain pending until actually executed.
No phase/source/production closure follows from candidate tests.


Independent RLP-B08 host acceptance — 2026-10-26T12:21:17.951Z:

- PASS: automation (/Users/macbookpro/Documents/LMPS_Risk/financial-crime-platform/node_modules/.bin/node --test --test-concurrency=1 /Users/macbookpro/Documents/LMPS_Risk/financial-crime-platform/tools/ralph/automation.test.mjs)
- PASS: quality-1 (/Users/macbookpro/.nvm/versions/node/v24.19.0/bin/pnpm typecheck)
- PASS: quality-2 (/Users/macbookpro/.nvm/versions/node/v24.19.0/bin/pnpm test)
- PASS: quality-3 (/Users/macbookpro/.nvm/versions/node/v24.19.0/bin/pnpm build)
- PASS: quality-4 (/Users/macbookpro/.nvm/versions/node/v24.19.0/bin/pnpm verify:fresh)
- PASS: publication-and-secrets (/Users/macbookpro/Documents/LMPS_Risk/financial-crime-platform/.venv/bin/python -B ci/security.py)

All listed commands completed with exit0 using private local fixtures. Actual full outputs and hashes are retained in the task's private checks directory. Online advisory audit: SKIP (offline batch). Synthetic simulation only; production readiness, real source semantics/identity/labels and the real2GB trial remain unverified/deferred. Task completion is controlled by a durable host receipt after guarded promotion.
