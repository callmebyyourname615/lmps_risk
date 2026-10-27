# Risk activity calendar — trailing year

User approved the original year heatmap layout on2026-10-27, replacing the earlier monthly UI/API candidate. The Portal starts in2D, with a purple palette, and can morph the same canvas into3D. No month selector or month query remains in the product.

`GET /v1/local/overview/risk-calendar` accepts **no query parameters**. The verified JWT supplies the workspace. All four Overview scopes are required: `transactions:read risk:read alerts:read cases:read`. The response has `Cache-Control: no-store`. The existing `GET /v1/local/overview` summary shape is unchanged.

```ts
type RiskCalendar = {
  provenance: 'local_synthetic';
  execution_mode: 'test';
  workspace_key: string;
  as_of: string; // UTC YYYY-MM-DDTHH:mm:ss.ffffffZ
  timezone: 'Asia/Vientiane';
  metric: 'alerts_created';
  range: 'week_aligned_year';
  start_date: string; // YYYY-MM-DD
  through_date: string; // today in ICT, including its partial day as of as_of
  total_alerts: number; // nonnegative safe integer, sum of days[].count
  days: Array<{ date: string; count: number }>;
};
```

The start is the Sunday on or before the day364 days before today. This matches the supplied contribution component's full starting-week layout:365–371 consecutive calendar dates ending today. Exact dates remain visible beneath the year total. The same SQL statement supplies the observation clock, range and daily counts. Count one stored `local_alerts` row by `created_at`, once per Alert ID; review state does not remove it and overlapping Fraud/Mule/AML groups do not multiply it. Timestamps before the first ICT midnight or after `as_of` are excluded. This is Alert creation volume, not a financial occurrence date, risk score, severity measure or proof of financial-source completeness. Zero means no stored Alert for that day.

The response contains no Alert IDs, account fields, actor identity or raw snapshots. Unknown/repeated/month/range/workspace queries return400 `INVALID_QUERY`; unauthenticated/expired requests401, missing scopes403, storage or projection failures503 `OVERVIEW_UNAVAILABLE`. Storage failures never become an empty-success year.

## Portal integration

- `../LMPS_Risk_Portal/src/components/ui/contribution-skyline.tsx` contains the user-supplied component, with pure helpers extracted into `contribution-skyline-model.ts`. The physical `src/components/ui` folder matches the existing `@/components/ui` alias. React19, TypeScript and Tailwind4 already exist; this component needs no additional runtime dependency or shadcn CLI initialization. The separately supplied `demo.tsx` remains a labeled synthetic demo and is not mounted in Overview.
- `RiskActivityMonitor.tsx` replaces the monthly adapter, always supplies validated API data, starts in2D and preserves the selected view through locale changes/renewal. API loading/error/scope/workspace/expiry remove old scene evidence; no generated sample fills missing API data.
- The renderer retains year total, busiest day, longest streak and current streak. Longest ties select the earliest run; current streak may end yesterday if today is still empty, matching the supplied component. All four numbers derive from the displayed daily bins.
- Global styles remain `src/index.css`; scoped bridges in `src/api-overview.css` map the component's background/foreground/border/muted colors and purple palette onto Overview tokens. Native SVG icons from the supplied component are retained. No photo assets are needed.
- Mobile2D scrolls inside the chart container, keeping the day cells usable; document width does not expand. Keyboard arrows/Home/End, `aria-describedby`, a daily text alternative, hover/tap tooltips, viewport-aware tooltip positioning, orbit/reset and reduced motion remain supported. EN/LO changes labels and date formatting without changing evidence.

## Executed verification

Backend full build/test **143/143 passed**, including six real-PostgreSQL calendar tests for ICT/start/year boundaries, consecutive bins, one-per-Alert counts including reviews, safe workspace/scopes, rejected queries, OpenAPI and actual outage/recovery with unchanged stored Alert fingerprints. Portal full suite **229/229 passed**, including six real-calendar/client/model tests for exact validation, leaked fields, dates/counts, literal transport, zero/foreign workspaces, outage and streak calculations. Final TypeScript and production build passed; existing bundle-size warning remains.

Year Skyline real-browser acceptance **four groups passed**, checking default2D/full year/no month input, visibly purple pixels, four stats, same-canvas morph, actual orbit/reset, keyboard date/count evidence, EN/LO,320/375/414/768px internal scrolling, reduced motion, actual touch selection, independent calendar failure, real DB outage/recovery and scope/workspace/expiry cleanup. Existing Overview browser acceptance **ten groups passed**. Owned disposable cleanup passed, with GET-only business API requests and no browser runtime errors.

The local API/session companion was restarted once for the year contract. Live same-origin8443 authenticated read200, unauth401, obsolete month query400 and OpenAPI GET registration passed. The live range is2025-10-26 through2026-10-27 (367 days), containing one stored Alert on2026-10-23. Counts/full-row fingerprints of eight persistent tables match the pre-restart snapshot. No migration, seed, dependency or persistent business write ran. No real source, account identity/masking, production telemetry or production-capacity readiness is claimed.

Receipts/logs: backend `.local/risk-calendar-verification/year-*`; Portal `output/risk-skyline/year-*`; browser `output/playwright/risk-skyline-year/acceptance.json` and neighboring screenshots, plus existing `output/playwright/overview-api/acceptance.json`. `git diff --check` passed; the pre-existing tracked/untracked baseline is not an exact source/Git scope proof.
