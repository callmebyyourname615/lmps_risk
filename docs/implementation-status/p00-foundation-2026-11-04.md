# P00 Foundation review — 2026-11-04

This is an engineering evidence/gap ledger for the original eight P00 requirements. It does not replace plan checkboxes, assign operational owners, select a production platform or approve a release. The current repository is `Core_LMPS_Risk`; the earlier `financial-crime-platform` name remains in historical records.

| Requirement | Current evidence | Remaining gate |
| --- | --- | --- |
| P00-01 Repository | Existing new TS/Python workspace, package boundaries and local bootstrap. | No new repository or branch is needed. |
| P00-02 Toolchain | Node 24.22.0, pnpm 11.20.0, Python 3.13.15, strict TS and frozen locks; CI drift test checks the configured Node/pnpm pins. | Repeat platform acceptance for an adopted target; no version upgrade in this batch. |
| P00-03 Compatibility/licenses | Existing compatibility matrix, native local DB tests and verified lock-bound SBOM: 226 components, zero UNKNOWN licenses. | Hosted Ubuntu results, selected production runtime/resources, legal approval and signed release/image inventory. |
| P00-04 Entry points/readiness | Existing NestJS API/workers, FastAPI, contracts and explicit unavailable/configuration states; no empty services added. | Production integration and model/source readiness must remain independently attested. |
| P00-05 Environment separation | Existing local/test guards, private generated credentials, secret templates, disposable test clusters and publication scan. | Approved deployed environment separation, secret/key ownership and access policy. |
| P00-06 CI | Existing pinned read-only GitHub workflow and local/fresh verification. This batch removes the sibling-Portal dependency from Core regression without silently substituting operator policy. | Authorized publication and actual hosted run URL/commit/result; image scans only after a release image/runtime is selected. |
| P00-07 Ownership/SLO | Existing role/ownership register, ADRs and actual-versus-target workload inputs. | Named owners, approved SLO/freshness/resource/cost/RPO/RTO and on-call/stop conditions. Keep TBD; tests cannot supply these approvals. |
| P00-08 Adoption decisions | Existing spike/ADR records plus bounded local feature/cache/graph comparisons and Web App implementation. | Approved backbone/engine/cache/history/deployment/IaC adoption with operations, security, licensing and recovery evidence. Local candidates do not select production products. |

## Standalone checkout correction

Core's native mapping and offline-publication tests previously imported the sibling Portal's policy/detector/currency source transitively. A normal GitHub checkout has no such sibling; the fresh verifier copied those external files as a workaround. The policy helper now loads the canonical Portal module only on its default operator path. Tests explicitly supply a repository-owned synthetic fixture, using the unchanged approval/hash/currency checks and original database policy/assessment/job implementations. There is no fixture fallback for an operator command. A separate Portal contract test checks the fixture's selected fields and content hash against the actual bound Portal policy.

The fresh verifier now stages only Core Git-visible source. Tests retain source-mutation detection, cleanup on failed install and exclusion of private state, and prove a missing Portal checkout is allowed. Security/workflow checks retain read-only permissions, pinned action commits and the final full verification command.

## Acceptance record

Actual command results and any fresh-source/platform limitations are recorded in `current.md` after checks complete. Hosted execution, commit/push, deployment, purchases, account/source connections and production changes are outside this local batch. The remaining owner inputs are listed in `docs/architecture/engineering-foundation-gates.md` and `plan/09-missing-inputs-and-foundation-readiness.md` in the parent project.

Completed local acceptance: `pnpm verify:fresh` passed on a temporary standalone Core checkout with no Portal source staged, unchanged original source hashes and verified temporary cleanup. This includes frozen offline installs, runtime/SBOM checks, 29 CI/security tests, typecheck, root Node/Python tests, 226 ML tests plus 43 subtests and 28 DDL metadata tests. Five existing opt-in graph tests and online advisories were skipped. Canonical Portal fixture parity and missing-Portal/no-fallback checks passed separately. The post-run status/acceptance notes are not part of that earlier source snapshot.
