# LMPS Risk Portal

The full-width Midnight interface reuses the palette, panel radii, gradients and button tokens from the Midnight Crypto design. `src/tokens.css` is the token source; `styles.css` retains the original reset and evidence layouts with a new visual layer. No external fonts, analytics, runtime dependencies or relaxed CSP were introduced. Font families use available local fallbacks.

After authenticated connection the default view is Overview. Existing `#/` Inbox, `#/alerts/<UUID>` detail and `#/definitions` links are preserved; `#/overview` opens the dashboard. All business reads/reviews still use the scoped same-origin local Alert API. Tokens remain memory-only. The regular Portal retains its five-minute expiry/sign-out behavior; the explicitly started local synthetic preview auto-connects and renews its signed session.

Overview summarizes only the first API page (at most five alerts), with an explicit page scope. Mean indices exclude unavailable/not-evaluated values; a genuine zero remains zero, and an entirely unavailable or empty dimension renders `—`. Counters are not network totals, trends, accuracy metrics or probabilities. Queue priority applies only within the returned page. No case, verified account graph or payment action is added.

## Run and verify

```sh
pnpm test:portal
pnpm dev:portal
```

Vite serves `http://127.0.0.1:18505/portal/` and proxies the existing Alert API at18501. This requires the existing local API and a valid short-lived access token; it does not create a session or source connection.

For an isolated interactive visual review, first build the API and Portal. Set `LMPS_PLAYWRIGHT_MODULE` to the absolute installed `playwright-core/index.mjs`, then run:

```sh
pnpm --filter @lmps/risk-api build
pnpm --filter @lmps/risk-portal build
pnpm exec node apps/risk-portal/test/preview.mjs
```

The preview exclusively binds loopback18505 and opens Chrome directly on Overview. New tabs and reloads auto-connect without a Login form. The existing synthetic API fixture issues signed five-minute reviewer tokens in memory through a same-origin-only POST route available exclusively in the test preview. Tokens renew before expiry while preserving the active page and unsaved review draft. Nothing is persisted to browser storage or printed, and the project database is not used. The regular API still rejects unauthenticated/forged requests; no production route, CSP or auth policy is relaxed. Closing the launched Chrome stops the server. Do not run Vite on the same port simultaneously. This fixture is not a production server or real-source integration.

`test/browser-checks.mjs` exports the original nine API-injection browser scenarios (including Overview); `test/browser-overview.mjs` exports five focused Overview checks and six-width visual checks. They accept a Playwright page. `pnpm test:portal:browser` additionally exercises the native disposable PostgreSQL→TCP API→Chrome review path when `LMPS_PLAYWRIGHT_MODULE` and the pinned native runtime are available. Browser screenshots stay under ignored `.local/portal-checks`.

`test/preview-session.test.mjs` checks the isolated issuer, host/marker detection, signature validation and same-identity renewal. `test/browser-preview.mjs` exports `runPreview(page)` for an explicit Playwright context; it tests four-second token rotation, draft retention/review, reload/new-tab entry, connection failure/retry and API denial without a bearer. The default fixture never enables the preview issuer or HTML marker.
