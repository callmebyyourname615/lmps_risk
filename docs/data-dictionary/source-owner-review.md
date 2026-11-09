# Source owner review: semantics and identity

This is a question set for an authorized source owner, DBA, identity/privacy owner and downstream policy owner. It is not a mapping, approval, access grant or evidence that a field has a particular meaning. Record `unknown` when an answer is unavailable. Keep answers, evidence and any examples in approved private storage; do not put account values, credentials or source rows in this document, source control or logs.

## Identify the reviewed source

- Owner role and approved contact reference; review date and version; evidence reference and SHA-256 of the reviewed private artifact.
- System, database/table or extract, environment, approved access method, permitted columns, snapshot or change-feed scope, date range, and retention. Identify separately each current, history and archive feed.
- Whether the evidence is a final-state snapshot, a sequence of changes, or a mixture; which claims it can and cannot support. A hash binds content but does not establish authenticity or authority.

## Lifecycle and business transaction identity

- For every observed and documented combination of status and type codes: what operation and lifecycle state does it mean? Which codes represent payment, lookup, pending, failed, successful, reversal or adjustment? Are there codes outside the reviewed sample?
- When are amounts gross, executed, settled or reversed? Are reversals full or partial and cumulative or incremental? What authoritative evidence links a reversal to its original transaction?
- What identifies a business payment versus a source row, attempt, retry or revision? How can duplicate deliveries and changes in current/history tables be distinguished? Does a source key persist across retries and corrections?
- Which source fields have null, empty, unknown or default values with distinct meanings? What is the change-control and effective-date process for codebook updates?

## Money and time

- For each currency and money field, what are its unit, scale, rounding and sign rules? Is the currency code a standard currency or an internal code? What do zero and null mean? Are fees separate?
- For each timestamp field, what event does it represent, what clock and timezone/offset apply, and can values change later? Specify precision, daylight-saving behavior where applicable, and how clock corrections or invalid values are handled.
- When did each field become available to a reader? Can this known-at time be reconstructed for historical revisions? What delay, late-arrival and out-of-order behavior is documented?

## Account identity and masking

- Is there a stable sender and receiver account identifier or token? For each, identify the source field/system, issuing authority, lifetime, namespace and institution scope, and whether the same account is consistently represented across feeds and roles.
- At which boundary is data masked or tokenized? Which roles may access unmasked values or a managed token? Can authorized evidence distinguish two different accounts that have the same visible masked text?
- Are participant/member identifiers routing entities or account owners? What documented relationship, if any, links them to accounts? How are accounts merged, closed, reused, rotated or migrated?
- Which owner approves key custody, mapping versions, revocation and retention? A repeated masked string, routing member or similar-looking value is not evidence of account identity.

## History, references and policies

- What date range and entities have complete history? Are deleted, corrected, reversed or late records retained? What gaps, backfills and outages are known, and what evidence supports completeness?
- Which authority publishes reference or flagged-account data, and what are its effective time, availability time, scope, expiry and revocation rules?
- Which authorized owner approves detection policy and thresholds for each currency and effective period? Missing policies remain unavailable; no cross-currency threshold is inferred.

## Apply answers to the correct workflow

| Source shape | Existing workflow | Scope and review limitation |
| --- | --- | --- |
| Six-column `transfer` intake | [Intake source contract](../operations/intake-source-contract.md) | `id,requesttime,amount,ccy,result,txtime` provide no account identity or independently verified occurrence time. Existing `OK` and `TRANSACTION_FAILED` handling is an operator test mapping, not source-owner confirmation. Do not invent the other selector fields. |
| Twenty-two-field pilot | [Source semantics](../operations/source-semantics.md) | Review exact six-field lifecycle selectors, currency units and declared time interpretation using private evidence. The existing validator checks syntax and sample coverage, not owner authority or evidence authenticity. |

For each answer, record the precise scope, source and evidence reference/hash, owner, review date and unresolved exceptions in a private review artifact. An `owner_declared` mapping or a complete sample report is not independent verification, authorization to connect, production approval, or proof for unobserved rows. Identity, history and reversal linkage need their own evidence even if a lifecycle mapping is complete. The current generic readiness tool records attestations only; it does not authenticate owners or approve a connection.
