# Bounded local synthetic feature consumer

US-601–605 is a supplemental P04 experiment. Every entity is invented
`synthetic_declared`. `production_ready=false` is mandatory. This does not close
original phase/master leaves or establish source configuration, full/masked
account representation, stable identity, linkage or the masking boundary. The
P03 specimens CDC table is not canonical payments.

## Commands and host acceptance

Use the existing offline workspace and pins; install nothing. Node currently
reports 24.19.0 in the coding sandbox; package policy is Node >=24.19.0 <25,
pnpm 11.20.0, TypeScript 5.9.3. The host checks the unchanged toolchain policy.
Required preparation includes contracts, risk and worker builds. Available
scoped commands (from repository root):

```sh
pnpm --filter @lmps/contracts build
pnpm --filter @lmps/risk build
pnpm --filter @lmps/risk-workers build
pnpm --filter @lmps/risk-workers typecheck
node --test apps/risk-workers/test/feature-stream-acceptance.test.mjs
```

The new test also runs from `apps/risk-workers` as
`node --test test/feature-stream-acceptance.test.mjs`. Subprocess substitutes
exercise validation, not native Kafka. Import and invalid CLI tests start no
services. There is no fake CLI, receipt input, runtime override or caller success
parameter. Tests must never be presented as native acceptance.

The trusted host runs its fixed full check group: unchanged automation, root
typecheck/test/build, frozen offline `verify:fresh`, publication/security and
scope/source/plan/Git guards, plus required worker/legacy integration suites with
owned fixtures. There is no lint command. Guarded promotion and durable receipts
for all five stories must precede the final host trial. On final promoted source:

```sh
node apps/risk-workers/scripts/feature-stream-acceptance.mjs --output /absolute/project/.local/new-private-feature-acceptance
```

Replace `/absolute/project` with this project's absolute root. `.local` and any
intermediate directory must already exist and have safe ancestors. Destination
must be new, normalized, strictly beneath project `.local`, with simple path
components and no symlink or group/world-writable ancestors. Never reuse evidence
directories. Only `--output <absolute-path>` is accepted. Generic nonzero failure
is `FEATURE_ACCEPTANCE_FAILED`; payloads and native diagnostics stay private.

Success prints `FEATURE_ACCEPTANCE_RECORDED`. Status is the private
`acceptance.json` in that invocation's output, not stdout or an old receipt. The
parent must independently rehash current sources/compiled files, inspect actual
result and check zero remaining owned processes before reporting native success.
All public checksums use eight-character lossless hex groups. Final proof contains
counts/hashes, elapsed time, zero-owned-process count and explicit remaining gates;
it contains no events or identity values. `pipeline/` retains private captures,
snapshots, pipeline receipt and consumer owner/checkpoint for inspection.

## Native runtime and bounds

The default US-604 runner uses the unchanged CDC supervisor and pin inventory:
Temurin 21.0.10, Kafka 4.1.2 (Scala 2.13), inventoried client jars. The existing
inventory also verifies Debezium 3.7.0.Final; this experiment does not start Connect
or MariaDB. No downloads, existing broker, network provider or real source. The
owned broker and producer/reader connect only over loopback, with one partition.
Broker heap is `-Xms32m -Xmx512m`; Java helpers use `-Xms32m -Xmx128m`, both with
`-XX:+ExitOnOutOfMemoryError` and the supervisor's restricted child environment.

Fixture limits: <=32 deliveries, <=8 snapshots, <=32768 input bytes; capture
<=2000 records and <=2MiB for the complete run. Checkpoint <=1MiB, bounded
revision/offset maps. Reject gaps, corruption, unsupported state and overflow;
never truncate. >=6GiB free is required before startup on project/helper storage.
Owned runtime/storage <=2GiB, including runtime evidence, output and helper scratch;
the supervisor also monitors its owned runtime resources. These are finite fixture
bounds, not SLOs or production capacity claims.

Native trial <=180 seconds including teardown. Runner work deadline is 150 seconds
with 30 seconds reserved for teardown; acceptance's overall watchdog starts before
runtime preflight, signals only live owned handles at 150 seconds and escalates at
170 seconds. Expiry cannot publish success. Source and compiled hashes must match
before/after; runtime integrity is independently checked before/after.
Package manifests are included in provenance; compiled directories must be real
directories. ESM package discovery from the actual worker/reducer locations must
resolve to this project's packages with their exact supported import exports;
CommonJS resolution is not used for these import-only packages. Every compiled
JavaScript file in contracts/risk/workers is hashed. Persisted receipts reject unknown fields, and the entire checkpoint
envelope must equal its independently reconstructed canonical bytes, including
version, private owner UUID, plan/state hashes and next offset. A caller's extra
success marker or rehashed unsupported envelope cannot establish acceptance.
Actual captures must match deterministic golden envelopes and contiguous partition-zero
offsets; quiet end offsets must agree. The runner reads the topic three times,
with two controlled broker restarts. Acceptance checks the persisted initial and
restart capture, full receipt, durable prefix/final hashes and independently
reconstructs restore/replay state. The third capture is checked in the bound
runner before return; its bytes are not separately retained.
Acceptance additionally reopens the private final consumer through its compiled
adapter and compares its recomputed receipt, then closes its writer lock. The
prefix checkpoint hash is reconstructed using the same owned checkpoint UUID,
independent prefix state and fixed plan; a claimed cursor alone is insufficient.

## Snapshot meaning

Unchanged golden corpus and existing offline risk reference are authoritative.
Acceptance additionally has six fixed independent count/amount/reason tuples.
Same-currency outgoing latest available revision contributes exact decimal/BigInt
net money in `(target.occurred_at - 3600s, target.occurred_at]`. Full and partial
reversals apply. Missing evidence and incomplete coverage return unavailable,
never zero. Snapshot `as_of`, coverage and evidence are explicitly supplied
synthetic metadata. Kafka arrival and wall clock do not establish historical
availability. Future revisions remain available for later eligible `as_of`;
previously frozen evidence stays fixed. This is not event-time watermark,
lateness admission, TTL, HA or production adoption proof.

## Stop, ownership and recovery

Run in the foreground. On operator stop use SIGINT/SIGTERM on the current runner
process; native runner handlers trigger owned teardown. Never kill by process
name, read persisted PIDs as authority, or delete an unknown directory. All helper
and broker closes are awaited; successful acceptance requires the supervisor and
helper handle registry to be empty. Native startup/cleanup failure retains private
fixed-code failure evidence and cannot publish final acceptance. Unexpected hard
termination is not proved recoverable; unresolved ownership blocks.

Consumer checkpoints provide one cooperating writer, exclusive ownership, bounded
private files, fsync and atomic local publication of effects and next offset.
ACK follows durable commit. Reopening requires exact plan/input identity and
validated state/content hashes. Identical replay does not add effects. Changed
content/configuration, committed-file loss, unsafe links or ownership fail closed.
No stale-PID takeover. A failed publication poisons the handle: close, reopen and
validate before replay; an ambiguous lock/stage requires owner investigation.
There is no automated recovery command and no permission to erase evidence.
Guarantees require local filesystem exclusive-create/atomic-link-or-rename/fsync
semantics, cooperating writers and stable safe ancestors; hostile ancestor
replacement, machine crash durability, SIGKILL recovery, distributed locking and
HA remain gates.

Final acceptance is staged privately and fsynced, then linked exclusively to
`acceptance.json` and directory-fsynced. Existing evidence is never replaced;
concurrent publication permits one winner. On ordinary
publication failure, only the staging file exclusively created by that invocation
is removed; the final file is preserved, including another publisher's winner.
A crash after linking but before
directory fsync may leave a visible file without a confirmed durable command
result. Treat interrupted/failed invocation as unaccepted and require host review
and a fresh destination. Do not infer success merely from file presence.

Remaining gates include original phase leaves, real source semantics/masking,
stable identity, named adoption/operations owners, capacity, crash recovery,
retention/TTL/watermarks and production rollout. Stop the task queue after US-605.


Independent RLP-B06 host acceptance — 2026-10-26T03:35:36.882Z:

- PASS: automation (/Users/macbookpro/Documents/LMPS_Risk/financial-crime-platform/node_modules/.bin/node --test --test-concurrency=1 /Users/macbookpro/Documents/LMPS_Risk/financial-crime-platform/tools/ralph/automation.test.mjs)
- PASS: quality-1 (/Users/macbookpro/.nvm/versions/node/v24.19.0/bin/pnpm typecheck)
- PASS: quality-2 (/Users/macbookpro/.nvm/versions/node/v24.19.0/bin/pnpm test)
- PASS: quality-3 (/Users/macbookpro/.nvm/versions/node/v24.19.0/bin/pnpm build)
- PASS: quality-4 (/Users/macbookpro/.nvm/versions/node/v24.19.0/bin/pnpm verify:fresh)
- PASS: publication-and-secrets (/Users/macbookpro/Documents/LMPS_Risk/financial-crime-platform/.venv/bin/python -B ci/security.py)

All listed commands completed with exit0 using private local fixtures. Actual full outputs and hashes are retained in the task's private checks directory. Online advisory audit: SKIP (offline batch). Synthetic simulation only; production readiness, real source semantics/identity/labels and the real2GB trial remain unverified/deferred. Task completion is controlled by a durable host receipt after guarded promotion.
