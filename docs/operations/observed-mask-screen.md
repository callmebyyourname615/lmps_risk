# Observed bank/mask window screening

The user approved source-profile versioning, bank-scoped masked-representation grouping, four window screens and distribution/backtest/trace on the downloaded October snapshot. This is a separate provisional analysis mode. It does not resolve real accounts, reconstruct historical availability, enable canonical 15-pattern assessments, activate policy or authorize transaction enforcement.

## Declared source profile

`@lmps/contracts/observed-mask` exports frozen `OBSERVED_MASK_SOURCE_PROFILE`, version `bank_mask_snapshot_candidate_v1`. The profile records the user's declarations: frommember/tomember are the respective banks; bank-supplied account masks are stable and mostly equal across roles; amount is major-unit LAK; txtime is occurrence time and requesttime is receipt time in Vientiane UTC+7; the cross-bank-transfer product cap is 200 million LAK. These are user declarations, not independent source-owner verification or evidence that every <=cap row belongs to that product.

Mask uniqueness, universal cross-role consistency, real identity, refund completion/net execution, DRS correction history, known-at and source completeness remain unverified. The source-profile declaration never changes historical mapping/report versions or sets `identity_status=synthetic_declared` on real input.

`@lmps/risk` exports:

- `observedMaskKey`: private HMAC-SHA-256 over exact UTF-8 `["observed-mask-1", bank, representation]`. Equal text from different banks stays separate. Equal bank/text from sender/receiver roles is one **observed group**, not proof of one real account. No trimming, case folding, padding or fuzzy cross-role linkage is performed. Empty/nonprintable endpoint values are withheld; raw masked values are not returned.
- `observedMaskTime`: strict naive DATETIME validation followed by the declared fixed UTC+7 conversion. This is a declared clock interpretation, not recovered known-at history.
- `referenceObservedWindow`: a small independent TS reducer for invented parity cases. It supports up to 1,024 events and is not the full-month runner.

## Cohort and time semantics

The month runner uses valid transfer source rows in the selected requesttime month, LAK with `0 < amount <=200,000,000.00`, literal OK, shouldrevert string 0, no nonempty originalreference DRS marker, printable/nonempty banks and account representations, and txtime in the selected event month. Each exclusion is counted in priority order. Failed/unknown/refund-required/unknown-refund/DRS-marked/over-cap/other-currency/missing-endpoint rows are not silently treated as eligible or safe. All counts remain source observations rather than unique business payments.

Windows are `(anchor−duration, anchor]` at 300, 900 and 3,600 seconds in declared event time. All events for one observed endpoint at the same second are added before evaluating any anchor in that second. Input file/row order therefore cannot create arbitrary tie differences. An anchor earlier than month-start+duration is withheld as warmup; this containment check does not establish complete history. The scope remains a current corrected snapshot. There is no claim that all contributing records were available at the historical anchor time.

For each window:

| Proxy | Metric |
| --- | --- |
| FRAUD_COUNT_VELOCITY | Outgoing source-row count for the sender observed group |
| FRAUD_AMOUNT_VELOCITY | Exact recorded LAK sum for that group; not verified net money |
| MULE_FAN_OUT | Distinct observed receiver groups for that sender group |
| MULE_FAN_IN | Distinct observed sender groups for that receiver group |

Self-equal mask keys are not called verified self-transfers. Role representations that differ are not forced together. Mask collisions can combine real accounts; representation differences can split one account. Distinct observed peers are not true distinct-account counts. A cumulative window sum may exceed 200 million even though every included transaction respects the per-transaction cap.

## Distribution and candidate thresholds

Distributions are weighted by eligible source-row anchors, pooled across all included banks, separately for each proxy and duration. A separate endpoint-window count counts one observed group/second/duration once, regardless of tied transaction anchors. This is not an endpoint-weighted or per-bank calibrated distribution.

The bounded integer histogram preserves eight significant bits. Nearest-rank p50/p90/p95/p99 are reported as enclosing integer intervals, not fake exact quantiles. The exploratory cutoff is one integer unit above the p99 interval's upper bound. Because that boundary aligns with the histogram bins, its tail anchor/window counts are exact. The same dataset chooses and evaluates this cutoff; this is workload exploration, not held-out performance, a production rule or a fraud-accuracy estimate. Counts/cumulative money are exact integers; monetary metric bounds/cutoffs/trace values use integer-cent strings to preserve values above JS safe-integer precision.

Backtest counts distinguish matching source-row anchors and matching observed endpoint windows. A bitset computes the union across all four proxies and three durations by source ordinal. Do not sum overlapping metric counts or reinterpret this union as unique business payments. Canonical core pattern matched counts stay null/not_evaluated.

## Command, private key and outputs

```sh
pnpm --silent dataset:mask-screen \
  --plan /ABSOLUTE/PRIVATE/readiness-plan.json \
  --profile /ABSOLUTE/PRIVATE/MONTH-READINESS/v1/ANALYSIS-ID/report.json \
  --output "$PWD/.local/observed-mask-screen"
```

The output parent and input directories must be owned/private. The prior month report must retain its canonical directory ID, request hash, producer binding and catalog; its exact-input evidence must show no malformed/invalid/duplicate/conflicting source keys. The runner rechecks all source file hashes/rows/headers/bytes while reusing the accepted uniqueness and field-validity evidence. Content bindings do not authenticate source authority or attest an untrusted producer.

The command creates an owned 0600 `.mask-key.json` in the private output base, or reuses and validates it for an exact replay. Keep this file private and retain it for reproducing group commitments. It is an analysis key, not a bank credential, canonical account token or managed identity provider. The key is sent to Python over captured stdin, not command-line arguments/logs, and is never included in report/traces; only a commitment is recorded. A partial/invalid key file is rejected and not overwritten. Different output bases receive different keys.

Under `output/v1/<analysis-id>/`, immutable `report.json` and `traces.json` bind inputs, declared profile, implementations, parity, cohort, distributions, backtest counts and verification receipts. Traces are bounded top examples per proxy/duration and contain observed-group HMACs, UTC seconds under the declaration, exact metric/cutoff strings and source-file/row/key commitments. No raw account representations, bank values, actual references or source paths are stored in scratch/report/traces. This is not a full candidate export.

## Bounded execution and verification

Two source passes construct separate sender/receiver sorted runs. A fixed 84-byte private binary record contains only an observed-group commitment, time, source ordinal, peer commitment and recorded cents. At most 250,000 records are sorted in memory; at most 128 runs are merged without writing a second merged copy. One role's runs are fully removed before the other role starts. Preview merges compute histograms and candidate counts; an independent final merge verifies complete selected trace windows before removing the runs. Selected original source files are then fully rehashed to replay trace anchors and source-key commitments.

Caps: 4,096 source files, 30 million physical rows, existing 64 MiB compressed/decoded per-file bounds, 16 GiB compressed/decoded per source pass, 3 GiB sorted scratch, 1 GiB free-space reserve and two hours. Preflight requires `physical_rows*84 + reserve +64 MiB` free. Rolling state is limited to 500,000 active events per observed group, 100,000 same-second events and two million distinct peer entries across trace replay. An exceeded bound fails without publishing a partial report; there is no silent sampling/truncation. Temporary `.mask-screen-*` progress/sort files are private and removed on handled completion/failure; forced process/machine death can retain private scratch for review. Key material and source exports are not deleted.

TS/Python parity checks the actual endpoint-key, clock and naive window functions before full analysis. Tests exercise ties, exclusive lower/inclusive upper bounds, warmup, bank scope, mask collisions/representation differences without real-identity claims, exact cents, bounded quantile intervals and tail counts, union overlap, source mutation/profile scope, production/resource/privacy refusal and immutable CLI replay. Real run measurements and aggregate findings are recorded in the implementation status. DRS/limit-table extraction and the other patterns remain separate work.
