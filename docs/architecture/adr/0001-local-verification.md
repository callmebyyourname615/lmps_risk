# ADR-LOCAL-001 — Shared verification entrypoint

Status: IMPLEMENTED LOCALLY under approved item 6, 2026-10-18. Operations owner: TBD.

The Node and Python workspaces previously required separate manual checks. `pnpm verify` now orchestrates their existing test runners, artifact/lock drift checks and an offline DDL fixture without requiring a source DB. A separate cached fresh-source run checks reproducibility. Standard-library orchestration avoids another task-runner dependency. The pinned detect-secrets development tool supplies established credential detectors; pinned PyYAML checks workflow syntax in tests.

Online dependency advisories fail closed; offline mode states that advisories were skipped. Secret values and scanner diagnostics are not echoed. Current-source scanning has documented checksum exceptions and cannot certify historical publication or arbitrary data privacy. GitHub was selected by the user's remote URL; the workflow is prepared with read-only permission, without application secrets or deployment. Hosted execution is pending commit/push and runner evidence.

Revisit when actual CI execution, business services, containers or additional deployment platforms exist. Add their relevant checks then; do not declare P00 or production security complete from this local foundation.
