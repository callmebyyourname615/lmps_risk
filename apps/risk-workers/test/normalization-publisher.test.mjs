import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planPublications, publishSnapshot } from '../dist/normalization-publisher.js';
import { snapshotIdentity } from '../dist/sync-job.js';
import { publisherFixture, rebindFixture } from './fixtures/publication.mjs';

test('publisher plans known payments only and retains explicit unknown/invalid/lookup withholding', () => {
  const f = publisherFixture(), original = structuredClone(f); const p = planPublications(f.snapshot, f.evidence, f.manifest);
  assert.equal(p.total, 7); assert.equal(p.revisions.length, 3); assert.equal(p.withheld.length, 4);
  assert.deepEqual(p.revisions.map(r => r.transaction.transaction_status).sort(), ['pending', 'reversed', 'succeeded']);
  assert.equal(p.revisions.find(r => r.transaction.transaction_status === 'reversed').publication.normalization_input.reversal_evidence.events.length, 3);
  assert.ok(p.withheld.some(r => r.reason_codes.includes('INVALID_AMOUNT')));
  assert.ok(p.withheld.some(r => r.reason_codes.includes('NON_PAYMENT_LOOKUP'))); assert.deepEqual(f, original);
});

test('publisher never infers business/currency bindings and can withhold every row without opening a database', async () => {
  const f = publisherFixture(); f.manifest.bindings = [];
  const p = planPublications(f.snapshot, f.evidence, f.manifest); assert.equal(p.revisions.length, 0);
  assert.ok(p.withheld.some(r => r.reason_codes.includes('PUBLICATION_BINDING_MISSING')));
  const result = await publishSnapshot(f.snapshot, f.evidence, f.manifest, 'invalid-dsn');
  assert.equal(result.status, 'complete'); assert.equal(result.counts.withheld, 7); assert.equal(result.counts.inserted, 0);
});

test('mismatched frozen evidence, unsafe binding, wrong currency/identity or unrecognized targets reject before storage', async () => {
  for (const change of [f => f.manifest.snapshot_sha256 = 'a'.repeat(64), f => f.manifest.evidence_sha256 = 'b'.repeat(64),
    f => f.manifest.capture_id = '33333333-3333-4333-8333-333333333333', f => f.manifest.extra = 'SYNTHETIC_PRIVATE_VALUE',
    f => f.manifest.bindings.push(f.manifest.bindings[0]), f => f.manifest.bindings[0].event_key = 'transfer:99',
    f => f.manifest.bindings[0].currency.raw = 'WRONG', f => f.manifest.bindings[0].currency.decimal_places = 0,
    f => f.manifest.bindings[1].currency.code = 'BAD', f => f.manifest.bindings[1].transaction_id = 'synthetic_wrong_original', f => f.manifest.execution_mode = 'live']) {
    const f = publisherFixture(); change(f);
    await assert.rejects(publishSnapshot(f.snapshot, f.evidence, f.manifest, 'invalid-dsn'), /preflight failed; details withheld/);
  }
});

test('cross-row matching observations deduplicate by declared revision and contradictory aliases reject the batch', () => {
  const f = publisherFixture(); f.evidence.entries.push({ ...f.evidence.entries[0], event_key: 'transfer_hist:1' });
  f.evidence.snapshot_sha256 = snapshotIdentity(f.snapshot).snapshot_sha256; rebindFixture(f);
  f.manifest.bindings.push({ ...structuredClone(f.manifest.bindings[0]), event_key: 'transfer_hist:1' });
  assert.equal(planPublications(f.snapshot, f.evidence, f.manifest).revisions.length, 4);
  f.snapshot.events.find(e => e.event_key === 'transfer_hist:1').fields.amount = '43.00';
  f.evidence.snapshot_sha256 = snapshotIdentity(f.snapshot).snapshot_sha256; rebindFixture(f);
  assert.throws(() => planPublications(f.snapshot, f.evidence, f.manifest), /preflight failed/);
});

test('publisher sorts explicit revision ordinals rather than trusting source row order; source time stays unresolved', () => {
  const f = publisherFixture(); f.manifest.bindings[0].transaction_id = f.manifest.bindings[2].transaction_id;
  f.manifest.bindings[0].expected_revision = 1; f.manifest.bindings[0].transaction_revision = 'synthetic_revision_2';
  const rows = planPublications(f.snapshot, f.evidence, f.manifest).revisions.filter(r => r.transaction.transaction_id === 'synthetic_pending_001');
  assert.deepEqual(rows.map(r => r.expected_revision), [0, 1]); assert.ok(rows.every(r => r.transaction.occurred_at === null));
});

test('publisher runtime guards reject live/production without storage', async () => {
  const f = publisherFixture(), previous = process.env.LMPS_EXECUTION_MODE; process.env.LMPS_EXECUTION_MODE = 'live';
  try { await assert.rejects(publishSnapshot(f.snapshot, f.evidence, f.manifest, 'invalid-dsn')); }
  finally { if (previous === undefined) delete process.env.LMPS_EXECUTION_MODE; else process.env.LMPS_EXECUTION_MODE = previous; }
});
