# Synthetic snapshot normalization pipeline — No.25.3

The local pipeline reads a frozen synthetic snapshot plus optional separately declared synthetic evidence, calls the [No.25.2 normalizer](synthetic-normalizer.md) and publishes one private immutable report. It makes no MariaDB/PostgreSQL/network call, registers no import job and creates no business effect. Source columns/grants, stored rows and published spools are not widened or rewritten.

## Run and private paths

```sh
pnpm source:normalize <capture_id>
```

| Artifact | Path |
| --- | --- |
| Frozen input | .local/snapshots/<capture_id>/snapshot.json |
| Optional synthetic evidence | .local/normalization-evidence/v1/<capture_id>/evidence.json |
| Immutable report | .local/normalization/v1/<capture_id>/normalization.json |

Only local_synthetic/test input and local/test process context are accepted. Labels are not source-access authority. Snapshot result/table/sign/history values never supply missing operation/reversal semantics. A transaction row without explicit evidence is unknown without passing it through payment normalization. Member records remain unsupported/unknown and cannot receive payment supplements. Non-snapshot/DELETE input is rejected by the existing snapshot validator, never interpreted as a financial reversal.

## Optional synthetic evidence

| Exact root field | Required value |
| --- | --- |
| format / provenance / execution_mode | 1 / local_synthetic / test |
| codebook_version | synthetic-lifecycle-0.1.0-draft.1 |
| capture_id | The frozen snapshot UUID |
| snapshot_sha256 | The existing snapshotIdentity(snapshot) fingerprint |
| entries | At most400 unique event-key supplements targeting transaction-table events in this capture |

An entry permits only event_key, operation_code, status_code, reversal_code, synthetic_payment_ref and reversal_evidence. The last five use the normalizer profile. Money/currency/time/keys/observation time cannot be overridden; they come from frozen fields.amount/ccy/txtime and event.observed_at. Invalid code or nested normalization evidence withholds the affected row as invalid. Invalid batch shape/binding/non-JSON content, forbidden entry fields, unknown/member targets or repeated event keys reject the complete batch before publication. Duplicate supplements are rejected even when identical; reversal-event deduplication within one supplement remains the normalizer's responsibility.

The normalizer reference uses source_namespace and event_key. The enclosing row preserves full workspace, generation, capture epoch, table, complete source key, operation and observation time. References are not verified business/account IDs. History observations remain distinct; identical synthetic payment handles do not establish business deduplication across observations.

Evidence directories must be owner-private0700 and final files0600, without symlinks/hardlinks. Evidence is limited to2MiB. Missing directory/version/capture means evidence_status=absent; an existing capture directory without final evidence.json is partial and fails. Unsafe/unreadable/corrupt inputs do not fall back to absent. Explicit synthetic declarations do not verify real-source semantics, currency, account linkage or source authority.

## Output, identity and replay

The report contains pipeline/codebook/normalizer versions, capture/source fingerprint, nullable evidence fingerprint/status, counts and one outcome per observation, up to400. Rows have complete source lineage, known/unknown/invalid state, fixed reasons and normalization outcomes when supplemented. Accepted raw inputs/source keys/money/evidence remain private report data. canonical_emission=false, source_semantics=unverified and account_identity=unresolved remain explicit.

Evidence identity sorts object keys and entries by event_key; JSON formatting/entry order do not change identity. Nested reversal-event order remains frozen evidence even though candidate sums are order-independent. Counts include lookups and are observations, not business payments, financial totals or quality PASS. There is no cross-row/capture accumulation, persistent business deduplication, source-completeness check or PG reconciliation.

The report limit is4MiB; bounds fail rather than truncate. Same source/evidence replay acknowledges duplicate without rewriting. Changed source/evidence/versions or changed/partial/corrupt prior report conflicts at the capture path. After publication, richer evidence requires a separately reviewed experiment/output scope or a new synthetic capture; never overwrite frozen input/output to simulate a successful replay. No automatic partial repair/latest pointer exists.

The extracted private JSON reader/publisher is shared with the existing profiler. It retains owner/mode/single-link/regular-file/size checks, O_NOFOLLOW/O_NONBLOCK, exclusive capture-directory publication, fsync and no replacement. It assumes a trusted owner-controlled ancestor tree, as the existing local profile/spool does; this is not WORM or protection from the privileged owner. One concurrent writer publishes; another may fail closed while publication is pending and return duplicate on retry. Evidence/reports are outside PostgreSQL backups and are not a production retention/DR policy.

## Status and evidence

Stdout is local provenance/mode, normalized/duplicate status, capture UUID, evidence_status and counts only. No source key, amount, evidence, fingerprint or private path is printed. Exit0=published/replayed without invalid rows (unknown may exist); exit2=published/replayed with invalid rows needing review; exit1=argument/context/source/evidence/filesystem rejection. Processing status is not production/data-quality acceptance. Errors are fixed/redacted.

The actual CLI demonstration used a new invented7-row private fixture:4 known (including lookup),2 unknown and1 deliberate invalid negative amount. First invocation published; replay returned duplicate; expected exit2 both times. Frozen source/evidence and report bytes stayed unchanged. This fixture was not captured/imported from MariaDB/PG; its new private spool/evidence/report were retained for review without changing earlier spools.

Focused tests cover binding/forbidden overrides, row withholding,400-row/empty snapshots, replay/input immutability, reversal dedup/conflicts, zero source/network calls, private file/link/FIFO/size/partial/concurrency boundaries and CLI redaction. Existing profiler tests cover unchanged behavior after helper extraction. Final full/fresh results are in [Implementation Status](../implementation-status/current.md).

Real-source codebooks/identity, continuous capture, canonical business storage, features/risk engines, hosted/Linux verification and production capacity remain pending. See [source gates](source-mapping.md), [missing inputs](../../../plan/09-missing-inputs-and-foundation-readiness.md) and [next steps](../../../plan/10-next-implementation-steps.md).
