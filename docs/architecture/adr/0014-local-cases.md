# ADR-0014 — Local Case Management Backend

Status: No.37.1 implemented in local/synthetic scope. Actual acceptance is recorded in [current status](../../implementation-status/current.md). No production case authority, verified account identity or training label is inferred.

## Purpose and boundaries

Connect the existing immutable Alert/risk evidence to an analyst investigation: create a case, link additional Alerts, assign a reviewer, record notes and separate Fraud/Mule/AML opinions, close and reopen. Reuse the existing NestJS, JWT/workspace guards, strict contracts, PostgreSQL and backup tools. No UI, dependency, file attachment, case export, automated notification or payment action is added.

A case originates from one actual stored synthetic Alert; opening/linking does not acknowledge/review that Alert. One Alert belongs to one case for its entire local history, and a case contains at most20 Alerts. Links cannot be moved/unlinked in this MVP; reopen the existing case for further work. Case/Alert state machines remain independent. This is not account/entity resolution, transaction settlement accounting or case creation from non-alert sampling.

## Workflow and concurrency

New cases start `open`, version1, review_cycle1, with one linked Alert and no assignee/outcome. Every successful action appends exactly one event and increments the case version. Commands contain client v4 `request_id`, integer `expected_version` and a1–2000-character note; create uses expected_version0. Case IDs are client v4 UUIDs in the route, so a lost create response can be retried exactly.

- `create`: immutable title1–120 characters plus initial Alert. Case creator is the verified JWT subject.
- `link_alert`: add a validated Alert while open/in_review; increments evidence_version and invalidates the effective outcome.
- `assign`: set a valid synthetic subject, with separate assignment scope. Changing assignee invalidates the effective outcome. Assigning the same subject again with a new request conflicts.
- `start`: assigned reviewer changes open→in_review. Notes may be appended to open/in_review cases by their assigned reviewer.
- `record_outcome`: assigned reviewer in in_review records all three dimensions, each with suspicious/legitimate/unknown and an individual1–1000-character rationale. A new record supersedes the effective outcome while preserving history.
- `close`: assigned reviewer in in_review must have an effective outcome matching the current reviewer, review cycle and evidence version.
- `reopen`: separate reopen scope changes closed→open, increments the review cycle and clears the effective outcome. Existing assignment and all historical outcomes/notes/links remain.

Closed cases accept only reopen. New evidence, changed assignee and reopen require fresh outcome evidence before another close. Title editing, unassignment and attachments are deferred. At1000 events, further mutations return CASE_LIMIT_REACHED; an exact recorded retry still returns its original result. This is an explicit prototype bound, not a production retention/capacity policy.

Request UUIDs are unique across case actions in a workspace. Same case/actor/normalized body returns `duplicate` plus the original saved result, even if current state advanced. Changed case/actor/body conflicts. Current detail must be read separately for fresh state. Advisory locks serialize request identity, case changes and Alert ownership; version checks reject lost updates. A competing create/link from the same Alert commits once and rolls back the losing case/link/event. State, links, outcome and audit event commit atomically. Audit failure cannot leave an unaudited case mutation.

## Outcomes and label boundary

Outcomes are analyst opinions, not confirmed crime findings or model scores. Review status is `analyst_reviewed`; maturity is always `unverified`; `training_eligible` is always false, including suspicious and legitimate opinions. Unknown stays distinct. Closing/reopening never changes an opinion into legitimate, and no outcome is automatically copied from the Alert's review.

The outcome API returns historical versions and `effective_current` for the requested read snapshot. Reopened, superseded, reassigned and evidence-invalidated opinions remain visible as history. Label adjudication, maturity rules, sampling/selection-bias records, QA and any training export require a later approved contract. This slice only partially advances P06/S14.

## Evidence integrity

Links freeze bounded references/hashes to the stored Alert snapshot, risk assessment/result, exact namespace/transaction/revision, RiskPolicy and AlertPolicy. Registry approval is not inferred from an embedded policy reference; legacy Alert generation can remain outside No.36 governance.

On link the repository recomputes the existing Alert/risk proofs. Evidence reads verify the saved reference/hash against those immutable proofs. Outcome recording and close revalidate all linked evidence before mutation. Corruption/unavailable storage returns503 rather than empty/safe evidence. No raw transaction/source/context payload, credential or verified account entity is returned by a case evidence projection.

Case metadata/current opinion is one committed query. Each paginated history/evidence response uses a repeatable-read read-only transaction, keeping effective-outcome flags and linked references consistent within that request. Pages across requests remain live views, not stable exports. Metadata/history is bounded default5/max10 rows; events/outcomes/evidence use integer version cursors; case lists use UUID order, not chronological order. Reaching a page boundary does not imply the whole workspace was assessed.

## Storage and privileges

Reviewed additive `0014_local_cases.sql` adds:

- `local_cases`: immutable creator/title plus current state/version/assignee/review-cycle/evidence-version/outcome pointer.
- `local_case_alerts`: unique Alert ownership and immutable frozen evidence references/hashes.
- `local_case_events`: append-only original command, actor, DB timestamp and original result, including notes.
- `local_case_outcomes`: append-only dimension opinions/rationales, review/evidence coordinates and hard false training eligibility.

Deferred FKs tie each current version, link and outcome to its audit event at commit. The dedicated `lmps_case` credential can read the minimal existing Alert/risk proof tables and execute only `command_local_case`; it has no direct insert/update/delete privileges on case tables. App is read-only. Intake/reviewer/outbox/policy credentials have no case write/function permission. The trusted API writer asserts the verified JWT subject to the function; this is local service-role authorization, not database-enforced per-human tenancy. Database owner/superuser can modify records; external immutable retention remains pending.

New disposable clusters prepare the isolated role. Existing project clusters require separately authorized `pnpm db:prepare-case` plus migration before use. Optional `LMPS_LOCAL_CASE_DSN` must be the `lmps_case` credential on the same local database instance as app reads, with configured local JWT authentication. Generated credentials stay in ignored `.local/postgres/case.env`; implementation/tests do not prepare/migrate/seed the persistent project DB.

Assignee subjects are syntactically bounded synthetic identifiers. No corporate user directory/membership or production assignment authority is claimed. Production role provisioning, institution/case restrictions, case/outcome SOP and retention remain unverified.

## API

All paths below start `/v1/local/cases`. Routes are registered only with configured local authentication; every action uses the authenticated workspace/subject. Only synthetic_local writes are accepted. No-store, server request ID, Content-Language/Vary and redacted Lao/English errors follow existing API conventions. Original titles, notes, rationale text, machine codes and evidence hashes are never translated.

| Method/path | Required scopes | Contract |
| --- | --- | --- |
| GET `/` | cases:read | UUID `after`, limit5/max10, optional state/assignee filters |
| GET `/:case_id` | cases:read | Current metadata/opinion or case:null for unknown/foreign IDs |
| GET `/:case_id/events` | cases:read + audit:read | Version `after`0–1000, limit5/max10; notes/actor/result without original command's protected Alert parameters |
| GET `/:case_id/outcomes` | cases:read | Versioned opinions and effective_current flag |
| GET `/:case_id/evidence` | cases:read + alerts:read + risk:read | Verified frozen references/hashes |
| POST `/:case_id/create` | cases:read + cases:write + alerts:read + risk:read | action=create, expected_version0, title, alert_id |
| POST `/:case_id/alerts` | cases:read + cases:write + alerts:read + risk:read | action=link_alert, alert_id |
| POST `/:case_id/assignment` | cases:read + cases:assign | action=assign, assignee_subject |
| POST `/:case_id/start` | cases:read + cases:work | action=start; assigned reviewer only |
| POST `/:case_id/notes` | cases:read + cases:work | action=add_note; assigned reviewer only |
| POST `/:case_id/outcomes` | cases:read + cases:work | action=record_outcome, dimensions; assigned reviewer only |
| POST `/:case_id/close` | cases:read + cases:work | action=close; assigned reviewer/current outcomes required |
| POST `/:case_id/reopen` | cases:read + cases:reopen | action=reopen; required reason in note |

Every POST also requires request_id, expected_version and note. Commands have a16KiB UTF-8 limit after JSON parsing/normalization; the bounded18KiB JSONB allowance accommodates canonical formatting without rejecting valid multibyte text. Bodies reject unknown fields, forged actors, unsupported actions, null/omitted dimensions, invalid IDs, non-integer versions and control/invalid Unicode text. Unsupported/duplicate query fields and workspace overrides reject. No scope implicitly grants another. Permission to read case notes/opinions is distinct from source-evidence scopes.

Example outcome command (all identifiers/text are invented):

```json
{
  "action": "record_outcome",
  "request_id": "00000000-0000-4000-8000-000000000001",
  "expected_version": 3,
  "note": "Synthetic review remains inconclusive.",
  "dimensions": {
    "fraud": { "outcome": "unknown", "rationale": "Additional evidence required." },
    "mule_network": { "outcome": "unknown", "rationale": "No verified source account identity." },
    "aml": { "outcome": "unknown", "rationale": "Synthetic patterns are not confirmed intent." }
  }
}
```

Success POST201, including duplicate retry. Invalid input400; authentication401; missing scope/not-assignee403; missing case/Alert mutation target404; version/idempotency/link/state/outcome/limit conflict409; unconfigured writer or unavailable/corrupt storage503. Foreign detail/history returns null/empty and foreign lists empty. Unconfigured writer never simulates success. Malformed/oversized bodies return localized400 without echoing body/parser/SQL details.

## Verification and backup

Actual checks are in [current status](../../implementation-status/current.md). Native tests cover full review/reopen history, unknown/training-false semantics, assignee/scoped access, concurrent case creation/CAS, request replay/conflict, evidence corruption, atomic audit failure, SQL role denials, evidence/history bounds and current/legacy backups. API tests exercise the real disposable database through Nest/Fastify injection; no browser automation is used.

Current backups add all four case tables and check restored app mutation/function-execution denial. Original migration-prefix4–14 backups retain their original inventory/ledger without schema upgrade or invented case history. Restore does not start workers or overwrite the project database. No production capacity, real source/identity, corporate IdP, label maturity, attachment storage, UI/P06 completion or deployment acceptance is claimed.
