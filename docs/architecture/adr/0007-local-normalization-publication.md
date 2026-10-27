# ADR-0007 — Evidence-bound synthetic normalization publication

Status: IMPLEMENTED locally; verification is recorded in [current status](../../implementation-status/current.md). Date: 2026-10-21. Owner: TBD.

## Boundary

No.28 connects the frozen synthetic snapshot classifier to append-only transaction revisions and the existing scoped read APIs. Real-source semantics/access, account identity, canonical business keys, production schema choice, continuous CDC, risk rules/models and deployment remain pending. `execution_mode=test`, `canonical_emission=false`, `source_semantics=unverified`, null occurred time/source mapping and unresolved accounts remain explicit.

The classifier now lives once in `packages/contracts/src/synthetic-normalization.ts`; the original worker module re-exports it. Worker planning, repository validation and API reads use that same implementation. Contracts expose two additive subpath exports. Workers declare the existing contracts workspace dependency; no external dependency/version is added. The shared Transaction wire schema/version is unchanged.

## Explicit publication contract

`source:publish <capture_id>` reads existing private frozen snapshots and fingerprint-bound synthetic semantic evidence. A separate private publication binding is required:

```text
.local/publication-bindings/v1/<capture_id>/publication.json
```

The directory chain must be private, owned and nonsymlink; the final JSON file is bounded, single-link and private, using the existing nonblocking/O_NOFOLLOW reader. Maximum binding manifest size is 512 KiB and 400 entries. It is an explicit fixture declaration, not approved actual-source semantics or a request to resolve accounts.

```json
{
  "format": 1,
  "provenance": "local_synthetic",
  "execution_mode": "test",
  "publisher_version": "synthetic-publisher-0.1.0-draft.1",
  "capture_id": "<frozen capture UUID>",
  "snapshot_sha256": "<exact snapshot fingerprint>",
  "evidence_sha256": "<exact normalized semantic-evidence fingerprint>",
  "bindings": [{
    "event_key": "transfer:1",
    "transaction_id": "synthetic_payment_001",
    "transaction_revision": "synthetic_revision_1",
    "expected_revision": 0,
    "currency": { "raw": "SYNTH_CCY_A", "code": "SYN", "decimal_places": 2 }
  }]
}
```

Placeholders must be replaced with the actual private synthetic fixture values. Evidence fingerprint is the deterministic hash produced by `normalizeSnapshot`/the private normalization report, not the byte hash of a JSON file. `expected_revision=0` publishes ordinal1; subsequent ordinals require their predecessor. IDs/revision handles must use the bounded synthetic format. IDs are supplied explicitly; no row key, masked value or fingerprint is promoted to business/account identity. An explicit normalizer payment reference, including a reversal original, must match the declared transaction ID.

Currency binding preserves raw text, declares a draft three-letter code and the existing synthetic two-decimal profile. It performs no unit/rate conversion or rounding and does not approve a real currency. Contradictory raw-code mappings within one manifest reject preflight. Missing currency/identity bindings are never guessed. Source DATETIME remains naive/unverified and `occurred_at=null`; original source time, raw codes and exact amount remain in evidence.

## Planning and eligibility

The publisher recomputes `normalizeSnapshot` from frozen source and semantic supplements; it never accepts a supplied report candidate as proof. Manifest context/version/fingerprints, complete bindings and cross-row conflicts are checked before opening PostgreSQL. Only known payment candidates with valid explicit bindings are eligible. Lookup, member, unknown, invalid and unbound payments are withheld with reasons by the pure planning API. Malformed/contradictory bindings reject the whole preflight. Withholding does not mean low risk or source quality PASS.

The shared publication builder recomputes `normalizeSynthetic`, checks source/observation/payment/currency bindings and derives the restricted draft Transaction. Run identity names the original capture; correlation/source-reference handles identify the explicitly declared synthetic revision, with the actual source coordinates retained separately. Inputs detach before asynchronous work and non-JSON values are rejected. Publication evidence is bounded to48 KiB; draft payload remains bounded to7000 bytes.

## Persistence, deduplication and retries

Additive migration0007 adds nullable `publication` JSONB to the existing table and replaces only its unknown-only payload profile. Legacy unknown observations retain null evidence. Known states require an attached proof profile; intake gains INSERT on that column, with no UPDATE/DELETE/metadata privilege. Old migration files, row identities, self-FK predecessor constraints and revision-handle uniqueness remain unchanged. Full shared validation/recomputation is authoritative; SQL constraints supplement it. The privileged migration owner can still alter valid history; this is not production WORM or RLS.

Each revision plus its full first-publication evidence commits in one transaction. There is no separate mutable current pointer. After conflict, the committed winner is validated and compared:

- Legacy unknown rows still require complete payload equality.
- Normalized replay requires the same workspace/namespace/source generation, declared transaction/revision/ordinal, currency profile and complete raw semantic input. Capture coordinates, raw source-row references and capture observed time do not create a new revision. Source time/codes/amount/reversal evidence remain significant.
- A repeated capture must also keep its exact snapshot/evidence fingerprints. Cross-row/history aliases deduplicate only when explicitly bound to the same revision and matching semantic content.
- The first payload, observed time and lineage remain unchanged. Later duplicate capture lineage is not appended to PostgreSQL; retain its private frozen snapshot/evidence/bindings for reconstruction. The API is not a complete capture-observation ledger.
- Changed content/units/source generation, reused handles, gaps or competing different publications conflict. Concurrent identical attempts yield one insert and duplicates. Corrections need an explicitly new revision; observed time never chooses a winner.

Reversal evidence is a complete local synthetic envelope, checked for original linkage, confirmation, same currency and exact partial/full bounds. Repeated event references count once inside that envelope. Publishing/replaying observations never accumulates additional transferred/reversed money. Ordinal order is publication order, not a source lifecycle state machine or real execution proof.

The CLI commits per eligible revision in deterministic transaction/ordinal order. A failure/conflict stops subsequent work and returns counts including unattempted rows; already committed revisions remain. Retry the exact same frozen inputs after recovery to deduplicate committed work and resume. Storage timeout/uncertain commit is not proof of rollback. No snapshot-wide atomicity or exactly-once external effect is claimed.

Stdout includes only local context, capture ID, status and counts: total/eligible/withheld/inserted/duplicate/conflict/failed/unattempted. Exit0 means every eligible revision completed, including a fully withheld plan; exit2 is partial/conflicting/failed storage work; exit1 is rejected input/configuration. None is a whole-source quality or production-readiness verdict. No source records/jobs, audit/outbox events, push or payment actions are created by this publisher.

## Read APIs, migration and recovery

Existing `transactions:read` history/latest routes expose additive `publication` evidence, null for old observations. Verified token workspace and bounded paging remain authoritative; raw proof/source keys here are strictly synthetic and scoped. Both payload and proof are recomputed/validated on reads. Corrupt proof or unavailable/old schema returns fixed503, never an invented unknown candidate. Readiness stays503.

The runtime needs migration0007 before these current reads/publications. The project PG is not migrated/seeded by implementation tests. Eight reviewed migrations run only on disposable test clusters; use the documented `pnpm db:migrate` during a separately approved runtime-preparation batch. Existing project credentials/data are preserved.

Table inventory remains unchanged. Native backup/restore includes full JSONB evidence and app write denial; actual old4/5/6/7-migration backups restore their own exact schema/ledger without auto-upgrade. An old seven-migration row survives migration0007 and still deduplicates with null proof. Existing1000-row/table and32MiB artifact bounds apply. Private capture sidecars are outside PostgreSQL backup scope and must be retained separately; this is local restore evidence, not production DR approval.

## Verification and next work

Checks cover pure eligibility/context/mapping/precision, real PostgreSQL immutable proofs/races/conflicts, old-schema upgrade/restore, snapshot-to-HTTP history/latest, scoping, corrupt proof withholding, outage and partial-commit replay, private files and existing classifier regression. Actual commands/counts belong in [implementation status](../../implementation-status/current.md).

Next work remains a separately scoped P03 capture/history path or an offline P05 prototype using eligible inputs. Source/identity, product adoption, feature recovery, Ubuntu/hosted execution, operational SLOs and production capacity gates are unchanged. No new microservice is introduced.

References: [previous revision scope](0006-local-transaction-revisions.md), [normalization pipeline](../../data-dictionary/synthetic-normalization-pipeline.md), [next steps](../../../../plan/10-next-implementation-steps.md).
