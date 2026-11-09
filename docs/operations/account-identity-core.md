# Account identity core — P01-08

This batch implements a local/synthetic resolver and tokenizer, a pinned key-provider interface, sanitized golden fixtures and an opt-in worker enrichment stage. It does not certify LMPS account identity, masking, account ownership or historical coverage. The222-row Intake cohort remains unresolved; no account fields or links are manufactured from its six-column source keys.

## Contract and stable identity boundary

`@lmps/contracts/account-identity` defines strict mapping/input/result types. Mappings specify an explicit synthetic namespace, owning institution, mapping version, representation, stability declaration, exact-UTF8 canonicalization and key reference/version. Unknown fields, coercion, non-plain objects, accessors, sparse arrays, cycles and oversized structures are rejected without echoing inputs. The resolver accepts at most32 mappings, and duplicate `(namespace,institution,version)` declarations reject construction, even if their contents match. Mapping objects are detached when constructing the resolver; callers cannot modify its active declarations afterward. This is an immutable registry within one resolver instance, not a durable global version registry.

Only `local_synthetic` input with a matching `synthetic_declared` mapping, both representations explicitly `unmasked`, and a nonempty bounded `synthetic_...` fixture value can resolve. The exact fixture identifier is significant: leading zeros and case are preserved; whitespace is rejected rather than trimmed. Account values and mappings for actual LMPS data are still unverified. `user_supplied_file` provenance always returns `STABLE_IDENTITY_UNVERIFIED` before the resolver inspects the identity input or calls a key provider. Masked/unknown representations are never linked, including two identical masked strings. Unsupported execution environments are refused.

`unresolvedIdentityAccount()` supplies the existing unresolved wire shape. Both real-file and synthetic publishers now use this shared fallback; their persisted transaction/account representation remains unchanged.

## Token and managed key interface

`@lmps/risk` exports `createAccountIdentityResolver(mappings, provider, timeoutMs = 250)` and `createLocalIdentityKeyProvider(keys)`. The latter is an in-memory fixture adapter, using caller-supplied32-byte secret `KeyObject` handles and HMAC-SHA-256. It rejects duplicate key versions and supports terminal revocation within the adapter. It has no key export, persistence, configuration-file loader or network implementation. An adopted managed KMS/HSM provider and its custody/access controls are future work.

The injected `IdentityKeyProvider.mac` interface receives a pinned key ID/version, bounded transient message and AbortSignal; it returns the same key metadata, active status and32-byte digest. A trusted implementation must honor immutable key references, HMAC-SHA-256 semantics and current key-access/revocation policy. Reply validation cannot independently prove a remote provider's cryptographic implementation or custody. The resolver rejects wrong key metadata/status/digest length, catches provider exceptions without their diagnostics, and enforces a1..2000ms deadline even if a provider ignores cancellation. It aborts the request and clears its message buffer on completion/timeout; this is not a guarantee of erasing all runtime copies.

The mapping hash is SHA-256 of recursively sorted JSON object keys. The HMAC message is the UTF-8 JSON array `["account-identity-test-1", mapping_sha256, exact_fixture_value]`. The mapping hash includes the namespace, institution, mapping version, key ID/version, representation, stability and canonicalization. Result tokens use `synthetic_token_` plus64 hex characters; `resolution_version` uses `synthetic_identity_` plus the full mapping hash. Returned accounts conform to the existing Transaction schema.

Same value and same pinned mapping/key produce the same token regardless of sender/receiver role or transaction revision. Namespace, institution, mapping version and key version changes produce separate identities. Rotation never automatically aliases an old token to a new token. Historical relinking/re-tokenization and key migration require a separately reviewed policy and evidence; this module does not merge their histories. Revoking a key prevents subsequent local resolutions with it, without rewriting previously returned evidence.

The sanitized golden vector is `packages/risk/fixtures/account-identity-golden.json`, with explicit invented fixture identifiers and deliberately public all-zero fixture bytes. It pins the full mapping digest and HMAC result. Those deterministic bytes are test-only and never loaded as a deployed key.

## Worker integration

`resolveWorkerTransactionIdentity({ publication, evidence }, resolver)` in `apps/risk-workers/src/account-identity.ts` recomputes the transaction with the existing strict `publicationTransaction` boundary. It derives provenance from that publication and rejects caller-supplied transaction/provenance overrides. Supplied identity evidence must bind transaction ID, revision, source namespace, record reference and the canonical hash (`riskHash`) of the full publication. Changed money/source evidence under the same revision therefore cannot reuse an earlier identity binding.

Missing/foreign/stale evidence returns unresolved accounts without invoking the resolver. Invalid publications/envelopes fail with fixed diagnostics. The sender and receiver resolve independently; one unavailable account cannot borrow the other's token. A user-supplied-file publication always produces unresolved accounts regardless of supplied synthetic-looking identity evidence.

This is a callable, opt-in worker stage. No runtime key configuration, job-dispatch activation or database migration is added. It does not persist an enriched transaction, replace publication evidence or create a RiskContext. The existing publication writer still requires its original recomputed account projection. Account resolution alone does not prove time semantics/history completeness or enable context-dependent detectors; those existing gates remain mandatory.

## Verification and remaining gates

Run the pinned workspace build, then the focused tests:

```sh
pnpm --filter @lmps/risk-workers build
pnpm exec node --test packages/contracts/test/account-identity.test.mjs packages/risk/test/account-identity.test.mjs apps/risk-workers/test/account-identity.test.mjs
```

Tests cover the golden vector, exact identifiers, sender/receiver consistency, scope isolation, mapping immutability, actual rotation/revocation, provider outages/metadata errors/timeout and late replies, source-file refusal, strict publication binding, input privacy, wire-schema validity and retained history/time gates. Test output contains no actual source accounts or secrets.

P01-08 is assessed at0.5/1 on the existing engineering rubric: the core library/interface/worker bridge and fixtures work locally, while target adoption is incomplete. This is a narrow reassessment against its historical0 score, not a refreshed104-item project percentage or production-readiness score. Pending: owner-verified stable identity field and canonicalization; institution/namespace ownership; masking/tokenization boundary and authorized raw-field access; adopted managed-key custody and immutable version governance; durable mapping/rotation/retention policy; approved real-source adapter and historical integration. P01-03 and the account/history-dependent real detector gates remain open.
