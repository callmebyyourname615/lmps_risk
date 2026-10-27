# Local MariaDB metadata preflight — item 9

This batch connects only to an **isolated synthetic local server**, never the LMPS read replica. It creates four empty tables with the 65 selected columns/primary/unique keys from the item-7 mapping. It does not import the source dump, reproduce its complete DDL, copy transaction rows or sync PostgreSQL. The local server is standalone: **zero replication channels is expected and proves nothing about the real replica**.

## Prepare and run

From the repository root, after the standard locked Node/Python bootstrap:

```sh
pnpm source:prepare
pnpm source:init
pnpm source:start
pnpm source:preflight
pnpm source:stop
pnpm source:status
```

`source:prepare` supports macOS 26+ arm64 with Homebrew, Xcode command-line tools and the bottle's existing core dynamic-library dependencies. It fetches the Homebrew MariaDB **11.8.9_1** bottle, checks the [pinned SHA-256](runtime.json), extracts privately under `.local/mariadb-runtime`, relocates Mach-O dependencies and ad-hoc signs changed binaries. It runs no `brew install`, link, post-install or service command and upgrades no shared library. Existing MySQL binaries/data/services remain untouched. Missing libraries or a changed upstream bottle fail preparation; review the new artifact instead of bypassing integrity checks. Optional storage-engine plugins, including Groonga, are not part of the tested runtime. This is a core-server test setup, not a full Homebrew installation.

Other environments may supply an installed MariaDB **11.8** through absolute `LMPS_MARIADB_BASE` (`bin/mariadbd` or `sbin/mariadbd`, plus `bin/mariadb-install-db` and server support files). Linux CI uses `/usr`; its package patch is repository-managed. Run as a non-root user with OpenSSL available. Native binaries are required and tests fail if missing; no Docker is required.

`source:init` creates `.local/mariadb`, database `lmps_source_local`, generated administrator/inspector credentials and a local CA/server certificate, then stops it. Repeating init leaves a recognized ready fixture unchanged. Port **18504** and IPv4 loopback are dedicated to this fixture; the separate PostgreSQL foundation uses 18503. A conflicting listener does not cause fallback to another server. The manager verifies authenticated `@@datadir` before controlling a server. No reset/drop command is provided; incomplete or unverifiable state is preserved for inspection. A failed spawned startup receives SIGTERM; do not erase state while its process ownership/stopped state is uncertain.

The bootstrap starts with networking disabled until credentials/grants are installed and initial extra users removed. Ordinary starts enable `read_only`, verified TLS, ROW/FULL binlog and logged replica updates **only on this newly created local fixture**. Generated certificates are valid for 30 days, name `localhost` and IP 127.0.0.1. The connector explicitly verifies the `localhost` TLS identity while dialing loopback; wrong CA and wrong identity are rejected. Expired certificates require local certificate renewal/retest; verification is never disabled. Private directories and credential/key/config/log files are restricted and ignored by Git. Do not paste `state.json` or `preflight.json` into chat/source.

## What the tool reads

One connection, no connection pool, parallel workers or retries. Queries are a fixed [allowlist](../../packages/source-preflight/src/index.ts):

- Read-only transaction, MariaDB version and 12 selected global variables.
- `SHOW ALL REPLICAS STATUS`, requiring `REPLICA MONITOR`; missing privilege becomes `UNVERIFIED/PERMISSION_DENIED` and does not stop independent schema checks.
- `information_schema.TABLES`, `COLUMNS`, `STATISTICS`, restricted to the four candidate tables with bound database/table parameters. Primary and unique key order, selected column type/length/precision/nullability are compared with the review artifact.

There is no transaction-table SELECT, `COUNT(*)`, `ANALYZE`, query-plan execution, table lock request, configuration change or replication administration in the inspector. Metadata still has a cost; this local test does not establish an acceptable real-replica load budget. The synthetic inspector has SELECT on only those four fixture tables and global `REPLICA MONITOR`; it has no DML, DDL or replication-control grant. A read-only transaction is additional protection, not a substitute for grants.

Connect timeout=1s, driver query timeout=800ms, client query deadline at most 1s, socket inactivity=1.5s, post-connect total query budget=8s, packet cap=1 MiB. SQL LIMITs and application row caps reject truncated/oversized results; replication channels cap=32. These are development limits, not a measured production SLA. Full metadata results for those four tables must fit the caps; otherwise the report stays partial. There are no automatic retries that could amplify load.

Schema reads are best-effort metadata observations, not an atomic DDL snapshot or complete source-schema approval. Additional columns, ordinary indexes, signedness, collations/defaults, partitions, triggers and checks are outside comparison scope. A missing table is not treated as an empty verified table. A missing selected column/key can reflect drift or restricted visibility and needs review. `TABLE_ROWS` is explicitly an **estimate**, including when it returns zero; never use it for financial reconciliation or exact daily counts.

## Report and exit codes

`source:preflight` emits allowlisted JSON to stdout without persisting a report. Exit **0** means `complete_for_local_metadata`; **2** means partial metadata/mismatch; **1** means configuration/transport/connection failure with a fixed redacted message. Credential/config/server-log files are never printed. The public MariaDB version excludes server suffixes; GTIDs are reduced to `present`/`empty`. Replica hosts, users, channel names, raw errors and log positions are omitted. Replica lag `null` remains unknown; zero lag alone is not replication health or recovery evidence.

Every report states `local_synthetic`, `full_source_ddl_verified=false`, `cdc_readiness_approved=false` and `account_identity_verified=false`, including a successful one. This package accepts only the generated local database/user/loopback profile and rejects extra connection overrides. There is no real-source connection adapter in this batch. The reserved root `.env.example` source DSN is not used by this tool.

```sh
pnpm test:preflight
pnpm verify
pnpm verify:fresh
```

Tests initialize a separate temporary native MariaDB with their own CA, credentials and ephemeral port, verify TLS/permissions/schema drift/redaction/timeouts/outage recovery, stop it and remove verified scratch state. Fresh-source verification reuses only the absolute native binary location; no source/local DB state or credential is copied. GitHub CI prepares MariaDB 11.8 using a checksum-pinned official repository helper and signed APT packages on its disposable runner, preventing service auto-start during installation. The workflow's MySQL removal is confined to that ephemeral runner; it is never executed on the developer host. Hosted Linux execution remains NOT_RUN until an actual authorized GitHub run.

## Remaining real-source gates

DBA-approved configuration/access scope, actual version/topology, TLS trust/identity, grant review, binlog/GTID/retention/space, primary/replica workload budgets, schema review and CDC connector compatibility remain UNVERIFIED. No source-side configuration change, snapshot, Kafka/Debezium deployment, PostgreSQL sync, account linkage, model or notification is delivered. See [handoff](../../docs/implementation-status/db-sync-readiness.md) and the sibling [source runbook](../../../plan/07-mariadb-replica-bootstrap.md).

Server license: GPL-2.0-only in Homebrew formula metadata; Node connector `mariadb` **3.5.4**: LGPL-2.1-or-later in installed npm metadata. No paid API/license key is needed for this local setup. Hardware, hosting, operations/support and a full transitive license/SBOM review are separate considerations.

Primary references: [Node connector options](https://mariadb.com/docs/connectors/mariadb-connector-nodejs/node-js-connection-options), [replica-status permissions/fields](https://mariadb.com/docs/server/reference/sql-statements/administrative-sql-statements/show/show-replica-status), [install-db](https://mariadb.com/docs/server/clients-and-utilities/deployment-tools/mariadb-install-db), [repository setup and published helper checksums](https://mariadb.com/docs/server/server-management/install-and-upgrade-mariadb/mariadb-package-repository-setup-and-usage), [Homebrew formula](https://formulae.brew.sh/formula/mariadb@11.8).

## Item11 local snapshot fixture

`pnpm source:seed` prepares a separate column-limited TLS reader and seven invented rows in the four selected local tables. It refuses changed/populated fixtures and preserves matching rows/credentials. `pnpm source:snapshot` captures at most100 rows/table into a private local spool; `pnpm source:import <capture_id>` sends that frozen capture into the existing PG intake. See [operations, retry semantics and source-load limits](../../apps/risk-workers/README.md). Metadata preflight stays metadata-only; source capture is a separate CLI, not a real replica connection or CDC connector.
