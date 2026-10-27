# Toolchain baseline — approved items1–16

Pins were selected on 2026-10-17. A pinned version is a reproducibility baseline, not a promise that future frameworks or production deployment have passed compatibility/security checks.

| Component | Pin | Role / verification boundary |
| --- | --- | --- |
| Node.js | 24.22.0 | LTS major; project runtime provisioned by pnpm, separate from the shell's bootstrap Node |
| pnpm | 11.20.0 | Node workspace manager and `pnpm-lock.yaml` |
| TypeScript | 5.9.3 | NestJS ESM/NodeNext/decorator build and HTTP behavior verified in item 2 |
| `@types/node` | 24.19.2 | Node 24 type definitions; no application dependency |
| Python | 3.13.15 | FastAPI diagnostic bootstrap verified in item 3; algorithm/model packages are not installed |
| uv | 0.12.5 | Python workspace/venv/`uv.lock`, enforced by `required-version` |

The Node workspace includes root compiler/type tooling and the API dependencies below. The Python workspace includes the local FastAPI diagnostic service described below. Kafka, registry, ML algorithms and infrastructure are adopted in their relevant tasks.

## API dependencies — item 2

| Dependency | Exact version | Installed license metadata / purpose |
| --- | --- | --- |
| `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-fastify` | 12.1.3 each | MIT; modular HTTP application and Fastify adapter |
| `@nestjs/swagger` | 12.0.2 | MIT; generated OpenAPI/Swagger UI |
| `@fastify/static` | 10.1.2 | MIT; serves bundled Swagger UI assets |
| `reflect-metadata` | 0.2.2 | Apache-2.0; decorator runtime metadata |
| `rxjs` | 7.8.2 | Apache-2.0; NestJS peer dependency |

Fastify 5.12.5 is resolved through the adapter and locked in `pnpm-lock.yaml`. Framework/API versions were selected from npm metadata and tested with Node 24.22.0/TypeScript 5.9.3. Full production or cross-platform compatibility is not asserted. Tests use Node's standard runner; DTO-validation libraries will be added when an approved input DTO needs them.

The seven direct API package versions/licenses were checked from installed manifests. `pnpm licenses list --json` currently fails on the managed `node@runtime:24.22.0` resolution type, so item22 uses the installed-manifest inventory in [local supply-chain inventory](../supply-chain/README.md) instead. It records raw metadata or `UNKNOWN`; it is not a legal approval or a cross-platform/release SBOM. The runtime pin is retained; no tool incompatibility is hidden by disabling integrity controls.

`ignoreScripts: true` disables dependency lifecycle scripts by default. If a later approved dependency needs a build, review and narrow that policy deliberately. It is not permission to bypass dependency integrity or TLS checks.

The private project is not licensed for publication. TypeScript reports Apache-2.0 and `@types/node` reports MIT in npm metadata. The lockfile also contains transitive `undici-types` and the managed Node runtime. Review transitive licenses and vulnerabilities from the actual lockfiles as dependencies evolve; no production supply-chain gate is marked complete here.

## ML service dependencies — item 3

| Dependency | Exact version | Installed license metadata / purpose |
| --- | --- | --- |
| FastAPI | 0.143.3 | MIT; health endpoints and generated OpenAPI |
| Pydantic | 2.14.1 | MIT; typed health responses |
| Uvicorn | 0.54.0 | BSD-3-Clause; ASGI listener |
| pytest (development) | 9.1.1 | MIT; HTTP/config/subprocess tests |
| HTTPX2 (development) | 2.13.1 | BSD-3-Clause; TestClient and loopback HTTP checks |

Runtime dependencies are exact requirements in `services/ml-inference/pyproject.toml`; transitive versions and artifact hashes are recorded in the root `uv.lock`. pytest and HTTPX2 belong only to the member's development group. Starlette 1.8.0 recommends HTTPX2 for TestClient; legacy HTTPX emits a deprecation warning, so this service uses the supported HTTPX2 path. No `fastapi[standard]`, `uvicorn[standard]`, model library or database driver is required for this bootstrap. `package = false` runs the local module from its service directory without adding a build backend or publishing a distribution.

Only local diagnostic behavior is verified; production, model compatibility and complete transitive license review remain pending. See [service usage and verification](../../services/ml-inference/README.md).

## Draft contract dependencies — item 4

| Dependency | Exact version | Installed license metadata / purpose |
| --- | --- | --- |
| Ajv | 8.20.0 | MIT; Node validation of generated JSON Schema 2020-12 |
| ajv-formats | 3.0.1 | MIT; full calendar/date-time format validation |
| json-schema-to-typescript (development) | 16.0.0 | MIT; generated TypeScript types from the same schemas |

The private `@lmps/contracts` workspace pins these requirements; `pnpm-lock.yaml` locks their transitive packages. Existing Pydantic produces the authoring models/schemas, so no Python dependency was added. Both runtimes consume the independently authored synthetic corpus; schema/type drift checks verify the generation chain. Version/validation behavior is verified locally, not as a deployed business integration. See [draft contract rules](../../packages/contracts/README.md).

## Offline DDL tool dependency — item 5

| Dependency | Exact version | Installed license metadata / purpose |
| --- | --- | --- |
| SQLGlot | 30.23.0 | MIT; local SQL tokenization/AST, using its MySQL dialect for the MariaDB dump |

The virtual Python workspace now includes `tools/schema-metadata`. The tool adds only SQLGlot; tests use standard-library unittest. CLI has no database/network operation and does not invoke SQLGlot's executor. Parser limitations, omitted values and logging redaction are explicit; the actual file yields partial coverage, not proof of DDL validity/live compatibility. See [tool scope and checks](../../tools/schema-metadata/README.md).

## Inputs still pending

- MariaDB replica/PostgreSQL connection settings and actual source/binlog compatibility.
- Actual account masking/full-value representation, stable identity and sender/receiver/bank namespace linkage. User deferred this verification; ingestion planning can proceed without claiming verified account analytics.
- Peak/burst, retention, SLO/RPO/RTO, hardware and measured capacity. Five million payments/day remains a growth target.
- Business API/ML integration, hosted CI execution, containers, infrastructure and release checks remain pending. Items 2–3 supply only local diagnostic endpoints; item 4 supplies offline draft contracts, not production readiness.

## References

- [Node.js release support](https://nodejs.org/en/about/previous-releases)
- [Python version support](https://devguide.python.org/versions/)
- [pnpm project runtime pinning](https://pnpm.io/package_json#devenginesruntime)
- [pnpm workspaces](https://pnpm.io/workspaces)
- [uv workspaces](https://docs.astral.sh/uv/concepts/projects/workspaces/)
- [NestJS Fastify](https://docs.nestjs.com/techniques/performance)
- [NestJS OpenAPI](https://docs.nestjs.com/openapi/introduction)
- [FastAPI testing](https://fastapi.tiangolo.com/tutorial/testing/)
- [Starlette TestClient](https://starlette.dev/testclient/)
- [Pydantic JSON Schema](https://docs.pydantic.dev/latest/concepts/json_schema/)
- [Ajv JSON Schema](https://ajv.js.org/json-schema.html)
- [JSON Schema to TypeScript](https://github.com/bcherny/json-schema-to-typescript)
- [SQLGlot AST/parser behavior](https://sqlglot.com/sqlglot.html)
- [MariaDB CREATE TABLE](https://mariadb.com/docs/server/reference/sql-statements/data-definition/create/create-table)

## Verification development dependencies — item 6

`detect-secrets==1.5.0` (Apache-2.0) and `PyYAML==6.0.3` (MIT) are pinned in the root security group and uv lock. The scanner runs locally with network key verification disabled; PyYAML parses workflow tests. These are development tools, not application services. Dependencies are installed with `uv sync --locked --all-packages --group security`. Item22 records installed transitive metadata in the local inventory; legal review, a release/image SBOM and production-platform evidence remain pending. See [verification scope](../../ci/README.md).

## Database foundation — item 8

| Component | Pin / observed | License / verified boundary |
| --- | --- | --- |
| pg | 8.23.1 | MIT; local SCRAM pool, transactions, lossless numeric/bigint strings |
| drizzle-orm | 0.45.4 | Apache-2.0; node-postgres SQL execution and reviewed-SQL migration runtime |
| @types/pg (development) | 8.23.1 | MIT; strict TypeScript pool/API boundary |
| Native PostgreSQL | Major 18 required; installed/tested 18.3 Homebrew | Existing host binaries, not modified/upgraded; this is not a current patch security approval |

Node 24.22.0/TS 5.9.3 compiled the pg/API integration without weakening strict/library type checks. Drizzle is used by JS migration scripts/tests; domain ORM TypeScript models and drizzle-kit are not delivered. The major pin is `infrastructure/postgres/major-version`; full native server artifact/minor pin and production matrix remain pending. Upstream version policy listed current minor 18.6 on 2026-10-18, which should be reviewed/retested before any deployment baseline. CI prepares PG18 from signed official APT; its minor is repository-managed and hosted execution remains unverified. No global/Homebrew service was changed.

[Database usage and test scope](../../infrastructure/postgres/README.md), [PostgreSQL version policy](https://www.postgresql.org/support/versioning/). The local metadata inventory exists; legal/license, image and production driver/platform compatibility gates remain pending.

## Local source preflight — item 9

`mariadb@3.5.4` (LGPL-2.1-or-later, Node >=20) is the only new application dependency. The installed manifest was checked and Node24/strict TypeScript/native TLS integration tested. MariaDB server 11.8.9 Homebrew bottle revision1 (GPL-2.0-only) is privately prepared for this macOS26 arm64 environment from a pinned checksum, without shared Homebrew install/link/post-install/service changes. Only core native server functionality is exercised; optional plugins are not adopted. Native 11.8 is required for tests; Linux CI uses an APT-managed patch and a checksum-pinned official repository helper. Hosted execution/real-source version and topology compatibility remain pending.

The package reads only local synthetic metadata; it is not a CDC library, normalizer or PostgreSQL writer. [Scope and operations](../../infrastructure/mariadb/README.md). Local transitive metadata is tracked, while legal/release/image review remains pending; local installation does not require a vendor subscription/API fee.

## Local SBOM/license inventory — item22

`pnpm sbom:write` creates [the tracked CycloneDX 1.6 local inventory](../supply-chain/local-sbom.cdx.json) from workspace manifests, installed Node package manifests and installed locked Python metadata. `pnpm sbom:check` regenerates it after frozen installation, and unified verification fails on drift. It preserves `UNKNOWN` for absent metadata and records both lockfile hashes; it never infers a license.

The evidence is deliberately scoped to the current macOS arm64 installation. It does not approve a license, replace legal review, include unselected Kafka/CDC/registry products, prove another platform, produce a signed release SBOM or inspect a container image.

## Local snapshot CLI — item11

`apps/risk-workers` reuses pinned mariadb3.5.4 and `@lmps/database` through workspace dependencies; no new library/runtime is added. Its strict TypeScript build and standard Node tests run recursively with existing CI commands. It is a one-shot local synthetic snapshot/import CLI, not a NestJS worker daemon or a replacement for the future CDC connector. No production connector/client/serializer compatibility ADR is closed by this spike.

Item13 adds jose6.2.12 (MIT metadata), pinned from npm and verified against its primary documentation, for local resource-server signature/claims validation. No transitive dependency is introduced by jose. Local fixture keys/token remain ephemeral; real OIDC integration is still pending.

Items12/14–16 reuse existing dependencies/native PG tools. Local source and operations scopes share the JWT guard with server-side required-scope metadata. Queue/backup tools remain local-only; no SDK/provider, distributed telemetry or scheduler dependency was added.

Fresh-source correction: API declares Fastify5.12.5 directly because its typed request/reply guard imports Fastify. It was already the adapter runtime, but undeclared transitive visibility on the old install was insufficient; the fresh install caught TS2307. Exact direct pin/lock now replaces that accidental dependency visibility.
