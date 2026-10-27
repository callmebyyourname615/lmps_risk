# Synthetic transaction risk — No.31

Shared bounded monitoring evaluator for the new platform. No service, external library, trained model or real-source connection is added. All15 detectors execute on explicit synthetic fixtures; current source rows do not acquire verified account identities through this module. Production activation, continuous features and payment decisions remain pending.

`@lmps/contracts/transaction-risk` exports the strict request/observation schema and result types. `@lmps/risk` exports `validateRiskRequest`, `evaluateTransactionRisk`, `RiskError`, the bilingual catalog and presentation helpers. The existing draft Python/TypeScript `RiskAssessment` contract and No.29/30 backtest interfaces are unchanged; the new bounded synthetic response is a separate versioned contract.

## Input and temporal scope

The exact runnable synthetic request/policy/context is in [fixtures/request.mjs](fixtures/request.mjs). The proof-bound source fixture is [transaction-risk.mjs](../database/test/fixtures/transaction-risk.mjs). Request fields are `format`, `provenance=local_synthetic`, `execution_mode=test`, `workspace_key=synthetic_local`, explicit run UUID, namespace/transaction/revision target, nullable policy and nullable context. Unknown fields, executable expressions, numeric money, foreign workspaces and production/live mode reject.

A policy explicitly declares a synthetic ID/version, currency,1–86400-second window,1–30 baseline windows, graph depth2–5, minimum amount, synthetic structuring ceiling, near-ceiling basis points, severity cutoffs and exactly one enabled/disabled configuration for every catalog code. Each rule has threshold, weight1–10000 and signal severity. There is no production default policy. All amount strings have exactly two decimals; count/basis-point thresholds are positive integer strings. This profile does not support other minor-unit precisions or FX conversion.

A context binds to the exact target and SHA-256 of its validated source revision. It explicitly declares synthetic account identities, UTC millisecond event/availability times, history coverage and an optional versioned synthetic flag set. This does not resolve the source's sender/receiver or validate any real account token. Scope is executed monitoring: pending/failed/fully reversed/zero-net target observations are not applicable; pre-transfer attempts/decisions need their own later contract.

The evaluator filters `available_at <= as_of` before selecting each payment's highest declared revision. Identical same-revision duplicates deduplicate; conflicting copies reject. Latest revisions replace contributions rather than add deltas. Net executed amount is original minus cumulative declared reversal; pending/failed/full reversal contribute zero. Current windows are `(target_time-window,target_time]`; baseline windows precede the current window. Future/late-unavailable observations and other currencies do not contribute. Paths require strictly increasing event times, distinct accounts and inclusion of the pinned target payment. Equal-time edges are not used to invent an order.

The target context must match the source amount, status, reversal, currency, revision fingerprint and source observed time. Missing context/identity/coverage, empty or zero baselines, missing flags and exhausted graph budget produce explicit unavailable reasons. Source business time is never inferred from its naive timestamp fields. `as_of` is an explicitly declared synthetic observation boundary, not reconstructed production point-in-time evidence.

## Detector definitions

All comparisons are `metric >= configured threshold`. The exact English/Lao definitions, trigger conditions, prerequisites, units and limitations are in [src/catalog.ts](src/catalog.ts) and the authenticated catalog API.

| Code | Dimension | Metric |
| --- | --- | --- |
| `FRAUD_HIGH_AMOUNT` | Fraud | Target net executed amount |
| `FRAUD_COUNT_VELOCITY` | Fraud | Sender's outgoing executed-payment count in the window |
| `FRAUD_AMOUNT_VELOCITY` | Fraud | Sender's outgoing net-amount sum in one currency |
| `FRAUD_NEW_COUNTERPARTY` | Fraud |0/1 indicator for no earlier executed sender→receiver payment in covered history |
| `FRAUD_AMOUNT_DEVIATION` | Fraud | Target amount / prior mean outgoing amount, in basis points |
| `FRAUD_FREQUENCY_DEVIATION` | Fraud | Current count / mean count per equal baseline window, in basis points |
| `MULE_FAN_IN` | Mule network | Distinct senders paying the target receiver |
| `MULE_FAN_OUT` | Mule network | Distinct receivers paid by the target sender |
| `MULE_RAPID_PASS_THROUGH` | Mule network | Sender's outgoing sum since its first earlier receipt / received sum; minimum receipt applies |
| `MULE_NETWORK_CYCLE` | Mule network | Longest bounded time-ordered cycle closed by the target payment |
| `MULE_FLAGGED_NEIGHBOR` | Mule network | Distinct flagged direct counterparties of the target endpoints in the supplied synthetic flag set |
| `AML_STRUCTURING_PATTERN` | AML | Count of sender payments near/below the configured ceiling, with total at least the ceiling; target must belong |
| `AML_REPEATED_HIGH_VALUE` | AML | Count of outgoing payments meeting the minimum amount; target must qualify |
| `AML_MULTI_HOP_FLOW` | AML | Longest bounded time-ordered simple account path ending in the target payment |
| `AML_NETWORK_DEVIATION` | AML | Current distinct outgoing receivers / mean distinct receivers per prior equal window, in basis points |

Network searches allow at most5000 edge checks per detector and depth at most5; a limit yields unavailable, not an incomplete negative finding. Input is at most384 KiB/200 history observations/200 flags. Features use exact BigInt cents and integer ratios. Ratio division rounds down;10000 basis points means1× baseline. Coverage is a synthetic declaration, not a source-completeness certification.

## Scores, severity and response codes

Each of Fraud/Mule/AML gets its own score, coverage and reason. For enabled, applicable evaluated rules:

```text
index = sum(weights of triggered rules) / sum(weights of evaluated rules)
```

The result is a policy-weighted binary-signal `risk_index`, truncated to six decimals, not a probability, calibrated confidence or crime classification. If an enabled required detector is unavailable, that dimension's value remains null. All-disabled/no-policy/no-applicable dimensions are not_evaluated/null. Severity is computed from the supplied ordered policy cutoffs; individual triggered findings retain their configured signal severity. Correlated signals are not interpreted as independent evidence or averaged across risk dimensions.

Every result contains an assessment/run ID, explicit target revision, as-of boundary, policy/catalog/engine versions, input/source/feature fingerprints, all15 findings and triggered `risk_types[]`. Findings include stable reason codes, metrics/thresholds, severity and bounded revision evidence references. A transaction may trigger several dimensions. Assessment-level `reason_codes[]` summarizes the finding reasons.

| Business response code | Meaning |
| --- | --- |
| `RISK_SIGNALS_DETECTED` | Applicable configured scope evaluated with one or more signals |
| `NO_SIGNAL_IN_EVALUATED_SCOPE` | No signal in the evaluated scope; not a safety guarantee |
| `RISK_ASSESSMENT_PARTIAL` | Some inputs are unavailable; known signals remain visible |
| `RISK_ASSESSMENT_UNAVAILABLE` | Configured detectors cannot be evaluated |
| `RISK_NOT_EVALUATED` | No policy or all detectors disabled |
| `RISK_NOT_APPLICABLE` | Payment/currency is outside enabled monitoring scope |

These codes are separate from HTTP status and source/payment response codes. Partial/unavailable results are successful reads, not HTTP errors or instructions to allow/block a payment. `decision.status=not_decided`, `action=null`, `enforcement=false` and `canonical_emission=false` always hold.

## Lao and English

Language tag `lo` is Lao and `en` English. `la` is accepted only as an application compatibility alias for the earlier plan wording. No header defaults to Lao; language/region preferences use quality ordering; unsupported/malformed preferences fall back to English. Machine codes, score values, metric evidence, policy and core fingerprints are language-independent. Human labels/reasons/conditions/limitations and API error messages are localized at read time, never stored as a second assessment.

`localizedRiskCatalog(locale)` supplies dimensions, units, statuses, score meaning, all risk definitions and code definitions for future Portal/Mobile use. `localizeRiskResult` adds human text to an immutable core. The current legacy Portal and Python diagnostics are not translated by this backend batch. Lao text needs review by a fluent product/risk reviewer before release; automated coverage checks do not establish translation quality.

## Reference context and limits

The observable-pattern vocabulary was checked against primary guidance: [FFIEC red flags](https://bsaaml.ffiec.gov/manual/Appendices/07) and [Europol money muling](https://www.europol.europa.eu/operations-services-and-innovation/public-awareness-and-prevention-guides/money-muling). Those sources do not approve these algorithms, weights, thresholds or a Lao production policy. Definitions and metrics here are explicit prototype design choices. No statutory reporting amount, sanctions screening, PEP/KYC decision, terrorism-financing classifier or guarantee of detecting every fraud technique is claimed.

See [ADR-0010](../../docs/architecture/adr/0010-bilingual-transaction-risk.md) for storage/API/worker operations and actual verification boundaries. Synthetic test success does not establish production accuracy, real identity coverage, continuous recovery or pre-transfer safety.

## No.32 — Alert projection

The shared module now exports strict alert policy/generation/review validation, `projectAlert`, review-ledger validation and Lao/English alert text. Selection uses original triggered finding severity and explicit policy codes/partial inclusion; it never converts a null dimension score to zero or changes the frozen result. Review outcomes are analyst opinions, not verified crime labels. [Full manifest/API/audit contract](../../docs/architecture/adr/0011-local-alert-review.md). No external dependency or trained model was added.

## No.36.1 — Policy lifecycle and comparison

Shared strict policy command validation and read-only two-policy replay reuse this evaluator. Policies keep all15 typed detector definitions, exact thresholds and separate non-probability indices. See [ADR-0013](../../docs/architecture/adr/0013-local-risk-policy-lifecycle.md) for lifecycle, scopes, approved enqueue and synthetic-only limits.
