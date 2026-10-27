# Risk API — diagnostics with optional local DB (items 2/8)

NestJS + Fastify diagnostic API. Item 8 adds optional local PostgreSQL availability diagnostics. Optional local fixture JWT enables scoped synthetic source, operations and outbox-audit reads. There is no real account data, corporate login, scoring, payment decision or live notification workflow. It binds to **127.0.0.1** and accepts only local/test environment with test execution mode. `NODE_ENV=production` is rejected until a later approved production implementation exists.

## Run from the repository root

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm start:api
```

Default address: `http://127.0.0.1:18501`. Stop with Ctrl+C. Root `.env` is optional; copy `.env.example` only if you need local overrides. The API reads `LMPS_ENVIRONMENT`, `LMPS_EXECUTION_MODE`, and `LMPS_API_PORT` (1–65535). `LMPS_POSTGRES_DSN` is now optional and validated for the local app role only; MariaDB remains unused. Prefer `pnpm start:api:db` after local DB setup so credentials are loaded from the ignored generated file.

| Endpoint | Expected behavior |
| --- | --- |
| `GET /health/live` | 200: process responds; no assertion about risk/payment readiness |
| `GET /health/ready` | **503 intentionally**: `bootstrap_only`, postgres is not_configured/available/unavailable; source sync/risk engine not implemented |
| `GET /openapi.json` | Generated OpenAPI for health and any enabled local scoped read routes |
| `GET /docs` | Swagger UI with bundled local assets |

Health responses use `Cache-Control: no-store`. Request logging is disabled to avoid recording supplied URLs/bodies. Invalid config errors omit the supplied value. No business mutation route is exposed; production authorization and telemetry will be implemented with their own approved tasks.

## Verify

```sh
pnpm typecheck
pnpm test
pnpm audit --audit-level high
```

`pnpm test` builds the TypeScript API and runs 12 Node.js built-in tests against a real loopback listener on an ephemeral port, then closes it. Coverage includes liveness/readiness separation, response/OpenAPI agreement, bundled Swagger assets, absent business mutations, valid defaults and rejected environment/mode/port config. No additional test framework is installed.

CommonJS/ESM compatibility is checked through the compiled entrypoint: this package uses ESM/NodeNext with TypeScript decorator metadata enabled. Current framework pins are recorded in [toolchain](../../docs/architecture/toolchain.md). Four added tests use an isolated native PG18 cluster for availability/outage, config rejection and real entrypoint SIGTERM/DB-session shutdown. No hosted CI/load/business DB claim follows from these tests.

See [local PostgreSQL setup/roles/migrations](../../infrastructure/postgres/README.md). `available` means SELECT 1 succeeded, not that migration/business/source/model gates passed; readiness remains 503. Optional connection pools close with Nest application shutdown. Test fixtures use separate scratch clusters; no live LMPS source is queried.

## Optional authenticated synthetic source reads — item13

Set `LMPS_LOCAL_AUTH_CONFIG` to an absolute0600 regular single-link file owned by the current UID, plus the app-role `LMPS_POSTGRES_DSN`, before startup. Only local/test mode is supported. When this option is absent, the source route is not registered; diagnostics remain unchanged. Invalid config fails startup before DB creation. With it enabled, `GET /v1/local/source/captures/{capture_id}/events?after=0&limit=25` requires a Bearer access token, source:read scope and a signed synthetic workspace claim.

The config is deliberately a **local fixture trust profile**, not a chosen corporate IdP: format1/kind local_synthetic, issuer `https://lmps-local.invalid`, audience `lmps-local-source-read`, and a `jwks.keys` array of1–4 public EC/P-256/ES256 signing JWKs with unique bounded kids. Private/symmetric keys, unknown config fields, insecure permissions/symlinks/hardlinks, corrupt curves and real-issuer URLs are rejected. The application loads a fixed public key set at startup; update keys through an explicit app reload/restart. No token JKU/remote key URL is fetched. Corporate OIDC discovery, JWKS refresh, OAuth login/MFA/session/revocation and institution entitlement mapping remain unimplemented.

JWT verification uses pinned jose6.2.12, ES256 only and typ at+jwt. Signature, exact issuer/audience, required sub/iat/nbf/exp/jti, temporal validity/max age and a maximum300-second lifetime are enforced. Fixture subject/workspace IDs must have synthetic prefixes. Token length and claims are bounded. Missing/invalid access tokens return401 plus WWW-Authenticate; missing scope/invalid workspace return403. These synthetic signed workspace claims are not real institution authorization. Every source query includes the verified workspace and fixed synthetic_snapshot namespace; client workspace/mode overrides are rejected. The DB app role itself can read all synthetic workspaces locally; production DB row security/entitlements remain a gate.

Responses use string event IDs and decimal amounts, opaque record UUIDs and approved synthetic evidence fields. Raw source keys/accounts are excluded. Pagination is ascending event_id, maximum100+1 rows with bigint-text cursors; invalid/duplicate/unknown query parameters return400. Storage failures return a fixed503. A new server-generated X-Request-ID and Cache-Control:no-store apply even on auth/query failures; client request IDs are not trusted, request logging is disabled. This ID is local correlation support, not a distributed OpenTelemetry implementation.

Each HTTP statement sees its own current committed snapshot. Import may still be partial and concurrent event commits may change later pages; the endpoint is not a stable historical export or proof of completeness. Use reconciliation after import for bounded local capture verification. No risk decision/write endpoint is added and readiness remains503.

For an existing local capture, run `pnpm api:source-smoke <capture_id>` from the repo root. It generates an ephemeral fixture keypair (private key/token stay in memory), writes only its public config to a private temporary file, starts a loopback ephemeral server, checks401 vs200, reports counts only, then closes sessions/listener and removes the temp config. It does not leave a server or a reusable credential running. The CLI does not assert that an empty capture query proves a valid source capture.

Native HTTP tests cover denial/token attacks, workspace isolation, pagination/input validation, redacted errors/outage recovery, local key rotation/reload, OpenAPI and persistent503 readiness. Existing diagnostics still work without auth config. No production authentication, browser login or live-data security approval is implied.

Reference: [jose signature/claims verification and local JWKS](https://github.com/panva/jose).

## Local operations diagnostics — item16

When the local auth profile is enabled, `GET /v1/local/operations` requires **operations:read**, independently of source:read. The shared guard gets its required scope from server-side route metadata; clients cannot override it. JWT workspace always restricts outbox counts. A source-only token cannot read operations and an operations-only token cannot read source rows.

The response reports current API-process pg pool total/idle/waiting/limit and workspace fake-outbox state counts from one bounded query (at most1001 rows). Empty verified workspaces return zeros; DB failure returns status unavailable with null outbox, and over1000 intents returns limit_exceeded/null totals rather than silently truncated counts. All states are stored queue states, not real device receipt/user acknowledgement or instantaneous wall-clock TTL classification. The diagnostic response stays HTTP200 with an explicit component status; it never changes readiness503 or makes missing data zero. Unknown query parameters fail400, invalid/missing scopes401/403. No payload, subject identity, DSN or token is exposed.

This is authenticated local JSON diagnostics, not Prometheus/OpenTelemetry/distributed traces or production observability/SLO monitoring. The pool is process-global (not a tenant usage meter); outbox counts are workspace-scoped. The local fixture IdP/entitlements remain unverified for real institutions. The source smoke CLI now checks both separate scopes through its ephemeral fixture.

The API explicitly pins Fastify5.12.5, matching the adapter runtime, because its access guard imports Fastify request/reply types. Fresh frozen installs verify this direct declaration rather than rely on transitive/local leftover visibility.


## Local audit reads — item17

The same optional local auth profile now also registers `GET /v1/local/audit/events?after=0&limit=25&intent_ref=<optional UUID4>` with independent **audit:read**. Source/operations scopes do not grant audit access. Verified-token workspace is enforced in both filtered and unfiltered SQL; max100+1 results, bigint text cursor, no raw payload/key/token, fixed400/401/403/503 errors and no-store/generated request ID. No audit mutation endpoint exists. OpenAPI describes the enabled route.

These are live committed pages, explicitly `pagination=live_committed_view`; identity allocation is not commit order and concurrent writes can appear below an advanced cursor. This is not a reliable incremental feed or frozen export. Correlation ID is the stable intent UUID, not an HTTP/OTel trace. Actors are database session roles, not employees. No pre-migration backfill or failed-request audit is implied.

Run `pnpm api:audit-smoke` after `pnpm db:migrate` on the running owned local PG. Each run leaves one new invented intent/attempt and five audit rows in a unique synthetic workspace, verifies fake flow/dedup plus401/403/200, and closes temporary listeners/keys/pools. No provider call is made. [Full audit design and limits](../../docs/architecture/adr/0002-local-outbox-audit.md).


## Local sync job status — item18

With the same optional local auth profile, GET /v1/local/sync/jobs supports after/limit and optional capture_id; GET /v1/local/sync/jobs/{job_ref}/attempts supports after/limit. Both require independent sync:read and verified workspace. Pending jobs have last_attempt:null; expired active leases show effective_status:interrupted while preserving stored status. Import completion, reconciliation outcome and historical attempts stay distinct. Unknown/foreign jobs return empty scoped pages; DB outage returns fixed503, never empty success. Bigint job IDs remain strings and limits are100+1. Tokens, lease/fingerprint/source payload fields are excluded.

Audit version2 adds typed job evidence and optional job_ref filter with audit:read; it cannot be combined with intent_ref. Outbox version1 remains supported. All lists are live views, not complete feeds/exports, and readiness remains503. After a tracked import, pnpm api:sync-smoke <capture_id> checks persisted jobs/attempts plus401/403/200 with a temporary key/listener and no database mutations. [Sync job contract and actor/correlation limits](../../docs/architecture/adr/0003-local-sync-jobs.md).


## Synthetic transaction revision reads — item27

The optional local auth profile now registers GET /v1/local/transactions/{namespace}/{transaction_id}/revisions?after=0&limit=25 and the /revisions/latest selector, both with independent transactions:read. Verified token workspace plus exact namespace/opaque ID filter every query. Unknown/foreign identity returns empty200; unavailable or corrupt stored payload returns fixed503. History pages are ascending publication ordinals, max100; latest is ordinal order, not source lifecycle/time order. Query scope overrides and mutation methods are rejected. Replies retain no-store/server request IDs and explicit canonical_emission=false/source_semantics=unverified. Readiness stays503.

Payloads reuse the draft Transaction contract. Legacy test/unknown/unresolved observations remain supported; No.28 adds evidence-bound synthetic lifecycle states through the worker publisher. No HTTP write endpoint is registered. [ADR-0006: full contracts and boundaries](../../docs/architecture/adr/0006-local-transaction-revisions.md). The current project runtime needs additive0006 and0007 migrations before these reads; this batch tests them in disposable native/HTTP fixtures and does not migrate the project DB.


## Normalized synthetic reads — item28

History/latest items add `publication`: null for legacy observations, otherwise the validated first-publication source coordinates/fingerprints, raw currency mapping and normalization input. This synthetic-only evidence is returned under the same verified transactions:read workspace scope. Reads recompute the shared classifier and require an exact payload/proof match; corrupt proof, absent current schema or DB outage returns the existing fixed503. Cross-capture replay leaves the first observed time/proof unchanged; responses are not a complete capture ledger. Pagination/readiness/no-store behavior is unchanged. [ADR-0007](../../docs/architecture/adr/0007-local-normalization-publication.md).

The API test command builds the existing worker package as an explicit prerequisite for snapshot→publication→HTTP integration tests; it adds no runtime network dependency.

## Rule versions and stored assessments — item30

[ADR-0009](../../docs/architecture/adr/0009-local-rule-assessments.md) defines the local/synthetic MVP; native acceptance passed in the2026-10-22 backend-first follow-up recorded in current implementation status. With private local JWT configuration and a separately prepared database through0008:

| Read route | Required scope | Bounds |
| --- | --- | --- |
| `/v1/local/rules/:rule_id/versions` | `rules:read` | `after=<version>`, `limit` default25/max100; lexical version order |
| `/v1/local/assessments` | `assessments:read` | `after=<run_uuid>`, `limit` default5/max10; UUID order |
| `/v1/local/assessments/:run_id` | `assessments:read` | Frozen validated report/hash or null; no query parameters |

Collections return `next_cursor` and `live_committed_view`; order is not effective-date/time order. Reads use the verified workspace, no-store headers and fixed errors. No caller-supplied workspace override or mutation route is accepted. Details preserve unavailable/not-applicable outcomes, exact money, pinned revisions and reasons; they never re-evaluate current transaction data. Registration is not production policy approval. API readiness stays503.

## Bilingual transaction risk — item31

Independent `risk:read` scope is required for:

| Route | Output |
| --- | --- |
| `/v1/local/risk/catalog` |15 type definitions, prerequisites, limits, units, dimensions/statuses and code definitions |
| `/v1/local/risk-assessments/:run_id` | Frozen per-transaction scores/findings plus stable core hash; unknown/foreign run is null |
| `/v1/local/transactions/:namespace/:transaction_id/revisions/:revision_number/risk-assessments` | UUID-ordered history for one revision; `after`, default5/max10 and `next_cursor` |

Use `Accept-Language: lo` (default Lao) or `en`; `la` aliases Lao and unsupported languages fall back to English. Responses include no-store, Content-Language and Vary headers. Unauthorized/forbidden/query/storage errors are localized and redacted. Caller-supplied workspace and extra/duplicate parameters reject. Locale is presentation only; codes/scores/evidence/core hashes stay unchanged. Older read scopes do not authorize these routes. Swagger documents all three reads. No mutation/online scoring/payment endpoint is opened; readiness stays503.

See [risk definitions/score math](../../packages/risk/README.md) and [ADR-0010](../../docs/architecture/adr/0010-bilingual-transaction-risk.md). Existing No.30 routes retain their earlier response shape; this batch localizes the new risk domain, not the legacy Portal or all existing diagnostics.

## No.32 — Synthetic Alert Inbox

Authenticated `GET /v1/local/alerts`, `/catalog` and `/:alert_id` require alerts:read; `POST /v1/local/alerts/:alert_id/reviews` requires both alerts:read and alerts:review. Read APIs use existing app credentials. Optional `LMPS_LOCAL_REVIEW_DSN` must use the isolated reviewer role on the same app database instance with configured JWT auth; without it, review fails closed503. The API does not use intake/migration credentials for review. [Filters, request bodies, two-step state machine, localized codes and audit limitations](../../docs/architecture/adr/0011-local-alert-review.md). No public alert-generation mutation, new Portal or notification/payment action is enabled.


## No.34 — Synthetic risk job status

Independent `risk-jobs:read` and verified JWT workspace are required for GET `/v1/local/risk-jobs` (UUID after, limit default5/max10), `/:job_ref` (job metadata or null) and `/:job_ref/attempts` (after0–8, limit default5/max10). Unknown/foreign identifiers return null/empty scoped results. All mutations and query workspace overrides are rejected. Job read permission does not authorize the linked Risk/Alert evidence routes.

Replies expose explicit revision coordinates, status/effective_status/stage, attempt count, result/error codes, retry time and assessment/Alert references. They exclude frozen manifests/observations/context/hashes and lease tokens. Expired running leases show effective_status=interrupted; a GET does not reclaim work. Lists are live UUID views, not stable exports/incremental feeds. Lo/en/la language selection, no-store, Content-Language/Vary, server request IDs and fixed redacted errors apply; outages return503. [Full contract](../../docs/architecture/adr/0012-synthetic-risk-job-flow.md). This supplies backend reads for the separately built Web App; no PWA installability/offline/push feature is enabled by this batch.

## No.36.1 — Local Risk Policy APIs

`/v1/local/risk-policies` exposes bounded versions/bindings, scoped draft/submit/approve/reject/activate/rollback commands, protected policy events and a read-only comparison of1–20 frozen synthetic runs. Read scope is `policies:read`; writes/approval/activation have separate scopes, and comparison also requires `risk:read`. Optional isolated `LMPS_LOCAL_POLICY_DSN` uses the same local DB and existing local JWT profile; without it write commands return503. Creator/submitter self-approval is denied. [Exact bodies, credentials, statuses and boundaries](../../docs/architecture/adr/0013-local-risk-policy-lifecycle.md). Persistent role preparation/migration is a separate operational action.

## No.37.1 — Local Cases

`/v1/local/cases` adds bounded metadata, independently scoped evidence/history reads and version-checked case creation, Alert linking, assignment, notes, per-dimension opinions, close/reopen. Actors come from local JWT subjects; case work requires the assigned reviewer. Optional `LMPS_LOCAL_CASE_DSN` is an isolated same-instance writer; without it mutations return503. [Exact routes/bodies/scopes and synthetic-only boundaries](../../docs/architecture/adr/0014-local-cases.md). Production users/label policy and UI integration remain pending.

## No.38.1 local core runtime

Root `pnpm start:api:core` verifies the owned prepared database and opens existing scoped APIs on loopback with a fresh synthetic JWT profile. `pnpm core:demo` drives approved Policy→Risk job→Alert→Case through existing services and authenticated TCP APIs with replayable invented inputs. Neither command migrates/prepares roles automatically. [Preparation, token roles/expiry, retry, cleanup and tests](../../docs/operations/local-core.md). Corporate authentication and production readiness remain pending.
