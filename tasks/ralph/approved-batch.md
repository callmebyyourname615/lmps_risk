# Ralph Local Setup and Read-only Recovery Pilot

Approved in chat on 2026-10-25. Existing Codex logins must remain intact: never run login/logout, replace/copy credentials or rotate accounts. Default pilot account is the existing plusd CODEX_HOME. Tool installation was approved separately and is already complete.

Scope: preserve the existing415 Git-visible source files and11 sibling plan documents; build a104-item traceability map; configure a pinned sequential Ralph/Codex adapter; test safe failures/recovery with simulated agents; execute one real read-only intake task. Initial commit, application features, schema/migrations, persistent database changes, real datasets/source connections, payment/provider actions and production deployment are excluded.

### US-001: Audit the approved automation intake without changing application files

**Priority:** P1

**Depends on:** none

Read the working rules, requirements map, original phase plan and latest implementation-status entry. Verify that the map covers the full requirement inventory and preserves unknown target gates despite completed local/synthetic batches. Return only the structured audit report; independent host verification controls completion. This task does not close any P00-P11 target gate or rescore the historical ledger.

#### Acceptance Criteria

- [ ] All104 unique MUST IDs and11 plan documents are represented by the intake.
- [ ] Current local No.42-51 implementation is distinguished from the historical No.41 scores; reported970 tests are not claimed as freshly run.
- [ ] Source semantics, account identity, historical availability, real labels and production approval remain explicit blockers.
- [ ] The audit makes no application/plan/Git/database changes and performs no login/logout or account rotation.
- [ ] The independent adapter verifies map consistency, pinned runtimes, automation regression tests, publication/secret checks and original-source/plan preservation before completion.

## After this batch

Stop when US-001 is verified. A later application implementation batch must identify selected requirement gaps, small task IDs, dependencies, exact acceptance checks and approved files/services before execution. Do not turn every unchecked plan item into an executable task. The real2GB experiment and user-owned app work remain deferred.
