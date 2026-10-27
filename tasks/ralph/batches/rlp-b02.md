# RLP-B02 — approved local synthetic QA sampling records

Approved by the user's instruction "ทำ RLP-B02 ก่อน" on2026-10-25, including trusted R0 registration and fixed host fixture checks. Source of truth remains the unchanged sibling plan, especially P06-07. The reviewed full contract is preserved at `.local/ralph/proposals/implementation-batch-002.md` and supplied by the host to each task. Other plan work is planning-only in `.local/ralph/proposals/full-plan/README.md`.

No real data, source/provider/network, database operation, migrations, API/UI, production sampling policy, auto-label/training, dependencies/lockfile, Git commit/push or deployment. Never logout or automatically rotate accounts/retry. Stop on a failed check, decision or usage limit; preserve unfinished candidate.

## Quality Gates

- Affected package typecheck/tests, unchanged protected source/exact manifest fields and publication/secret scan must pass under trusted verification.
- Final task additionally runs trusted automation and root typecheck/test/build/frozen offline verify:fresh. Existing application tests remain unchanged.
- Only durable independent host receipts establish completion; final output is ready_for_verification, never self-declared COMPLETE.

## Fixture Contract

local_synthetic/test/simulation_only=true/enforcement=false/production_ready=false. Caller context is separate from policy/pool. Pool<=4MiB/10000 unique rows, selected<=1000, report<=1MiB. Strict fields/types/IDs/UTC times; explicit policy/version/as_of/public deterministic seed/strata/declared Alert status/evidence. No wall-clock or randomness in selection. Canonical hash ranking with deterministic tie-break is reorder-invariant and without replacement; caller and Alert/non-alert strata remain isolated. Future unavailable evidence is excluded with counts/reasons. Complete policy/pool hashes and exact integer per-stratum fractions describe supplied fixture pool only, population_claims=false. Missing/insufficient strata remain explicit, no cross-stratum backfill, labels, negatives, sample weights, training eligibility or population/detection-accuracy claims. Count-only CLI, immutable private file retry/conflict handling through unchanged existing helpers. O-010/source/identity/real sampling/maturity gates remain open.

### US-201: Strict synthetic QA sampling contracts
**Description:** Define validated caller/pool/policy/result types for the fixture contract above, exported only through the approved contracts subpath.
**Acceptance Criteria:**
- [ ] Input/output schemas enforce explicit synthetic/test/simulation-only boundaries and strict non-coercing unknown-field rejection.
- [ ] Pool/policy/caller/result reject malformed IDs/UTC dates, inconsistent counts, duplicate/conflicting IDs and limits beyond4MiB/10000 input/1000 selected/1MiB report.
- [ ] Contract preserves explicit Alert/non-alert strata/evidence/as_of/seed/version and never infers review/negative/identity/training or production readiness.
- [ ] Add only packages/contracts/src/qa-sampling.ts and its new contract tests; package.json changes only approved ./qa-sampling export to ./dist/qa-sampling.js.
- [ ] pnpm --filter @lmps/contracts typecheck and test pass; existing tests/dependencies/lockfiles remain unchanged.
- [ ] Independent host scope/manifest/source/publication guards pass before a durable receipt.

### US-202: Deterministic stratified QA selection
**Description:** Implement the fixture-only selection and audit record with an independent reference model in new tests.
**Depends on:** US-201
**Acceptance Criteria:**
- [ ] Selection is deterministic canonical hash rank with stable-ID tie-break, input reorder invariant and without replacement using existing canonical utilities.
- [ ] Caller scopes and declared Alert/non-alert strata remain separate; future evidence is excluded by supplied as_of with exact counts/reasons.
- [ ] Missing/insufficient strata remain explicit without substitution; record complete pool/policy hashes, denominators and exact integer fractions for supplied fixture pool only.
- [ ] No output creates labels/negatives/weights/training eligibility/population accuracy; inputs remain immutable.
- [ ] New independent-reference/adversarial tests and existing risk tests/typecheck pass; risk index only appends export * from './qa-sampling.js';.
- [ ] Independent host scope/manifest/source/publication guards pass before a durable receipt.

### US-203: Private immutable QA file CLI
**Description:** Expose selection as a private-file worker/root CLI, reusing private IO helpers unchanged.
**Depends on:** US-202
**Acceptance Criteria:**
- [ ] Reuse readPrivateJson/savePrivateReport without changing helpers; enforce owner/mode/link/FIFO/UTF-8/size restrictions.
- [ ] Exact retry acknowledges existing immutable report; changed run conflicts and partial/concurrent publication never overwrites unrelated data.
- [ ] CLI console/errors expose only status/counts and no fixture IDs/policy/private paths or raw rows.
- [ ] Root adds only risk:sample-qa with pnpm --filter @lmps/risk-workers build && pnpm exec node apps/risk-workers/scripts/qa-sampling.mjs; no other scripts/deps/lockfiles change.
- [ ] New actual root/worker CLI smoke and worker typecheck/tests pass; document synthetic-only operation and remaining gates.
- [ ] Independent host scope/manifest/source/publication guards pass; no DB/network/source/provider effect occurs in new CLI.

### US-204: Full local QA acceptance and handoff
**Description:** Verify contracts→selector→private CLI end to end and append honest acceptance notes, preserving all prior status bytes.
**Depends on:** US-203
**Acceptance Criteria:**
- [ ] New end-to-end acceptance covers both Alert/non-alert strata, reorder/retry and changed-run conflict, caller/time/duplicate/cap boundaries and unavailable inputs.
- [ ] Selection creates no labels/training/persistent DB/provider/network effects and never claims representative population or real accuracy.
- [ ] Existing49 plus new trusted automation checks and pinned root typecheck/test/build/frozen offline verify:fresh pass under fixed user-approved host fixture verification.
- [ ] Secret/publication/source/manifest guards pass; online advisories explicitly SKIP rather than claimed passed.
- [ ] Append actual executed results to QA runbook/current status with original status prefix byte-for-byte preserved; host-only checks pending until independent host appends results.
- [ ] B01 receipts/tracker/original plan/Git/unrelated changes stay intact; B02 completion uses durable receipts, no duplicate task on resume and finite queue termination.
