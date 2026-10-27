# Synthetic normalizer — No.25.2

normalizeSynthetic(input) in apps/risk-workers/src/normalization.ts is a synchronous, side-effect-free local/test classifier using the [v1 lifecycle codebook](synthetic-lifecycle-codebook.v1.json). It reads the bundled codebook once at module load. Calls perform no file/database/network writes, generate no IDs/timestamps and do not mutate input. Identical input under the same permitted environment produces the same outcome. Production/nonlocal/live process contexts are rejected before consuming input.

This is a bounded synthetic envelope, not LocalSourceEvent, a snapshot row, a canonical Transaction or an API. No importer calls it. [No.25.3](synthetic-normalization-pipeline.md) now adapts frozen local snapshots with separately declared synthetic evidence, without rewriting private spools or widening column grants; absent semantic evidence stays unknown.

## Input profile

| Field | Rule |
| --- | --- |
| format / provenance / execution_mode | Required exact 1 / local_synthetic / test |
| codebook_version | Required exact synthetic-lifecycle-0.1.0-draft.1; unsupported versions are invalid context |
| source_reference | Required namespace matching synthetic_[a-z0-9_]{1,40} and opaque record_ref of1–80 ASCII letters/digits/._:- starting with a letter/digit; preserve leading zeros |
| observed_at | Required actual caller-provided observation timestamp in YYYY-MM-DDTHH:mm:ss.SSSZ format; calendar-checked, not generated or reconstructed as historical availability |
| operation_code / status_code / reversal_code | Optional nullable strings, at most200 characters, matched exactly against the codebook; missing/null/empty/unrecognized means unknown; non-string or oversized values are invalid |
| amount | Optional nullable exact fixed-two-decimal magnitude string, at most22 integer digits without leading zeros except zero itself; required for a payment candidate; zero allowed without reversal |
| currency | Optional nullable raw literal using1–200 ASCII letters/digits/._:-; required/nonempty for a payment candidate; no ISO/minor-unit/FX claim or mapping |
| source_time | Optional nullable naive YYYY-MM-DD HH:mm:ss; valid calendar only, no timezone conversion. Missing is explicit; provided empty/malformed time is invalid |
| synthetic_payment_ref | Optional synthetic_ handle with1–70 ASCII letters/digits/._:- after the prefix; required for any non-none reversal; not a verified LMPS payment/account identity |
| reversal_evidence | Optional nullable object with exactly original_payment_ref and events. Evidence fields are synthetic declarations, not externally verified provenance |

An event has exactly event_ref (synthetic_ handle), amount (exact positive amount), currency (raw literal) and completed (boolean or null). At most100 events and32KiB serialized envelope are accepted. The amount scale/width belongs to this bounded synthetic envelope version, matching the existing local two-decimal fixture profile; it does not confirm actual source units/currency semantics. Unknown input fields, including raw account/source flags, are rejected. No number coercion, abs(), rounding, trimming or case folding occurs.

## Outcomes

All outcomes include normalizer/codebook version, local_synthetic/test markers, canonical_emission=false, state, stable reason_codes, a validated source_reference when available, record_kind, time, candidate and raw.

- known payment: candidate status and exact amount/raw currency; account_identity remains unresolved. No business/account entity or execution decision is created.
- known lookup: candidate=null, including successful lookup and lookups with no amount/currency.
- unknown: candidate=null. Examples include missing/unrecognized/explicit-unknown codes, missing payment money/currency, original link or completion proof. No default success/no-reversal is supplied.
- invalid: candidate=null. Examples include bad context/shape/types, invalid money/calendar, contradictory known lifecycle, link/currency mismatch, changed event reuse or bad reversal amounts.

Shape/context failures return raw=null; arbitrary extra fields are not echoed. Once the bounded envelope shape is accepted, raw is a detached copy retained for known, unknown and semantic-invalid results. Caller-owned input is never changed. Reasons contain fixed codes, not raw values or exception details. Raw/time/amount evidence remains private and must not be logged or returned through an unapproved endpoint. The caller must retain rejected source evidence through its existing approved storage controls; this module persists nothing.

For valid naive time, source_time is preserved, source_timezone=unverified and occurred_at=null; its quality is naive_unverified. Missing time has quality=missing. This uncertainty does not prevent a known synthetic lifecycle classification, but canonical emission is always disabled. Observation time is never substituted for occurrence time.

## Reversal evidence and replay

Non-none reversal applies only to a succeeded original payment; pending/failed originals and lookup reversals are invalid. Unknown original status stays unknown. Requested/failed reversal requires an explicit original synthetic payment handle and preserves succeeded status without a reversal amount. Completion evidence on a non-completed code is rejected rather than silently ignored.

Partial/full completion requires a matching original_payment_ref, nonempty events, completed=true on every event, a positive original amount and positive event amounts in the exact same raw currency. Unconfirmed/null completion holds the candidate as unknown. A mismatch is invalid. Partial requires0 < cumulative < original; full requires cumulative=original>0. The sum uses BigInt scaled to the envelope's two decimals; the original amount string is preserved.

Within this one original-payment envelope, identical event_ref/evidence repeats count once. Reusing an event_ref with a changed amount/currency/completion value is a conflict and withholds the entire candidate. Raw duplicates are retained; no input row is rewritten. Event order does not affect the candidate. Independent observations/calls are never added together: each result describes cumulative evidence supplied in that call. There is no persistent cross-call, cross-original or cross-namespace deduplication/identity resolver. No.25.3 publishes observation reports only; later business storage must provide a reviewed protocol before consuming any result as business effects.

## Use and checks

Build with pnpm --filter @lmps/risk-workers build, then import normalizeSynthetic from apps/risk-workers/dist/normalization.js. The exported TypeScript SyntheticNormalizationInput and NormalizationOutcome describe the local profile. Calls accept unknown so runtime validation still checks JavaScript/JSON callers. No.25.3 adds a separate offline source:normalize CLI; the function has no business HTTP endpoint, package export, migration, dependency or runtime configuration.

Focused check: pnpm --filter @lmps/risk-workers exec node --test test/normalization.test.mjs after building. Root pnpm test / verification discover the tests automatically. Tests cover shared golden cases, code/type/context rejection, exact large-money/reversal boundaries, original/currency/completion conflicts, event-local dedup, naive-time uncertainty, bounds, replay, detached frozen inputs and zero source/network calls. Full verification evidence is recorded in [Implementation Status](../implementation-status/current.md).

The [real-source mapping gates](source-mapping.md) and [missing inputs](../../../plan/09-missing-inputs-and-foundation-readiness.md) remain unverified. No risk rule, model score, payment enforcement, verified account graph or production capacity claim follows from a known synthetic outcome.
