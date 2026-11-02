# Local synthetic feature cache/API handoff

US-1006, RLP-B10. `production_ready=false`. ADR0019 remains **PROPOSED**. These commands are for the independent parent host on promoted source; the workspace coding agent must not start native fixtures. Existing pluse session only; no login/logout, rotation, installation, downloads, commits or deployment.

## Build and verification

Run from the repository root with prepared offline dependencies. Never lower resource, disk or deadline checks to obtain a receipt.

```sh
pnpm --filter @lmps/contracts build
pnpm --filter @lmps/risk build
pnpm --filter @lmps/risk-workers build
pnpm --filter @lmps/risk-api build
node --test --test-name-pattern='unit final' apps/risk-workers/test/feature-cache-final-acceptance.test.mjs
```

The last command runs only sandbox-compatible assertions. The host runs the entire new file (including the real default runner and evidence tampering regression):

```sh
node --test --test-concurrency=1 apps/risk-workers/test/feature-cache-final-acceptance.test.mjs
```

The native case creates a unique private output, runs the actual acceptance CLI, verifies it, then rejects changed/missing persisted publication, unsupported real mode, stale source/runtime provenance, uncertain cleanup and mismatched HTTP hashes/bytes. HTTP file hashes are deliberately rebound to exercise semantic verification. Evidence is restored between cases and removed afterward. This regression is not the durable final promotion receipt.

Fixed full host gates also include automation, root `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm verify:fresh`, frozen offline fresh checks, publication/secrets, exact source/plan/Git guards, preserved status prefix and guarded promotion receipts. Use the trusted host's existing fixed commands and permission profile; there is no lint script. These gates remain pending until actual host evidence is appended.

## Final promoted acceptance

Use a new, nonexistent private destination beneath project `.local`; never reuse earlier receipts. Ensure `.local` is owned, mode 0700, with no writable or symlink ancestors. Example names below must be fresh for each run:

```sh
node apps/risk-workers/scripts/feature-cache-acceptance.mjs --output .local/b10-final-promoted-unique
node --input-type=module -e 'import { resolve } from "node:path"; import { verifyFeatureCacheAcceptance } from "./apps/risk-workers/scripts/feature-cache-acceptance.mjs"; await verifyFeatureCacheAcceptance(resolve(".local/b10-final-promoted-unique"));'
```

`runFeatureCacheAcceptance({output})` is the public API; it accepts only `output`. No caller-supplied runner, environment, executable or receipt can authorize success. `verifyFeatureCacheAcceptance(absoluteOutput)` is read-only consistency verification, not proof that an arbitrary receipt executed. The CLI internally uses a bounded fresh-process verifier and exclusive fsynced receipt publication. Its `--verify-stage` form is internal, not an execution alternative.

The parent must independently bind current promoted source/compiled/corpus/policy/runtime hashes to persisted comparison/store/cache and HTTP evidence, confirm exact DTO hashes and private file inventory, and inspect owned OS processes/listeners/directories for zero survivors. In-process `ownedApiHandles()` and `ownedProcessHandles()` alone cannot detect a subprocess leak. Retain count/hash/status evidence and durable host receipts, never auth keys or payload logs. Do not claim B10 closure before that final independent trial. B11 is a separate approved batch.

## Runtime ownership and provenance

The installed source is `/opt/homebrew/Cellar/redis/8.10.1/bin/redis-server`. The parent-prepared private byte-identical executable is `/Users/macbookpro/.cache/lmps-redis-fixture/8.10.1/redis-server`. Both must match Redis 8.10.1 and SHA256 `48a07c3892d5982a1af6c3fbb9db896b50e7aa564b1d4e6abcb12fcb6b6b6e0d` before every launch. The pin is host-specific; missing/changed binary or unsafe ancestors fail closed. Binary presence is neither a portable artifact pin nor license/adoption clearance. Do not prepare or repair this external copy from the coding sandbox.

The runtime CLI is a launch/readiness/PING/stop probe, not a daemon manager:

```sh
node apps/risk-workers/scripts/feature-cache-runtime.mjs --output .local/b10-runtime-unique
node apps/risk-workers/scripts/feature-cache-compare.mjs --output .local/b10-comparison-unique
```

Programmatic lifecycle: `verifyRuntime()` checks provenance; `await createRuntime({output:'.local/unique-name'})` returns the owned handle. Use `ready()`, `status()`, `receipt()`, `await request(['PING'])` and always `await stop()` in `finally`. Stop is idempotent and confined to that handle. There is no standalone PID-based stop/status CLI and no supported remote target setting. A failed request can make the runtime unavailable and tear it down. Never connect to, flush, stop or adopt another Redis, port, service or data directory.

Fresh exclusive mode-0700 directories, private authenticated Unix socket transport and password-protected loopback TCP are used. TCP ports are allocated in 1024–65535; HTTP binds an owned ephemeral `127.0.0.1` port. Secrets are ephemeral and must not enter logs. Remote binding, modules, persistence/replication and dangerous disk/flush/config commands are disabled. Cleanup checks ownership before removing only its directory; uncertainty cannot publish success.

## Scope, HTTP and exact values

`GET /v1/local/features` uses the existing local JWT `LocalAccessGuard`, permission `risk:read`, and matching principal workspace. Missing/invalid auth is 401; missing permission or foreign workspace is 403 before evidence reads. Local synthetic JWTs do not establish corporate identity or real source field permissions.

Exactly six query fields are required: `version=synthetic-feature-serving-1`, `query_id`, uppercase three-letter `currency`, `as_of`, `now`, and decimal-string `minimum_generation` (1–1000). `query_id` must match the configured frozen plan (1–80 alphanumeric/underscore characters); timestamps are exact UTC seconds, e.g. `2026-01-01T12:00:00Z`. Unknown fields, repeated/non-string inputs, unsupported versions and invalid dates reject with 400. Use explicit fixture time/policy, never wall-clock freshness defaults. No real-account mode exists.

Fixture configuration has exactly `mode:'local_synthetic'`, `scope`, `cache_policy:'required'|'no_cache'`, and absolute private `store_directory`. `loadFeatureFixture(path)` validates it. App activation uses `LMPS_LOCAL_FEATURE_CONFIG` with existing authenticated app configuration; other `LMPS_LOCAL_FEATURE_*` flags reject. Ordinary bootstrap does not launch Redis or accept a cache address; without an owned capability, required cache reads are unavailable. The acceptance harness supplies the owned capability and local JWT verifier; do not add an unauthenticated route or weaken existing app auth to reproduce it.

Available DTOs contain exact decimal `count`/`amount`, complete coverage, explicit freshness and compact generation/content-hash references. Original query 0 is `11`/`14.11`; extended queries 1–5 are respectively `11`/`13.14`, null/`INPUT_MISSING`, null/`HISTORY_INCOMPLETE`, `11`/`13.14`, and `1`/`7.00`. The failed-event zero fixture is available `0`/`0.00`. At fixture now `2026-01-01T12:02:00Z`, source age is 120 seconds with max age 3600. Stale/expired/partial/missing/incompatible/minimum-generation/outage/timeout results are unavailable with null count, amount and source, never invented zero. Errors and DTOs expose no raw account/event/publication/history/path/auth data. Reads are readonly and trigger no enforcement.

## Finite limits and recovery

| Boundary | Limit |
| --- | --- |
| Synthetic records / queries | 2000 / 8 |
| JSON input/state; RESP request/reply | 2 MiB each |
| Cache scoped keys / value bytes / physical TTL | 1 / 1 MiB / 86400 seconds |
| Redis memory / clients | 16 MiB, noeviction / 8 |
| Process output | 64 KiB |
| Runtime command / startup / lifetime / teardown | 1000 / 5000 / 150000 / 2000 ms |
| Adapter command deadline | 1100 ms |
| HTTP query / response | 2048 / 4096 bytes |
| HTTP request+headers / fetch / keepalive | 3000 / 4000 / 1 ms |
| Native scratch / retained evidence | 2 GiB / 16 MiB |
| Independent native trial | 180 seconds including teardown reserve |

The runner targets execution under 160 seconds and publication under 175 seconds, reserving time before the 180-second host deadline. RESP and JSON parsing, process output, sockets and requests are bounded. Capacity rejection is a failure, never silent successful eviction.

`openFeatureCache(ownedRuntime,scope)` returns `capability`, `publish(publication)`, `serve(request)` and `rebuild(publication)`. Scope binds workspace, namespace, full plan, policy and version. A Redis Lua CAS compares generation, predecessor/content and observed fingerprint atomically; identical retry is idempotent, changed same-generation/stale predecessor/old rebuild/cross-scope publication cannot replace newer data. The advisory client read does not authorize the commit.

Durable filesystem publication and cache publication are separate commits. A durable success followed by cache failure is not atomic dual success; required cache reads remain unavailable. Explicit `no_cache` is a separately selected baseline policy, never an automatic outage fallback or silent generation mix. Source freshness is derived from declared as-of/now and policy, not time of cache insertion; expiry equality is unavailable even if a physical TTL key remains.

On outage/timeout, stop only the owned handle and confirm teardown. Start a new owned runtime, independently validate retained durable evidence, then call `rebuild` at the retained generation and verify exact reads. Do not fabricate data, reset a generation to bypass CAS, or rebuild old evidence over newer publication. RDB/AOF are disabled; stop removes owned runtime state and restart has no keys until explicit rebuild. No persistence, replication, automatic failover, production recovery durability or SLO is demonstrated by this fixture.

Corporate IdP, source permissions/semantics/timezone, full-account/masking boundary, stable identity/linkage, engine/cache choice, ownership/legal/license, retention, capacity/SLO and production adoption remain open. Valkey is uninstalled and untested. No target gate is cleared by local success; no real data, account graph, enforcement or production deployment is authorized.


Independent RLP-B10 host acceptance — 2026-10-29T04:37:41.647Z:

- PASS: automation (/Users/macbookpro/Documents/LMPS_Risk/financial-crime-platform/.local/ralph/workspaces/p04-b09-20261027/repo/node_modules/.bin/node --test --test-concurrency=1 /Users/macbookpro/Documents/LMPS_Risk/financial-crime-platform/.local/ralph/workspaces/p04-b09-20261027/repo/tools/ralph/automation.test.mjs)
- PASS: quality-1 (/Users/macbookpro/.nvm/versions/node/v24.19.0/bin/pnpm typecheck)
- PASS: quality-2 (/Users/macbookpro/.nvm/versions/node/v24.19.0/bin/pnpm test)
- PASS: quality-3 (/Users/macbookpro/.nvm/versions/node/v24.19.0/bin/pnpm build)
- PASS: quality-4 (/Users/macbookpro/.nvm/versions/node/v24.19.0/bin/pnpm verify:fresh)
- PASS: publication-and-secrets (/Users/macbookpro/Documents/LMPS_Risk/financial-crime-platform/.local/ralph/workspaces/p04-b09-20261027/repo/.venv/bin/python -B ci/security.py)

All listed commands completed with exit0 using private local fixtures. Actual full outputs and hashes are retained in the task's private checks directory. Online advisory audit: SKIP (offline batch). Synthetic simulation only; production readiness, real source semantics/identity/labels and the real2GB trial remain unverified/deferred. Task completion is controlled by a durable host receipt after guarded promotion.
