# Local synthetic core acceptance

This acceptance exercises the opt-in core detection runtime using invented data and a disposable PostgreSQL cluster. It covers the identity resolver, checkpoint journal, P04 feature reconstruction, existing fifteen-detector evaluator, candidate projection and read-only policy comparison in one pipeline. It is not evidence of LMPS source semantics, production identity, production Alert integration, capacity or model accuracy.

Run from the repository root:

```sh
pnpm --filter @lmps/risk-workers build
node --test packages/contracts/test/feature-catalog.test.mjs packages/risk/test/risk.test.mjs packages/risk/test/policy-lifecycle.test.mjs packages/risk/test/feature-risk.test.mjs packages/risk/test/feature-risk-alerts.test.mjs apps/risk-workers/test/core-detection-native.test.mjs
```

The native fixture publishes five distinct synthetic transactions across an invented baseline and current window. Tokens, checkpoint, assessment and candidate are persisted together. The independent expected results for the final transaction are:

| Detector | Status | Observed value |
| --- | --- | --- |
| FRAUD_HIGH_AMOUNT | triggered | 900.00 |
| FRAUD_COUNT_VELOCITY | triggered | 3 |
| FRAUD_AMOUNT_VELOCITY | triggered | 2650.00 |
| FRAUD_NEW_COUNTERPARTY | triggered | 1 |
| FRAUD_AMOUNT_DEVIATION | triggered | 90000 basis points |
| FRAUD_FREQUENCY_DEVIATION | triggered | 60000 basis points |
| MULE_FAN_IN | not triggered | 1 |
| MULE_FAN_OUT | triggered | 3 |
| MULE_RAPID_PASS_THROUGH | triggered | 14722 basis points |
| MULE_NETWORK_CYCLE | not triggered | 0 |
| MULE_FLAGGED_NEIGHBOR | unavailable | `FLAGS_UNAVAILABLE` |
| AML_STRUCTURING_PATTERN | triggered | 3 |
| AML_REPEATED_HIGH_VALUE | triggered | 3 |
| AML_MULTI_HOP_FLOW | triggered | 2 |
| AML_NETWORK_DEVIATION | triggered | 60000 basis points |

The fixture has no flagged-account evidence, so the flagged-neighbor detector is withheld. The individual detector suite separately checks all fifteen detector thresholds, but does not establish that unavailable real inputs exist. Fractional risk indices survive checkpoint serialization and restart; the feature-input validator still rejects fractional numbers by default. The test verifies a replayed revision retains its candidate identity, and that a candidate policy changes the high-amount finding without activation or alteration of the committed baseline. Other native cases cover key revocation, masked identity, stale/incomplete context, correction and cumulative reversal, conflicting offsets, concurrent workers, process death before and after commit, and backup/restore.

The journal persists a local candidate alongside each assessment. Inbox publication is explicitly opt-in; normal consumption does not publish. For an isolated local/test runtime, with the intake DSN supplied privately through the existing environment, the CLI can publish committed synthetic candidates:

```sh
node apps/risk-workers/scripts/core-detection.mjs --config /absolute/private/config.json --input /absolute/private/deliveries.json --output /absolute/private/new-output.json --publish-inbox
```

Config, input and output must follow the CLI's private-file requirements; the output must not already exist. Do not put a DSN, key bytes, account values or actual source data in the command, source control or logs. `publishCandidate(index)` is the corresponding opt-in runtime method. It reconstructs the committed prefix, verifies the assessment and candidate, and the database rechecks the pinned checkpoint before re-evaluating the assessment. Risk and Inbox alert commit in one transaction; concurrent or repeated publication returns the existing alert. Candidate ID and Inbox alert ID have different purposes and need not match. If a later candidate fails, earlier committed publications remain and can be retried idempotently with a new output path. Real-file provenance and duplicate checkpoint entries are refused by the publisher.

This path uses the existing local Alert Inbox repository. A disposable native integration test confirms the published synthetic alert is readable through the authenticated Inbox API and denied without `alerts:read`. A separate browser acceptance exercises six core-published synthetic alerts through the actual API and Portal, including pagination, fifteen findings, bilingual evidence, outage/recovery and mobile layout. With the sibling `LMPS_Risk_Portal` dependencies and Chrome installed, set `LMPS_PLAYWRIGHT_MODULE` to an absolute path to an installed `playwright-core/index.mjs`, build the workspace, then run:

```sh
node tools/core-inbox-browser.mjs
```

The command creates an isolated temporary PostgreSQL cluster and uses ephemeral API and Portal ports. All Portal proxy targets are redirected to the isolated API. It writes a synthetic screenshot and receipt in a new private `.local/core-inbox-browser-*` directory and removes the temporary cluster. No project database is used. This manual browser check is not part of `verify:fresh`, which does not copy the full sibling Portal. The path does not establish a production notification path. A policy comparison is a synthetic replay, not an approved production policy. Source-owner identity/masking, source lifecycle and timestamps, historical coverage, flag authority and per-currency policy remain unverified. The real source and existing production-like runtimes are not accessed by these tests.
