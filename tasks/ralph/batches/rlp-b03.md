# RLP-B03 — registered dependency-ready local foundations

Registration requested by the user on2026-10-25: ลงทะเบียนให้ครบตาม plan. This preparation starts no agent. An explicit launcher run/resume activates only US-301–309 in this reviewed local scope, including fixed trusted host fixture checks. Coding agent remains workspace-write. No account logout/rotation, unlimited retries, API key fallback, Git commit/push/reset, external data/provider, installation of new dependencies, persistent user DB operation or production deployment.

Source of truth is the unchanged sibling plan directory. tasks/ralph/master.json registers all104 MUST/135 leaves:4 existing B02 receipts,9 ready local tasks,122 blocked leaves. B01 and B02 are historical completed batches. Never redo their implementations. Blocked leaves cannot be selected, and these local foundations do not close target requirements.

## Quality Gates

Every task: exact file/manifest-field/source/plan/Git guards and publication/secret scan. Affected package checks follow the frozen manifest identifiers; full tasks additionally run trusted automation and pinned root typecheck/test/build/offline verify:fresh. No lint command or online advisory pass is invented. Stop on failure/decision/quota/storage conflict, preserve pending source, and use explicit resume. No automatic account rotation or quota-reset polling.

Host checks use ordinary macOS user processes only for the fixed commands on owned private/disposable fixtures, because native PostgreSQL shared memory was not available in the tested Codex sandbox. This is a new scoped B03 permission record; B02 permission is not reused. Agent sandbox never widened.

Local resource policy: bounded inputs/outputs and deterministic clocks/fixtures; explicit limits must be documented/tested as local limits, not business thresholds/capacity. Reuse current primitives before adding code. Existing tests/lockfiles/dependencies/automation/PLAN source are protected. Unknown real fields/authority remain gated.

### US-301: Prepare one decision record per unadopted component

**Description:** P00-08-T1 (P00-08); implement only the declared local foundation.

Exact files: `docs/architecture/adr/0017-local-adoption-evidence-register.md`, `docs/architecture/engineering-foundation-gates.md`
Exact manifest edits: {}

**Acceptance Criteria:**
- [ ] For backbone/engine/cache/history/deployment/IaC define candidates, exact-version spike, owner, pass/fail/TCO and rollback
- [ ] Preserve selected Web App direction; alternatives are conditional, not mandatory installs
- [ ] Reuse the existing foundation spike table/compatibility matrix; consolidate one evidence register for backbone, stream engine, cache, history, deployment and IaC rather than duplicate implemented components.
- [ ] Keep unselected versions, owners and adoption approval explicitly pending; define how exact-version compatibility/correctness/recovery/TCO/rollback will be demonstrated. Do not invent compatibility, license sign-off or provision products.
- [ ] Preserve the user-owned Web App direction and all existing foundation history; this task completes a local decision-plan document only.
- [ ] Fixed docs checks and host source/field/publication guards pass; no invented test result or change outside current allowlist.
- [ ] Return ready_for_verification only with current task implemented; only durable independent host receipt establishes completion.

### US-302: Define bounded historical dataset manifest and writer port

**Description:** P03-06-T1 (P03-06); implement only the declared local foundation.
**Depends on:** US-301

Exact files: `packages/contracts/src/historical-dataset.ts`, `packages/contracts/package.json`, `packages/contracts/test/historical-dataset.test.mjs`, `docs/data-dictionary/historical-dataset-manifest.md`
Exact manifest edits: {"packages/contracts/package.json":{"kind":"export","key":"./historical-dataset","value":"./dist/historical-dataset.js"}}

**Acceptance Criteria:**
- [ ] Manifest binds schema/content hash/count/currency/time/availability/provenance and execution namespace
- [ ] Partial output is not published; fake store failure/identical retry/change conflict contract is executable
- [ ] Define strict non-coercing local_synthetic/test manifest types and a writer port binding schema/content hashes, exact row/currency/time/availability/provenance and execution namespace. Invented IDs only; arbitrary field/code execution rejected.
- [ ] Document explicit finite local byte/row/file bounds and test exact/one-over, unknown fields, money precision, changed content, incomplete publication and no silent truncation.
- [ ] Exercise the port with an in-memory fake store: identical retries acknowledge, changed reuse conflicts, failed/partial output never publishes a complete manifest. No Parquet dependency, filesystem data acquisition, object service or actual writer adoption.
- [ ] Add only the declared package export; preserve all existing dependencies, scripts, exports and lockfiles. This local port does not close P03-06 target writer/storage gates.
- [ ] Fixed contracts checks and host source/field/publication guards pass; no invented test result or change outside current allowlist.
- [ ] Return ready_for_verification only with current task implemented; only durable independent host receipt establishes completion.

### US-303: Build bounded golden-stream reference corpus

**Description:** P04-02-T1 (P04-02); implement only the declared local foundation.
**Depends on:** US-302

Exact files: `packages/risk/test/fixtures/feature-streams/golden.json`, `packages/risk/test/feature-streams.test.mjs`, `docs/data-dictionary/feature-golden-streams.md`
Exact manifest edits: {}

**Acceptance Criteria:**
- [ ] Include duplicates/out-of-order/late corrections/reversal/currency/hotkey/missing evidence
- [ ] Expected snapshots calculated independently of candidate engine
- [ ] Create a bounded invented golden stream corpus covering duplicates, out-of-order/late corrections, reversals, separate currencies, hot keys and unavailable evidence using existing synthetic feature contracts.
- [ ] Compute expected count/exact-money/availability/window outputs independently; compare supported cases with the unchanged existing reference calculator. Unsupported online-engine cases stay explicitly pending.
- [ ] No engine/cache package, real account identity, new feature runtime or benchmark/adoption claim. Document event order/as_of and deterministic replay without altering existing fixtures/tests.
- [ ] Fixed risk checks and host source/field/publication guards pass; no invented test result or change outside current allowlist.
- [ ] Return ready_for_verification only with current task implemented; only durable independent host receipt establishes completion.

### US-304: Define subscription lifecycle/ownership contract

**Description:** P07-03-T1 (P07-03); implement only the declared local foundation.
**Depends on:** US-303

Exact files: `packages/contracts/src/notification-subscription.ts`, `packages/contracts/package.json`, `packages/contracts/test/notification-subscription.test.mjs`
Exact manifest edits: {"packages/contracts/package.json":{"kind":"export","key":"./notification-subscription","value":"./dist/notification-subscription.js"}}

**Acceptance Criteria:**
- [ ] Caller-derived ownership, per-environment opaque IDs and rotation/revoke semantics
- [ ] No token/endpoint credential in logs or response to another user
- [ ] Define a strict bounded local_synthetic/test subscription lifecycle contract for register/rotate/revoke with caller context separate from untrusted bodies, ownership/environment/expected-version/idempotency bindings.
- [ ] No real provider endpoint or credential storage, DB/API registration, session logout, device delivery or inferred recipient authorization. Contract output is not an authorization grant.
- [ ] Reject unknown/coerced/oversized/cross-owner/conflicting inputs; errors and public projections contain no credentials. Add only the declared contracts subpath export; preserve dependencies and existing APIs.
- [ ] Fixed contracts checks and host source/field/publication guards pass; no invented test result or change outside current allowlist.
- [ ] Return ready_for_verification only with current task implemented; only durable independent host receipt establishes completion.

### US-305: Extend fake provider with deterministic notification failure corpus

**Description:** P07-06-T1 (P07-06); implement only the declared local foundation.
**Depends on:** US-304

Exact files: `apps/risk-workers/test/fixtures/notifications/fake-provider.mjs`, `apps/risk-workers/test/fixtures/notifications/cases.json`, `apps/risk-workers/test/notification-provider-fixtures.test.mjs`
Exact manifest edits: {}

**Acceptance Criteria:**
- [ ] Simulate accepted/offline/expired/revoked/rate-limit/bad subscription/crash boundary
- [ ] No real provider calls or fabricated device-delivery claim
- [ ] Reuse the current outbox/fake delivery semantics where applicable; add deterministic fixture cases accepted/offline/expired/revoked/rate-limited/invalid-subscription/crash-after-acceptance with supplied clock/random seed.
- [ ] Keep provider acceptance distinct from actual device receipt/open/ack. Bound attempts/TTL and demonstrate semantic intent dedup while allowing ambiguous physical acceptance.
- [ ] All provider behavior is local in-memory fake test support; no real push, credentials, subscription DB, network call or recipient target. Do not build a second production queue or modify existing worker tests.
- [ ] Fixed workers checks and host source/field/publication guards pass; no invented test result or change outside current allowlist.
- [ ] Return ready_for_verification only with current task implemented; only durable independent host receipt establishes completion.

### US-306: Define minimal opaque deep-link payload contract

**Description:** P07-07-T1 (P07-07); implement only the declared local foundation.
**Depends on:** US-305

Exact files: `packages/contracts/src/notification-payload.ts`, `packages/contracts/package.json`, `packages/contracts/test/notification-payload.test.mjs`
Exact manifest edits: {"packages/contracts/package.json":{"kind":"export","key":"./notification-payload","value":"./dist/notification-payload.js"}}

**Acceptance Criteria:**
- [ ] Opaque intent/detail handle only; no raw account/amount/risk detail on lock screen
- [ ] Reject unsafe URL schemes/cross-origin destinations and require authenticated retrieval
- [ ] Define strict bounded synthetic minimal lock-screen/deep-link payloads carrying opaque intent/detail handles only; prohibit account, amount, raw evidence and risk/label details.
- [ ] Any link resolution helper must use caller-supplied allowlisted synthetic origin with strict scheme/origin/path validation; opaque handles never replace authenticated detail retrieval.
- [ ] Test unsafe schemes, cross-origin/path injection, unknown fields, malformed/oversized handles and detached input. No Web App implementation, service worker, actual push or token storage. Add only the declared export.
- [ ] Fixed contracts checks and host source/field/publication guards pass; no invented test result or change outside current allowlist.
- [ ] Return ready_for_verification only with current task implemented; only durable independent host receipt establishes completion.

### US-307: Add dependency-ready bounded batch schedule/resume contract

**Description:** P08-07-T1 (P08-07); implement only the declared local foundation.
**Depends on:** US-306

Exact files: `services/ml-inference/lmps_ml/batch_schedule.py`, `services/ml-inference/lmps_ml/pipeline.py`, `services/ml-inference/tests/test_batch_schedule.py`, `docs/operations/local-ml-batch-schedule.md`
Exact manifest edits: {}

**Acceptance Criteria:**
- [ ] Versioned inputs/policy/artifacts, one-writer state and bounded retries skip finished outputs
- [ ] Failed/changed-input runs stop; no implicit data acquisition or model activation
- [ ] Reuse existing versioned dataset/pipeline/private IO and add a bounded local synthetic batch schedule/resume contract with stable task/dependency/input/policy/artifact hashes and one-writer ownership.
- [ ] Expose only an additive explicit local batch-plan entry in pipeline CLI; execution uses a fixed trusted action mapping, never shell commands from input, arbitrary imports, cron, network acquisition or model activation.
- [ ] Test dependency order/cycles, exact retry acknowledgement, changed-input conflicts, failed/blocked stage stop, finite retry budget, concurrent writer rejection and interrupted checkpoint resume skipping verified outputs.
- [ ] No Airflow/dependency install, real training labels, scheduled daemon or service deployment; preserve all existing CLI commands and model/data safeguards. Final host runs all root checks including Python tests through frozen fresh verification.
- [ ] Fixed full checks and host source/field/publication guards pass; no invented test result or change outside current allowlist.
- [ ] Return ready_for_verification only with current task implemented; only durable independent host receipt establishes completion.

### US-308: Define vendor/graph evaluation port and fake failures

**Description:** P08-09-T1 (P08-09); implement only the declared local foundation.
**Depends on:** US-307

Exact files: `services/ml-inference/lmps_ml/vendor_evaluation.py`, `services/ml-inference/tests/test_vendor_evaluation.py`
Exact manifest edits: {}

**Acceptance Criteria:**
- [ ] Port binds cohort/as-of/provider/version/availability/cost evidence
- [ ] Fake timeout/stale/conflict/redaction tests; no network calls or unsupported accuracy claim
- [ ] Define strict bounded local synthetic vendor/graph evaluation request/result ports binding cohort/test split/as_of/provider/version/availability/lineage and explicit supplied cost evidence, separate per risk dimension.
- [ ] Use in-memory fakes only; test timeout/unavailable/stale/as_of mismatch/conflicting lineage, unknown fields, deterministic retry and redacted diagnostics with no network/data-export effects.
- [ ] No actual vendor SDK/call/credential, GNN/GPU, artifact download or automatic activation. Unknown accuracy/cost/coverage remains unknown; actual adoption/DPA/data/label gates remain blocked.
- [ ] Fixed full checks and host source/field/publication guards pass; no invented test result or change outside current allowlist.
- [ ] Return ready_for_verification only with current task implemented; only durable independent host receipt establishes completion.

### US-309: Write evidence-based threat model and abuse test matrix

**Description:** P10-09-T1 (P10-09); implement only the declared local foundation.
**Depends on:** US-308

Exact files: `docs/security/threat-model.md`, `docs/implementation-status/current.md`
Exact manifest edits: {}

**Acceptance Criteria:**
- [ ] Cover tenants/insider audit tamper/PII/source ingestion/artifact supply chain/payment binding/push replay
- [ ] Map existing controls and gaps without declaring an unrun pen test passed
- [ ] Write an evidence-based threat model and abuse-test matrix covering tenant/Case permissions, insider/admin audit tamper, ingestion/PII, artifact supply chain, payment binding, push replay and automation guard boundaries.
- [ ] Link each existing control to actual code/tests/receipts and mark missing or owner-dependent defenses explicitly. No fabricated pentest, real attack, security sign-off or release approval.
- [ ] Append an honest batch handoff to current.md preserving its entire original prefix. Candidate notes must leave host-only checks pending; trusted verifier appends actual successful check evidence.
- [ ] Final acceptance includes all trusted automation tests, pinned root typecheck/test/build/frozen offline fresh verification and publication/scope checks, preserved B01/B02 history, plan/Git/user source and unchanged logins. No target phase is closed from these local foundations.
- [ ] Fixed full checks and host source/field/publication guards pass; no invented test result or change outside current allowlist.
- [ ] Return ready_for_verification only with current task implemented; only durable independent host receipt establishes completion.
