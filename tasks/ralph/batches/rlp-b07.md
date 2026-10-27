# RLP-B07 — P04 versioned local feature snapshot serving

User explicitly confirmed ปิด B06 แล้วต่อ B07 after reviewing ordered tasks, files, checks and pending dependencies. Start only after B06 source and actual final native Kafka acceptance both pass. Existing plusd only. This supplemental local filesystem baseline does not close original master gates.

- Authorization: explicit user confirmation ปิด B06 แล้วต่อ B07 after the reviewed ordered proposal. Execute only the current isolated story. Existing plusd login only; no login/logout/rotation, commits, deployment, source connection, real data, verified account entity or enforcement.
- Scope is a bounded local_synthetic no-separate-cache baseline for P04-04/05/09. Reuse B06 contracts/reducer/consumer and unchanged golden/reference. No HTTP endpoint, database/migration, npm dependency/lockfile change, Valkey/Redis install, native service startup or production adoption. Original phase/master leaves remain gated.
- Use strictly invented synthetic workspace/namespace/identity, explicit fixture-only policy versions and supplied UTC times. These do not establish real tenant/account identity, watermark completeness, risk policy or production TTL. Preserve unavailable/partial/stale reasons and exact decimal strings; never silently turn missing into zero or permit a risk action.
- Finite local limits: one plan per owned store, <=2000 positioned deliveries, <=8 frozen snapshots, <=1MiB encoded state/publication, <=32 golden deliveries/32768-byte golden corpus, <=1000 successful generation publications per store. Reject one-over limits without eviction/truncation. Fixture freshness/expiry bounds <=86400 seconds, explicit policy, no Date.now defaults in deterministic logic.
- Document each public API precisely for subsequent stories. New tests must be cwd-independent via import.meta.url, assert independent expected results, exact/one-over limits, isolation, caller/input immutability and failure behavior. Do not edit prior B06 source/tests/golden/reference, existing automation, package locks or AGENTS.md.
- Use unchanged registered fixed host check groups and publication/source/plan/Git guards. No lint command exists. Coding agent runs current-task unit checks/builds/typechecks available in its workspace-write sandbox; host alone runs DB-heavy full/fresh suites. Report ready_for_verification with unexecuted host gates pending, never self-certify completion. Keep production_ready=false.
- For filesystem operations use existing project private ownership/fd/atomic-publication conventions. No unsafe path traversal/symlink/FIFO/hard-link/unowned directory, stale-PID takeover, global process kill, arbitrary output overwrite or dynamic code/config. Fsync file and directory before successful publication acknowledgment; retain ambiguous evidence and block unresolved ownership.
- Final parent acceptance must actually invoke the promoted local feature-serving acceptance CLI, independently bind source/compiled/golden hashes and prove persisted exact output, version/freshness/rebuild/isolation behavior. Unit doubles and B06 receipts do not substitute for a fresh B07 acceptance run. This local filesystem baseline is not a cache/HA/capacity/native-Kafka adoption proof.

## US-701: Define bounded versioned feature-serving contracts

Dependencies: sealed verified B06 with final native Kafka acceptance
Exact files: `packages/contracts/src/feature-serving.ts`, `packages/contracts/test/feature-serving.test.mjs`, `packages/contracts/package.json`
Fixed check group: contracts

- [ ] Add strict detached JSON types/validators and fixed-code errors for store scope, synthetic serving policy, publication, request and discriminated result. Reuse validateFeatureStreamPlan/State/Snapshot instead of redefining event arithmetic. Add only exports["./feature-serving"]="./dist/feature-serving.js" to contracts manifest.
- [ ] Bind synthetic workspace_key, full plan identity including namespace/run/input/topic, strictly increasing generation 1..1000, exact predecessor generation/hash, reducer state, published_at, expires_at and explicit policy id/version/max_age_seconds. Define first generation predecessor exactly. Published time cannot precede snapshot as_of and expiry must be later within bounded fixture TTL.
- [ ] A request binds exact workspace/plan/query/currency, policy version, supplied now and optional minimum generation. Define unavailable reasons for missing/partial/stale/expired/future evidence/policy or scope mismatch; successful response retains complete snapshot provenance. Unavailable results carry null count/amount, never stale usable values or zero fallbacks.
- [ ] Separate source-as_of age from publication expiry: query.as_of is synthetic evidence time, published_at is not proof of source freshness. Define exact equality boundaries: now at expires_at is expired; age equal max_age_seconds allowed; future query/publication or incompatible policy unavailable. Invalid shapes/times/unknown fields fail validation.
- [ ] Strict UTC real-calendar timestamps, safe bounded integers, no numeric coercion/undefined/accessors/prototype/symbol/cycle/duplicate query identity; enforce bounded serialized bytes before trust. Public hashes use deterministic lossless grouped hex and are recomputed later, not trusted from input.
- [ ] Tests cover exact and one-over limits, malformed JSON objects/encoding/times/money, changed identity/policy/version, available and unavailable result invariants, and detached immutable inputs. Contracts typecheck/test and unchanged secret/publication guards pass.

## US-702: Persist atomic version-fenced local feature snapshots

Dependencies: US-701
Exact files: `apps/risk-workers/src/feature-snapshot-store.ts`, `apps/risk-workers/test/feature-snapshot-store.test.mjs`
Fixed check group: workers

- [ ] Implement import-inert openFeatureSnapshotStore on a new owned private directory or validated closed existing one, with publish/read/receipt/close API. One exact synthetic workspace/plan/policy bound at creation. Reuse US-701 and restoreFeatureStream to recompute state/frozen arithmetic and every content/hash before trusting any publication.
- [ ] Publish whole bounded state/snapshot generation atomically. New writes require current generation+1 and exact predecessor content hash; initial generation1 only. Exact same committed generation/content is idempotent; same generation different bytes, stale/lower, skipped generation, changed scope/plan/policy or regressed offset fails without altering committed bytes. A new generation must extend the prior deliveries exactly and preserve all prior frozen snapshots; never rewrite evidence.
- [ ] Private ownership, exclusive cooperating-writer lock and fd-based bounded reads reject unsafe file kinds/links/ancestor traversal or unowned state. No stale-owner takeover. Close releases only this live lock; read/receipt return detached validated data and count/hash-only metadata. Bound store initialization and staged writes; never load unbounded files.
- [ ] Use one fsynced staging inode, atomic replace and parent fsync to commit snapshot content+generation+source position together. Acknowledge only durable publication. Before-publish fault preserves previous committed data; after-publish fault poisons handle and validated close/reopen resolves actual state. No completion marker or success on unresolved cleanup.
- [ ] Trusted fault seam only in unit API, never environment/CLI input. Real filesystem tests cover exact retry/no-rewrite, same/stale/skipped/concurrent writers, higher generation with old data, changed scope/policy, corrupt hash/state/arithmetic, before/after faults, restore and retained evidence, permissions/links, detached reads and limits.
- [ ] Document the no-cache local cooperating-writer guarantee and retained stale locks; do not claim distributed linearizability, SIGKILL recovery, live tenant isolation or TTL deletion. Full worker typecheck/tests and publication guards pass on trusted host.

## US-703: Serve typed feature snapshots with explicit freshness

Dependencies: US-702
Exact files: `packages/risk/src/feature-serving.ts`, `packages/risk/test/feature-serving.test.mjs`, `packages/risk/src/index.ts`
Fixed check group: risk

- [ ] Implement deterministic IO-free typed serving function from validated publication (or null), exact synthetic scope/policy and explicit request.now. Export only by appending export * from ./feature-serving.js to risk index, preserving its full previous prefix. Specify stable public API for adapter and final acceptance.
- [ ] Recompute/validate reducer state and all frozen arithmetic using existing restoreFeatureStream; verify publication/request bindings before lookup. Return snapshot count/amount only for exact matching workspace/full plan/query/currency/policy/minimum generation, available complete evidence and permitted time. No default policy, guessed completeness, network or wall-clock access.
- [ ] Missing publication/query, partial coverage, INPUT_MISSING, stale source-as_of, expiry, future publication/evidence, incompatible scope/policy/version or insufficient generation produce explicit typed unavailable result with null values. Malformed input produces fixed-code validation failure. Unknown source is never represented as safe zero.
- [ ] Enforce age==max_age_seconds boundary and expiry equality exactly as US-701. Preserve snapshot source position, query/as_of/window/coverage and content/version provenance; published_at cannot refresh old source evidence. Distinct namespace/workspace/currency and historical query versions never bleed across results.
- [ ] Tests independently assert fixed expected outputs for valid zero vs unavailable, every reason/boundary, old publication with recent publish time, future clock, changed policy/query/scope, tampered arithmetic/hash, minimum generation and input immutability. Include unchanged golden stream/reference parity rather than returning fixture expected values.
- [ ] Risk typecheck/tests and unchanged source/publication guards pass; no HTTP endpoint or integration into real scoring/enforcement. Document that explicit fixture times/policies are not owner-approved production freshness rules.

## US-704: Connect bounded consumer state to snapshot serving and rebuild

Dependencies: US-703
Exact files: `apps/risk-workers/src/feature-serving-adapter.ts`, `apps/risk-workers/test/feature-serving-adapter.test.mjs`
Fixed check group: workers

- [ ] Implement an import-inert local adapter combining unchanged B06 consumer, US-702 store and US-703 serving function. Document explicit input and API; no native Kafka/database/listener/install. Use separate private owned consumer/store directories with exact synthetic scope/plan/policy and bounded positioned input.
- [ ] Drive actual consumer consume/materialize/close/reopen with supplied deliveries and configured queries; publish only state independently restored/recomputed and matching actual durable consumer checkpoint/receipt. Read checkpoint through bounded safe file descriptors and validate its exact schema/hashes/owner/plan; never trust a caller success flag or receipt alone.
- [ ] Consumer ACK and store publication are separate local commits: only claim serving success after matching store commit. If publication fails, retain consumer prefix and replay idempotently to converge; no atomic cross-store claim. Exact restart/retry preserves totals and frozen snapshots. Closed corrupt/missing state, changed configuration or ambiguous lock stops without overwriting evidence.
- [ ] Support rebuild into a NEW empty owned store from retained validated consumer evidence. Rebuilt outputs/source positions must match original semantic state; store-owner/hash differences are not claimed identical. Refuse in-place destructive rebuild and prevent older rebuilt data replacing a newer active generation.
- [ ] Real filesystem integration tests run unchanged golden corpus/reference through consumer -> store -> typed serving; prove exact expected count/amount/reasons, controlled close/reopen replay, publish failure recovery, new-destination rebuild, stale writes, workspace/namespace/query isolation and bounds. No fake runtime/native result.
- [ ] Preserve all B06 source/tests and pinned runtimes. Worker full typecheck/tests and publication guards pass through trusted host; document unresolved crash locks, explicit policy/time, no separate cache and no real identity/enforcement.

## US-705: Accept local feature serving with full host checks and handoff

Dependencies: US-704
Exact files: `apps/risk-workers/scripts/feature-serving-acceptance.mjs`, `apps/risk-workers/test/feature-serving-acceptance.test.mjs`, `docs/operations/local-feature-serving.md`, `docs/implementation-status/current.md`
Fixed check group: full

- [ ] Add import-inert strict --output acceptance CLI using the actual default compiled B07 adapter/store/serving implementation and unchanged golden/reference. New project .local private destination only; reject unknown flags/existing/unsafe destination before side effects. No injected runner/environment, receipt-file input, fake mode, external service or dependency install.
- [ ] Actually execute controlled local filesystem consumer/store lifecycle, close/reopen retry, stale/conflicting write refusal, fresh/stale/partial/missing/expired outcomes, independent scope checks and new-directory rebuild. Independently compare all fixed golden expected values and existing reference; malformed/changed outputs cannot yield acceptance.
- [ ] Bind before/after source and actual compiled module hashes including B06 contracts/reducer/consumer, B07 modules, golden and reference. Verify private persisted consumer/store/acceptance evidence and actual generation/position/semantic hashes; do not substitute self-reported success. Count/hash-only proof, <=180s and <=16MiB owned experiment evidence; no payload diagnostics.
- [ ] Exclusively atomically publish private acceptance.json only after actual assertions and confirmed closed owned locks/handles. Tests prove inert import/invalid CLI, real failure and provenance mismatch, forged/changed evidence, immutable no-overwrite acceptance and cwd independence. No Kafka/native/production pass claim from this filesystem test.
- [ ] Write runbook with exact commands/APIs/bounds, status/recovery/rebuild and freshness/expiry semantics, retention/lock and separate-commit limits. Describe no-cache baseline and cache-selection/real source/identity/production gates pending. Append candidate handoff strictly AFTER all existing current.md bytes; capture and verify exact entire baseline prefix. Do not insert inside historical headings.
- [ ] Run fixed full host automation/typecheck/test/build/frozen offline verify:fresh/publication plus guarded source/plan/Git/prefix checks and receipts. Parent then runs acceptance CLI on final promoted source and independently verifies current hashes/evidence before final completion. Report only executed results and stop this queue after US-705; production_ready=false.
