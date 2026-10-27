# Runtime and dependency compatibility matrix

Status: local baseline inventory — 2026-10-19. This records exact pins and pairings exercised in the current repository. It is not a vendor support matrix, production certification, cross-platform guarantee or approval to deploy. Source of truth is the root manifests, workspace manifests and lockfiles.

Target update — 2026-10-20: the user confirmed **Ubuntu x64 for Production**. The prepared CI target is ubuntu-24.04 x64. The Production Ubuntu release, deployment runtime/resources and patch/support owner remain TBD; hosted/Linux execution is still NOT_RUN. macOS arm64 remains the locally exercised development platform. Missing inputs are tracked in [the foundation summary](../../../plan/09-missing-inputs-and-foundation-readiness.md).

## Pinned local baseline

| Area | Exact current pin | Evidence and boundary |
| --- | --- | --- |
| Node.js | 24.22.0 (`.node-version`); supported range `>=24.19.0 <25` | Local macOS arm64 builds/tests passed. Other operating systems and runtime patch versions are not certified. |
| pnpm | 11.20.0 (`packageManager`) | Frozen workspace install and local verification passed. |
| TypeScript | 5.9.3 | Strict typecheck/build passed in the current Node workspace. |
| Python | 3.13.15 (`.python-version`); project range `>=3.13,<3.14` | Locked install and local test suite passed. Python 3.14 and other OS builds are outside the declared range/evidence. |
| PostgreSQL server | 18 major, native local cluster | Native migration, API and database tests passed on this local platform. This does not certify managed PostgreSQL, HA/PITR, another major or Linux. |
| MariaDB server | 11.8.9 synthetic fixture | Used only for the local invented fixture. This is not evidence about the LMPS read replica or its version/settings. |

## Exercised application pairings

| Role | Exact lock/manifest pins | What was exercised |
| --- | --- | --- |
| API | NestJS `12.1.3`, `@nestjs/platform-fastify` `12.1.3`, Fastify `5.12.5`, `@fastify/static` `10.1.2`, Swagger `12.0.2` | Local HTTP/API tests and strict builds; no hosted/Linux run. |
| PostgreSQL access | `pg` `8.23.1`, `drizzle-orm` `0.45.4`, `@types/pg` `8.23.1` | Local PostgreSQL 18 native integration/migration tests; no HA or production pool/load profile. |
| MariaDB access | `mariadb` `3.5.4` | Local MariaDB 11.8.9 synthetic read-only fixture and snapshot tests; not the actual replica, CDC or binlog path. |
| ML/API service | FastAPI `0.143.3`, Pydantic `2.14.1`, Uvicorn `0.54.0` | Local Python HTTP/config/subprocess and contract tests; no model inference is loaded. |
| DDL metadata tool | SQLGlot `30.23.0` | Offline parser and synthetic/schema-reference tests; coverage of live source metadata remains partial. |
| JSON contracts | Ajv `8.20.0`, ajv-formats `3.0.1`, json-schema-to-typescript `16.0.0` | Local validation, generation and drift tests for the current draft contracts. |

These rows show pairings that were built and exercised together on the recorded local platform. They do not establish compatibility with future releases, all optional features, production deployments or platform/vendor support guarantees. Re-pin only through a reviewed lockfile change and matching tests. Keep build and runtime dependencies in their declared package scope.

## Not selected or not compatibility-tested

| Area | Status | Required evidence before adoption |
| --- | --- | --- |
| Kafka broker, Kafka Connect, Debezium MariaDB connector | No versions selected or installed | Exact broker/Connect/connector matrix, source-version support, security/patch ownership, snapshot and restart tests, ACL, retention and replica-impact evidence. See [ADR-0004](adr/0004-event-backbone.md). |
| Kafka client, Avro serializer, Apicurio registry | No versions selected or installed | Producer/consumer/registry compatibility, schema evolution and compatibility-mode tests, license review and recovery procedure. |
| Flink / Kafka Streams / Valkey / Redis | Candidates only | Golden-stream correctness, runtime compatibility, freshness, recovery, failure and cost comparison. |
| ClickHouse / DuckDB / object storage | Not adopted | Representative historical workload, exact query/correction behavior, retention, backup/recovery and cost evidence. |
| Docker images, Kubernetes, cloud/managed services | No production deployment target or image digests | Approved platform, supported versions, pinned digests, deployment/rollback, security scanning and operations ownership. |
| React portal / mobile application | Separate sibling workspace; not part of this backend repository | Maintain its own runtime/lockfile matrix and API compatibility checks before integration. |

## Supply-chain and platform limits

No.24 corrects the [lock-bound CycloneDX inventory](../supply-chain/local-sbom.cdx.json) to 176 components and zero UNKNOWN licenses, with [reviewed exact-wheel evidence](../supply-chain/README.md). This closes missing metadata evidence, not legal approval, signed release/image inventory or production security approval. No dependency was introduced. Hosted CI/Linux, container images, cloud providers, commercial support and their patch policies remain unverified. Point-in-time dependency advisory results are recorded in Implementation Status.

Update this file when a lockfile, supported runtime range, native database major or deployment platform changes. Record the exact verification command, operating system/architecture and any skipped advisory or platform checks in implementation status. Do not infer product compatibility from an architecture diagram or from a neighboring version number.
