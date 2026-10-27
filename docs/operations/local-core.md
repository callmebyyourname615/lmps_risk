# No.38.1 — Local core runtime and demo

Explicit local/synthetic commands connect the existing approved-policy, Risk job, Alert and Case services on the owned PostgreSQL instance. This is not real-source ingestion, corporate login, an online payment decision service or a deployed worker. Readiness remains503. [Actual acceptance and backup IDs](../implementation-status/current.md).

## Prepare an existing database

Database preparation/migration requires an approved operational scope. No.38.1 authorizes the project upgrade. On another owned local instance, use this order:

```sh
pnpm db:backup
pnpm db:restore-drill <backup_id>
pnpm db:prepare-reviewer
pnpm db:prepare-policy
pnpm db:prepare-case
pnpm db:migrate
pnpm db:migration-status
```

Replace backup_id with the printed UUID and verify restore before migrating. Existing intake/outbox roles must already be prepared for the six-migration baseline. A new db:init prepares roles but does not apply business migrations. Preparation preserves existing passwords and only adds recognized loopback HBA rules/reloads PostgreSQL. Migrations validate the applied SQL/hash prefix and use the existing advisory lock. The0000–0014 inventory contains27 platform tables plus one migration ledger; offline staging remains unreadable to app/API credentials. No reset/drop/down migration is provided.

## Run the demo

```sh
pnpm core:demo
```

After building dependencies and checking database ownership/schema, this starts a temporary loopback API with a fresh synthetic JWT profile. It appends an invented transaction revision, creates/submits a Policy as synthetic_core_author, approves/activates it as independent synthetic_core_checker, enqueues the approved policy and runs the existing worker. The Alert opens a Case assigned to synthetic_core_analyst, which is started, annotated, reviewed in three dimensions and closed. Policy/Case actions use the real authenticated TCP API; append/enqueue/worker use the existing intake repositories. No new HTTP intake/job-write route is added.

The publisher contract requires namespace synthetic_snapshot. Demo transaction is synthetic_core_payment, policy synthetic_core_demo, job38000000-0000-4000-8000-000000000001 and case38000000-0000-4000-8000-000000000002. Publication/account-context fixtures are invented, not verified accounts or an actual source capture. Demo activation sets the local synthetic_snapshot/SYN binding; an existing conflicting binding/input fails through normal conflict rules without overwrite.

Inputs/command IDs are fixed. Rerun after restart returns duplicate results without adding a revision/job/Alert/Case/audit record. Failure retains committed steps for exact retry; it never deletes conflicts, resets failed jobs or overwrites manual changes. Existing job recovery applies when needed. Changed/reopened/reassigned demo cases require investigation rather than automatic reset. Concurrent invocations can encounter normal claim contention; retry after the owning invocation finishes.

Final checks require closed Case version6, six audit events, matching frozen approved-policy hash/Alert and unknown outcomes with training_eligible=false. Reader write denial is checked. Case creation does not acknowledge/review the Alert. No outbox, real notification or payment action is emitted. Stdout contains synthetic references/status only; fixed errors withhold credentials/diagnostics. Temporary listener/auth files are removed on completion/error.

## Open the interactive API

```sh
pnpm start:api:core
```

Swagger: http://127.0.0.1:18501/docs; OpenAPI: /openapi.json. LMPS_API_PORT may select another free loopback port1024–65535. Startup verifies ownership/schema; it never prepares roles, migrates or runs the demo automatically. Ctrl+C/SIGINT/SIGTERM closes pools/listener and removes its owned temporary auth directory. Forced termination may leave private files for manual cleanup; issued tokens still expire normally.

The printed private /tmp/lmps-core-auth-… directory contains0600 JSON files with an authorization header and expiry metadata. Tokens/passwords are not printed or passed as arguments. The signing key stays in memory; auth.json contains public verification keys only. Tokens expire after300 seconds; restart this explicit launcher for fresh credentials. There is no issuer/renewal endpoint, auth bypass or browser storage.

| File | Subject | Permissions |
| --- | --- | --- |
| reader.json | synthetic_core_reader | Existing read APIs, evidence and audit |
| author.json | synthetic_core_author | Policy create/submit; Case create/link/assign/reopen |
| checker.json | synthetic_core_checker | Independent Policy approve/activate |
| analyst.json | synthetic_core_analyst | Assigned Case work and Alert review |

Read the demo Case without putting its token in shell arguments/history; replace the private path printed by the launcher:

```sh
pnpm exec node --input-type=module <<'JS'
import { readFile } from 'node:fs/promises';
const auth = JSON.parse(await readFile('/tmp/lmps-core-auth-REPLACE/reader.json', 'utf8'));
const response = await fetch('http://127.0.0.1:18501/v1/local/cases/38000000-0000-4000-8000-000000000002', {
  headers: { authorization: auth.authorization }, signal: AbortSignal.timeout(5000)
});
console.log(response.status, await response.json());
JS
```

Local roles are not corporate entitlements; no verified institution/account identity is implied. Existing start:api/start:api:db behavior is unchanged. No Web Portal or Playwright work is part of this batch.

## Verification

Seven native checks cover old-schema startup denial, six→fifteen migration upgrade with old rows/credentials preserved, actual outcome-audit failure and restart/resume, full-table fingerprint equality after retry, TCP/auth/OpenAPI/private token lifecycle, current backup/restore and live-mode/port rejection. Tests use disposable clusters. The authorized project drill separately compares original seven platform-table fingerprints before/after migration/demo, complete28-table retry fingerprints and isolated restoration. Final fresh acceptance is in current status. No production capacity or2GB source-data support is claimed.
