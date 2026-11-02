import assert from 'node:assert/strict';
import test from 'node:test';
import { transferObservation, recordedAmountAtLeast } from '../dist/intake-observation.js';
const row = () => ['1', '2026-10-29 12:00:00', '100000.00', 'LAK', '00', '2026-10-29 12:00:01'];

test('file and sync retain one stable identity/content with honest transport provenance and unknown semantics', () => {
  const file = transferObservation('lmps_transfer', 'file', row()), sync = transferObservation('lmps_transfer', 'sync', row());
  assert.equal(file.identity, sync.identity); assert.equal(file.revision_sha256, sync.revision_sha256);
  assert.equal(file.source_kind, 'user_supplied_file'); assert.equal(sync.source_kind, 'database_sync');
  assert.equal(file.amount_unit, 'unverified'); assert.equal(file.lifecycle_status, 'unknown');
  assert.equal(file.occurred_at, null); assert.equal(file.account_identity, 'unresolved');
});

test('updates keep identity but change revision; namespace and composite source key prevent collisions', () => {
  const source = row(), original = transferObservation('lmps_transfer','file',source);
  source[2] = '200000.00'; const correction = transferObservation('lmps_transfer','sync',source);
  assert.equal(original.identity,correction.identity); assert.notEqual(original.revision_sha256,correction.revision_sha256);
  source[1] = '2026-10-29 12:00:02'; assert.notEqual(original.identity,transferObservation('lmps_transfer','sync',source).identity);
  assert.notEqual(original.identity,transferObservation('other_source','file',row()).identity);
  source[4] = null; const nullResult = transferObservation('lmps_transfer','file',source); source[4] = '';
  assert.notEqual(nullResult.revision_sha256,transferObservation('lmps_transfer','file',source).revision_sha256);
});

test('invalid input is rejected without echoing source values or interpreting raw lifecycle/time', () => {
  for (const mutate of [v=>v[2]='PRIVATE_INVALID',v=>v[1]='2026-02-30 12:00:00',v=>v.push('extra'),v=>v[3]='',v=>v[0]='01']) {
    const v=row();mutate(v);assert.throws(()=>transferObservation('lmps_transfer','file',v),e=>!e.message.includes('PRIVATE_INVALID'));
  }
  assert.throws(()=>transferObservation('unsafe namespace','file',row()));
  assert.throws(()=>transferObservation('lmps_transfer','unknown',row()));
});

test('amount review keeps exact signed decimals beyond Number precision and rejects alternate formats', () => {
  assert.equal(recordedAmountAtLeast('9007199254740993.01','9007199254740993.02'),false);
  assert.equal(recordedAmountAtLeast('5000000.00','5000000.00'),true);
  assert.equal(recordedAmountAtLeast('-1.00','0.00'),false);
  for (const v of ['1e6','NaN','100,000.00','1.001',100]) assert.throws(()=>recordedAmountAtLeast(v,'1.00'));
});
