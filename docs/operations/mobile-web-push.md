# Mobile Web Push and production gates

Standard Web Push/VAPID runs in the existing core API. It uses browser-provided HTTPS endpoints for Chrome/FCM, Firefox/Mozilla and Safari/Apple, encrypted subscription storage and a durable delivery queue. The original fake outbox is retained separately for historical test evidence; no fake row becomes a real delivery receipt.

## Configure this core

Run from the core repository root, replacing the contact with the actual operator email or HTTPS contact URI:

```sh
node apps/risk-api/scripts/setup-web-push.mjs --subject=mailto:YOUR_OPERATOR_EMAIL
```

The command creates `.local/web-push/config.json` once, mode0600, with a VAPID key pair and an independent AES256-GCM storage key. It never prints or overwrites keys. Keep this ignored private file in protected operator backup alongside the database; restoring encrypted subscriptions without their original storage key cannot recover the endpoints. Do not put private keys in `VITE_*`, Git, API responses or chat.

Set `LMPS_WEB_PUSH_CONFIG` to that file's absolute path in the core process environment. `LMPS_WEB_PUSH_WORKER=1` is the default when configured;0 explicitly disables the worker. The Portal/Mobile development companion forwards these two settings to the core:

```sh
cd ../LMPS_Risk_Portal
LMPS_WEB_PUSH_CONFIG=/ABSOLUTE/CORE/PATH/.local/web-push/config.json node tools/local-alerts-api.mjs
```

Restart the existing companion after stopping its owned process; do not run a second process on18501/18507. No contact/key was invented for the user; the current process stays unconfigured until a real contact and private configuration are supplied.

Open Mobile → Notification Preferences → Enable this device. Only that explicit action asks browser permission and registers its endpoint; merely loading a page never requests permission. Use Send test, then Delivery → Web Push to inspect the result. On iPhone use an installed Home Screen app over HTTPS. A real phone needs a reachable HTTPS origin/gateway, not the Mac's127.0.0.1 address.

## API and delivery meaning

- `GET /v1/local/alerts/summary`: workspace-wide committed `open`, `acknowledged`, `reviewed` counts; requires only `alerts:read`. Bottom badge uses `open`, independently of loaded pages/Overview filters. It refreshes every30s while visible/online, on visibility/online return and after a confirmed review. Missing/failed reads remain unknown, not zero.
- `GET /v1/local/web-push`: authenticated user's device metadata and public key. No plaintext endpoint/auth key is returned.
- `POST /v1/local/web-push/subscriptions`: exact browser endpoint/keys after user consent. HTTPS service allowlist, valid curve/key sizes, authenticated ownership and encrypted storage are enforced;10 active devices and100 historical registrations per user.
- `POST /v1/local/web-push/subscriptions/:id/revoke`: idempotent personal revoke; pending jobs are cancelled. Explicit sign out also attempts browser unsubscribe; browser/network failures can still require the explicit disable action. A request already accepted by a provider cannot be recalled.
- `POST /v1/local/web-push/subscriptions/:id/test`: queue a personal test, at most once/minute/device. It does not claim success before processing.
- `GET /v1/local/web-push/deliveries?after=…`:50 personal delivery records with UUID cursors and fixed diagnostic codes. Mobile's Delivery page defaults to these records; `?channel=local` opens the labelled historical fake outbox.

Every15s the optional worker enqueues unseen Alerts created after device registration, up to24h old,100 at a time. Existing historical Alerts do not produce a registration burst. It claims5 fenced leases, respects personal enable/severity/dimension/quiet-hour preferences, encrypts only generic lock-screen copy, and never includes account/amount/Alert evidence in the push body. Quiet hours defer without consuming retries; equal start/end means quiet all day. Transient provider failures retry up to5 attempts;404/410 disables the expired subscription. TTL60s and a5s request timeout bound each provider call. Duplicate network submission remains possible after process loss; this is at-least-once submission, not exactly-once delivery.

`accepted` means the push service accepted the request. It does not prove device receipt, display, reading or Alert review. The fixed Service Worker notification opens the authenticated inbox. API responses/evidence/tokens are not cached offline.

## Production is still gated

The user confirmed production URL/auth are not configured and selected this repository as the core. This change implements the badge and a real protocol sender; it does not approve source semantics or change synthetic records into production data.

| Required input/change | Current state |
| --- | --- |
| Reachable HTTPS domain, gateway/proxy and deployment target | Not configured |
| Trusted production identity/issuer/audience, scopes and real workspace mapping | Not configured; existing Login intentionally still bypasses User/Password validation |
| Approved real source mapping, masking boundary and stable identity | Unverified; cannot infer from synthetic fixtures |
| Production backend bootstrap and supported wire contract | Existing API deliberately supports local/test only; clients also validate synthetic provenance/IDs |
| Real VAPID operator contact and persistent private keys | Awaiting operator contact/setup |
| Consenting real device, browser/provider acceptance and device receipt checks | Not run |

Keep current local/test mode and visible Test label until those gates are met. Removing the production guard, renaming provenance, or importing real records under synthetic identities would not complete integration.

Protocol references: [web-push Node library](https://github.com/web-push-libs/web-push), [browser subscribe API](https://developer.mozilla.org/en-US/docs/Web/API/PushManager/subscribe), [Apple Web Push](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers).
