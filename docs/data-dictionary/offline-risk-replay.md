# No.35.3 — Offline Risk Replay MVP

One complete, reconciled offline staging batch → explicit simulation policy → private deterministic JSON/CSV report. The first evaluator is `offline-amount-screen-1`: **signed raw recorded amount ≥ an explicitly configured threshold for the exact source currency code**. It produces screening candidates, not Fraud/Mule/AML scores, probabilities, canonical Risk Assessments, operational Alerts or payment decisions.

## Run

First follow [CSV profiling](offline-dataset-profile.md) and [import/reconciliation](offline-dataset-import.md). Keep the **canonical batch_ref returned by import** and dataset_sha256 from the private profiler report. Same-file UUID aliases are not additional stored batches. The separately authorized local PostgreSQL runtime must already be prepared through migration0012; implementation/tests do not upgrade the persistent project database.

Place an owner-private0600 JSON file in an owner-private0700 directory, for example `.local/replay-inputs/replay.json`:

```json
{
  "format": 1,
  "execution_mode": "offline_analysis",
  "evaluator_version": "offline-amount-screen-1",
  "run_id": "<new v4 UUID>",
  "workspace_key": "offline_local",
  "batch_ref": "<canonical imported batch UUID>",
  "dataset_sha256": "<dataset_sha256 from the original profile>",
  "policy": {
    "version": "simulation_example_v1",
    "purpose": "simulation_only",
    "amount_semantics": "raw_recorded_amount",
    "amount_unit": "as_recorded",
    "lifecycle_scope": "all_recorded_rows",
    "thresholds": [
      { "source_ccy": "<exact source currency code>", "amount_gte": "100.00" }
    ]
  }
}
```

Replace every placeholder. `100.00` is an invented demonstration threshold, not a business recommendation or confirmed unit. Copy source_ccy literally from the approved private export context; no trimming, case folding, codebook, ISO interpretation, currency conversion or default currency is applied. No account fields enter this policy. A version starts with simulation_ followed by1–60 ASCII letters/digits/underscore/dot/hyphen. Supply1–32 unique source currency codes, each1–200 Unicode characters without controls, and positive decimal strings with at most22 integer digits and exactly2 decimal places. Threshold arrays are sorted by literal currency for deterministic hashing; all other values are preserved.

```sh
pnpm --silent dataset:replay --manifest "$PWD/.local/replay-inputs/replay.json" --output "$PWD/.local/replay-reports"
```

Manifest/output paths must be absolute, with owner-private parent directories. The command creates the private output root if absent, then writes:

```text
replay-reports/v1/<run_id>/replay.json
replay-reports/v1/<run_id>/replay.csv
```

The manifest is limited to64KiB. Nonregular, symlinked, multiply linked, public or oversized input files reject. Local/test execution guards remain mandatory; production/live modes reject. No HTTP endpoint, scheduler, credentials discovery, LMPS connection or new dependency is added. The CLI uses the existing intake credential because app/API/reviewer/outbox roles remain denied raw staging access.

## Verification and evaluation

The reader opens one **REPEATABLE READ, READ ONLY** PostgreSQL transaction. It verifies batch/manifest bindings, internal manifest/identity hashes, requested file fingerprint, complete/matched state and checkpoint, source kind/mode/semantics, then scans500 rows per query. It checks contiguous row numbers, table, strict typed projections, complete unique source keys, every row hash, expected count and the frozen rowset hash. A previous matched status alone is insufficient. Missing/extra/changed rows, inconsistent metadata, incomplete or blocked batches, cross-scope references and storage errors fail before report publication; the reader never repairs or changes staging.

The profile fingerprint selects the file already bound to that staging batch; the rowset fingerprint is read from its frozen manifest, recomputed, and included in the report. There is no claim of source authenticity against a privileged DB owner who can forge all evidence. One read snapshot remains consistent across pages during concurrent updates; later database changes do not alter an already published report.

| Outcome | Meaning |
| --- | --- |
| matched / AMOUNT_AT_OR_ABOVE_THRESHOLD | Raw signed amount is at or above this simulation threshold for the exact configured code |
| not_matched / AMOUNT_BELOW_THRESHOLD | Amount is below this one threshold; this does not establish absence of risk |
| unavailable / CURRENCY_POLICY_MISSING | No threshold is declared for this literal source currency; no negative result is fabricated |
| unavailable / AMOUNT_FIELDS_UNAVAILABLE | The selected member projection has no transaction amount/currency fields |

Transfer/transfer_hist/transfer_old use the same per-record comparison. Amounts and thresholds use integer-scaled BigInt arithmetic, retaining original strings; negative amounts are not converted to absolute values and signed zero stays literal evidence. result/txtime/requesttime are retained in staging but not interpreted by this evaluator. Failed/reversed/unknown-status records are not silently excluded. This is **not** the existing synthetic FRAUD_HIGH_AMOUNT detector, whose net executed/lifecycle semantics require additional verified inputs. History/current tables are never merged, netted or deduplicated as business payments. Member rows remain unavailable; they do not establish account identity.

## Reports, privacy and retries

JSON is the exact evidence artifact. It contains evaluator/profile versions, file/rowset fingerprints, scoped batch reference, source table/namespace, normalized simulation policy and hashes, input hash, counts and all row outcomes. Each result references the batch's1-based row_number and row_sha256, with raw amount/currency, selected threshold and reason. Batch+row reference resolves to the complete staged source key; the report does not duplicate account data or claim verified entities. Input hash includes the run UUID; a second UUID is a separate report run, not semantic job dedup.

CSV includes run/batch/policy/evaluator/purpose/unverified-semantics columns and each row reference/outcome/evidence. All amount, threshold and raw currency cells have a leading apostrophe inside CSV quoting, so spreadsheet programs treat them as literal text rather than formulas or rounded large numbers. JSON retains the exact original values and is the source of truth; CSV is a review presentation, not a lossless import format. Both files are private0600 in0700 directories and each is capped at128MiB. The dataset retains the existing64MiB/100,000-record bound. Reports can contain sensitive amounts/codes: keep them outside Git and approved public logs. The DB backup does not include these files; retain them separately under an approved policy.

The exclusive creator of a run directory writes/fsyncs both pending files, renames them and syncs the directory. A successful CLI result means both files were published. The pair of renames is not one atomic transaction: a crash can preserve a partial directory. An identical retry compares both artifacts and returns duplicate; changed policy/input under the same run ID, tampered/missing artifacts or partial directories fail without replacing evidence. Use a new run UUID after inspecting retained partial output; there is no automatic cleanup/repair or run-status database table. Concurrent publication can return a recoverable error until the first writer finishes. A policy version is an operator label, not an independently enforced policy registry; the recorded policy hash binds the actual thresholds for each report.

Stdout contains only run/batch references, publication/status, mode/semantics/purpose and counts. Errors are fixed codes with private diagnostics withheld; raw values, paths, fingerprints, policies and driver diagnostics are excluded. Use pnpm --silent to suppress argument echo; shell history/process argument visibility remains outside this guarantee.

| Exit | Result |
| --- | --- |
| 0 | Both reports published/verified duplicate; all rows evaluated (complete) |
| 2 | Both reports published/verified duplicate; at least one row unavailable (partial) |
| 1 | Invalid/private-file/config/storage/integrity/publication failure; no success claim |

Complete describes this configured comparison's coverage, not low risk, successful payments or readiness for production. No model, operational Alert/notification, enforcement or production scoring is invoked. Source amount units, status/currency codebooks, timezone, business-payment identity, cross-history overlap and account identity/masking remain unverified.

## Acceptance

Tests use invented private exports and disposable native PostgreSQL only. They cover strict policies and mode gates, exact/signed/maximum money, literal multiple currencies, unavailable member/missing-policy cases, deterministic evidence, spreadsheet-safe CSV, private output/duplicate/conflict/partial/concurrent publication, unchanged DB evidence, post-reconciliation corruption and missing/extra rows, a real concurrent update across the read snapshot, outages, a real100,000-row transfer replay/publication and CSV profile→import/reconcile→replay. Existing shared private report callers retain compatibility coverage. Actual results and remaining gates are recorded in [implementation status](../implementation-status/current.md).
