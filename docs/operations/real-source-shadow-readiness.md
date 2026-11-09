# Real-source and shadow readiness

The prepared tool reports missing owner inputs without connecting to a source:

```sh
node_modules/.bin/node tools/source-readiness.mjs
node_modules/.bin/node tools/source-readiness.mjs --input /absolute/private/readiness.json
```

Input is version 1 with exactly nine `gates`: source_permission, source_semantics, identity_masking, historical_availability, reference_authority, security, capacity, dr and release. Each has `status` (pending/attested), an opaque `owner_ref` and `evidence_sha256` (both nullable while pending). The file must be owned, private, regular, single-link and at most 16 KiB. Keep it outside source control. Store references/hashes only; never include credentials, account values or datasets.

Even all-attested input returns `owner_review_required`, with connection/shadow authorization and production readiness false. The tool checks declaration completeness, not whether an owner is authorized or evidence is authentic. Independent evidence review and explicit operational approval remain required.

## Owner review sequence

Use the [source owner review question set](../data-dictionary/source-owner-review.md) to collect scoped semantics, identity and history evidence without including private values in source control.

1. DBA/data owners confirm the read-only source boundary, approved columns, load budget, time/currency/lifecycle codebook and revision semantics.
2. Identity/privacy owners verify stable account identity, namespaces, masking/tokenization boundary and permitted linkage. Similar masked text cannot establish identity.
3. Data/reference owners confirm historical known-at/availability and reference publisher authority, validity, expiry and revocation; unsupported inputs remain unavailable.
4. Security/operations owners review actual identity/scopes, retention/legal, isolated destinations, representative capacity envelope and failure/backup/restore evidence.
5. Reviewers approve a bounded shadow plan with source/feature/policy/model versions, reconciliation counts and amounts by currency, time bounds, stop conditions and rollback. Shadow must have no payment or recipient notification effects.
6. Run the approved read-only trial, retain private evidence, compare expected/observed results, then independently review failures and cleanup before considering a release decision.

Current source/identity/masking and operational inputs remain pending. Synthetic tests and this checklist do not authorize connecting to LMPS or establishing production readiness. The deferred real 2 GB trial is still deferred.
