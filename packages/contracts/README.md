# Draft business contracts — item 4

Version: **`0.1.0-draft.1`**. These are proposed canonical wire shapes, not verified LMPS source mappings or production API endpoints. Only synthetic examples are included. No database, scoring, decision execution or mobile delivery is implemented here.

## One authoring source

Edit `services/ml-inference/lmps_ml/contracts.py`. Pydantic generates standalone JSON Schema 2020-12 documents in `schemas/`; `json-schema-to-typescript` generates the TypeScript types in `src/generated/`. The Node package validates those same schemas with Ajv 2020 and the full `date-time` format check. Do not edit generated schemas or types by hand.

From the repository root:

```sh
pnpm generate:contracts
pnpm test:contracts
```

The first command exports schemas and regenerates types. The second runs Python contract tests, checks generated TypeScript is current, compiles the Node package and runs its contract tests. Full suites remain `pnpm typecheck`, `pnpm test`, and `uv run --locked --directory services/ml-inference python -m pytest`. Root `pnpm test` includes Node packages only; use the Python command for all ML tests.

Node exports `Transaction`, `RiskAssessment`, `Alert` types and `isTransaction`, `isRiskAssessment`, `isAlert` boolean type guards from `@lmps/contracts`. A future consuming workspace must declare `@lmps/contracts: workspace:*` and build it first; no business route consumes it yet. Python imports the models directly from `lmps_ml.contracts`.

## Common wire rules

| Field / concept | Draft rule |
| --- | --- |
| `schema_version` | Required exact literal `0.1.0-draft.1`; unrelated to JSON Schema's `$schema` dialect |
| `execution_mode`, `run_id`, `correlation_id` | Required context; modes are `live`, `shadow`, `backfill`, `replay`, `test`; all fixture examples use `test` |
| Identifiers / versions | Opaque strings, 1–128 ASCII letters/digits/`.`/`_`/`:`/`-`, starting with a letter/digit; numeric JSON values rejected; leading zeros preserved |
| Reason codes | Uppercase ASCII letter followed by uppercase letters/digits/underscores, at most 64 characters |
| Required nullable fields | Must be present; JSON `null` explicitly represents unknown/unavailable data |
| Unknown fields | Rejected, including raw payload/account/device fields |
| Validation | No coercion, default filling or removal of fields; validates JSON wire data, not arbitrary Python objects |

Mode/context fields are **claims, not authorization**. Producers/servers must assign and verify them; a caller selecting `live` never grants delivery or payment authority. Existing HTTP services remain local/test diagnostics and expose no business endpoint. Namespace isolation, durable idempotency and access control are later implementation gates.

## Transaction

This represents a proposed normalized transaction revision, not a raw CDC change or verified unique business payment key.

- `transaction_id` and `transaction_revision` identify the proposed projection and revision. Stable business identity, retry/history deduplication and revision ordering need source evidence; strings are not ordered lexicographically as source versions.
- `source_reference` carries a namespace, opaque record reference and nullable mapping version. No DDL column, composite key or bank-code mapping is invented here. An opaque reference is neither a raw payload nor proof of uniqueness.
- `occurred_at` is nullable when event time is unknown. `observed_at` records actual observation; extract time must not be presented as historical availability. Timestamps use a bounded wire profile: UTC uppercase `Z`, four-digit years 1000–9999, seconds 00–59 and optional 1–6 fractional digits. Offset/local times require verified conversion before serialization; invalid calendar dates are rejected in both languages.
- `amount` is a nonnegative decimal **string** without exponent, separators, whitespace or leading zeros other than zero itself; at most 80 characters. Zero is structurally allowed. Precision is preserved; no currency minor-unit or PostgreSQL numeric precision decision is implied. This is a proposed magnitude representation; reversal direction and signed-source amounts need confirmed mapping.
- `currency` checks three uppercase letters only, not membership in a verified currency codebook. No FX conversion or cross-currency aggregation occurs.
- Source/destination bank IDs, type and channel can be null. Routing participant IDs must not be silently promoted to account-owning bank IDs.
- Status is proposed `unknown/pending/succeeded/failed/reversed/partially_reversed`; LMPS codebooks and executed-funds semantics remain unverified.

### Accounts

`unresolved` carries only source representation (`masked/unmasked/unknown`) and a reason code. A full-looking account value does not itself prove stable identity. Raw account numbers, masked display strings and token generation are absent from this shared contract; restricted ingestion of actual source fields requires its own mapping/security work.

`resolved` requires namespace, owning institution, account token and resolution version. This validates structure only: a trusted resolver must verify token provenance, uniqueness, sender/receiver linkage and permissions. Putting masked text into a token field does not create verified identity. The resolved example is invented and uses the same token for both roles to demonstrate that roles are not part of account identity; no real token system is claimed to exist.

## Risk assessment

Each assessment references a transaction **and revision**, assessment timestamp, nullable feature/vendor references, triggered rules and three independent components: `fraud_score`, `mule_network_score`, `aml_suspicion_score`.

| Component state | Required meaning |
| --- | --- |
| `not_evaluated` / `unavailable` | `value=null`, reason code and nullable engine version; omission or zero is not substituted for missing |
| `available`, `meaning=risk_index` | Numeric value within 0–1, engine version, `calibration_version=null`; not a probability |
| `available`, `meaning=calibrated_probability` | Numeric value within 0–1, engine version and nonempty calibration version |

The unit interval is a proposed transport scale, not a calibration method. Raw vendor/model values require a reviewed adapter and score definition. A calibration reference is metadata, not evidence that calibration is valid; target definitions, model cards, label maturity, evaluation and approval remain future gates. Scores must not be averaged across dimensions by this contract.

The decision is either `not_decided` with null action/policy and reasons, or `decided` with `allow/review/step_up/hold/block`, a policy version and reasons. Rule-only decisions may coexist with unavailable ML components. This is a record of a proposed policy result; it does not authorize payment enforcement. Binding, expiry, authority, input hashes, immutable persistence and reassessment rules are later work. Contract validation does not check referenced artifacts exist.

## Alert

An alert references its assessment, transaction/revision, creation time, severity (`low/medium/high/critical`), one or more unique risk dimensions, reason codes, alert policy version and evidence references. Those references must be checked by future storage/service logic, including institution/run/mode scope; JSON validation alone does not enforce relational integrity or prevent a forged assessment link.

Severity and example scores are invented. No high-risk threshold is chosen. An alert is not a delivery receipt or a push payload, and it has no device token/recipient/account number. Recipients, inbox, authentication, notification policy, outbox/retries and FCM/APNs are later work. No score or alert establishes wrongdoing.

## Synthetic corpus and drift checks

`fixtures/corpus.json` contains three independent base examples and 83 named cases: 15 accepted, 68 rejected. Each case chooses a base, replaces whole top-level fields with `set`, and removes fields listed in `omit`. This small fixture convention is not JSON Patch. Expected outcomes are authored independently of the validators and consumed unchanged by both test suites.

Tests cover missing fields versus null, string money/IDs beyond JavaScript safe precision, strict scalar types, unavailable versus zero scores, calibration/policy metadata, unknown fields, unresolved/resolved shapes, real calendar dates, and duplicate alert dimensions. Python checks generated schemas against the authoring models; Node checks generated types against those schemas. These checks establish parity for the corpus, not mathematical equivalence for every possible input or production safety. No example is a confirmed fraud/mule/AML label.

For changes: edit the authoring models, update independently expected fixtures, regenerate, run both suites and inspect schema/type diffs. Bump the draft version when wire shape or meaning changes; do not reuse a published version for incompatible semantics. Version history/compatibility with deployed consumers, registry/Avro and schema migration gates remain pending.

## References

- [Pydantic JSON Schema generation](https://docs.pydantic.dev/latest/concepts/json_schema/)
- [Ajv JSON Schema dialects](https://ajv.js.org/json-schema.html)
- [Ajv formats](https://ajv.js.org/packages/ajv-formats.html)
- [JSON Schema to TypeScript](https://github.com/bcherny/json-schema-to-typescript)

## Source design fixtures — item 7

`fixtures/source-mapping.json` adds ten shared wire cases (six accepted/four rejected), five numeric-boundary examples and four scoped-source-key counterexamples, separately from the original 83-case corpus. Python `tests/test_source_mapping.py` checks the proposed mapping against offline DDL metadata and the existing Pydantic contract; Node `test/source-mapping.test.mjs` checks the ten wire cases with the existing Ajv validator. Both are included in `pnpm verify:offline`/`pnpm verify`; the existing focused `pnpm test:contracts` runs the original Python contract file only, while the Node package runner includes both test files. No generated wire schemas/types or versions changed.

See [source mapping and unknown handling](../../docs/data-dictionary/source-mapping.md). Fixture values/handles/currency assumptions are invented and do not perform source conversion or authorize canonical emission. Source numeric range/scale and currency membership are narrower semantic gates than the wire shape. A passing draft transaction does not establish a payment, account, codebook or live source identity.

## Offline dataset contracts — No.35.2

No.35.2 adds the separate `@lmps/contracts/offline-dataset` subpath: strict file manifest/row validators, source projections and limits, plus fixed offline operational errors. Its server-side helpers retain source values as strings/null without publishing canonical payments or changing generated Transaction/RiskAssessment/Alert schemas. Python/Node row parity is exercised through the actual private CSV bridge. [Offline staging contract](../../docs/data-dictionary/offline-dataset-import.md).

## Synthetic lifecycle definition — No.25.1

The [versioned codebook](../../docs/data-dictionary/synthetic-lifecycle-codebook.v1.json) is a JSON definition, with [usage and boundaries](../../docs/data-dictionary/synthetic-lifecycle-codebook.md). fixtures/synthetic-lifecycle.json contains12 lifecycle examples,7 exact-amount boundaries and invalid/unknown code values. The package's existing test runner includes22 new definition/wire-consistency tests; no export, authoring model, generated schema/type or dependency changed. Runtime context/input/evidence enforcement belongs to the next normalizer item, not to these test-only fixture assertions.

## Offline replay contracts — No.35.3

`@lmps/contracts/offline-replay` supplies strict simulation-only input/policy, evaluator version, typed report/outcomes, bounded artifacts and fixed errors. It pins an offline batch/file fingerprint and requires exact currency codes with positive decimal thresholds; no source codebook, lifecycle or currency conversion is inferred. This leaves generated canonical schemas and existing synthetic-only contracts unchanged. [Replay policy and reports](../../docs/data-dictionary/offline-risk-replay.md).
