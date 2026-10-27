# Local synthetic CDC acceptance (P03 / RLP-B04)

This is a separately invoked parent-host experiment after trusted implementation gates pass. Coding agents run unit tests only. Importing the command or running the existing root test glob does not launch the experiment. No package, lock, test budget or root script changes are required.

## Prepared provenance

The host acquired the following upstream HTTPS archives and verified SHA512 before extraction. The command never downloads or installs anything. Kafka is **4.1.2**, Debezium **3.7.0.Final**, MariaDB **11.8.9**, and Eclipse Adoptium Temurin Java **21.0.10** at `/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home`.

Cache: `/Users/macbookpro/.cache/lmps-cdc-runtime/kafka-4.1.2_debezium-3.7.0.Final`, resolved using `node:os userInfo().homedir`, independently of verifier HOME. Kafka relative directory: `kafka/kafka_2.13-4.1.2`; plugin: `debezium/debezium-connector-mariadb`. Runtime cache is read-only to the experiment.

| Archive | Upstream | Bytes | SHA512 (spaces omitted) |
| --- | --- | ---: | --- |
| Kafka | https://archive.apache.org/dist/kafka/4.1.2/kafka_2.13-4.1.2.tgz | 133586323 | `78ac6e488b1071122f9608dfdb363f6fe50e1dbbc492347002c0398dfbf77e0d8caa5bf794c5937379721004dfe92025937d238b0faf4eb715529417fd43b491` |
| Debezium | https://repo.maven.apache.org/maven2/io/debezium/debezium-connector-mariadb/3.7.0.Final/debezium-connector-mariadb-3.7.0.Final-plugin.tar.gz | 9024428 | `b5cf153830e1c33e0e2e9f6bf4fa7f9be80b85303a83aa0125803133c6975e03e407e51afcd1058e8522c32b8a9de9ea3af63e46cc4f281258b2290da1f29602` |

The 249-file extracted inventory SHA256 is `efd8dcc34d81f51961a1d69dc5863c7307ba90fd9de985002b7e40e2b37edc9c`. [Pins](../../apps/risk-workers/scripts/cdc-runtime-pins.json) are additionally bound by exact file SHA256 `6fda3f20ed7cf0bc9a8fbb18b240a436035001027f3ead4e95d42e600d7d0518` in the acceptance command. Changed pins fail closed. The supervisor verifies archive sizes/hashes, inventory hash and every inventoried file, refuses extra classpath/plugin files, checks ownership/symlinks, Java release vendor/version and the actual Java version command. Acceptance checks runtime before and after the native trial, and records unchanged source hashes. These hashes identify code used; they are not a signature or production supply-chain attestation.

## Data flow and bounds

The actual [US-402 runner](../../apps/risk-workers/scripts/cdc-spike.mjs) creates a disposable invented MariaDB fixture, uses its private CA and verified TLS, and captures via Debezium MariaDbConnector into a single-partition local Kafka topic. MariaDB, Kafka listeners and Connect REST bind loopback. JSON converters require no schema registry. Only `lmps_cdc_invented.specimens` with synthetic integer id, revision, exact decimal-string amount and currency XTS is allowed. There is no real source, account data, provider or payment action. Observation offsets/positions are not business identity.

Fresh owned runtime/socket directories are under `/private/tmp/lmps-cdc-`; new private evidence is under project `.local/`. Files are 0600 and directories 0700. Generated passwords and source truststore remain private; passwords do not enter argv or console output. Native subprocesses use minimal environments. Do not publish private runtime files, credentials or diagnostics.

Limits: at least 6 GiB free on project and temporary filesystems before startup; at most 2000 captured records across reads (including tombstones), 2 MiB aggregate capture, 2 GiB owned storage and 180 seconds for the native trial including cleanup. Broker and Connect heaps are at most 512 MiB each; CLI/reader at most 128 MiB. Native setup/read commands have 15-second deadlines, reader has a 10-second observation window; supervisor readiness and stop deadlines are finite. Runner reserves 50 seconds for teardown, monitors resources and fails on violations rather than truncating/retrying. Acceptance also rejects total elapsed time over 180 seconds, including its provenance checks. Its `oracleBytes` counts normalized JSON bytes; the pipeline independently enforces actual transport capture bytes. These limits are experimental bounds, not business SLOs or capacity evidence.

## Run, status, stop and recovery

From the promoted project root, only after the independent full check group and guards pass, the authorized parent host executes this exact command with a never-used private destination:

```sh
node apps/risk-workers/scripts/cdc-acceptance.mjs --output .local/cdc-spike/native-acceptance-001
```

For an operator-controlled asynchronous invocation in the same shell:

```sh
node apps/risk-workers/scripts/cdc-acceptance.mjs --output .local/cdc-spike/native-acceptance-002 &
cdc_acceptance_pid=$!
ps -p "$cdc_acceptance_pid" -o pid=,ppid=,stat=
```

Stop request, followed by waiting for the actual command's exit (use only the live child PID saved by this shell, never a PID copied from a file):

```sh
kill -TERM "$cdc_acceptance_pid"
wait "$cdc_acceptance_pid"
```

SIGINT/SIGTERM mark the trial interrupted and suppress acceptance publication; the bounded pipeline is allowed to finish its owned teardown. Stop is not immediate. Repeated signals do not bypass teardown. Do not SIGKILL or kill by process name. The runner stops Connect/Kafka and MariaDB and checks live owned child handles before removing successful temporary state. An interrupted command exits nonzero even if the underlying pipeline later produced `receipt.json`.

After a normal foreground run, use its exit status and inspect only count/hash evidence:

```sh
node -e 'const fs=require("node:fs"); const r=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(r.kind!=="local_synthetic_native_cdc"||r.cleanupVerified!==true||r.production_ready!==false)process.exit(1); console.log(JSON.stringify(r));' .local/cdc-spike/native-acceptance-001/acceptance.json
```

The parent must independently verify the receipt hash/provenance and no remaining owned processes before recording success. A receipt alone is not that independent host verification. There is no general `status`/`stop` CLI for detached orphan recovery. If the parent dies or cleanup is unresolved, preserve the private directory and any `/private/tmp/lmps-cdc-*` state; use the original supervisor's live child handles and the source helper's positively owned state to investigate. Never issue a global database stop, trust a stale PID, remove unknown paths or automatically retry. No acceptance exists for that trial. Owner investigation/proven cleanup is a required gate before recovery.

Recovery after the owner proves all prior owned services stopped is a new experiment, not offset-state rescue or reuse of evidence:

```sh
node apps/risk-workers/scripts/cdc-acceptance.mjs --output .local/cdc-spike/native-acceptance-recovery-001
```

Existing output directories are refused, including failed runs. Do not edit old evidence. The runner preserves fixed-code `failure.json` when it has an output directory; preflight/acceptance failures may leave no failure file. Absence of `acceptance.json`, any nonzero exit or unresolved cleanup means failure/pending, never acceptance.

## Proof and receipt contract

The acceptance entry has no receipt-file input, fake mode or injected runner. It calls the actual native pipeline with default dependencies. The pipeline's strict oracle verifies snapshot completion, exact independent operation/revision and final-state expectations, exact decimal strings, ordered observation offsets, delete tombstone and conflicting replay rejection. It stops connector and broker, mutates only the paused fixture, restarts the same broker logs/offset/schema-history state and verifies prefix continuity with no re-snapshot. A second topic read must match and reduction twice must preserve the independently expected result. Missing, unsupported, oversized, unordered or conflicting observations fail.

Acceptance separately validates all four proofs (`snapshot`, `stream`, `restart`, `replay`) against independent expected state/operation hashes and exact counts, verifies replay's doubled observation count/bytes, verifies the private persisted pipeline receipt matches the live invocation, rechecks runtime/source provenance and checks no owned handles remain. No caller-provided success flag can substitute for running that path. Native assertions remain unproven until the host actually runs it.

`acceptance.json` is published only after success with an exclusive atomic hard link of a fully written/fsynced private temporary file, then directory fsync. Existing acceptance evidence is never overwritten. Publication failure exits nonzero. Receipt fields:

| Field | Meaning |
| --- | --- |
| `format`, `kind`, `production_ready` | Version 1, local synthetic native CDC, always false production readiness |
| `completedAt`, `elapsedMs` | Host completion timestamp and measured elapsed bound |
| `sourceSha256` | Pins, supervisor, oracle, runner and acceptance source hashes, unchanged during run |
| `pipelineReceiptSha256` | SHA256 of private `receipt.json` bytes |
| `versions`, `limits` | Exact versions and experiment caps |
| `capturedRecords`, `oracleBytes` | Aggregate read counts and normalized JSON byte counts |
| `cleanupVerified` | Pipeline teardown succeeded and exported owned handle sets are empty |
| `proofs` | Pipeline version/capture hash and separate per-phase records, observations, bytes, tombstones, state and operations hashes |
| `pendingGates` | Explicit unresolved owner/adoption/source/operations and unsupported guarantees |

The native command is deliberately absent from the root test glob. Unit tests use pure validation, test-process module substitutions and disposable workspace filesystem paths, without starting native services. Run `node --test apps/risk-workers/test/cdc-acceptance.test.mjs` locally. The trusted host separately runs mandatory automation, root typecheck/test/build, frozen offline fresh verification and exact scope/source/plan/Git/publication guards with unchanged dependencies, locks and existing tests.

## Open gates

### US-501 correction and supersession

Final candidate recheck expanded descendant EACCES/EIO regressions across lstat, chmod and readdir in both guards. All 39 CDC tests passed again from each supported cwd, and the exact pins-file checksum binding passed without changing pins. The repeated security check returned its generic tool/setup failure; final trusted security verification remains pending. Preliminary host diagnostic success does not replace verification and a new native acceptance run on promoted source.

RLP-B05 reconciles the prepared P03 candidate rather than rebuilding US-401/402. Their verified source receipts remain intact. The partial US-403 handoff remains historical and unverified: its package-cwd acceptance test failed; US-501 supersedes only that unfinished final work. B03 remains the complete sealed predecessor; B04 is an additional verified source basis, not a sealed complete batch.

Both live storage guards tolerate ENOENT only for a vanished descendant during lstat, chmod or readdir. Missing roots, other filesystem errors, ownership/type/symlink violations and size bounds still fail closed. Deterministic deletion seams exercise each operation; root ENOENT/EACCES/EIO failures are also covered at each step. Acceptance subprocess paths and publication fixtures resolve from import.meta.url, independently of cwd. Prepared integration corrections retain the verified Connect plugin parent and sibling rejection, MariaDB verify-full TLS and ordered first/last snapshot markers. Public grouped checksum metadata reconstructs exact values without changing pins.

The installer diagnosis is historical host evidence, not a coding-agent native trial. Interrupted installer descendants remain unproven; no shutdown is inferred from an interrupted script exit. The private host review is preliminary only and cannot replace final native acceptance. The parent must repeat `node apps/risk-workers/scripts/cdc-acceptance.mjs --output <new-project-private-directory>` after final source verification/promotion and independently verify cleanup before reporting success.

Current coding validation: all 39 CDC unit/subprocess tests pass from both repo root and apps/risk-workers; root pnpm typecheck passes. Grouped public pin syntax, reconstructed lengths and exact pins-file hash binding pass. The attempted python3 -B ci/security.py exited 1 with its generic withheld tool/setup error; no security PASS is claimed. Full trusted automation, root suites/build, frozen offline verify:fresh, publication/security/source/plan/Git guards and the final real native trial remain mandatory host gates. No native service, database command or binding was run by this coding turn.

At implementation handoff the full host checks and real native command are pending. Only the private host-generated `acceptance.json` plus independent process verification establish this bounded native experiment. No receipt is supplied by coding completion. Even a successful trial does not close original P03 owner/adoption/source/operations gates, authorize production adoption or a real source connection, prove concurrent initial-snapshot updates, DDL/schema evolution or expired-binlog recovery, or establish general ACL/HA/capacity guarantees. Real source configuration, full-account representation, stable account identity and the masking boundary remain unverified; no verified account graph is claimed. Original plan and historical B01–B03 receipts remain authoritative and unchanged.


Independent RLP-B05 host acceptance — 2026-10-25T23:52:40.865Z:

- PASS: automation (/Users/macbookpro/Documents/LMPS_Risk/financial-crime-platform/node_modules/.bin/node --test --test-concurrency=1 /Users/macbookpro/Documents/LMPS_Risk/financial-crime-platform/tools/ralph/automation.test.mjs)
- PASS: quality-1 (/Users/macbookpro/.nvm/versions/node/v24.19.0/bin/pnpm typecheck)
- PASS: quality-2 (/Users/macbookpro/.nvm/versions/node/v24.19.0/bin/pnpm test)
- PASS: quality-3 (/Users/macbookpro/.nvm/versions/node/v24.19.0/bin/pnpm build)
- PASS: quality-4 (/Users/macbookpro/.nvm/versions/node/v24.19.0/bin/pnpm verify:fresh)
- PASS: publication-and-secrets (/Users/macbookpro/Documents/LMPS_Risk/financial-crime-platform/.venv/bin/python -B ci/security.py)

All listed commands completed with exit0 using private local fixtures. Actual full outputs and hashes are retained in the task's private checks directory. Online advisory audit: SKIP (offline batch). Synthetic simulation only; production readiness, real source semantics/identity/labels and the real2GB trial remain unverified/deferred. Task completion is controlled by a durable host receipt after guarded promotion.
