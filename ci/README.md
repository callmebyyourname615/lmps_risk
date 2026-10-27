# Verification and CI

No.41.1 adds four bulk-plan contract checks, five native worker checks (including actual SIGKILL/resume and OS fencing), and `pnpm test:bulk-files` with six standard-library streaming/dedup/format/privacy tests. All ordinary CI data is invented and uses disposable clusters; no persistent project state or real export is copied. The explicit `pnpm test:bulk:scale --output /absolute/private/new-directory` acceptance separately runs100k→1m backup/restore with invented data and retains private metrics; it is not included in the ordinary test total. The user deferred the flash-drive2GB trial. [Bulk workflow/bounds](../docs/operations/bulk-import.md).

No.40.1 adds seven contract and eight worker/private-CLI tests to the existing Node suites and `pnpm test:source-semantics` (five Python evidence checks) to root `pnpm test`. All use invented bundles; no real mapping, source credentials or database state is needed. Tests distinguish owner-declared coverage from independently verified semantics and operational readiness, including unknown/reversal/time/money/privacy/immutable-version cases. [Source semantics runbook](../docs/operations/source-semantics.md).

No.39.1 adds `pnpm test:dataset-pilot` (eight standard-library adapter tests) to root `pnpm test`, plus four native PostgreSQL pipeline tests discovered by the existing worker suite. Synthetic private gzip bundles exercise lossless projection/lineage, limits/permissions/tamper rejection, backup-before-write, import/reconcile/replay, canonical aliases, retry and blocked pattern readiness. Fresh verification copies no real export or `.local/` state; it uses disposable clusters only. The operator-supplied real271-row local acceptance is separate from CI. See [pilot runbook](../docs/operations/real-pilot.md).

The manual source-export utility adds `pnpm test:source-export` after the existing dataset-profile suite in root `pnpm test`, so full/fresh runners include its standard-library synthetic subprocess/gzip/copy/cleanup checks. No real source credentials, exported dataset, SSH connection or flash drive is used. Python3.12 compatibility is checked separately; the pinned workspace runs Python3.13. See [operator workflow](../docs/operations/source-export.md).

No.35.2 adds reviewed migration0012_offline_datasets.sql, native staging/worker/CLI/private-file tests and a pre-offline v1 backup case to the existing runners. Native acceptance includes actual SIGKILL/checkpoint recovery and the100,000-record import/reconciliation/restore boundary. Only disposable clusters and invented exports are used; no original file/PG state is copied by fresh verification. Current v2 backup bounds/provenance and older restore compatibility are in the [offline dataset contract](../docs/data-dictionary/offline-dataset-import.md).

No.35.1: root `pnpm test` now runs the existing recursive Node suites followed by `pnpm test:dataset-profile`, a Python-standard-library unittest suite for offline CSV export readiness. Both full/offline and fresh-source verification therefore include temporary synthetic file/CLI tests, including the100,000-row cap, without a new environment/package or persistent data. Full results remain in implementation status; no real export is needed/copied.

Run from the repository root. Native MariaDB 11.8 is also required: see [local source setup](../infrastructure/mariadb/README.md), prepare once with `pnpm source:prepare` on the supported Mac or set absolute `LMPS_MARIADB_BASE`. Native PostgreSQL 18 binaries (postgres/initdb/pg_ctl) are now required, using `pg_config --bindir` or `LMPS_PG_BIN`. See [local PG setup](../infrastructure/postgres/README.md). Bootstrap once with the pinned pnpm/uv versions:

```sh
pnpm install --frozen-lockfile
uv sync --locked --all-packages --group security
pnpm verify
```

`pnpm verify` fails on a failed check: Git-visible publication/secret scan, runtime pins, frozen Node install, Python lock consistency, local SBOM/license-inventory drift, verification tests, TypeScript checks/builds, Node tests, Python ML/contract/source-design tests, mapping-to-DDL consistency, generated-contract drift, DDL tests and a synthetic DDL CLI run. It checks that both locks and generated contracts stay unchanged. No original source SQL, existing database, vendor or push credentials are required. Node tests initialize/stop their own native local clusters with temporary generated credentials. Missing PG18/MariaDB11.8 binaries fail verification, including offline mode. API/DB test listeners use loopback and close afterward.

Online advisories run last: pnpm fails at high/critical severity (all counts are printed), uv fails on reported vulnerabilities. The uv audit interface is experimental. Network/audit errors fail verification; an unavailable advisory service is not a clean result. On networks using an approved native certificate chain, set `UV_SYSTEM_CERTS=1`; never disable TLS verification.

```sh
pnpm verify:offline
pnpm verify:fresh
pnpm security:scan
```

Offline verification explicitly skips online advisories. Fresh verification copies only Git-visible source into a temporary Git repository, installs from frozen/locked local caches, runs the entire offline suite, checks the original source hashes and removes the temporary workspace. Populate caches with the bootstrap commands first. Fresh verification passes only the absolute native MariaDB binary location to its temporary copy; no ignored database/credential files are copied. A clean macOS run does not prove Linux deployment compatibility.

The secret scan includes tracked and untracked non-ignored files, including force-added ignored files. It rejects symlinks and known private files/data exports. `detect-secrets` runs with key verification disabled (`--no-verify`); inline allowlist comments cannot suppress findings. Findings show filename, line and detector only. Narrow exceptions cover pnpm SRI SHA-512 package/SHA-256 runtime integrity lines and the DDL report's source SHA-256 fingerprint plus the two exact MariaDB artifact/helper manifest SHA-256 fields and the exact public password-encryption algorithm setting in the tracked PG config; other content in those files is still scanned. There is no blanket baseline acceptance. This is a current-source heuristic scan, not a history scan or complete DLP classification; review new datasets and publication scope separately. Ignored local credentials remain outside the selected publication set.

GitHub `origin` is configured as `https://github.com/callmebyyourname615/lmps_risk.git`. [GitHub Actions](../.github/workflows/verify.yml) uses pinned action commits, read-only repository permission, disabled persisted checkout credentials, pinned toolchains and the same `pnpm verify` entrypoint. The workflow now prepares PG18 binaries from the signed official repository for disposable-cluster tests; it disables default cluster creation. The disposable hosted runner also replaces its bundled MySQL with MariaDB11.8 binaries using a checksum-pinned official helper/signed APT and suppresses service auto-start; developer MySQL is never altered. No upload, deploy or live application/DB secret is configured. YAML/security checks run locally; hosted execution remains NOT_RUN until an authorized commit/push and actual GitHub run. No commit or push is part of item 6.

`pnpm sbom:write` creates the tracked local CycloneDX inventory and `pnpm sbom:check` verifies it after a frozen install. It reports license metadata as supplied or `UNKNOWN`; legal approval, signed release SBOMs, container/image inventory and production platform evidence remain future gates. See [supply-chain inventory](../docs/supply-chain/README.md).

Local workflow tests do not replace GitHub's validation/execution. Container/image scans, signed release SBOM/full license approval, business integrations, browser/mobile/load/DR checks remain future gates.

Foundation update 2026-10-20: the user confirmed Ubuntu x64 as the Production target; the Production Ubuntu release/runtime remains unspecified. The existing ubuntu-24.04 workflow action SHAs were checked against their upstream repositories, and local YAML/security/shell syntax checks are recorded in Implementation Status. These checks do not count as a hosted run. The configured origin is currently public with no initial commit; confirm publication scope before initial commit/push. Named owners, SLOs, platform details and publication inputs are listed in [plan/09](../../plan/09-missing-inputs-and-foundation-readiness.md).

The corrected SBOM enumerates Node package roots rather than nested benchmark/test-fixture manifests, skips UNKNOWN metadata placeholders before classifier fallback, and uses reviewed exact-locked-wheel evidence for the two Python packages unavailable on this host. Its current 176 components have zero UNKNOWN license values; legal release approval remains separate. No scan bypass, dependency or workflow permission was added. See [license evidence](../docs/supply-chain/README.md).

References: [detect-secrets](https://github.com/Yelp/detect-secrets), [GitHub workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax), [uv CI integration](https://docs.astral.sh/uv/guides/integration/github/), [uv audit](https://docs.astral.sh/uv/reference/cli/#uv-audit).

Items8/10 permit only the exact reviewed `0000_foundation.sql`, `0001_local_source_intake.sql` and `0002_intake_column_grants.sql` paths under packages/database/migrations in the publication guard. Other SQL exports/dumps remain blocked; additional migrations need explicit review/guard updates. Local DB files, generated credentials, cluster logs and data stay ignored and are not copied by fresh-source verification. The PG major is pinned, while the native/CI minor patch is environment-managed and must be recorded/reviewed for deployment.

Item10 adds source-intake native tests to the existing database runner; no separate framework/dependency is required. Fresh native cluster bootstrap prepares the local intake role before applying the reviewed intake migrations (item14 adds the fourth outbox migration). Tests cover SQL constraints, concurrent duplicates/conflicts, failure rollback, reader/writer/generated-column grants and restart/replay. They use only synthetic data and their own disposable clusters, independent of the project DB currently open in pgAdmin.

Item11 adds `apps/risk-workers` to recursive Node typecheck/build/test discovery. Its snapshot suite initializes both native databases in a private disposable directory, seeds only synthetic rows, and removes stopped clusters afterward. No persistent source config or spool is required/copied. Worker tests exercise real two-database intake/replay/conflict/outage behavior plus driver/deadline boundaries; hosted CI execution remains pending.

Item14 explicitly adds only `packages/database/migrations/0003_local_outbox.sql` to the reviewed SQL publication paths, with a guard test. Fresh native bootstrap creates the local outbox role before grants; migration lifecycle tests now exercise all4 entries and a fifth failing test migration. Native outbox tests cover atomicity/fencing/permissions. Other SQL/dumps remain blocked.

Items12–16: recursive runners include local reconciliation, HTTP JWT/workspace/operations and native outbox/backup tests. Native PG18 pg_dump/pg_restore must match the test server version; restore targets are always new disposable clusters with fresh credentials, never an existing project DB. The fresh-source run copies no backup/key/token/private state. Current counts and actual full/fresh/audit results belong in implementation-status/current.md; these local checks do not establish hosted Linux/production readiness.


Item17 adds only reviewed `packages/database/migrations/0004_local_audit.sql` to SQL publication paths, with the existing allowlist guard. Migration tests cover five entries and a sixth failing synthetic migration. Native audit tests exercise protected triggers/privileges/role identity, rollback/outage atomicity and additive upgrade without backfill; backup tests cover current audit and legacy schema restore. HTTP tests cover separate audit:read/workspace restrictions, full-precision cursors and fixed errors. No new dependency is required; full/fresh results are recorded in implementation status.


Item18 adds only reviewed0005_local_sync_jobs.sql to publication paths. Migration tests cover six entries and a seventh failing migration; backup tests preserve both older inventory generations. Existing source-intake tests run against its extracted shared transaction helper. New native worker tests include real child SIGKILL after commit, atomic event/checkpoint rollback and post-write lease fencing, concurrent ownership, frozen-file conflict and reconciliation failure. New HTTP tests exercise sync:read, scoped jobs/attempts and version2 audit. Full/fresh results remain in implementation status; no new dependency is installed.


Item19 adds eleven worker profile/publication tests using the existing built-in runner and temporary private files. Exact decimal arithmetic,400-row maximum widths, literal code/time semantics, zero DB connections, immutable replay and symlink/hardlink/FIFO/size/partial/concurrent-file boundaries are exercised. No dependency or SQL publication path changes. Full/fresh results are recorded in implementation status.

No.25.3 adds12 offline snapshot-normalization tests: synthetic evidence/source fingerprint binding, unknown/invalid withholding, reversal proof/replay, zero source/network calls and private file/publication boundaries. The private JSON reader/publisher is now shared with the profiler; its original11 tests remain unchanged as regression coverage. No SQL/publication exemption, dependency or lockfile changed. source:normalize outputs counts/status only and writes ignored private artifacts. Fresh verification copies no sidecars or reports; focused/actual CLI/full-fresh results are recorded in Implementation Status.


No.28 adds shared publication validation, bounded worker preflight, native proof/replay/race checks, snapshot-to-scoped-HTTP and partial-commit recovery tests, and an actual pre-publication seven-migration restore case. Only reviewed0007_local_normalization_publications.sql is added to SQL publication paths. The API test runner explicitly builds the worker package before cross-package integration. Contracts are an existing worker workspace dependency; the lock-bound SBOM is refreshed without external artifact/version changes. Full/fresh results remain in current implementation status.


No.29 adds16 pure/native worker backtest tests with no new dependency or migration. They exercise exact money/rule validation, scoped explicit revision reads, pure/reference parity, unknown/corrupt input withholding, immutable report replay/private files and database outage/recovery. The existing full/fresh runners discover them automatically. Local-only result/version/Markdown checks are recorded in current implementation status.

No.30 adds only reviewed `packages/database/migrations/0008_local_rule_assessments.sql` to publication paths and keeps external dependency artifacts unchanged. Pure/driver and listener-free HTTP tests are separated from native transaction/worker/restore tests. The initial native runs were blocked by loopback restrictions; the2026-10-22 backend-first follow-up subsequently passed the combined50-test suite and fresh-source offline670 tests. Full verification must not be marked passed from the focused subset; see current implementation status and [ADR-0009](../docs/architecture/adr/0009-local-rule-assessments.md).

No.31 adds one workspace (`@lmps/risk`), discoverable by existing recursive runners; no external artifact/version is added. Only reviewed0009_local_transaction_risks.sql joins the SQL publication allowlist. The updated SBOM has177 components/0 UNKNOWN, including the new workspace; Node/Python external versions stay pinned. The new strict synthetic request schema is a separate TypeScript/Ajv contract, leaving existing generated cross-runtime business contracts unchanged. Native SQL/worker/restore tests remain distinct from pure/driver/HTTP-injection tests. A frozen reinstall could not finish supply-chain verification without network; cached files were restored with digest checks without disabling policy checks. Actual passed checks and blocked gates are in current implementation status.

## Closing No.30/31 native acceptance

Use a host that permits localhost listeners and has the pinned Node/pnpm/Python toolchain, PostgreSQL18 binaries and the prepared MariaDB11.8 runtime. Frozen installation also needs the registry metadata/attestation access required by pnpm supply-chain policy, even when package artifacts are cached and `--offline` is selected. Offline mode skips advisory audits; it does not authorize disabling install policy checks. A DNS failure or `listen EPERM 127.0.0.1` leaves acceptance pending.

No.34 extends this command with job validation, native recovery/fencing and actual worker/HTTP coverage. After the bootstrap commands above succeed, run the combined75-check backend suite (native plus pure validation/projection checks) from the repository root:

```sh
pnpm build
pnpm exec node --test \
  packages/database/test/rule-assessments.test.mjs \
  packages/database/test/transaction-risks-native.test.mjs \
  apps/risk-api/test/assessments-native.test.mjs \
  apps/risk-api/test/transaction-risk-native.test.mjs \
  packages/database/test/backup.test.mjs \
  packages/database/test/alerts-native.test.mjs \
  apps/risk-api/test/alerts-native.test.mjs \
  packages/database/test/database.test.mjs \
  packages/database/test/risk-jobs.test.mjs \
  packages/database/test/risk-jobs-native.test.mjs \
  apps/risk-api/test/risk-jobs.test.mjs
```

Continue only after the build and all75 checks pass with no skips/setup failures:

```sh
pnpm verify:fresh
```

The native suite creates only disposable synthetic PostgreSQL clusters. It covers atomic rule/policy/result writes, concurrent retries/conflicts, frozen replay, role/column privileges, rollback/recovery, worker-to-PG-to-scoped-HTTP behavior including Lao/English, current backup restoration and migration-prefix4–11 compatibility. It never migrates or seeds the persistent project database; no `db:migrate`, source connection or real credentials are needed. Fresh verification additionally exercises the full offline suite in a temporary source copy. Record each command's exit status, test totals, toolchain/native versions and remaining gates in [current status](../docs/implementation-status/current.md); do not replace native evidence with driver mocks or mark a failed fresh run complete. Online advisories, hosted/Linux acceptance and production readiness remain separate.

No.32 adds no dependency or lockfile change. Only reviewed0010_local_alerts.sql joins the SQL publication allowlist. Alert contracts/pure projection, generation/review driver tests, private worker tests and listener-free scoped HTTP tests run separately from native evidence. Native tests exercise reviewer-role preparation, actual concurrent transitions and direct-write denial; backup tests retain the ten-migration predecessor and restore current review history. Parser-error localization is scoped to alert routes. Current status records actual counts and blocked gates; no full/fresh or SQL acceptance is inferred from focused passes.


No.34 adds only reviewed0011_local_risk_jobs.sql to the SQL publication allowlist; no external dependency/version/lock changes are required. Existing assessment/Alert transactions are shared with the fenced worker without changing standalone command interfaces. New checks cover13 native job scenarios (including actual child SIGKILL),7 real private-enqueue/worker/PG/HTTP scenarios,4 pure validation/projection cases and1 legacy restore case. Final fresh-source offline695 tests passed; existing historical No.30–32 blocked results above are not the current status. CLI idle does not imply a completed job; see [ADR-0012](../docs/architecture/adr/0012-synthetic-risk-job-flow.md). Actual source, deployed scheduler, Web App/PWA, hosted/Linux and production gates remain separate.
