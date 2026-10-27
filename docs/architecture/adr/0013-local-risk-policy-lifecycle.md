# ADR-0013 — Local Risk Policy Lifecycle and Comparison

Status: implemented in No.36.1, local/synthetic scope. Acceptance results are recorded in [current status](../../implementation-status/current.md). This is not production policy approval or a verified identity system.

## Purpose and scope

Manage the existing15-detector `RiskPolicy` without executable expressions or a second scoring algorithm. Policy content is immutable from creation. Changes, including changes to a draft, require a new `synthetic_*` version. Existing standalone risk/Alert commands remain explicit synthetic tools; they do not acquire governance approval automatically. Alert-policy governance is separate and is not added here.

The recommended operator sequence is create candidate → compare against baseline on explicitly selected frozen runs → submit → independent approval → explicit activation → enqueue approved jobs. This MVP exposes comparison as a read-only operation; it does not require a stored comparison attestation for approval. Production mandatory evaluation, approval authority and acceptance thresholds remain pending.

## State and identity

`draft` revision0 → `submitted` revision1 → `approved` or `rejected` revision2. Approved/rejected versions are terminal. Both approval and rejection deny the creator and submitter. The authenticated synthetic JWT subject supplies actor identity; a client cannot supply an actor in the body. Separate `policies:write`, `policies:approve` and `policies:activate` scopes control mutations, each also requiring `policies:read`.

Each command includes a v4 `request_id` and a1–1000-character reason. A request UUID is unique within the workspace across all policy actions. The same actor and normalized body return the original result with `status=duplicate`, even after later state changes; changed actor/body conflicts. State changes use `expected_revision`. Every successful mutation and its audit event commit in one database transaction; audit failure rolls back the state change.

JWT identities and role issuance are local test fixtures. Distinct subjects are not evidence of distinct real employees or production segregation of duties. The trusted API writer can assert subjects to the database function. Database owner/superuser can change records; external immutable retention and production identity controls remain pending.

## Activation and rollback

Bindings are explicit `(workspace, namespace, currency)` selections. There is no global/default policy and no scheduled effective-date activation. `expected_generation=0` creates the first binding; each activation/rollback increments its generation. An approved policy's currency must match the binding. Selecting the already-active version with a new request conflicts. Rollback requires a previously activated version in the same binding and uses a new command/event, never deletion of history. Active versions remain approved rather than acquiring a second lifecycle state.

Database transactions use bounded advisory locks for request idempotency and binding changes; row locks serialize version transitions. Approved enqueue shares the same binding advisory lock, so it cannot read half of an activation. A stale generation conflicts rather than silently selecting another policy. Activation does not cancel, re-score or rewrite existing jobs/assessments.

## Database and credentials

Additive migration `0013_local_risk_policy_lifecycle.sql` creates:

- `local_risk_policy_versions`: immutable normalized content/hash, governance state/revision and creator/submitter/approver.
- `local_risk_policy_bindings`: active version/hash and generation per namespace/currency.
- `local_risk_policy_events`: append-only action, actor, original normalized command, immutable command result and DB time.
- `local_risk_job_policy_bindings`: first canonical job's selected version/hash/generation and enqueue command fingerprint.

The new isolated `lmps_policy` credential can read governance projections and execute only `command_local_risk_policy`. It cannot directly insert/update/delete governance tables or mutate source, jobs, assessments, Alerts or reviewer records. The SECURITY DEFINER function owns lifecycle writes and audit insertion. App is read-only. Intake can read policies and insert job-selection receipts but cannot alter governance state/events. Reviewer/outbox get no governance access. These local roles are trusted service roles; this is not database-enforced per-human tenancy.

New disposable clusters prepare the role automatically. An existing project cluster needs separately authorized `pnpm db:prepare-policy` and migration before use. `LMPS_LOCAL_POLICY_DSN` is optional, requires configured local JWT/app reads and must point to `lmps_policy` on the same local database instance. Credentials stay in ignored `.local/postgres/policy.env`; never copy them into source or logs. Implementation/tests do not prepare or migrate the persistent project database.

## HTTP contract

Routes exist only with configured local authentication. All use authenticated workspace, no-store, server request IDs, Lao/English error presentation and redacted errors. Unsupported/duplicate query fields reject. Foreign details/bindings return null; foreign lists are empty; foreign comparison inputs are404. Only `synthetic_local` writes are accepted.

| Method/path under `/v1/local/risk-policies` | Scope in addition to `policies:read` | Body / result |
| --- | --- | --- |
| GET `/` | — | `limit` default5/max10; opaque `after`; live lexical `(policy_id,version)` pages |
| GET `/:policy_id/versions/:policy_version` | — | Full normalized policy/hash and governance projection, or null |
| GET `/binding/:namespace/:currency` | — | Explicit binding/hash/generation, or null |
| GET `/events` | `audit:read` | Bounded UUID pages; actor/action/reason/result/time; not an incremental feed |
| POST `/drafts` | `policies:write` | `{action:"create",request_id,policy,note}` |
| POST `/submissions` | `policies:write` | `{action:"submit",request_id,policy_id,policy_version,expected_revision,note}` |
| POST `/approvals`, `/rejections` | `policies:approve` | Same shape, action `approve` / `reject` |
| POST `/activations`, `/rollbacks` | `policies:activate` | `{action,request_id,policy_id,policy_version,namespace,currency,expected_generation,note}` |
| POST `/comparisons` | `risk:read` | `{baseline:{policy_id,policy_version},candidate:{policy_id,policy_version},run_ids:[UUID...]}` |

POST success is201, including read-only comparison and duplicate commands. Invalid input400; authentication401; missing scope/self-approval403; missing mutation/comparison target404; state/version/generation/idempotency conflict409; unavailable/unconfigured write storage503. Malformed/oversized JSON is localized400 without body/SQL diagnostics. Write endpoints with no policy credential return503, not simulated success. No credentials, private feature inputs or raw source payloads are returned by comparison.

## Comparison semantics

Select1–20 distinct stored assessment run IDs. Baseline and candidate must use the same policy ID and currency. All versions and frozen inputs are read within one REPEATABLE READ, READ ONLY transaction. Frozen snapshot hashes and target/run/workspace bindings are checked. Missing/corrupt evidence fails; it never yields an empty-success comparison.

The current shared evaluator re-evaluates each frozen request/context/observation under each policy. Reports pin current engine/catalog, both normalized policy hashes, original frozen-input fingerprints and a deterministic report hash. Input runs sort by UUID, so presentation locale and caller run order do not change the core hash. Reports show each dimension's score/status/coverage, all15 findings/metrics, changed finding codes and counts of runs with signals. Weight-only changes can change scores with no changed finding code. Unavailable/null stays null, not zero. These are simulated index/signal comparisons, not measured precision/recall, calibrated probabilities, projected production Alert counts or training labels.

Comparison writes no assessment, Alert, job, outbox or audit row. Its inputs are stored synthetic risk evidence, not raw offline dataset staging; No.35 replay remains separate. Results are returned bounded in the response and not persisted/automatically approved.

## Approved job path

The existing private CLI adds:

```sh
pnpm risk:jobs enqueue-approved <job_ref>
```

The private `.local/risk-job-inputs/v1/<job_ref>/input.json` envelope must contain exactly `job` and `selection`. `job` is the existing strict local RiskJobInput with `risk_request.policy=null`; `selection` is `{policy_id,policy_version,namespace,currency,expected_generation}`. Namespace matches the exact transaction target. The alert policy and synthetic context remain explicit and are not selected by this registry.

The worker resolves the approved active version, copies its complete normalized payload into the existing frozen job manifest and records the selection receipt atomically with enqueue. Existing semantic job dedup, observation freezing, fenced leases, checkpoints and retry caps are reused. Exact retries of the original job command revalidate the frozen job and return its original receipt even after activation changes. Changed command under the same job ID conflicts. UUID aliases deduplicate to the first canonical job/receipt while the requested binding is current; keep the returned canonical job ID for status/run/retry. A newly submitted alias with a stale binding generation conflicts. Legacy jobs cannot be retrospectively labelled approved merely because their policy matches.

The legacy `enqueue`, `risk:assess` and other explicit tools remain outside this opt-in registry. They can still encounter the existing immutable risk-policy version conflict; governance does not override the old registry or stored evidence. No HTTP job mutation, automatic publisher hook, scheduler, real notification or payment action is introduced.

## Verification and remaining gates

Tests use disposable native PostgreSQL and invented fixtures. They cover lifecycle/permissions/self-approval/idempotency, concurrent approvals and activation CAS, atomic audit rollback, read-only deterministic comparison, corruption/outage/scoping/localization, approved worker execution/frozen-policy replay/private-file boundaries and current/legacy backup restore. [Current status](../../implementation-status/current.md) records commands and actual results.

Backups add the four governance tables while retaining original migration-prefix4–13 inventories. Restore fingerprints data and verifies app mutation/function-execution denial; it never upgrades historical schemas or starts workers. No dependency, production connection/identity/policy, scheduled activation, UI/browser work, capacity claim or deployment is part of No.36.1.
