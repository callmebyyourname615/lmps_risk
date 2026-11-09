# Synthetic risk-reference evaluation

`@lmps/contracts/risk-reference` validates a bounded `synthetic-risk-reference-1` request. `evaluateRiskReferences` from `@lmps/risk` evaluates up to 100 declared entries without IO. All subjects, sources and identifiers are synthetic. Source payload/evidence hashes are supplied references, not independently verified publisher signatures.

An entry declares reference ID/version, risk dimension, namespace/subject ID, match precision, known-at, validity interval, optional revocation and evidence hash. The evaluator selects the highest version known at the query's as-of, before testing validity/revocation, so an expired or revoked replacement never resurrects the prior active version. Validity is `[valid_from, valid_to)`; revocation applies at equality. Future-known versions are excluded. Duplicate reference/version pairs and malformed or excessive inputs fail closed.

Exact comparison requires identical literal synthetic namespace/subject IDs and explicitly exact declarations on both sides. Partial is a declared limitation, not inferred prefix matching. Unresolved identity and incomplete source coverage remain distinct. `no_match` never means safe; output always declares no enforcement, training eligibility or independently verified identity. Case outcomes and model/rule scores are not treated as reference authority.

Real publisher validation, source permissions, stable account identity/masking, approved claim types and storage/retention/API integration remain pending. Do not insert real identifiers into this fixture-only contract.
