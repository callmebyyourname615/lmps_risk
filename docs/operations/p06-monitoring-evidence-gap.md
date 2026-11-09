# P06 Monitoring and Evidence: source review and next queue

Reviewed 2026-11-03 against this backend and the canonical sibling `LMPS_Risk_Portal`. The initial ledger was a source/contract review; the later local Model receipt implementation and actual checks are recorded in [current status](../implementation-status/current.md). Historical acceptance descriptions in the linked Portal documents remain attributed to their original dates. The original eight P06 requirements, master definitions and 104-item score are unchanged.

The independently accepted B12/B13 local code is integrated into this checkout. Its actual shared checks and remaining gates are recorded in [current status](../implementation-status/current.md). Historical batch pointers and flags describe older execution state; they cannot override later receipts. Ralph execution tooling was retired at the user's request; implementation may be commissioned directly with Codex in separately approved batches.

## Requirement ledger

| Requirement | Existing local evidence | Remaining gap / boundary |
| --- | --- | --- |
| P06-01 Typed Portal pages | Canonical `src/App.tsx` routes Overview, Transactions, Alerts, Cases, Policies, Network, Assessments, Health, Audit and Outcomes to API components. Health also provides [Model receipt inspection](../../../LMPS_Risk_Portal/MODEL-RECEIPTS-API.md) through the existing backend GET. | Production identity/source integration and complete model/feature health remain open. |
| P06-02 Loading/empty/error/stale/partial/denied states and coverage | [Monitoring snapshots](../../../LMPS_Risk_Portal/MONITORING-API.md), [records](../../../LMPS_Risk_Portal/MONITORING-RECORDS-API.md), [Assessment evidence](../../../LMPS_Risk_Portal/ASSESSMENTS-API.md) and Health clients explicitly manage scoped reads, null availability, obsolete requests and errors. Model receipt states have local native/browser coverage. | No new cross-module state/coverage acceptance was run by this review; real availability and source freshness remain unverified. |
| P06-03 Case workflow, concurrency and audit | [Backend Cases](../../apps/risk-api/src/cases.controller.ts) exposes create/link/assign/start/notes/outcomes/close/reopen. [Portal Phase 1](../../../LMPS_Risk_Portal/CASE-MANAGEMENT-API.md) command client exposes create/link/assign with independent manager scope, optimistic versioning and exact retry/proof. Alert acknowledgement/review is separately integrated. | API-bound start/notes/outcomes/close/reopen UI remains later scope. Attachments have no delivered authorized storage/quarantine/retention contract. Demo Case controls are not evidence of API integration. Staff identity/permissions require their own approval. |
| P06-04 Immutable feature/rule/model/policy evidence | [Assessment client](../../../LMPS_Risk_Portal/src/api/assessment-client.ts) validates frozen target/revision, 15 findings, policy/version and hashes; Assessment content can be independently hashed from its returned core. The Model panel reads the redacted stored receipt; [Network](../../../LMPS_Risk_Portal/NETWORK-API.md) declares synthetic identity and graph limitations. | The receipt hash binds a stored full snapshot that is **not** returned by its redacted DTO; the browser cannot recompute that hash or verify the original model signature from this DTO. Current feature cache state cannot be retroactively attached to an Assessment. |
| P06-05 Dimension-specific outcomes and maturity | [Outcomes](../../../LMPS_Risk_Portal/OUTCOMES-API.md) reads current/historical opinions and task-specific candidates, preserving unknown/null and eligibility/maturity distinctions. | Real label/outcome policy, reviewer identity and representative real outcomes remain owner gates. Case closure must never create a legitimate label implicitly. |
| P06-06 Adjudication and versioning | [Label API](../../apps/risk-api/src/labels.controller.ts) supports scoped candidate/detail reads and adjudication writes. Portal exposes read-only candidate/label lookup and current head/eligibility. | Portal adjudication writes, complete label-history discovery and an approved reviewer workflow are not delivered by read-only lookup. Do not invent a candidate-to-label ID link. |
| P06-07 QA sampling and blind spots | [B02 QA implementation](qa-sampling.md) and its durable receipts cover bounded deterministic local sampling/file publication. | No API-bound Portal sampling workflow or approved real sampling pool/policy; real labels, coverage and population evaluation remain gated. |
| P06-08 Safe export, access audit and redaction | [Audit](../../../LMPS_Risk_Portal/AUDIT-API.md) reads scoped Sync/Outbox history. [Datasets](../../../LMPS_Risk_Portal/DATASETS-API.md) uses bounded pages and a source-field allowlist. Existing private label/QA CLIs remain separate local tools. | Approved browser export/attachment access policy, redaction, retention and protected access audit are absent. Demo CSV helpers or private file CLIs do not close this target. Never download a whole dataset to the browser. |

All eight rows remain **partial local support with open target gates**. Source configuration/semantics/history/timezone, stable account identity/linkage/masking, independent labels, governance/retention/legal, real identity/authorization, workload/SLO and production adoption remain unverified. No account relationship or real source eligibility is inferred.

## Model receipt implementation

**Read-only Model receipt inspection within Health** supports P06-01/P06-02/P06-04 locally. The existing endpoint returns request/assessment IDs, immutable model/policy/feature references, gate decision, exact probability strings, optional Alert ID and synthetic/no-enforcement markers. It requires both `risk:read` and `alerts:read`; missing model trust returns `ML_NOT_CONFIGURED`, and invalid/unavailable storage returns `ML_STORAGE_UNAVAILABLE`.

The [historical proposal](../../tasks/ralph/proposals/p06-model-evidence/prd.md) describes the planned scope. Its old tracker and activation metadata are retained as history and do not indicate current implementation status. See [Portal handoff](../../../LMPS_Risk_Portal/MODEL-RECEIPTS-API.md) and current status for actual direct-Codex results.

The page must use an explicit known request UUID. It must not infer that request ID equals Assessment run ID, invent a receipt inventory, attach current cache values to historical evidence, average model probabilities with rule indices, or claim verified accounts/production accuracy. `receipt_sha256` is a stored reference; full browser-verifiable snapshot/signature delivery would need a separate contract.

Future work requires its own reviewed scope and verification. Preserve user changes and historical receipts. The archived tracker does not authorize implementation or require Ralph registration.

## Other backlog candidates

- Case Phase 2 command UI: existing backend transitions are reusable, but actor scopes, command proof and uncertain retry require a separate reviewed batch.
- Label adjudication UI: separate from read-only Label inspection; independent reviewer governance and history/discovery semantics need review.
- Feature health/evidence: current serving reads and historical assessment lineage must stay distinct until a binding/read contract is approved.
- Attachments, bounded export, real QA and production integrations: blocked on their explicit policy/storage/source/identity inputs.

The initial review changed no Portal source; later direct implementation added the read-only Portal client and panel. No application API/schema, persistent business database, account credential or phase target checkbox was changed by that implementation.
