# Bounded synthetic golden streams

US-303 / P04-02-T1 supplies a local test corpus, not an online feature runtime.
All identifiers and amounts are invented, with `local_synthetic` / `test`
provenance. Synthetic sender equality is declared test identity only; real source
fields, full/masked account representation, linkage and masking boundaries remain
unverified. SYN and ALT are separate invented currency buckets, without FX.

`packages/risk/test/fixtures/feature-streams/golden.json` records explicit array
delivery order: the target arrives first, eight one-cent hot-key payments arrive
in reverse event-time order, one identical revision repeats, and later entries
include a correction and reversal. Array order is replay order, not event time or
authority. Each snapshot replays the finite array, filters `available_at <= as_of`,
deduplicates identical namespace/payment/revision tuples and selects the highest
available revision per namespace/payment. Conflicting same revisions are outside
this corpus and remain subject to existing request validation.

The target anchors the one-hour window `(target.occurred_at - 3600s,
target.occurred_at]`, even when `as_of` advances. The exact start event and a
future event are excluded. The eight hot-key payments contribute 0.08; target
10.02 plus partially reversed net 1.01 plus initial correction-payment 3.00
produce count 11 / 14.11 SYN. At 12:01 the late revision replaces 3.00 with
2.03, producing count 11 / 13.14 SYN. A full reversal contributes neither count
nor money. The ALT target has its own 10:50–11:50 window and count 1 / 7.00.
Missing input and incomplete coverage produce unavailable values, never zero;
missing flags leave count/money available and flagged-neighbor evidence unavailable.

Expected snapshots are fixed hand calculations above. A separate test-only oracle
uses decimal splitting with BigInt and exhaustive revision comparisons, importing
no reference-calculator arithmetic or window helpers. Tests compare these fixed
outputs with that oracle and supported findings from the unchanged existing
`evaluateTransactionRisk` reference calculator, validate requests through that
entry point, and verify reversed-array replay yields the same report. The existing
fixture factory supplies policy structure only; run ID, events and clock are fixed.
Other risk metrics are outside this corpus's expected-output claim.

Local fixture limits are 32,768 serialized bytes, 32 deliveries and 8 snapshots;
tests exercise exact and one-over bounds without truncation. These are test input
limits, not business thresholds or capacity evidence. The present corpus uses 18
deliveries and six snapshots; eight payments share one synthetic sender.

Pending: online-engine arrival processing, watermarks, lateness admission,
incremental correction/retraction emission, checkpoint recovery, cache consistency,
engine selection/adoption and performance benchmarks. Snapshot recomputation here
does not demonstrate any of those properties or close P04-02. No engine/cache,
dependency, original fixture or existing test is changed. Trusted host risk suites,
source/manifest/plan/Git guards and publication/secret checks remain pending until
their independent durable receipt; candidate unit checks alone do not establish
completion. Implementation-status publication belongs to the host handoff because
that file is outside this task's three-file allowlist.
