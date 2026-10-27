# ADR-0009 — Local synthetic rule versions and assessment storage

Status: IMPLEMENTED local synthetic MVP; native PostgreSQL/restore acceptance PASSED in the backend-first follow-up. Date: 2026-10-22. Owner: TBD.

## Scope

No.30 connects No.29's existing evaluator to append-only PostgreSQL storage and scoped reads. It remains a local/synthetic P05/S11 prototype. Rule registration is not approval, activation, an effective-date policy or a payment decision. Account identity, source semantics, historical availability and production governance remain unverified.

The shared evaluator now lives in `packages/database/src/rule-backtest.ts`; the original worker module re-exports its existing interface. This keeps readonly backtests, persisted assessments and stored-result validation on the same exact-cents rule calculation without adding a package, dependency or service. The original `rules:backtest` command remains readonly.

## Write path

Migration `0008_local_rule_assessments` adds only:

- `platform.local_rule_versions`: primary key `(workspace_key,rule_id,rule_version)`, normalized rule definition and SHA-256.
- `platform.local_assessment_runs`: primary key `(workspace_key,run_id)`, frozen bounded backtest report and SHA-256.

Both tables admit only `synthetic_local`. The existing intake role has column-limited INSERT and SELECT; app has SELECT only. Neither can UPDATE/DELETE/TRUNCATE or spoof recording metadata. The privileged database owner remains outside this immutability boundary; this is not tamper-proof external audit storage.

`createRuleAssessments(intakeDsn).evaluate(manifest)` validates local/test mode and the existing 20-rule/100-explicit-revision manifest before connecting. A single transaction:

1. Takes a transaction advisory lock for the workspace/run, then checks an existing assessment.
2. Returns the original validated report for an identical normalized manifest. Changed manifests under that run ID conflict.
3. For a new run, reads all explicit revision targets in one SQL statement and uses the shared proof-validating evaluator.
4. Registers normalized rule versions in stable rule-ID order. Same version/content deduplicates; changed content conflicts. A new definition needs a new version and run ID.
5. Inserts the assessment and commits. Failure rolls back newly registered rules and the assessment together. A lost commit acknowledgement can be retried with the same manifest.

Existing-run replay intentionally returns frozen evidence without consulting current transactions. A partial run stays partial even if missing inputs later arrive. Use a new run UUID to assess new availability. This differs from the readonly file backtest, which evaluates its input set again and refuses to overwrite a changed report.

Reports preserve explicit revision targets, exact amounts, separate fraud/AML outcomes, reasons, unavailable/not-applicable markers, first-publication lineage, evaluator/normalizer/codebook versions and rule/input/manifest hashes. They are validated at write/read boundaries, including outcomes, counts, source shapes, rule/evidence consistency and canonical fingerprints. Corrupt input values do not enter stored reasons/evidence. No transaction FK is imposed on missing targets; their missing status is part of the frozen evidence.

The report embeds its rule definitions. Rule registration and report insertion share a transaction; this MVP has no separate rule-reference join table or per-rule assessment rows. Add those when approved investigation queries require them. Stored snapshots/hashes do not prove real-source semantics or reconstruct past availability.

## Worker command

After separately preparing an owned local database through migration0008, reuse the private manifest documented in [ADR-0008](0008-offline-synthetic-rule-baseline.md):

```sh
pnpm rules:assess <run_id>
```

Input: `.local/rule-backtests/v1/<run_id>/input.json`. The command uses the existing intake credential profile, private bounded file reader and local-mode guard. Stdout includes only provenance/mode, run ID, inserted/duplicate status, complete/partial status and counts. Exit0 means complete assessment, exit2 partial assessment, exit1 rejected input/storage. Reasons and amounts are read through the authenticated API; no extra private report file is dual-written. Assessment runs and rule versions are included in PostgreSQL backups. Input manifests remain outside those backups.

## Read APIs

All routes require the existing verified local JWT/workspace, return `Cache-Control: no-store`, reject unknown/duplicate query parameters and have no write methods.

| Route | Scope | Pagination/output |
| --- | --- | --- |
| `GET /v1/local/rules/:rule_id/versions` | `rules:read` | Version/definition/hash; lexical C-collation version order; `after` version, default25/max100 |
| `GET /v1/local/assessments` | `assessments:read` | Run/status/count/hash summaries; UUID order, not chronological; `after` UUID, default5/max10 |
| `GET /v1/local/assessments/:run_id` | `assessments:read` | Frozen validated report/hash; unknown/foreign IDs return both fields null |

Collections expose `pagination=live_committed_view` and `next_cursor`. Caller headers/query parameters cannot override workspace. Missing/foreign rules and runs have empty collection results. Invalid queries return400, authentication401, missing scope403, storage/corrupt evidence503 with fixed redacted codes. Swagger describes the read routes. Readiness remains503.

Assessment lists validate at most11 bounded reports before returning at most10 small summaries. This MVP intentionally has no transaction/rule/outcome search, chronological index, online scheduling, rule write HTTP API, draft/reviewer/activation workflow, score conversion, alerts, cases, graph, mobile push or enforcement.

## Verification and runtime boundary

Pure report/driver tests and in-process Nest/Fastify/JWT tests exercise validation, frozen replay, conflicts, rollback/error paths, independent scopes, pagination, exact evidence, redaction and OpenAPI. Driver/in-process storage stubs do not prove SQL constraints or concurrency.

Native suites are included for actual transactional races/rollback/ACLs, private worker → PostgreSQL → scoped HTTP and current/legacy backup restoration. Earlier runs were blocked by loopback `EPERM`. The2026-10-22 backend-first follow-up passed50 combined native tests and fresh-source offline670 tests after the environment permitted listeners/registry access. Exact current results belong in [implementation status](../../implementation-status/current.md).

The new inventory supports backups with all nine migrations and the previous 4/5/6/7/8-migration prefixes, without upgrading a restored backup. Restore checks cover app read/write denial for both new tables. Tests never migrate/seed the persistent project database; no project migration, real-source connection, deployment, commit or push is part of No.30.

Next MVP work needs a separately approved scope. Approval/activation, online feature windows, alerts/grouping and production/security/source/capacity gates remain pending. P05/S11 remain PARTIAL.
