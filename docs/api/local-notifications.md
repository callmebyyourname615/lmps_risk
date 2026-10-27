# Local Notifications & Outbox — Profile A/B contract

Contract frozen for the approved Phase 1 implementation, 2026-10-27. Profile A owns the backend and this contract. Profile B can implement against these shapes while the backend is completed. This document is a contract, not an implementation/test completion receipt; executed status will be appended below.

## Routes and authorization

| Method/path | Scope | Purpose |
| --- | --- | --- |
| `GET /v1/local/notifications` | `operations:read` | List stored outbox intents |
| `GET /v1/local/notifications/:intent_ref` | `operations:read` | Read one stored intent |
| `GET /v1/local/notifications/:intent_ref/attempts` | `operations:read` | Read attempts for one intent |

The workspace comes only from the verified JWT. Never accept a workspace query parameter. `intent_ref` and `notification_ref` are opaque lowercase UUID v4 strings. `notification_ref` is **not an Alert ID**, staff recipient or device reference. No Alert relationship is supplied by this contract.

Audit navigation is `/audit?intent_ref=<intent_ref>`; its existing API `GET /v1/local/audit/events?intent_ref=<intent_ref>` independently requires `audit:read`. Reading notifications does not grant audit access. Browser auto-session/catalog requirements remain with the existing Portal session integration.

All responses use `Cache-Control: no-store`. No endpoint sends, claims, retries, cancels, expires, acknowledges or otherwise updates an intent. No migration or new write credential is required.

## Common response fields

Every successful envelope contains:

```ts
type Common = {
  provenance: 'local_synthetic';
  execution_mode: 'test';
  provider: 'fake';
  delivery_semantics: 'fake_provider_only';
  workspace_key: string;
  as_of: string; // UTC ISO timestamp, exactly six fractional digits: YYYY-MM-DDTHH:mm:ss.ffffffZ
};
```

`accepted` records a result from the local fake-provider outbox. It does not establish real provider acceptance, device delivery, opening, acknowledgement or an Alert workflow change. Missing production/subscription/recipient evidence remains unavailable in the UI.

## Intent schema

The same exact projection is used in list and detail responses:

```ts
type Intent = {
  intent_ref: string;
  notification_ref: string;
  state: 'pending' | 'leased' | 'accepted' | 'expired' | 'dead';
  attempt_count: number; // integer 0..3
  created_at: string;
  available_at: string;
  expires_at: string;
  lease_until: string | null;
  is_expired: boolean;    // expires_at <= as_of
  lease_expired: boolean; // lease_until !== null && lease_until <= as_of
};
```

All timestamps use the six-fraction UTC format above. `state` is the **stored state**. Time-derived flags do not rewrite that state: an overdue pending intent can remain pending until a worker processes it; a leased intent can have `lease_expired=true`. Lease deadline is safe timing metadata; the lease token is never returned.

The projection excludes `semantic_key`, `lease_token`, raw payloads, credentials, account fields and inferred recipient/Alert/device relationships. There is no invented `updated_at`, channel, read status or delivery timestamp.

## List query and response

Optional query parameters:

| Query | Format/default |
| --- | --- |
| `state` | One exact stored-state enum above; omitted means all |
| `notification_ref` | Exact UUID v4 filter; omitted means all |
| `limit` | Canonical decimal integer 1..100; default **25** |
| `after` | Opaque `next_cursor` from the previous response; omitted on first page |

Unknown/repeated parameters, blank filter values, invalid UUIDs/enums/cursors and unsupported limits return 400. A direct Intent ID lookup uses the detail route, not a search/prefix filter.

```ts
type IntentPage = Common & {
  pagination: 'live_committed_view_uuid_order';
  filters: { state: Intent['state'] | null; notification_ref: string | null };
  items: Intent[]; // at most limit rows, ascending intent_ref
  next_cursor: string | null;
};
```

The cursor is canonical unpadded base64url JSON, versioned and bound to workspace, resource kind and both filters. Treat it as opaque in the Portal: preserve/submit it unchanged; reset cursor history whenever applied filters change. It is not a secret, signed authorization grant or stable-export checkpoint. Page size is not part of the binding. UUID order is not chronological/commit order, and concurrent lower-ID inserts or state changes can alter a live traversal. No total count is implied by page length.

## Detail response

The detail route accepts **no query parameters**.

```ts
type IntentDetail = Common & { intent: Intent | null };
```

Unknown and foreign-workspace IDs both return HTTP 200 with `intent: null`. Malformed IDs return 400. The response never reveals whether the same ID exists in another workspace.

## Attempts query and response

Optional `limit` (1..100, default25) and opaque `after` only. Attempts are ascending by `attempt_number`, which is bounded to 1..3 by the existing storage contract. Use `limit=1` if the UI needs one attempt per page; the standard page can contain the complete three-attempt history.

```ts
type Attempt = {
  attempt_id: string;     // positive decimal bigint string, never convert to Number
  attempt_number: number; // integer 1..3
  outcome: 'unknown' | 'accepted' | 'retry' | 'permanent';
  claimed_at: string;
  finished_at: string | null;
};
type AttemptPage = Common & {
  intent_ref: string;
  pagination: 'live_committed_view_attempt_number_order';
  items: Attempt[];
  next_cursor: string | null;
};
```

`unknown` has `finished_at=null`; other outcomes have a recorded finish timestamp. The cursor is independently bound to the workspace, attempts resource and exact `intent_ref`; list cursors, another intent's cursor or another workspace's cursor are invalid. Unknown and foreign intents both return an empty attempts page; a known intent with no attempts is also empty. Read the detail response to distinguish a known zero-attempt intent in the current workspace.

## Errors and Portal acceptance

| HTTP | `code` |
| --- | --- |
| 400 | `INVALID_QUERY` |
| 401 | `UNAUTHORIZED` |
| 403 | `FORBIDDEN` |
| 503 | `NOTIFICATIONS_UNAVAILABLE` |

Errors contain a fixed redacted `message`, with no locale field or raw storage diagnostics. Successful responses are also locale-independent; Profile B owns EN/LO labels. Malformed stored projections or storage failures return 503 rather than an invented empty page. On loading/error/expiry/workspace change, remove stale evidence. Error and not-found states remain distinct.

Use the current Overview design tokens. Preserve opaque IDs and bigint strings. Display only stored states and the explicit time flags. Do not add production push/subscription controls or infer Alert mappings. Portal tests should cover both cursor histories, filters resetting pagination, detail-to-attempt identity binding, audit scope independence, EN/LO, 320/375/414/768px, empty/denied/expired/unavailable states and GET-only business requests.

## Implementation status

Profile A backend implementation and verification completed on 2026-10-27 ICT. The three GET routes are implemented in `apps/risk-api/src/notifications.controller.ts`, registered in `src/app.ts` and present in the running local API/OpenAPI. This contract's response shapes and authorization remain unchanged. No migration, dependency, write credential or production-provider integration was added.

Executed with the repository Node24.22.0 runtime:

- Complete risk-api build/test command: **137/137 passed**, including **12 Notifications integration tests** against an owned disposable PostgreSQL cluster. These cover exact projections, all five stored states, overdue pending/stale leases, 37 local intents traversing default25 pages, exact and combined filters, foreign-workspace isolation, cursor bindings/canonicalization, bigint IDs above2^53, three ordered attempts, independent Audit authorization, malformed queries/projections, actual database outage/recovery, and unchanged complete-row fingerprints of intents/attempts/audit after reads. Authenticated startup without an app database is rejected by the existing configuration gate.
- Profile B's existing Notifications client tests against the real API: **7/7 passed**. This verifies the frozen contract and its failure handling; it is not a claim that Profile A authored the Portal changes.
- Profile B's existing real-browser Notifications acceptance: **8 groups passed**, with disposable PostgreSQL cleanup completed. List/detail/attempt pagination and Audit links, Overview computed design tokens, EN/LO, renewal, scope/workspace/expiry cleanup, mobile320/375/414/768px, actual storage outage/recovery and GET-only business traffic were checked. No Portal source changes were made by Profile A in this completion batch.
- Live same-origin `http://localhost:8443` checks: session issuance200, all three Notifications routes200 and exact-intent Audit200; unauthenticated Notifications401; API health200; `/openapi.json` contains all three GET routes. The reader's current workspace returns one stored intent. The shared local companion had already been restarted during concurrent profile work and loaded this controller; Profile A observed its availability and did not restart it again.
- Persistent project data: counts and complete-row fingerprints match the before-check snapshot for seven tables (outbox intents/attempts, Audit, transaction revisions, risk runs, Alerts and Cases). No persistent seed/migration or business write was performed in this batch. Fixture mutations used only owned disposable test databases.

Verification logs/receipts: `.local/notifications-verification/{focused-tests.log,api-suite.log,portal-contract-tests.log,portal-browser.log,live-before.json,live-acceptance.json,status-prefix.json}`. Browser receipts/screenshots: `../LMPS_Risk_Portal/output/playwright/notifications-api/acceptance.json` and neighboring PNGs. `git diff --check` passed; the pre-existing untracked backend baseline does not establish an exact Git/source-scope guard.

Profile B can use the frozen routes above now. This remains local synthetic fake-provider evidence. Real financial-source connectivity, source/account identity and masking semantics, production delivery/recipients and production-scale capacity remain unverified. No full root/worker/legacy/CI/security or production-readiness acceptance is attributed to this batch.
