import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, chmodSync, statSync, linkSync, symlinkSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { openFeatureStreamConsumer as open } from '../dist/feature-stream-consumer.js';
const corpus = JSON.parse(readFileSync(new URL('../../../packages/risk/test/fixtures/feature-streams/golden.json', import.meta.url)));
const plan = { version: 'synthetic-feature-stream-1', identity: 'synthetic_declared', run_id: 'synthetic_run', input_identity: 'synthetic_golden_v1',
  namespace: 'synthetic_golden', topic: 'synthetic_golden.synthetic_run', window_seconds: 3600, coverage_start: corpus.coverage_start,
  queries: corpus.snapshots.map(({ expected, ...q }) => q), limits: { records: 32, revisions: 32, snapshots: 8, capture_bytes: 32768, state_bytes: 1048576 } };
const delivery = (i, event = corpus.events[i]) => ({ identity: 'synthetic_declared', topic: plan.topic, partition: 0, offset: i, event: structuredClone(event) });
const invalid = fn => assert.throws(fn, e => e.code === 'FEATURE_STREAM_INVALID');
function workspace(t) {
  const root = mkdtempSync(fileURLToPath(new URL('../.consumer-test-', import.meta.url))); chmodSync(root, 0o700);
  t.after(() => rmSync(root, { recursive: true, force: true })); return join(root, 'state');
}
test('real filesystem prefix restart, exact replay and independent frozen golden values', t => {
  const path = workspace(t); let worker = open(path, plan);
  for (let i = 0; i < corpus.events.length; i++) {
    assert.equal(worker.consume(delivery(i)).next_offset, i + 1);
    const receipt = worker.receipt(); worker.close(); worker = open(path, plan);
    assert.deepEqual(worker.receipt(), receipt); assert.deepEqual(worker.consume(delivery(i)), receipt);
  }
  const fixed = [['11', '14.11', null], ['11', '13.14', null], [null, null, 'INPUT_MISSING'], [null, null, 'HISTORY_INCOMPLETE'], ['11', '13.14', null], ['1', '7.00', null]];
  for (const [i, q] of plan.queries.entries()) {
    const s = worker.materialize(q.id); assert.deepEqual([s.count, s.amount, s.reason], fixed[i]);
    const receipt = worker.receipt(); s.amount = '0.00'; worker.close(); worker = open(path, plan);
    assert.deepEqual(worker.receipt(), receipt); assert.deepEqual([worker.materialize(q.id).count, worker.materialize(q.id).amount, worker.materialize(q.id).reason], fixed[i]);
  }
  assert.equal(statSync(path).mode & 0o777, 0o700);
  for (const name of ['owner.json', 'checkpoint.json', 'writer.lock']) assert.equal(statSync(join(path, name)).mode & 0o777, 0o600);
  worker.close(); worker.close(); invalid(() => worker.receipt());
});
test('exclusive ownership, changed plan, corruption and missing evidence never overwrite', t => {
  const path = workspace(t), w = open(path, plan); w.consume(delivery(0));
  invalid(() => open(path, plan)); const file = join(path, 'checkpoint.json'), original = readFileSync(file);
  w.close(); invalid(() => open(path, { ...plan, input_identity: 'synthetic_changed' })); assert.deepEqual(readFileSync(file), original);
  writeFileSync(file, '{}'); invalid(() => open(path, plan)); assert.equal(readFileSync(file, 'utf8'), '{}');
  writeFileSync(file, original); unlinkSync(file); invalid(() => open(path, plan));
});
test('before/after publication failures do not ACK, reopen and replay recover correct prefix', t => {
  for (const point of ['before_publish', 'after_publish']) {
    const path = join(dirname(workspace(t)), point); let armed = false;
    const w = open(path, plan, p => { if (armed && p === point) throw Error('trusted unit fault'); });
    w.consume(delivery(0)); const previous = readFileSync(join(path, 'checkpoint.json')); armed = true;
    const input = delivery(1), before = structuredClone(input); invalid(() => w.consume(input)); assert.deepEqual(input, before);
    invalid(() => w.receipt());
    if (point === 'before_publish') assert.deepEqual(readFileSync(join(path, 'checkpoint.json')), previous);
    w.close(); const recovered = open(path, plan); assert.equal(recovered.receipt().next_offset, point === 'before_publish' ? 1 : 2);
    assert.equal(recovered.consume(delivery(1)).next_offset, 2); recovered.close();
  }
});
test('invalid operations preserve checkpoint, input and receipt; finite maps and byte limits', t => {
  const path = workspace(t), config = structuredClone(plan); config.limits.records = 1; config.limits.revisions = 1;
  const w = open(path, config); w.consume(delivery(0)); const receipt = w.receipt(), before = readFileSync(join(path, 'checkpoint.json'));
  for (const d of [delivery(1), delivery(2), delivery(0, { ...corpus.events[0], amount: '99.00' })]) {
    const copy = structuredClone(d); invalid(() => w.consume(d)); assert.deepEqual(d, copy); assert.deepEqual(w.receipt(), receipt);
  }
  invalid(() => w.materialize('unknown')); assert.deepEqual(readFileSync(join(path, 'checkpoint.json')), before); w.close();
  const tiny = structuredClone(plan); tiny.limits.state_bytes = 1; invalid(() => open(workspace(t), tiny));
  const revisions = structuredClone(plan); revisions.limits.revisions = 1;
  const r = open(workspace(t), revisions); r.consume(delivery(0)); const rr = r.receipt(); invalid(() => r.consume(delivery(1))); assert.deepEqual(r.receipt(), rr); r.close();
});
test('unowned directories, unsafe paths, modes, hardlinks, symlinks and stranded lock block', t => {
  const empty = workspace(t); mkdirSync(empty, { mode: 0o700 }); invalid(() => open(empty, plan));
  const path = workspace(t), w = open(path, plan); w.close(); const file = join(path, 'checkpoint.json');
  chmodSync(file, 0o644); invalid(() => open(path, plan)); chmodSync(file, 0o600);
  linkSync(file, join(path, '..', 'hard')); invalid(() => open(path, plan)); unlinkSync(join(path, '..', 'hard'));
  const original = readFileSync(file); unlinkSync(file); writeFileSync(join(path, '..', 'target'), original, { mode: 0o600 });
  symlinkSync(join(path, '..', 'target'), file); invalid(() => open(path, plan)); unlinkSync(file); writeFileSync(file, original, { mode: 0o600 });
  writeFileSync(join(path, 'writer.lock'), 'stranded', { mode: 0o600 }); invalid(() => open(path, plan)); assert.equal(readFileSync(join(path, 'writer.lock'), 'utf8'), 'stranded');
  invalid(() => open(path + '/../other', plan)); chmodSync(path, 0o777); invalid(() => open(path, plan));
});
test('checkpoint envelope byte boundary and live corruption fail without changing evidence', t => {
  const probe = workspace(t), p = open(probe, plan); p.consume(delivery(0)); p.close();
  const sample = JSON.parse(readFileSync(join(probe, 'checkpoint.json')));
  const config = structuredClone(plan); let size = 0;
  for (let i = 0; i < 5; i++) {
    config.limits.state_bytes = size || 10000;
    sample.state.plan = config;
    size = Buffer.byteLength(JSON.stringify(sample));
  }
  config.limits.state_bytes = size;
  const exact = open(workspace(t), config); assert.equal(exact.consume(delivery(0)).next_offset, 1); exact.close();
  config.limits.state_bytes--;
  const short = open(workspace(t), config), before = short.receipt(); invalid(() => short.consume(delivery(0))); assert.deepEqual(short.receipt(), before); short.close();
  const path = workspace(t), live = open(path, plan), file = join(path, 'checkpoint.json');
  writeFileSync(file, '{}'); invalid(() => live.consume(delivery(0))); assert.equal(readFileSync(file, 'utf8'), '{}'); live.close();
});
test('recomputed hashes cannot hide forged snapshot arithmetic or unsupported envelope fields', t => {
  const path = workspace(t), w = open(path, plan); corpus.events.forEach((_, i) => w.consume(delivery(i))); w.materialize(plan.queries[0].id); w.close();
  const file = join(path, 'checkpoint.json'), original = readFileSync(file, 'utf8');
  const canonical = v => JSON.stringify(v, (_k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : x);
  const forged = JSON.parse(original); forged.state.snapshots[0].amount = '0.00';
  forged.state_hash = createHash('sha256').update(canonical(forged.state)).digest('hex').match(/.{8}/g).join(' ');
  writeFileSync(file, canonical(forged)); invalid(() => open(path, plan)); assert.equal(readFileSync(file, 'utf8'), canonical(forged));
  const extra = JSON.parse(original); extra.complete = true; writeFileSync(file, canonical(extra)); invalid(() => open(path, plan));
});
test('FIFO, oversized checkpoint and unsafe or linked ancestors refuse without blocking', t => {
  const path = workspace(t), w = open(path, plan); w.close(); const file = join(path, 'checkpoint.json');
  unlinkSync(file); execFileSync('mkfifo', ['-m', '600', file], { timeout: 2000 });
  invalid(() => open(path, plan)); unlinkSync(file);
  writeFileSync(file, Buffer.alloc(1048577), { mode: 0o600 }); invalid(() => open(path, plan)); assert.equal(statSync(file).size, 1048577);
  const root = dirname(workspace(t)), unsafe = join(root, 'unsafe'); mkdirSync(unsafe, { mode: 0o777 }); chmodSync(unsafe, 0o777);
  invalid(() => open(join(unsafe, 'new'), plan));
  const linked = join(root, 'linked'); symlinkSync(dirname(path), linked); invalid(() => open(join(linked, 'new'), plan));
});
