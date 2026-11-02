# P04 local synthetic handoff — RLP-B11 / US-1105

`production_ready=false`. This ledger records bounded implemented support and the evidence available in this isolated candidate on 2026-10-29. It does not certify final B11 acceptance. Current authorization is the approved B08–B11 continuation using the existing pluse session; no login change, installation, network, commit, deployment, real source, graph or payment authority is included.

## Evidence boundary

The registered [P04 catalog](../../tasks/ralph/phases/p04.json) preserves all nine requirement IDs, target flags and blockers. Its source-document digests identify the original definitions; this handoff supplies operational shorthand, not replacement definitions. Original plan/master/catalog checkboxes remain unchanged. The catalog identifies P04-07 as complete **only within its original bounded simulator scope**; actual LMPS pre-transfer integration belongs to P09. The other eight target requirements remain gated even when supplemental local stories pass.

The runbooks below contain independent host-check summaries: B01 at 2026-10-25T08:31:42.920Z; B06 at 2026-10-26T03:35:36.882Z; B07 at 2026-10-26T07:08:12.253Z; B08 at 2026-10-26T12:21:17.951Z; B09 at 2026-10-28T08:35:09.209Z; B10 at 2026-10-29T04:37:41.647Z. They record automation, root typecheck/test/build, offline fresh and publication/security success. These are historical summaries, not independently inspected private receipts or a current B11 execution. The approved contract states B10 is sealed with actual final acceptance. No private final native receipt was available for inspection in this candidate; do not invent its path, digest, timing or measurements.

Parent receipt references declared by the catalog include `.local/ralph/registry-preparation/b01-seal.json` and `.local/ralph/batches/rlp-b06/historical-seal.json` / `rlp-b07/historical-seal.json`. These are references to parent evidence, not files asserted present here. Parent must resolve actual B08–B11 promotion/final-run receipts and their checks directories in its private state. A registered task, binary, source file, unit substitute, old success flag or proposed evidence destination is insufficient proof of execution.

## Nine-requirement support/evidence/remaining-work ledger

| Requirement | Implemented local support and evidence anchor | Remaining target work / acceptance boundary |
| --- | --- | --- |
| P04-01 — feature definitions | B06 positioned net-feature contracts; B08 eight outgoing attempt/gross/reversal/net vectors, explicit identity/currency/time/availability and unsupported families. [Catalog](../data-dictionary/feature-catalog.md), [golden streams](../data-dictionary/feature-golden-streams.md), B08 [contribution acceptance](local-feature-contributions.md) and historical host summary. | G-DATA, O-006, O-017: real source definitions, stable identity/masking, lifecycle/units, owner-approved completeness/freshness; unsupported counterparty/institution/baseline/graph summaries. No target closure. |
| P04-02 — engine comparison/decision | B09 frozen same-stream worker/Streams comparison, clean restart and replay, independent expected values, persisted positions/state hashes. [Comparison runbook](local-feature-engine-comparison.md), [ADR0018](../architecture/adr/0018-feature-engine-candidates.md), historical B09 host summary. | O-013, O-008, O-006, F-LEGAL. ADR0018 remains **PROPOSED**. Flink, representative workload, unclean crash, native TTL/changed-duplicate/partial-coverage cases, license/operations/TCO and adopted target decision remain open. No performance winner inferred. |
| P04-03 — stateful engine | B06 durable consumer/ACK, B08 contribution/window worker, B09 finite native candidate integration. [Stream operations](local-feature-stream.md), contribution/comparison runbooks and B06/B08/B09 summaries. | O-013, O-006, O-007: adopted engine, actual stream/availability semantics, production watermark/retention, capacity, distributed/unclean recovery, ownership and operations. Local replay is not HA or production durability. |
| P04-04 — cache/atomic serving | B07 version-fenced durable store; B10 explicit no-cache baseline versus owned Redis, atomic server-side CAS, generation/scope/expiry/outage/rebuild assertions. [Cache/API runbook](local-feature-cache-api.md), [ADR0019](../architecture/adr/0019-feature-cache-candidates.md), B07/B10 host summaries. | O-015, O-008, O-006, F-LEGAL. ADR0019 remains **PROPOSED**; Redis artifact presence does not approve use/license/adoption. Valkey uninstalled/untested; persistence, HA, target retention/SLO and cache choice unresolved. |
| P04-05 — feature-serving API | B07 deterministic `serveFeatureSnapshot`; B10 guarded `GET /v1/local/features` with exact DTO, fixture time, full plan/workspace scope and unavailable nulls. [Serving](local-feature-serving.md), cache/API runbook, B07/B10 host summaries. | G-DATA, O-016: real account/source permissions, corporate identity, target API/latency/freshness/coverage and deployment. Local JWT risk:read/workspace checks do not prove corporate authorization. |
| P04-06 — lifecycle corrections | B06 latest eligible revision/net; B08 attempt/payment separation, partial/full reversal and signed retraction, currency isolation, explicit lateness/watermark/TTL/hot-key limits. Contribution acceptance preserves original reference/corpus semantics. B08 summary covers host checks. | O-004, O-005: real lifecycle, time/units, account/payment/attempt identities, corrections/reversals and history availability remain unverified. B06 target anchor and B08 event-window/count semantics are intentionally distinct; do not rewrite them to force parity. |
| P04-07 — concurrent pre-transfer simulator | B01 [simulator runbook](pretransfer-simulator.md), contracts/risk reservation functions and worker acceptance tests cover concurrent retry/binding, exact reservation accounting, outcomes/conflicts and expiry equality. Catalog records original bounded scope complete; B01 seal remains authoritative. B11 reexecutes the two existing worker simulator suites. | Original simulator scope only. Capacity is declared synthetic in-flight capacity, not balance/settlement or LMPS payment capacity. No actual pre-transfer endpoint/enforcement, G-ONLINE, identity or P09 closure. B11 rerun still pending parent final invocation. |
| P04-08 — point-in-time offline/online parity | B11 [parity contracts](../data-dictionary/feature-parity.md), `feature-parity.mjs` and Python `lmps_ml.feature_parity` select an explicit eligible cohort before running existing dataset and TS stream/serving paths. Integrated fixed expectations distinguish correction, future/missing availability, currency and zero. | B11 current source/runtime/persisted final acceptance pending. Eligible real historical data, availability evidence, supported matched semantics and owner/source gates remain open. Final snapshots never establish historical availability. Restricted probe parity does not cover all B08 vectors or original Python/TS features. |
| P04-09 — evidence persistence/health | B07 frozen publications; B11 `openFeatureEvidence` and `evaluateFeatureHealth` persist immutable count/hash/status generations with explicit fixture clock, lag/age/availability and scope/runtime bindings. `p04-acceptance.mjs` independently checks persisted health/parity/phase evidence. | B11 final integration pending; production observability backend, legal retention/hold, RPO/RTO/SLO, historical completeness and operational ownership remain open. Counts of tests/stories or healthy fixture rows do not close this target. |

## Reproducible commands and APIs

From repository root with prepared offline dependencies, build prerequisites before tests. These commands are reproduction instructions, not a statement that they ran in this story:

```sh
pnpm --filter @lmps/contracts build
pnpm --filter @lmps/risk build
pnpm --filter @lmps/risk-workers build
pnpm --filter @lmps/risk-api build
pnpm --filter @lmps/risk-workers typecheck
node --test --test-concurrency=1 apps/risk-workers/test/p04-acceptance.test.mjs
node --test packages/contracts/test/feature-parity.test.mjs packages/risk/test/feature-health.test.mjs apps/risk-workers/test/feature-parity.test.mjs apps/risk-workers/test/feature-evidence.test.mjs
```

Only the parent host runs the native integrated default runner, after guarded promotion. Choose a **new** normalized absolute destination strictly below this project's private `.local`. All existing project-local ancestors must be owned mode 0700, without links; all ancestors must deny group/other writes. Evidence files are owned mode 0600, regular single-link files. Do not repair permissions or lower bounds to make acceptance pass.

```sh
node apps/risk-workers/scripts/p04-acceptance.mjs --output "$PWD/.local/p04-final-promoted-unique"
node apps/risk-workers/scripts/p04-acceptance.mjs --verify "$PWD/.local/p04-final-promoted-unique"
node --input-type=module -e 'const {verifyP04Acceptance}=await import("./apps/risk-workers/scripts/p04-acceptance.mjs"); await verifyP04Acceptance(process.argv[1]);' "$PWD/.local/p04-final-promoted-unique"
```

`parseArguments(argv)` accepts exactly `--output ABS_NEW_PATH`; `runP04Acceptance({output})` accepts exactly that own data property. Import is inert. The separate public `--verify ABS_PATH` / `verifyP04Acceptance(output)` checks existing evidence; it does not replace execution. `--verify-pending` is internal publication verification, not a caller receipt/runner option. No public fake runner, environment, executable, plan override or receipt input authorizes success. Failure prints `P04_ACCEPTANCE_FAILED`; successful execution/verification prints `P04_LOCAL_SYNTHETIC_VERIFIED production_ready=false`.

The runner serially invokes existing lifecycle, serving, engine and cache default acceptance APIs, verifies each, reexecutes B01 worker simulator tests, runs actual Python/TS selected-cohort parity and persists/rechecks health. It repeats independent persisted verification before exclusive fsynced final publication. Parent also inspects current source/compiled/runtime/input/cohort/policy hashes and owned OS processes/listeners/resources: a fresh process's empty in-memory registry cannot establish another process's cleanup.

Standalone parity accepts the following exact flags, with private bounded input and plan files under project `.local`. The plan must bind current `runtimeBinding()` and the validated input hash; no caller-provided binding certifies execution:

```sh
node apps/risk-workers/scripts/feature-parity.mjs --source "$PWD/.local/parity-input/input.json" --plan "$PWD/.local/parity-input/plan.json" --output "$PWD/.local/parity-new"
node apps/risk-workers/scripts/feature-parity.mjs --verify "$PWD/.local/parity-new"
```

Public parity functions are `compare(sourceAbsolute,planAbsolute)`, `verify(outputAbsolute)`, `provenance()` and `runtimeBinding()`. Verification reruns both paths and compares unchanged private bytes. Contracts select latest revision with `available_at <= as_of`, then apply `(anchor-window,anchor]`; exact matched explicit key/currency/cohort/window/semantic/runtime bindings are mandatory. Missing availability or declared members remain unavailable; retrospective/unsupported remain distinct. Empty explicitly declared cohort can be zero. Probe intersection is positive active-count/net amount, one currency, one-hour window, at most 256 selected records/query. Active-zero inputs, incompatible semantics, out-of-retention windows, unsupported timestamp range or Python amount precision stay unsupported. Log transforms, novelty, graph/model and serving freshness are outside parity. No FX or cross-currency aggregation exists. Existing engines retain their original anchor/lifecycle semantics.

The [serving runbook](local-feature-serving.md) documents `openFeatureStreamConsumer`, `openFeatureSnapshotStore`, `openFeatureServingAdapter`, `rebuildFeatureServingStore` and deterministic `serveFeatureSnapshot`. The [contribution runbook](local-feature-contributions.md) documents contribution/window functions and `openFeatureContributionWorker`. Cache APIs are `openFeatureCache(ownedRuntime,scope)` with `publish`, `serve`, `rebuild`; runtime ownership is described in the cache/API runbook. `GET /v1/local/features` requires local JWT permission `risk:read` and matching workspace; exact fields are `version`, `query_id`, `currency`, `as_of`, `now`, `minimum_generation`. No real account selector is supported. Use that runbook's exact validation/configuration rather than a guessed deployment endpoint.

`openFeatureEvidence(absoluteDirectory,{scope,plan,input})` exposes `publish(trial)`, `read(generation,trial)`, `close()`. Read recomputes summaries from supplied observations rather than accepting caller success. `evaluateFeatureHealth({plan,now,max_age_seconds,sources})` is IO-free: now must equal fixture now, at most eight rows/one bound semantic-version set; future/missing/incompatible times, positions or plan bindings produce unknown/unavailable. Age equality is fresh; greater age is stale. Partial/unavailable/retrospective/unsupported rows remain distinct counts; unknown aggregate lag/age is null. No wall clock establishes completeness. Metrics contain bounded status/version counts, never raw account/event/PII/path/auth labels.

## Fixtures, resources and evidence layout

All inputs are finite `local_synthetic` declarations. General baseline ceilings are 2000 records, eight queries and 2MiB input/state; module-specific smaller ceilings still apply (B06/B07 checkpoint/publication 1MiB, golden input 32 deliveries/32768 bytes). Money uses decimal strings and exact minor-unit arithmetic with isolated currencies. No threshold may be raised to obtain evidence.

Original B06/B07 fixture is 18 deliveries/six snapshots. B09 frozen comparison has 26 logical/39 physical records including replay, eight queries and one partition. B08 retains explicit occurred-time anchor, watermark, lateness, availability and TTL from the unchanged corpus/policy. B11 parity fixture clock/as_of/anchor is `2026-01-01T12:00:00Z`, one-hour window and retention 3600 seconds; future availability is `12:00:01Z`. Its eight revisions/five queries independently expect USD count 1/amount 2.50 after correction/reversal, EUR 1/7.00, missing availability unavailable, empty cohort 0/0.00 and future-only member unavailable. Availability/record hashes are synthetic commitments, not real historical proof.

Each independent native trial stays <=180 seconds including teardown reserve, owned scratch <=2GiB and retained integrated evidence <=16MiB. B11 child work deadline is 150 seconds, escalation 170 seconds and successful closure <=175 seconds; process output <=64KiB. The integrated serial run is multiple trials, not a claim that its total duration is <=180 seconds. Native supervisors keep their own stricter bounds and existing disk preflights (B06 requires >=6GiB free). Missing runtime, oversize evidence, timeout or uncertain cleanup fails closed. Pinned engine/cache inventory must be independently checked before/after by the parent; presence alone proves nothing. No RSS, timing, TCO, load, p95, production capacity or SLO measurement is supplied here.

Evidence beneath the chosen new output is:

| Path relative to output | Purpose |
| --- | --- |
| `acceptance.json` | Exclusive final count/hash/status receipt with current source hashes, evidence inventory, runtime bindings, zero-owned-process assertion and remaining gates |
| `lifecycle/`, `serving/`, `engine/`, `cache/` | Original nested acceptance and persisted consumer/publication/comparison/cache/HTTP evidence; exact nested paths remain defined by their existing verifiers/runbooks |
| `input.json`, `plan.json`, `parity/evidence.json` | Private explicit cohort input/plan, observations, unsupported reasons and source/compiled/runtime bindings |
| `health/owner.json`, `health/generation-1.json` | Full scope/plan/corpus/runtime/semantic binding and independently checked immutable summary |

The final verifier requires exactly this top-level layout, inventories <=4096 entries and rejects links, changed/missing bytes and residual locks/stages. Source hashing covers actual source/compiled/Python/API/corpus/package inputs; source provenance guards still belong to trusted host policy. Evidence and health generations remain `production_ready=false` with independent runtime acceptance gates even when structurally valid. Final receipt presence alone is not confirmed durable execution.

## Failure, restart, retention and recovery

Consumer ACK follows durable effects/cursor publication. Consumer, durable serving store and cache are separate commits. Exact replay after validated close/reopen is idempotent; gaps, changed duplicates/configuration, malformed provenance or missing recovery evidence fail closed. Failed/ambiguous publication poisons the handle; retain the prefix and validate close/reopen before exact replay. Rebuild serving into a **new absent** store directory from validated retained consumer state; compare semantic hashes/positions before any separate promotion. No destructive in-place reset is authorized.

`no_cache` is an explicitly selected baseline, never an automatic fallback. Required cache outage/timeout returns unavailable/null, not zero or permission to enforce. Lua CAS fences generation/predecessor/content/scope; old rebuild cannot replace newer data. Source age derives from supplied as_of, not insertion/publication time; expiry equality is unavailable. Redis RDB/AOF and replication are disabled. Restart creates an empty owned runtime; explicitly validate retained durable generation and rebuild, then verify exact reads. This proves neither cache persistence nor production recovery/HA.

Evidence policy permits eight immutable generations, <=2MiB/generation, <=16MiB retained including owner data and fixture retention <=86400 seconds. Retention is a declared fixture bound, not automatic deletion or legal compliance. One-over fails without truncation, eviction or pruning. Generation read/reopen validates ownership, policy and hashes; read also recomputes summary from the supplied trial. Retain complete private failure/success directories and host receipts until owner review. No cleanup command here deletes retained evidence.

Cooperating writers use exclusive owned locks; close validates disk and removes only its own lock. Stale locks/stages block. Never trust stored PIDs as kill authority, take over stale locks, kill by name, reuse failed output or remove unknown scratch. Foreground SIGINT/SIGTERM follows existing owned supervisor teardown; uncertain ownership, interruption or cleanup prevents acceptance. Hard termination, hostile ancestor replacement, machine-crash durability and distributed locking are unproven. Recovery requires owner investigation and a fresh output, not edited receipts or relaxed thresholds. Parent must establish zero surviving owned processes/listeners/resources after each phase and final verification.

## Host closure and accounting

Current story verification results are recorded only in the appended [current status](../implementation-status/current.md). Before B11 local closure parent must run unchanged full automation, root `pnpm typecheck`, `pnpm test`, `pnpm build`, frozen/offline `pnpm verify:fresh`, required native/legacy suites, publication/security, exact manifest/allowed-source/plan/Git and whole-prefix guards, then guarded promotion with durable receipts. Online advisories are explicitly skipped offline; no lint script exists. Sandbox unit tests cannot replace host checks.

After promotion parent must run the actual final `p04-acceptance --output` invocation and fresh independent verifier on current promoted source; verify source/compiled/Python/runtime/cohort/persisted evidence and OS ownership cleanup. Record actual unique evidence paths/digests and check receipts only after success. Then update the separate **private phase evidence state**, nine-item evidence ledger and final summary. All final host checks/promotion and integrated acceptance are pending in this candidate handoff.

The separate 104-item engineering assessment retains denominator 104 and equal-weight rubric: 0 no implementation/evidence; 0.25 design/decision/primitive; 0.5 substantial local/synthetic implementation tested but target integration missing; 0.75 main scope integrated with exit gates pending; 1 full defined requirement verified. Fractional judgments require explicit evidence per original requirement, and percentages retain half-up one-decimal rounding. This story assigns no new score. Do not derive project progress from task/test/file counts, shrink the denominator or promote original checkboxes. Original simulator completion does not upgrade the eight gated target requirements.

Source configuration/permissions and historical availability, full/masked account representation, stable identity/linkage and masking boundary, lifecycle/time/units, target engine/cache, ownership/legal/license/adoption, retention/hold/RPO/RTO/SLO, corporate access and deployment remain unverified/deferred. Missing never means zero or safe enforcement. No production or phase target closure is claimed.


Independent RLP-B11 host acceptance — 2026-10-29T09:17:57.686Z:

- PASS: automation (/Users/macbookpro/Documents/LMPS_Risk/financial-crime-platform/.local/ralph/workspaces/p04-b09-20261027/repo/node_modules/.bin/node --test --test-concurrency=1 /Users/macbookpro/Documents/LMPS_Risk/financial-crime-platform/.local/ralph/workspaces/p04-b09-20261027/repo/tools/ralph/automation.test.mjs)
- PASS: quality-1 (/Users/macbookpro/.nvm/versions/node/v24.19.0/bin/pnpm typecheck)
- PASS: quality-2 (/Users/macbookpro/.nvm/versions/node/v24.19.0/bin/pnpm test)
- PASS: quality-3 (/Users/macbookpro/.nvm/versions/node/v24.19.0/bin/pnpm build)
- PASS: quality-4 (/Users/macbookpro/.nvm/versions/node/v24.19.0/bin/pnpm verify:fresh)
- PASS: publication-and-secrets (/Users/macbookpro/Documents/LMPS_Risk/financial-crime-platform/.local/ralph/workspaces/p04-b09-20261027/repo/.venv/bin/python -B ci/security.py)

All listed commands completed with exit0 using private local fixtures. Actual full outputs and hashes are retained in the task's private checks directory. Online advisory audit: SKIP (offline batch). Synthetic simulation only; production readiness, real source semantics/identity/labels and the real2GB trial remain unverified/deferred. Task completion is controlled by a durable host receipt after guarded promotion.
