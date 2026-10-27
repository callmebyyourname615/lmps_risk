import test from 'node:test';
import assert from 'node:assert/strict';
import { createOracle, parseObservation, FIXTURE, LIMITS } from '../scripts/cdc-oracle.mjs';

// Independent explicit input examples, not generated from production expectations.
export function observations() {
  const one = { id: 1, revision: 1, amount: '9007199254740993.1200', currency: 'XTS' };
  const two = { id: 2, revision: 1, amount: '0.0100', currency: 'XTS' };
  const three = { id: 3, revision: 1, amount: '12.3400', currency: 'XTS' };
  const changed = { ...one, revision: 2, amount: '9007199254740993.1201' };
  const event = (offset, op, before, after, snapshot = 'false') => ({ topic: FIXTURE.topic, partition: 0, offset, key: { id: (after ?? before).id }, value: { before, after, op, source: { connector: 'mariadb', name: 'lmps_cdc', snapshot, db: 'lmps_cdc_invented', table: 'specimens', file: 'local-bin.000001', pos: op === 'r' ? 100 : 100 + offset * 20, row: 0 } } });
  return [event(0, 'r', null, one, 'true'), event(1, 'r', null, two, 'last'), event(2, 'c', null, three), event(3, 'u', one, changed), event(4, 'd', two, null), { topic: FIXTURE.topic, partition: 0, offset: 5, key: { id: 2 }, value: null }, event(6, 'u', three, { ...three, revision: 2, amount: '12.3401' }), event(7, 'c', null, { id: 4, revision: 1, amount: '1.0000', currency: 'XTS' })];
}
test('independent snapshot, stream, restart and duplicate replay expectations', () => {
  const input = observations(), oracle = createOracle();
  input.slice(0, 2).forEach(r => oracle.accept(r));
  assert.equal(oracle.verify('snapshot').records, 2);
  input.slice(2, 6).forEach(r => oracle.accept(r));
  assert.equal(oracle.verify('stream').tombstones, 1);
  input.slice(6).forEach(r => oracle.accept(r));
  const proof = oracle.verify('restart'); assert.equal(proof.records, 8);
  input.forEach(r => oracle.accept(r));
  const replay = oracle.verify('restart');
  assert.equal(replay.observations, 16); assert.equal(replay.stateSha256, proof.stateSha256); assert.equal(replay.operationsSha256, proof.operationsSha256);
});
test('exact decimal string and unavailable/unsupported semantics', () => {
  const nanos = observations()[0]; nanos.value.ts_ns = 1790000000000000000;
  assert.equal(parseObservation(nanos).after.amount, '9007199254740993.1200');
  nanos.value.ts_ns = Infinity; assert.throws(() => parseObservation(nanos));
  for (const amount of [9007199254740993.12, null, '1e2', '12.34', '01.0000', '-1.0000']) {
    const r = observations()[0]; r.value.after.amount = amount; assert.throws(() => parseObservation(r));
  }
  const unavailable = observations()[0]; unavailable.value.after.amount = '__debezium_unavailable_value';
  assert.throws(() => parseObservation(unavailable), /UNAVAILABLE_VALUE/);
  const unsupported = observations()[0]; unsupported.value.op = 'truncate';
  assert.throws(() => parseObservation(unsupported), /UNSUPPORTED_OPERATION/);
  const rounded = observations(); rounded[0].value.after.amount = '9007199254740993.1202';
  const o = createOracle(); rounded.slice(0, 2).forEach(r => o.accept(r)); assert.throws(() => o.verify('snapshot'), /EXPECTED_MISMATCH/);
});
test('changed-content offset and source-position identity conflicts fail', () => {
  const o = createOracle(), input = observations(); o.accept(input[0]);
  const conflict = structuredClone(input[0]); conflict.value.after.amount = '1.0000';
  assert.throws(() => o.accept(conflict), /IDENTITY_CONFLICT/);
  const p = createOracle(); input.slice(0, 3).forEach(r => p.accept(r));
  const repeated = structuredClone(input[2]); repeated.offset = 3;
  assert.throws(() => p.accept(repeated), /POSITION_REUSE/);
});
test('missing/out-of-order observations, tombstones, revisions and snapshots fail', () => {
  const input = observations();
  assert.throws(() => createOracle().accept(input[1]), /OFFSET_ORDER/);
  const missing = createOracle(); input.slice(0, 5).forEach(r => missing.accept(r));
  assert.throws(() => missing.verify('stream'), /EXPECTED_MISMATCH/);
  const next = structuredClone(input[6]); next.offset = 5;
  assert.throws(() => missing.accept(next), /MISSING_TOMBSTONE/);
  const early = structuredClone(input[2]); early.offset = 0;
  assert.throws(() => createOracle().accept(early), /MISSING_SNAPSHOT/);
  const revision = createOracle(); input.slice(0, 3).forEach(r => revision.accept(r));
  const bad = structuredClone(input[3]); bad.value.after.revision = 3;
  assert.throws(() => revision.accept(bad), /REVISION_ORDER/);
  const resnapshot = createOracle(); input.forEach(r => resnapshot.accept(r));
  const again = structuredClone(input[0]); again.offset = 8; again.value.source.pos = 800;
  assert.throws(() => resnapshot.accept(again), /SNAPSHOT_ORDER/);
});
test('unknown envelope fields, wrong fixture/key, oversized record and replay limits fail', () => {
  for (const mutate of [r => { r.extra = true; }, r => { r.key.account = 'invented'; }, r => { r.topic = 'other'; }, r => { r.value.after.currency = 'USD'; }, r => { r.value.source.query = 'x'; }, r => { r.offset = Number.MAX_SAFE_INTEGER + 1; }]) {
    const r = observations()[0]; mutate(r); assert.throws(() => parseObservation(r));
  }
  const huge = observations()[0]; huge.value.extra = 'x'.repeat(LIMITS.recordBytes);
  assert.throws(() => parseObservation(huge), /RECORD_LIMIT/);
  const o = createOracle(), first = observations()[0];
  for (let i = 0; i < 2000; i++) o.accept(first);
  assert.throws(() => o.accept(first), /CAPTURE_LIMIT/);
});

test('Debezium first/last snapshot markers preserve completion and ordering checks', () => {
  const input = observations(); input[0].value.source.snapshot = 'first';
  const o = createOracle(); input.forEach(r => o.accept(r));
  assert.equal(o.verify('restart').records, 8);
  const misplaced = observations(); misplaced[1].value.source.snapshot = 'first';
  const bad = createOracle(); bad.accept(misplaced[0]);
  assert.throws(() => bad.accept(misplaced[1]), /SNAPSHOT_ORDER/);
  const incomplete = createOracle(); incomplete.accept(input[0]);
  assert.throws(() => incomplete.verify('snapshot'), /EXPECTED_MISMATCH/);
  const stream = observations()[2]; stream.value.source.snapshot = 'first';
  assert.throws(() => parseObservation(stream));
});
