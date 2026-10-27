# Versioned local synthetic feature serving (RLP-B07)

This is the bounded P04-04/05/09 filesystem baseline. It uses the B06 reducer and consumer, a version-fenced snapshot file and deterministic serving. There is no separate cache, endpoint, database, Kafka startup or risk action. Synthetic workspace/namespace/account strings, fixture-only policy versions and supplied UTC times establish no real tenant/account identity, watermark completeness, production TTL or risk policy. Original phase/master leaves remain gated.

## Build, acceptance and independent verification

Run from the project root with the prepared offline dependencies and existing login. No install, login change or service startup is required. The example output must not already exist; choose a new name for every run. `.local` and all destination ancestors must already exist, be directories without symlinks and deny group/other writes. Ancestors from this project's `.local` downward must also be owned by the current user and private (0700). The output itself and its consumer/store directories are created private (0700); evidence files are 0600, single-link owned regular files.

```sh
pnpm --filter @lmps/risk-workers build
pnpm --filter @lmps/risk-workers typecheck
node --test apps/risk-workers/test/feature-serving-acceptance.test.mjs
node apps/risk-workers/scripts/feature-serving-acceptance.mjs --output "$PWD/.local/feature-serving-final-001"
node --input-type=module -e 'const {verifyFeatureServingAcceptance}=await import("./apps/risk-workers/scripts/feature-serving-acceptance.mjs"); await verifyFeatureServingAcceptance(process.argv[1]); console.log("FEATURE_SERVING_EVIDENCE_VERIFIED")' "$PWD/.local/feature-serving-final-001"
```

The CLI resolves all modules/fixtures relative to `import.meta.url`; the output must be an absolute, normalized path below this project's `.local`. Only `--output PATH` is accepted. Unknown/duplicate/missing flags, existing paths, unsafe ancestors, traversal, links and malformed options fail before destination creation. Import is inert even without compiled modules. There is no environment/runner injection, fake mode, receipt-file input or dynamic configuration. The exported `parseArguments(argv)` performs syntax checks; `runFeatureServingAcceptance({output})` also checks the filesystem and runs the default compiled implementation. Errors expose only `FEATURE_SERVING_ACCEPTANCE_FAILED`; the CLI exits 1 without payload diagnostics. Success prints only `FEATURE_SERVING_ACCEPTANCE_RECORDED`.

`verifyFeatureServingAcceptance(output)` is a read-only API: it reads the fixed evidence layout, independently restores/recomputes state and fixed/reference parity, checks serving results and current source/compiled hashes, and returns the validated acceptance object. Run it in a fresh process against final promoted source. A receipt is evidence of this local experiment, never a substitute for the independent host checks or the parent's fresh final run. Do not accept old receipts after source/compiled changes.

Persisted `elapsed_ms` must be a safe integer from 0 through 180000; strings, fractional values and out-of-bound values fail verification without coercion.

The experiment consumes all 18 positioned golden deliveries, freezes six queries, checks fixed decimal count/amount/reason and every supplied golden expected field, and evaluates the unchanged transaction-risk reference independently. It tests exact retry without inode rewrite, close/reopen replay, generation 2, stale/conflicting publication refusal, missing/partial/stale/expired serving, workspace/namespace/policy isolation and new-directory rebuild at generation 1. Persisted consumer checkpoint, store and rebuilt publication must match recomputed semantic state and source offset 18. Owner envelopes, generation/predecessor/content hashes and private file layout are checked independently of API receipts.

Both the live adapter and the read-only persisted verifier must reject a wrong-currency request and an unknown historical query. The missing-publication check independently requires unavailable status and null count, amount and provenance. A subprocess test deliberately bypasses compiled currency validation and requires acceptance to fail without publishing a receipt.

Before and after execution, hashes bind B06 contracts/reducer/consumer, B07 contracts/store/serving/adapter, all actual JavaScript modules in the three package dist trees, manifests/export routing, contract schemas, golden corpus, reference fixture and the acceptance script. Workspace package resolution must match the intended package manifests. Evidence contains counts/hashes/positions, elapsed time, closed-handle count and remaining gates; it contains no transaction payload diagnostics. Persisted synthetic consumer/store state is retained privately. The final acceptance file is written through an exclusive staging inode, file fsync, atomic no-overwrite hard-link publication, staging unlink and directory fsync. Acceptance is acknowledged only after all checks and closed-lock verification. Existing acceptance is never overwritten.

## Public data and APIs

All shapes reject unknown fields, malformed times/decimals, coercion, prototypes, getters, symbols, cycles and oversize input; validators return detached data. UTC timestamps use real-calendar `YYYY-MM-DDTHH:mm:ssZ`. No deterministic API obtains the wall clock. Counts and amounts retain decimal strings; unavailable values remain null.

| API | Contract |
| --- | --- |
| `@lmps/contracts/feature-serving` | `validateFeatureStoreScope`, `validateFeatureServingPolicy`, `validateFeaturePublication`, `validateFeatureServingRequest`, `validateFeatureServingResult` validate/detach their respective objects. `featureStoreScopeIdentity(scope)` returns canonical full scope JSON. `featurePublicationContentHash(publication)` returns SHA-256 of sorted-key JSON excluding only content_hash; eight groups of eight hex digits joined by hyphens. Shape validation alone does not attest reducer arithmetic or caller hashes. |
| Scope | `{version:'synthetic-feature-serving-1',mode:'local_synthetic',workspace_key,plan,policy}`. Full B06 plan binds identity, run_id, input_identity, namespace, topic, coverage_start, window_seconds=3600, all queries and limits. Policy is `{id,version,max_age_seconds}` with explicit fixture-only synthetic identifiers. |
| Publication | `{version,scope,generation,predecessor,state,published_at,expires_at,content_hash}`. Generation 1 has null predecessor; later generations require exactly `{generation:n-1,content_hash:actualPreviousHash}`. State must restore under the full plan. |
| Request/result | Request is `{version,workspace_key,plan,query,currency,policy,now,minimum_generation?}`. Query must exactly match a configured historical query, including currency. Result includes `{version,request,status,reason,count,amount,provenance}`. Available retains full detached publication/snapshot provenance; unavailable has null count/amount/provenance. |
| `openFeatureSnapshotStore(directory,scope,fault?)` | Synchronous import-inert compiled worker API; creates a new owned store or validates closed existing evidence. Returns `publish(fullPublication)`, `read()`, `receipt()`, `close()`. Read is publication or null. Receipt is `{version:1,production_ready:false,generation,content_hash,next_offset,deliveries,snapshots,publication_hash}`; publication_hash hashes the owner envelope with hyphen-grouped SHA-256. Only publish acknowledges durable file+directory fsync. Exact retry preserves bytes/inode; changed same generation, stale/skipped generation, changed scope/policy or rewritten history fails. Optional fault callback is trusted unit API only, never an acceptance option. |
| `serveFeatureSnapshot(publicationOrNull,scope,request)` | `@lmps/risk` deterministic IO-free API. Restores all state/arithmetic and validates content hash before lookup. No cache or default policy. Malformed input throws `FEATURE_SERVING_INVALID`. |
| `openFeatureServingAdapter(consumerDirectory,storeDirectory,scope,fault?)` | Synchronous compiled worker API. Paths must be absolute, disjoint, private and owned. Returns `publish(positionedDeliveries,published_at,expires_at)`, `read()`, `receipt()`, `serve(request)`, `close()`. Publish consumes/replays, freezes all configured queries, closes/reopens B06, validates actual durable checkpoint/receipt, then publishes store state. Same state and times retry without generation change. Changed publication time creates a new generation. Read/receipt delegate to the store; serve uses the explicit request. |
| `rebuildFeatureServingStore(consumerDirectory,newAbsentStoreDirectory,scope,published_at,expires_at)` | Validates retained consumer evidence with all configured snapshots frozen, then writes a new generation-1 store. Returns store metadata and closes owned handles. Reopening the adapter serves it. Existing/in-place destinations are refused. Semantic state/positions match; owner/envelope hashes need not. Never switch an active pointer to older rebuilt data automatically. |

B06 `openFeatureStreamConsumer(directory,plan)` returns `consume(positionedDelivery)`, `materialize(queryId)`, `receipt()`, `close()`. Deliveries bind declared identity/topic/partition 0 and contiguous offsets; replay must match exactly. Its receipt exposes next_offset, snapshot count and checkpoint/state/plan hashes (space-grouped SHA-256). The adapter verifies the actual bounded private checkpoint rather than trusting that receipt. B06 `initializeFeatureStream`, `applyFeatureStreamDelivery`, `materializeFeatureStreamSnapshot` and `restoreFeatureStream` retain their existing contracts and arithmetic.

## Freshness, expiry and failure semantics

Source freshness uses snapshot query.as_of. A newer publication time cannot refresh old source evidence. `now - as_of == max_age_seconds` is allowed; one second beyond is SOURCE_STALE. `now == expires_at` is PUBLICATION_EXPIRED. Expiry must be after publication and at most 86400 seconds later; publication cannot precede any frozen query.as_of. Fixture freshness bounds are 0..86400 seconds.

Unavailable precedence is request scope, request policy, absent publication, publication scope, publication policy, generation, future publication, expiry, future evidence, absent snapshot, missing/partial evidence, source age. Reasons are SCOPE_MISMATCH, POLICY_MISMATCH, PUBLICATION_MISSING, GENERATION_TOO_OLD, FUTURE_PUBLICATION, PUBLICATION_EXPIRED, FUTURE_EVIDENCE, QUERY_MISSING, INPUT_MISSING, HISTORY_INCOMPLETE and SOURCE_STALE. Changed malformed queries/currency fail validation. Missing never becomes zero and no outcome authorizes a risk action.

## Bounds and operational recovery

One exact plan per store; at most 2000 positioned deliveries, 8 frozen snapshots, 1 MiB encoded state/publication and 1000 successful generation publications per store. Golden acceptance is fixed to 18 deliveries/6 snapshots within the 32-delivery/32768-byte corpus ceiling. Acceptance permits at most 180 seconds and 16 MiB total owned experiment evidence, including acceptance. Bounds fail without eviction or truncation. Golden acceptance has no knobs to enlarge them.

Consumer ACK and store publication are separate commits. A serving claim requires matching durable store evidence. On publication failure, retain the consumer prefix, close/reopen and replay exact deliveries to converge. Read/receipt/serve on a poisoned handle fail. Close validates the actual disk after an ambiguous publication; malformed state or unresolved ownership retains evidence and blocks. Use a NEW directory to rebuild from a validated retained consumer, then independently compare semantic hashes/positions/generation before any separate promotion decision. Never delete evidence to make a failed run pass.

Cooperating-writer locks are exclusive and released only by their live owner after validation. Stranded locks/stages block; there is no stale-PID takeover, process killing, SIGKILL recovery, arbitrary overwrite or destructive in-place rebuild. Stable ancestors/cooperating writers are required. Filesystem expiry controls availability, not retention deletion. Retain the entire private run directory and source/check receipts until review resolves it; any later deletion is a separate owner-authorized retention action. No automatic pruning is provided.

This baseline makes no distributed linearizability, HA, capacity, native-Kafka, real tenancy, cache-adoption or production claim. Cache selection/Valkey/Redis, real source configuration, masking/full-account representation and masking boundary, stable real account linkage, watermark completeness, owner-approved freshness/TTL and risk policy, security/operations and all original master leaves remain pending.

## Host handoff

The independent host runs the unchanged fixed `full` group: automation, root typecheck/test/build, frozen offline `verify:fresh`, publication/security, and exact allowed-source/plan/Git/prefix guards with durable receipts. No lint command exists. Sandbox current-task checks do not replace DB-heavy worker/root suites. After guarded promotion the parent must invoke the CLI afresh on final promoted source, verify current hashes and persisted evidence independently, confirm closed owned locks/handles, append actual host evidence, then stop this queue after US-705. `production_ready=false` throughout.


Independent RLP-B07 host acceptance — 2026-10-26T07:08:12.253Z:

- PASS: automation (/Users/macbookpro/Documents/LMPS_Risk/financial-crime-platform/node_modules/.bin/node --test --test-concurrency=1 /Users/macbookpro/Documents/LMPS_Risk/financial-crime-platform/tools/ralph/automation.test.mjs)
- PASS: quality-1 (/Users/macbookpro/.nvm/versions/node/v24.19.0/bin/pnpm typecheck)
- PASS: quality-2 (/Users/macbookpro/.nvm/versions/node/v24.19.0/bin/pnpm test)
- PASS: quality-3 (/Users/macbookpro/.nvm/versions/node/v24.19.0/bin/pnpm build)
- PASS: quality-4 (/Users/macbookpro/.nvm/versions/node/v24.19.0/bin/pnpm verify:fresh)
- PASS: publication-and-secrets (/Users/macbookpro/Documents/LMPS_Risk/financial-crime-platform/.venv/bin/python -B ci/security.py)

All listed commands completed with exit0 using private local fixtures. Actual full outputs and hashes are retained in the task's private checks directory. Online advisory audit: SKIP (offline batch). Synthetic simulation only; production readiness, real source semantics/identity/labels and the real2GB trial remain unverified/deferred. Task completion is controlled by a durable host receipt after guarded promotion.
