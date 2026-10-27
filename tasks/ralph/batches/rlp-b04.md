# RLP-B04 — approved local synthetic CDC spike

Authorization: user confirmed "P03: MariaDB → Debezium → Kafka บนข้อมูลสมมติ ผ่าน Ralph TUI let start" after the reviewed goal/tasks/files/checks/dependencies in chat. Serial tasks US-401–403 use existing plusb; no automatic retries/rotation, no login/logout, no API credential or deployment. Explicit fixed host local fixture checks and the real native acceptance command below are included. Coding agents retain existing workspace-write restrictions.

This batch adds technical experiment evidence for P03; it does not erase blocked master gates or claim full P03 completion. The master catalog/135 leaves/122 blockers and original plan are preserved. B03 is complete and hash-sealed before these new source definitions. Named product/operations/risk owners and real-source/adoption/SLO/legal/security acceptance remain pending. The current user-authorized host session operates this bounded experiment only.

Host prepared artifacts from upstream HTTPS and verified SHA512 before extraction. The extracted inventory is hash-bound below. No new npm/Python dependency or Docker install. Existing source MariaDB11.8.9 runtime is reused only to create disposable synthetic fixtures. Runtime files are read-only to the coding workflow; do not inspect outside candidate paths.

## Exact prepared runtime facts

```json
{
  "format": 1,
  "cacheBase": "/Users/macbookpro/.cache/lmps-cdc-runtime/kafka-4.1.2_debezium-3.7.0.Final",
  "javaHome": "/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home",
  "javaVersion": "21.0.10",
  "kafkaVersion": "4.1.2",
  "debeziumVersion": "3.7.0.Final",
  "mariadbVersion": "11.8.9",
  "inventorySha256": "efd8dcc3 4d81f519 61a1d69d c5863c73 07ba90fd 9de98500 2b7e40e2 b37edc9c",
  "inventoryFiles": 249,
  "kafkaRelative": "kafka/kafka_2.13-4.1.2",
  "pluginRelative": "debezium/debezium-connector-mariadb",
  "artifacts": [
    {
      "name": "kafka",
      "url": "https://archive.apache.org/dist/kafka/4.1.2/kafka_2.13-4.1.2.tgz",
      "sha512": "78ac6e48 8b107112 2f9608df db363f6f e50e1dbb c4923470 02c0398d fbf77e0d 8caa5bf7 94c59373 79721004 dfe92025 937d238b 0faf4eb7 15529417 fd43b491",
      "bytes": 133586323
    },
    {
      "name": "debezium",
      "url": "https://repo.maven.apache.org/maven2/io/debezium/debezium-connector-mariadb/3.7.0.Final/debezium-connector-mariadb-3.7.0.Final-plugin.tar.gz",
      "sha512": "b5cf1538 30e1c33e 0e2e9f6b f4fa7f9b e80b8530 3a83aa01 25803133 c6975e03 e407e51a fcd1058e 8522c32b 8a9de9ea 3af63e46 cc4f2812 58b2290d a1f29602",
      "bytes": 9024428
    }
  ]
}
```

## Native host acceptance gate

After all source tasks pass, the parent host must execute `node apps/risk-workers/scripts/cdc-acceptance.mjs --output <new-private-project-.local-directory>` on the promoted source and verify acceptance.json plus no remaining owned processes. This separate real experiment is mandatory before final P03 success. Never edit old evidence, declare a skeleton/native fake complete, skip old tests or widen coding-agent access.

Keep actual capture on loopback with invented non-account records, >=6GiB free, <=2000 records, <=2MiB captures, <=2GiB owned storage and <=180s native trial. Kafka/Connect heaps <=512MiB each, CLI <=128MiB. Time/resource limits are local experimental limits, not approved business SLOs. The trial must stop safely on a violated bound.

### US-401: Implement pinned bounded local Kafka/Connect runtime supervisor

**Description:** Approved local P03 experiment only; implement the current source task within its exact files. Native proof remains a separately invoked parent-host acceptance gate.
Exact files: `apps/risk-workers/scripts/cdc-runtime.mjs`, `apps/risk-workers/scripts/cdc-runtime-pins.json`, `apps/risk-workers/test/cdc-runtime.test.mjs`
Fixed check group: workers

**Acceptance Criteria:**
- [ ] Implement actual reusable runtime discovery/verification and owned process/config lifecycle helpers for the supplied Kafka 4.1.2, Debezium 3.7.0.Final, Temurin Java 21.0.10 artifacts. Export documented APIs usable by following tasks for Kafka start/stop, Connect start/stop/restart and bounded allowlisted Kafka CLI execution. No placeholder supervisor or fake implementation may satisfy native work.
- [ ] Use node:os userInfo().homedir to resolve the fixed .cache/lmps-cdc-runtime/kafka-4.1.2_debezium-3.7.0.Final cache independent of anonymous verifier HOME. Pin the supplied archive SHA512s and extracted-inventory SHA256 in cdc-runtime-pins.json; validate owned regular files, archive hashes, inventory hash and extracted files before execution. No download, network acquisition, package install, environment-selected code or silently changed version. Java home is supplied below; validate exact version and use absolute binaries.
- [ ] Kafka: one KRaft broker/controller, fresh short owned temp directory and separate dynamically allocated 127.0.0.1 ports; one partition/replica for this experiment. Standalone Connect uses private durable offset file, private schema-history topic and generated properties; explicitly bind REST/listeners/advertised addresses to loopback. JSON converters, no schema registry/Avro dependency. Broker log and private process outputs bounded; own files 0600/directories0700.
- [ ] Bound heap: broker <=512MiB, Connect <=512MiB, short-lived CLI <=128MiB. Set a minimal child environment with pinned JAVA_HOME/PATH and bounded JVM options; no inherited API keys, JAVA_TOOL_OPTIONS, arbitrary JVM/shell input, JMX remote port or services on existing ports. Finite readiness/command/stop deadlines; SIGTERM then bounded owned-child-only cleanup. State/config reuse must preserve broker identity/log/offsets on restart rather than reformatting.
- [ ] Expose process handles or equally verifiable ownership; never kill by broad process name or untrusted PID. Reject path symlinks/traversal, unowned directories, malformed ports, unknown settings/tools and missing/tampered runtime. No writes into runtime cache or arbitrary caller paths. Runtime helpers must be import-safe. Generated passwords/config never enter stdout/public errors or command-line arguments.
- [ ] Add meaningful unit checks for rejection boundaries, deadlines, minimal environment, failed startup cleanup and restart/offset preservation with injected trusted fake processes. Coding agent may run these unit checks; actual Java/database/binding trial is host-only and remains pending until final acceptance. Preserve every existing test/dependency/lockfile/tooling source.
- [ ] Exact allowlist/source/plan/Git/publication guards and the fixed checkGroup checks pass; existing tests, automation, package manifests and lockfiles are protected.
- [ ] Coding agent remains workspace-write, with no real source/data/provider, native database commands, external network, installs or authentication-home reads. Native service checks are host-only.
- [ ] Return structured ready_for_verification with honest actual unit results and pending host gates; only durable independent host receipts finish the source task.

### US-402: Implement bounded CDC observation oracle and private spike runner

**Description:** Approved local P03 experiment only; implement the current source task within its exact files. Native proof remains a separately invoked parent-host acceptance gate.
Exact files: `apps/risk-workers/scripts/cdc-oracle.mjs`, `apps/risk-workers/scripts/cdc-spike.mjs`, `apps/risk-workers/test/cdc-oracle.test.mjs`, `apps/risk-workers/test/cdc-spike.test.mjs`
Fixed check group: workers
**Depends on:** US-401

**Acceptance Criteria:**
- [ ] Reuse US-401 supervisor and existing packages/source-preflight/scripts/local.mjs native MariaDB ownership/TLS helpers. Implement an actual loopback synthetic MariaDB -> Debezium MariaDbConnector -> Kafka pipeline callable as an import-safe module and finite CLI. Only explicit run of this owned invented fixture may create data/services. No real source, persistent project database, external host, account field, canonical business identity, payment action, vendor/provider or new dependency.
- [ ] Build a dedicated invented CDC fixture with a small independent expected operation/state oracle: synthetic integer row id, revision, exact decimal-string amount and synthetic currency only. Seed snapshot rows; observe snapshot completion, then insert/update/delete, including delete tombstone. Configure finite table/column allowlist, decimal.handling.mode=string and bounded batches; credentials generated privately with only the disposable fixture grants needed. Use its CA and verified TLS to the source; do not weaken an existing shared server or edit a shared Java truststore.
- [ ] Implement strict bounded CDC-envelope parsing and reducer separately from transport. Reject malformed/oversized/unknown fixture records; preserve unavailable/unsupported semantics. Operation/position/record-offset observation identity is not payment/account identity. Compare observed op/revision set, final row state and exact money against independently declared expected values. Duplicate replay must not multiply logical effects; conflicting reuse fails. Do not claim exactly-once across systems.
- [ ] Prove offset continuity by stopping owned connector/broker, modifying only the owned fixture while capture is stopped, then restarting with the same broker logs, offset and schema-history state; observe expected new operations and no re-snapshot. Read the Kafka topic again and reduce twice to the same independently expected result. Keep snapshot/stream/restart/replay proofs separate and state limitations for untested concurrent initial snapshot/schema evolution/expired log recovery.
- [ ] Experimental limits: at most2000 records including tombstones/control observations, <=2MiB captured public data, <=2GiB owned fixture/log footprint, <=180s trial with per-step timeouts, and >=6GiB free before starting. Stop and preserve fixed-code private failure evidence on limits; no silent truncation, auto retry, source-wide query, global shutdown or cleanup outside positively owned fixture. These are local experiment bounds, not capacity/SLO/adoption promises.
- [ ] Use a short mkdtemp under /private/tmp/lmps-cdc- for sockets/process data; outputs go to a new private owned directory under project .local/cdc-spike/ by default. Emit a count/hash/version-only receipt, with no credentials, raw account values or raw diagnostic payloads. Always tear down owned Kafka/Connect/MariaDB processes with verified shutdown; preserve private failure evidence when safe cleanup cannot be proven. Native data manipulation is host-only; coding agent runs only independent oracle and runner rejection/lifecycle unit tests.
- [ ] Add meaningful independent expected-value tests for snapshot/create/update/delete/tombstone, exact decimals, duplicate replay, changed-content identity conflict, missing/out-of-order/oversized observations and bounded CLI inputs. No fake receipt or precomputed success can substitute for native acceptance.
- [ ] Exact allowlist/source/plan/Git/publication guards and the fixed checkGroup checks pass; existing tests, automation, package manifests and lockfiles are protected.
- [ ] Coding agent remains workspace-write, with no real source/data/provider, native database commands, external network, installs or authentication-home reads. Native service checks are host-only.
- [ ] Return structured ready_for_verification with honest actual unit results and pending host gates; only durable independent host receipts finish the source task.

### US-403: Add native CDC acceptance command and evidence-based handoff

**Description:** Approved local P03 experiment only; implement the current source task within its exact files. Native proof remains a separately invoked parent-host acceptance gate.
Exact files: `apps/risk-workers/scripts/cdc-acceptance.mjs`, `apps/risk-workers/test/cdc-acceptance.test.mjs`, `docs/operations/local-cdc-spike.md`, `docs/implementation-status/current.md`
Fixed check group: full
**Depends on:** US-402

**Acceptance Criteria:**
- [ ] Implement the host-only native acceptance entry node apps/risk-workers/scripts/cdc-acceptance.mjs --output <new-private-output-directory>. It must invoke the actual US-402 pipeline, verify every snapshot/changes/restart/replay oracle proof and process cleanup, and atomically publish an acceptance.json receipt only after all pass. Exit nonzero on native failure, unavailable runtime, changed pins, missing observation, limits or unresolved cleanup. Never accept self-reported or fixture-only results.
- [ ] Native acceptance is a separately invoked explicit host experiment, not automatically launched inside the legacy root test glob; existing root/fresh verification budgets and all existing checks remain unchanged. Unit-test command/receipt failure boundaries without starting native services. The parent host must run this exact real native command after the Ralph implementation gates pass; the approved P03 scope is incomplete until that independent trial and receipt succeed.
- [ ] Document exact versions/hash provenance, cache location/verification, local-only data flow, finite resource bounds, exact run/status/stop/recovery commands and receipt fields. Describe actual checked properties and explicit missing gates. No production adoption, real source connection, initial-snapshot concurrent-update/DDL/expired-log guarantee, general ACL/HA/capacity claim or verified account graph.
- [ ] Append an honest implementation handoff to current.md preserving its original prefix. At coding time host/full/native checks are pending; do not fabricate PASS/counts. Point actual native acceptance status to the private acceptance.json generated only by the host command. The trusted verifier appends actual standard host checks after they pass. Local implementation/receipt completion does not close original P03 owner/adoption/source/operations gates.
- [ ] Run all mandatory trusted automation, root typecheck/test/build/frozen offline fresh verification and publication/scope guards with unchanged tests/locks/dependencies. Keep B01-B03 receipts/trackers, original11 plan documents and Git/index unchanged. No commit/push/deploy/logout/account rotation.
- [ ] Return ready_for_verification only when actual code and available unit checks are finished, explicitly listing the native host trial as pending. Completion of the source task never manufactures a native acceptance receipt.
- [ ] Exact allowlist/source/plan/Git/publication guards and the fixed checkGroup checks pass; existing tests, automation, package manifests and lockfiles are protected.
- [ ] Coding agent remains workspace-write, with no real source/data/provider, native database commands, external network, installs or authentication-home reads. Native service checks are host-only.
- [ ] Return structured ready_for_verification with honest actual unit results and pending host gates; only durable independent host receipts finish the source task.
