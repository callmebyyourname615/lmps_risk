# Proposed P06 local Model receipt inspection

Status: proposal only; product implementation has not started. The matching historical draft tracker is at `tasks/ralph/batches/rlp-b14.json`. Ralph execution tooling was retired at the user's request; a future direct Codex batch needs its own scope and approval. Original master target gates and historical receipts remain unchanged.

## Problem and bounded result

The backend already verifies and reads local synthetic shadow receipts through `GET /v1/local/model-receipts/:request_id`, but the canonical Portal has no fixed transport, proxy or inspection view for that contract. Add an explicit known-request lookup within Health using the existing reader session. Preserve existing Health tabs/routes and all source/identity/governance/production limitations. No backend route, migration, model fitting, inference request, business POST, new dependency or production permission is needed.

The DTO is a redacted view of a larger immutable snapshot. Its stored receipt hash is a reference, not a browser-recomputable digest or a browser-verified model signature. Source reference: `packages/database/src/model-signals.ts`; contract: `packages/contracts/src/model-signal.ts`; endpoint: `apps/risk-api/src/model-signals.controller.ts`.

## Quality gates

Every story must pass, from the canonical Portal directory using its existing pinned/prepared tools:

- `./node_modules/.bin/tsc --noEmit --incremental false`
- `node --experimental-strip-types --test test/*.test.mjs`
- `./node_modules/.bin/vite build`

UI/acceptance stories additionally run `node test/api-model-receipts-native.mjs` with the existing explicit Playwright module configuration, using only owned disposable fixtures. The new native script is introduced by US-1402 and retained by later stories. Successful real browser proof is required; no placeholder script or simulated success is acceptance.

The final story also requires backend `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm verify:fresh` and publication/security checks, subject to their existing resource requirements. No root lint script exists. Online advisory audits remain separately reported rather than fabricated as passed. Preserve intermittent MariaDB bootstrap failure history; diagnostic retries cannot substitute for a successful full gate.

## Stories and exact proposed file scope

1. **US-1401 — Fixed Model receipt GET client and proxy.** Add `src/api/model-receipt-client.ts` and `test/api-model-receipts.test.mjs`; extend only the existing fixed transport in `src/api/alert-client.ts` and configured target routing in `vite.config.ts`. Validate the existing exact DTO and distinguish null receipt, unavailable model, missing trust, storage failure, denial and malformed evidence. The endpoint intentionally has no localized envelope. Keep credentials inside the existing in-memory same-origin session transport.
2. **US-1402 — Health Model inspection panel.** Add `src/ModelReceiptPanel.tsx`, `src/locales/api-model-receipts.ts`, `src/api-model-receipts.css` and integrate the new tab in `src/ApiHealthPage.tsx`/`src/locales/api-health.ts`. Add owned fixtures and an executable initial browser smoke in `test/support/model-receipt-fixture.mjs` and `test/api-model-receipts-native.mjs`. Preserve existing tokens/fonts/disclosures, EN/LO, keyboard/reduced motion and other Health tabs. Lookup is by explicit request UUID; navigate only with validated returned Assessment/Alert IDs. Copy exact stored references without a browser-verification badge.
3. **US-1403 — Native/browser evidence and state acceptance.** Extend only the two new tests and fixture support. Use actual NestJS/owned PostgreSQL, existing signed synthetic model fixture patterns and real browser requests. Prove ready/null/unavailable/unconfigured/denied/corrupt/network/session-change states, stale response cancellation, exact 9-decimal probabilities, optional links, request-vs-run distinction, safe hashes, read-only business HTTP, EN/LO, keyboard/reduced motion and 320/375/414/768px layout. No actual fitting/service startup or persistent project writes are necessary for a pre-recorded synthetic receipt fixture. Native metadata and browser evidence must be independently attributed.
4. **US-1404 — Current-source local handoff.** Add canonical Portal `MODEL-RECEIPTS-API.md`; append backend `docs/implementation-status/current.md` with only actual final checks and remaining gates. Execute all quality gates, current promoted native/browser acceptance, independent source/evidence/cleanup review and publication checks. Keep all original P06 targets open. Report local synthetic support, never production readiness or verified accounts.

The proposed order is US-1401 → US-1402 → US-1403 → US-1404. Review current source and user changes before any direct implementation. Do not copy the whole Portal, browser caches, credentials or private datasets into a source artifact.

## Excluded inputs and activation

Production IdP/staff identity, source semantics/history/account linkage/masking, real eligible labels/accuracy, payment actions, remote model registry, model retraining, current feature-cache-to-assessment linkage, Case/Label writes and attachment/export policies remain separate gates. Missing data must remain unavailable. Before implementation, approve exact checks and disposable host/browser scope. The historical [activation metadata](activation.json) does not authorize implementation.
