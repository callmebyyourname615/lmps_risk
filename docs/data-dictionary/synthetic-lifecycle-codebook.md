# Synthetic lifecycle codebook — No.25.1

Version: synthetic-lifecycle-0.1.0-draft.1. The [JSON codebook](synthetic-lifecycle-codebook.v1.json) is the definition source; [golden fixtures](../../packages/contracts/fixtures/synthetic-lifecycle.json) supply independently authored examples. No.25.1 defines the book and its examples, No.25.2 adds a [local normalizer](synthetic-normalizer.md), and No.25.3 adds [frozen-snapshot integration with explicit synthetic evidence](synthetic-normalization-pipeline.md). No actual source mapping is selected.

All codes are invented and apply only to explicitly synthetic test context with this exact version. operation_code, status_code and reversal_code are fixture attributes, not selected LMPS columns. No mapping from result/txtype/totype/qrtype or flags is approved. Existing snapshots and source-mapping fixtures retain their raw values and unknown status.

## Operation and original status

| Synthetic code | Definition |
| --- | --- |
| SYNTH_PAYMENT | Candidate payment observation; not proof of stable business/account identity or executed funds |
| SYNTH_LOOKUP | Lookup/request observation; successful lookup never becomes a payment or contributes payment amount/velocity |
| SYNTH_PENDING | Original synthetic payment/request is pending |
| SYNTH_SUCCEEDED | Original synthetic operation succeeded; the operation must still be a payment before considering payment semantics |
| SYNTH_FAILED | Original synthetic operation failed |
| SYNTH_STATUS_UNKNOWN | Explicit unknown original status |

Amount zero, table name, row PK and source history membership cannot distinguish lookup from payment. A payment observation does not establish whether two rows/attempts belong to one business payment. No attempt/executed/reversed counters, risk score or accounting totals are produced by this book.

## Reversal

| Synthetic code | Meaning and candidate original-payment status |
| --- | --- |
| SYNTH_REVERSAL_NONE | Explicitly no reversal in this synthetic example; preserve original status |
| SYNTH_REVERSAL_REQUESTED | Requested only; preserve original succeeded status, no completed-reversal contribution |
| SYNTH_REVERSAL_FAILED | Reversal failed; preserve original succeeded status, not failed original payment |
| SYNTH_REVERSAL_PARTIAL_COMPLETED | Candidate partially_reversed only after every completion requirement passes |
| SYNTH_REVERSAL_FULL_COMPLETED | Candidate reversed only after every completion requirement passes |

Any non-none reversal requires a linked original synthetic payment whose original status is succeeded. Lookup plus reversal, or a reversal attached to an original pending/failed payment, is a contradictory known combination: mark invalid and preserve the source observation. Missing linkage or completion evidence is unknown; withhold the candidate instead of assuming reversal success.

Completion requires an explicit original synthetic payment link, successful original payment, actual completed-reversal evidence, same currency, positive original amount, a positive cumulative reversed amount not exceeding the original and deduplicated reversal events. Partial means 0 < cumulative < original; full means cumulative = original > 0. Compare exact decimal strings using exact arithmetic; no rounding, floating point, abs() or FX conversion. These are cumulative amounts per original synthetic payment, not deltas to apply again for every observation. Replayed/history rows do not prove a new reversal.

originalreference, shouldrevert, isreconciled, issettled, negative amounts, source DELETE and history-table membership alone are not completion evidence. Settlement/reconciliation and risk remain separate dimensions. Even a completed synthetic code alone cannot satisfy the required link/amount/currency/dedup checks. Actual LMPS lifecycle/history/settlement codebooks remain unverified.

## Unknown, invalid and version rules

Match exact strings only: no trim, case folding, coercion or numeric-code conversion. Missing, null, empty, whitespace, unrecognized strings and earlier RAW_RESULT/SYNTHETIC_OK values mean unknown. Other scalar/object/array types are invalid input. The definition contains no default success or default no-reversal value. Unsupported codebook version or non-synthetic/non-test context is invalid context; no real-source use is authorized by a caller-supplied mode.

Preserve original raw input with its existing access controls. Unknown/invalid means a data-pipeline disposition, not a payment hold/block. Future normalization must retain codebook version and source reference and distinguish unknown from invalid. A semantic change requires a new codebook version and fixtures; it does not silently redefine the draft Transaction wire contract.

## Verification and remaining work

The existing contracts runner checks raw-code membership, candidate status compatibility with the existing Ajv Transaction validator, lookup/reversal separation, source gates remaining UNVERIFIED and exact large-amount examples. These are definition/fixture checks, not an implementation of the normalizer, evidence resolver, deduplication or production lifecycle state machine.

Run pnpm --filter @lmps/contracts test from the repository root for definition checks. The [No.25.2 normalizer](synthetic-normalizer.md) and [No.25.3 pipeline](synthetic-normalization-pipeline.md) enforce local envelope/evidence rules and frozen-source binding. No actual source mapping, dependency, migration, source column grant or business API is added. [Source mapping gates](source-mapping.md) and [missing real inputs](../../../plan/09-missing-inputs-and-foundation-readiness.md) stay open.
