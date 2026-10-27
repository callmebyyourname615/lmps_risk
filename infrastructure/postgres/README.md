# Local PostgreSQL foundation — item 8

No.38.1 runtime update: the separately approved project upgrade applies0000–0014,27 platform tables plus the migration ledger. Existing passwords and seven original platform-table fingerprints were preserved; before/after demo backups restored in isolated clusters. [Current acceptance](../../docs/implementation-status/current.md) and [local core commands](../../docs/operations/local-core.md) supersede historical runtime counts below. Synthetic demo inputs remain separate from actual-source/identity/production acceptance.

Item10 update: the running project database now has two **synthetic-only** intake tables (`platform.source_records`, `platform.source_events`) and three reviewed migration entries. lmps_app can read them in pgAdmin; lmps_intake can append approved columns only. For an existing cluster run `pnpm db:start`, `pnpm db:prepare-intake`, then `pnpm db:migrate`; fresh init prepares the role automatically. [Contract/permissions/operations](../../docs/data-dictionary/local-source-intake.md). The server remains running for the user's pgAdmin request; historical item8 stopped-state statements below describe that earlier batch.

This is an isolated local/test database. No MariaDB connection, source capture, account/payment table, risk model, vendor or push integration is configured. Use the existing supported PostgreSQL **18** binaries as a non-root user; `postgres`, `initdb` and `pg_ctl` must report the same version. Discovery uses `pg_config --bindir`; set `LMPS_PG_BIN` to an absolute binary directory when multiple installations exist. The tracked major pin is [major-version](major-version).

The session tested the already installed Homebrew **18.3**, without upgrading or restarting any shared installation/service. Upstream lists **18.6** as the current minor on 2026-10-18; update/retest the development binary set before promoting it to a deployment baseline. The major pin is not an exact server patch/artifact lock or a production security approval. See [PostgreSQL version policy](https://www.postgresql.org/support/versioning/).

## Bootstrap and run

From `financial-crime-platform/`, after `pnpm install --frozen-lockfile`:

```sh
pnpm db:init
pnpm db:start
pnpm db:migration-status
pnpm db:migrate
pnpm db:migration-status
pnpm db:status
```

`db:init` initializes a new `.local/postgres` cluster at **127.0.0.1:18503**, creates roles/database and stops it. Repeating init for a recognized ready cluster reports no changes; it never initializes over an existing directory. An incomplete/unowned directory fails rather than being erased or repaired by guessing. `db:start` starts only this cluster. The checked-in [configuration](postgresql.conf) is copied to its private generated config on each stopped-to-running start. Edit the tracked file, then stop/start to apply changes; this tool owns the generated config.

Database: `lmps_risk_local`. `lmps_bootstrap` is an isolated bootstrap/admin role, `lmps_migrator` owns this database/migrations, and `lmps_app` gets CONNECT and platform-schema USAGE only. App cannot create schemas/tables/roles/temp objects, become the migrator or read its ledger. Future business-table access requires reviewed explicit grants. Neither app nor migrator has SUPERUSER/CREATEDB/CREATEROLE/REPLICATION/BYPASSRLS. Public database privileges and public-schema access are revoked in this cluster; administrative databases reject app connections.

Authentication uses SCRAM with generated random per-role passwords; Unix sockets are disabled and TCP listens on IPv4 loopback only. `.local/postgres` and data are private directories; state/config/env/log files are restricted. Credentials live in ignored `state.json` and `app.env`, never printed by the commands; the temporary init password file is removed. A live port conflict/startup error fails without falling back to another server. The manager checks the authenticated server's data directory before controlling it. Commands do not load root `.env`; their exported environment must be local/test with test execution mode.

To run API diagnostics with the generated app credential file:

```sh
pnpm build
pnpm start:api:db
```

Node loads `.local/postgres/app.env` directly; do not paste its contents into chat or copy it into source. Existing exported environment variables take precedence over Node env files. `pnpm start:api` still supports diagnostics without a database. Stop the API with Ctrl+C, then:

```sh
pnpm db:stop
```

No destructive reset/drop command is supplied. Failed bootstrap retains private diagnostic state. Do not delete a directory until its ownership and stopped state are established. Successful verification leaves the persistent project cluster **stopped**; use `db:start` when needed. Tools do not control a default port-5432 cluster or change Homebrew packages.

## Migrations

[0000_foundation.sql](../../packages/database/migrations/0000_foundation.sql) creates only an empty `platform` schema and its USAGE grant. Drizzle creates the protected `lmps_migrations.__drizzle_migrations` ledger. The item8 migration creates no source/business tables; item10 adds the local-only source intake slice described above. Reviewed SQL plus the journal in `packages/database/migrations/meta` is the current authoring interface; drizzle-kit/schema generation is not needed for this foundation.

`db:migration-status` reads pending/applied state without creating metadata. Apply takes a dedicated-session advisory lock, validates the complete applied prefix against local SQL hashes/timestamps, then invokes Drizzle. Concurrent apply runs serialize; retries leave one journal entry. Editing/removing an applied migration or changing its timestamp fails. SQL effects and journal entries of pending migrations roll back together on failure; Drizzle's initial metadata-schema/table creation is outside that transaction. No automatic down migration or rollback of earlier applied versions is claimed.

New migrations must include SQL review, monotonically increasing journal entries, relevant rollback/constraint tests and publication-policy review. The scanner currently permits the three exact reviewed migration SQL paths plus the existing synthetic DDL fixture; source dumps and arbitrary migration-directory SQL remain prohibited. Do not bypass that guard with an inline allowlist or move a source dump into an approved filename.

## Connections, diagnostics and limits

[Database package](../../packages/database/README.md) validates explicit local DSNs: `postgresql`, host `127.0.0.1`, project DB, explicit port and expected role/password; query/hash overrides and other roles/hosts are rejected. Application pool max=4, migration max=1; connect/queue wait=1s, app statement=1s, migration statement=5s, lock=500ms, idle-in-transaction=5s. These are bounded local defaults, not measured SLA/production capacity. Normal application idle timeout is 5s. Native cluster max connections=30 is a development setting.

API `/health/ready` remains **503 bootstrap_only**. Its postgres component is `not_configured`, `available` (SELECT 1 passed) or `unavailable`; source sync/risk engine remain `not_implemented`. Database availability alone does not prove migrations, risk readiness or payment safety. `/health/live` remains independent. Shutdown drains API pool connections; no DSN/query result is put into HTTP error bodies or request logs.

Ordinary SQL errors can embed inputs in their primary messages even with SQL/parameter logging disabled. Local server config suppresses ordinary ERROR logging (`log_min_messages=fatal`), omits statement/parameter logs and keeps a private server log. This trades local diagnostics for reduced disclosure and is not a complete production logging/redaction/metrics solution. Pool idle errors are handled without process crashes or value logging; operational error metrics remain future work. Locally generated auth/canary tests verify the exercised paths, not all possible PostgreSQL messages.

## Verification

```sh
pnpm test:database
pnpm verify:offline
pnpm verify
```

Tests initialize separate disposable clusters on ephemeral ports, generate their own credentials, exercise real roles/DDL/transactions, stop servers and remove successfully verified scratch state. They do not use or alter `.local/postgres` data. Failed/unverifiable scratch ownership is preserved rather than deleting a possibly live cluster. Native PG18 binaries are required even for offline/fresh-source verification; missing/wrong-major binaries fail and do not silently skip integration tests.

GitHub workflow prepares PG18 binaries from the [official Ubuntu repository](https://www.postgresql.org/download/linux/ubuntu/) with signed APT metadata, disables default cluster auto-creation, and sets `LMPS_PG_BIN`; tests run as the normal runner user. Major is pinned while its APT minor patch is repository-managed. Hosted execution/Linux compatibility remains NOT_RUN here. No live DB credentials or artifacts are uploaded.

Backup/PITR/restore, HA, production TLS/networking/roles, PgBouncer, query/partition benchmarks, ORM domain models, business migrations and Source Mapping owner sign-off remain later gates. Five million payments/day remains an unmeasured design/benchmark target.

Item14: `pnpm db:prepare-outbox` prepares only the owned local lmps_outbox role/private outbox.env, preserving existing passwords and reloading the recognized HBA allowlist without a server restart. `pnpm db:migrate` adds two local fake-outbox tables via0003. App SELECT is available for pgAdmin; worker column grants cannot modify source evidence, payload/provider or migration history. See [outbox semantics](../../apps/risk-workers/README.md).

## Private local backup and isolated restore drill — item15

Current No.35.2 update: offline staging is covered by [the new contract](../../docs/data-dictionary/offline-dataset-import.md). Current bounds supersede historical32MiB/1000-per-table descriptions below:128MiB archives,1,000,000 total offline_dataset_rows and1000 rows for every other table. Fingerprints use bounded cursor pages under one snapshot. Schema including offline staging uses v2/local_workspace provenance; exact pre-offline v1/synthetic backups still restore their own migration prefixes. Raw staging SELECT is denied to app/API after restore. No persistent migration or real-data import is performed by implementation.

Run `pnpm db:backup`. It prints a backup UUID and table counts only. Then run `pnpm db:restore-drill <backup_id>` with that UUID. The restore tool always creates a new private disposable cluster on a free loopback port, restores there, checks data fingerprints/migration history/app privileges, stops it and removes it. It has no argument for restoring over the project database. The persistent PG and its pgAdmin credentials stay unchanged; workers are never started by restore.

Backups live under ignored `.local/backups/<backup_id>/`: custom-format database.dump and manifest.json,0600 files/0700 directories with owner/symlink/hardlink/size checks. Passwords are supplied only through a temporary0600 pgpass file removed after use, never command-line arguments or manifest fields. Child PG environment overrides are cleared; host/port/user/database and local transport are fixed. pg_dump/pg_restore must match the installed tested native version and backup version. No roles/global password dump or source credential state is copied; the target receives newly generated local credentials with the same role names so ownership/ACL restore can be checked.

The source administrator connection is first checked against its owned data_directory. A read-only REPEATABLE READ transaction exports a PostgreSQL snapshot and computes bounded ordered row fingerprints; pg_dump uses that same exported snapshot. This avoids comparing a dump to counts taken at another instant. Exporting the snapshot does not create a distributed/source-MariaDB checkpoint. The small source transaction allows20s idle time, each native tool is capped at10s, and source tables must match an exact reviewed synthetic schema inventory (see latest migration section below), at most1000 rows/table. Unexpected tables, excess rows, client-version mismatch, corrupt/insecure artifacts or a dump over32MiB fail closed. Native tools acquire read/metadata locks and use IO; this is not a production low-impact backup strategy.

A complete dump is flushed before manifest publication; its SHA-256 plus per-table count/SHA-256 fingerprints are checked before/after restoration. Only the final manifest.json commits a usable backup; abandoned partial directories have no valid manifest and may be reviewed/removed manually. These hashes detect damage relative to the local manifest; the owner can replace both, so use only trusted artifacts generated here. This is not a signature/WORM system or a safe untrusted-dump upload interface.

After restore, full row evidence is compared (not printed), the migration ledger is checked against current reviewed files and app SELECT/write denial is exercised. A native test changes the source after backup and proves the restored snapshot still matches the earlier state while the source stays running/current. Tests also cover corruption/permissions/symlinks, unknown/excess data and stopped source. The pg_dump artifact contains schema/data/ACLs; sequences may legitimately advance beyond rows included in its snapshot. No domain worker, fake delivery or live push is resumed automatically.

This local drill is one P10-06 foundation slice only. Production scheduled/encrypted/off-host backups, keys/retention, PITR/WAL archive, HA/fencing/failback and measured business RPO/RTO remain unimplemented. `verification_elapsed_ms` describes this disposable local check, not a production RTO. Real-data use also requires the outstanding PG patch review, source/privacy approval and production role/backup design.

Reference: [PostgreSQL pg_dump snapshot and archive behavior](https://www.postgresql.org/docs/18/app-pgdump.html), [pg_restore](https://www.postgresql.org/docs/18/app-pgrestore.html).


## Local audit migration and backup — item17

`pnpm db:migrate` now applies reviewed0004_local_audit after0000–0003. It adds `platform.audit_events` plus protected triggers; no roles/passwords are added or rotated. Outbox workers cannot directly write/change audit; the app remains SELECT-only. Existing outbox rows are preserved without historical backfill. `pnpm api:audit-smoke` writes a separate invented fake flow and leaves five correlated audit rows visible to the existing pgAdmin app login, then closes its temporary processes.

Backup/restore includes audit row fingerprints and verifies app SELECT plus DELETE denial on the restored audit table. Exact older pre-audit backups still restore their original schema/ledger prefix; they are not silently upgraded. Unknown inventories, more than1000 rows/table or oversized artifacts still fail closed. See [audit schema/permissions and browsing/owner limits](../../docs/architecture/adr/0002-local-outbox-audit.md). This is local-only evidence, not production immutable storage or DR approval.


## Local sync jobs — item18

Run pnpm db:migrate to apply0005_local_sync_jobs after0000–0004. It adds two job tables, preserves credentials/old evidence and extends protected audit to typed version2 job lifecycle events. No old capture is automatically backfilled. The normal source:import command now persists job attempts and reconciles using the existing private spool; source MariaDB can stay stopped during retry. Read status through the existing pgAdmin app login or the sync:read API.

Item18-schema backups include seven platform tables plus the migration ledger; exact older pre-job/pre-audit backups still restore their original inventory without auto-upgrade. Bounds/permissions are unchanged. [Job operations and limits](../../docs/architecture/adr/0003-local-sync-jobs.md). There is no production CDC/retention/DR sign-off from these local tables.


## Local transaction observation revisions — item27

Reviewed0006_local_transaction_revisions adds one append-only synthetic observation table with scoped sequential FK revisions and column-limited intake INSERT/app SELECT. Older migration files are unchanged. The project PG stays on six migrations during this implementation; pnpm db:migrate can apply the additive local migration when preparing that runtime. No project data/credentials are replaced or seeded by tests.

New-schema backups contain eight platform tables plus ledger; exact older four/five/six-migration inventories remain supported without auto-upgrade. Backup/restore includes full revision evidence and app write-denial checks. Existing row/archive bounds remain. See [ADR-0006](../../docs/architecture/adr/0006-local-transaction-revisions.md); this is not production canonical storage or DR approval.


## Evidence-gated synthetic publication — item28

Reviewed0007_local_normalization_publications adds nullable publication evidence and permits known local synthetic lifecycle states only within an attached proof profile. Repository/API recompute and validate the full proof. Existing unknown rows and role restrictions are preserved. Eight migration files are tested on disposable clusters; the project database remains unchanged until a separately approved `pnpm db:migrate` runtime-preparation batch.

There are no new tables; backup fingerprints include the evidence column. Exact4/5/6/7-migration backups restore their original schemas without auto-upgrade. Private snapshot/evidence/binding files are outside PostgreSQL backups. See [ADR-0007](../../docs/architecture/adr/0007-local-normalization-publication.md).

## No.30 synthetic rule/assessment migration

Reviewed0008 adds immutable local rule versions and frozen assessment runs. Implementation/tests do not migrate or seed the persistent project database. The current sandbox cannot verify native transaction/restore tests because loopback listeners are forbidden. Use the existing owned-cluster preparation/migration process only within an approved runtime batch before `rules:assess`. [ADR-0009](../../docs/architecture/adr/0009-local-rule-assessments.md) documents permissions and frozen replay. Backup/restore includes the two new tables while retaining old4/5/6/7/8-migration inventories; existing1000-rows/table and32-MiB dump bounds remain unchanged.

## No.31 transaction risk migration

Additive0009 creates synthetic policy and per-revision risk snapshot tables with an immutable policy fingerprint FK and target-history index. It introduces no account entity or real-source mapping. Implementation does not migrate/seed the project runtime. Current backup inventory now covers ten migrations and old4/5/6/7/8/9 prefixes, with original size/row bounds. Native SQL/restore acceptance is still pending. [ADR-0010](../../docs/architecture/adr/0010-bilingual-transaction-risk.md).

## No.32 — Additive0010 and isolated review role

Migration0010 adds alert policies, grouped immutable alerts and the protected review-event ledger/function. Fresh disposable bootstrap prepares a narrow unprivileged lmps_reviewer login. Existing project runtime requires separately approved `pnpm db:prepare-reviewer` before applying0010; no preparation/migration/seed is performed by implementation/tests. Private reviewer credentials stay in ignored reviewer.env. Current backup inventory includes11 migrations and preserves original4–10 prefixes; existing size/row bounds remain. [Runtime/API/audit details](../../docs/architecture/adr/0011-local-alert-review.md). Native SQL/restore and full-frozen acceptance remain pending.
