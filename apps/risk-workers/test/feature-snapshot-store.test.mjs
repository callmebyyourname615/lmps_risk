import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, chmodSync, statSync, mkdirSync, linkSync, unlinkSync, symlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openFeatureSnapshotStore as open } from '../dist/feature-snapshot-store.js';
import { featurePublicationContentHash as hash } from '@lmps/contracts/feature-serving';
import { initializeFeatureStream, applyFeatureStreamDelivery, materializeFeatureStreamSnapshot } from '@lmps/risk';
const corpus = JSON.parse(readFileSync(new URL('../../../packages/risk/test/fixtures/feature-streams/golden.json', import.meta.url)));
const plan = { version: 'synthetic-feature-stream-1', identity: 'synthetic_declared', run_id: 'synthetic_run', input_identity: 'synthetic_golden_v1',
  namespace: 'synthetic_golden', topic: 'synthetic_golden.synthetic_run', window_seconds: 3600, coverage_start: corpus.coverage_start,
  queries: corpus.snapshots.map(({ expected, ...q }) => q), limits: { records: 32, revisions: 32, snapshots: 8, capture_bytes: 32768, state_bytes: 1048576 } };
const scope = { version: 'synthetic-feature-serving-1', mode: 'local_synthetic', workspace_key: 'synthetic_store', plan,
  policy: { id: 'synthetic_fixture', version: 'synthetic_v1', max_age_seconds: 86400 } };
const invalid = fn => assert.throws(fn, e => e.code === 'FEATURE_SERVING_INVALID');
function workspace(t) { const root = mkdtempSync(fileURLToPath(new URL('../.snapshot-test-', import.meta.url))); chmodSync(root, 0o700); t.after(() => rmSync(root, { recursive: true, force: true })); return join(root, 'store'); }
function state(n = corpus.events.length) { let s = initializeFeatureStream(plan); for (let i = 0; i < n; i++) s = applyFeatureStreamDelivery(s, { identity: plan.identity, topic: plan.topic, partition: 0, offset: i, event: corpus.events[i] }); return s; }
const zeroHash = Array(8).fill('00000000').join('-');
function publication(s = state(), generation = 1, previous = null) {
  const p = { version: scope.version, scope: structuredClone(scope), generation, predecessor: previous && { generation: generation - 1, content_hash: previous.content_hash }, state: s,
    published_at: '2030-01-01T00:00:00Z', expires_at: '2030-01-02T00:00:00Z', content_hash: zeroHash };
  p.content_hash = hash(p); return p;
}
test('durable golden state, retained frozen evidence, detached read/retry and reopen', t => {
  const path = workspace(t), w = open(path, scope); assert.equal(w.read(), null);
  let s = state(); const expected = [['11', '14.11', null], ['11', '13.14', null], [null, null, 'INPUT_MISSING'], [null, null, 'HISTORY_INCOMPLETE'], ['11', '13.14', null], ['1', '7.00', null]];
  for (const [i, q] of plan.queries.entries()) { const r = materializeFeatureStreamSnapshot(s, q.id); s = r.state; assert.deepEqual([r.snapshot.count, r.snapshot.amount, r.snapshot.reason], expected[i]); }
  const p = publication(s), copy = structuredClone(p), r = w.publish(p), file = join(path, 'publication.json'), before = statSync(file);
  assert.deepEqual(p, copy); assert.deepEqual(w.publish(p), r); assert.equal(statSync(file).ino, before.ino); assert.equal(statSync(file).mtimeMs, before.mtimeMs);
  const detached = w.read(); detached.state.snapshots[0].amount = '0.00'; assert.equal(w.read().state.snapshots[0].amount, '14.11');
  const next = publication(s, 2, p); w.publish(next); w.close(); const restored = open(path, scope); assert.deepEqual(restored.read(), next); restored.close(); invalid(() => restored.read());
});
test('version fencing, conflicting scope/policy/history and frozen arithmetic preserve bytes', t => {
  const path = workspace(t), w = open(path, scope), p = publication(); w.publish(p); invalid(() => open(path, scope));
  const file = join(path, 'publication.json'), bytes = readFileSync(file);
  const candidates = [publication(state(), 3, p), publication(state(1), 2, p), { ...p, content_hash: zeroHash }, publication(state(), 2, { content_hash: zeroHash })];
  const changed = publication(); changed.scope.policy.version = 'synthetic_other'; changed.content_hash = hash(changed); candidates.push(changed);
  const workspaceChanged = publication(); workspaceChanged.scope.workspace_key = 'synthetic_other'; workspaceChanged.content_hash = hash(workspaceChanged); candidates.push(workspaceChanged);
  const conflict = publication(); conflict.published_at = '2030-01-01T00:00:01Z'; conflict.content_hash = hash(conflict); candidates.push(conflict);
  for (const candidate of candidates) { invalid(() => w.publish(candidate)); assert.deepEqual(readFileSync(file), bytes); }
  const second = publication(state(), 2, p); w.publish(second); invalid(() => w.publish(p)); w.close();
  invalid(() => open(path, { ...scope, workspace_key: 'synthetic_other' }));
});
test('before/after faults poison without acknowledgment; validated reopen resolves actual generation', t => {
  for (const point of ['before_publish', 'after_publish']) {
    const path = workspace(t); let armed = false;
    const w = open(path, scope, p => { if (armed && p === point) throw Error('unit'); }); const p = publication(); w.publish(p);
    const bytes = readFileSync(join(path, 'publication.json')); armed = true; const next = publication(state(), 2, p);
    invalid(() => w.publish(next)); invalid(() => w.read()); invalid(() => w.receipt());
    if (point === 'before_publish') assert.deepEqual(readFileSync(join(path, 'publication.json')), bytes);
    w.close(); const recovered = open(path, scope); assert.equal(recovered.receipt().generation, point === 'before_publish' ? 1 : 2); recovered.publish(next); recovered.close();
  }
});
test('unsafe/unowned state, modes, links, corruption and retained lock block', t => {
  const empty = workspace(t); mkdirSync(empty, { mode: 0o700 }); invalid(() => open(empty, scope));
  const path = workspace(t), w = open(path, scope); w.publish(publication()); w.close(); const file = join(path, 'publication.json'), original = readFileSync(file);
  chmodSync(file, 0o644); invalid(() => open(path, scope)); chmodSync(file, 0o600);
  linkSync(file, join(path, 'hard')); invalid(() => open(path, scope)); unlinkSync(join(path, 'hard'));
  unlinkSync(file); symlinkSync(join(path, 'owner.json'), file); invalid(() => open(path, scope)); unlinkSync(file); writeFileSync(file, original, { mode: 0o600 });
  const bad = JSON.parse(original); bad.publication.content_hash = zeroHash; writeFileSync(file, JSON.stringify(bad)); invalid(() => open(path, scope));
  writeFileSync(file, Buffer.alloc(1048577)); invalid(() => open(path, scope)); assert.equal(statSync(file).size, 1048577);
  writeFileSync(file, original); writeFileSync(join(path, 'writer.lock'), 'stranded', { mode: 0o600 }); invalid(() => open(path, scope)); assert.equal(readFileSync(join(path, 'writer.lock'), 'utf8'), 'stranded'); invalid(() => open(path + '/../other', scope));
});
test('recomputed content hash cannot legitimize forged arithmetic or rewriting frozen evidence', t => {
  const path = workspace(t), w = open(path, scope); const s = materializeFeatureStreamSnapshot(state(), plan.queries[0].id).state, p = publication(s); w.publish(p);
  const forged = publication(structuredClone(s), 2, p); forged.state.snapshots[0].amount = '0.00'; forged.content_hash = hash(forged); invalid(() => w.publish(forged));
  const removed = publication(state(), 2, p); invalid(() => w.publish(removed));
  w.close(); const file = join(path, 'publication.json'), envelope = JSON.parse(readFileSync(file)); envelope.publication = forged; writeFileSync(file, JSON.stringify(envelope)); invalid(() => open(path, scope));
});
test('generation 1000 exact limit, one-over rejected without rewrite', t => {
  const path = workspace(t), w = open(path, scope); let p = publication(initializeFeatureStream(plan)); w.publish(p);
  for (let i = 2; i <= 1000; i++) { p = publication(p.state, i, p); w.publish(p); }
  assert.equal(w.receipt().generation, 1000); const bytes = readFileSync(join(path, 'publication.json'));
  invalid(() => w.publish({ ...p, generation: 1001 })); assert.deepEqual(readFileSync(join(path, 'publication.json')), bytes); w.close();
});
test('2000 deliveries and eight snapshots, one-over admission and exact state byte bound', t => {
  const config = structuredClone(scope); config.plan.limits.records = 2000; config.plan.limits.revisions = 2000;
  config.plan.limits.capture_bytes = 2097152;
  config.plan.queries.push({ ...config.plan.queries[0], id: 'extra_7' }, { ...config.plan.queries[0], id: 'extra_8' });
  const s = initializeFeatureStream(config.plan);
  s.deliveries = Array.from({ length: 2000 }, (_, offset) => ({ identity: plan.identity, topic: plan.topic, partition: 0, offset, event: structuredClone(corpus.events[offset] ?? corpus.events[0]) })); s.next_offset = 2000;
  let frozen = s; for (const q of config.plan.queries) frozen = materializeFeatureStreamSnapshot(frozen, q.id).state;
  const p = publication(); p.scope = config; p.state = frozen; p.content_hash = hash(p);
  const path = workspace(t), w = open(path, config); w.publish(p); assert.equal(w.receipt().deliveries, 2000); assert.equal(w.receipt().snapshots, 8);
  const over = structuredClone(p); over.state.deliveries.push({ ...over.state.deliveries[0], offset: 2000 }); over.state.next_offset++; invalid(() => w.publish(over));
  const extraSnapshot = structuredClone(p); extraSnapshot.state.snapshots.push(extraSnapshot.state.snapshots[0]); invalid(() => w.publish(extraSnapshot)); w.close();
  const tooManyQueries = structuredClone(config); tooManyQueries.plan.queries.push({ ...config.plan.queries[0], id: 'extra_9' }); invalid(() => open(workspace(t), tooManyQueries));
  const bounded = structuredClone(scope); let empty;
  for (let i = 0; i < 5; i++) { empty = initializeFeatureStream(bounded.plan); bounded.plan.limits.state_bytes = Buffer.byteLength(JSON.stringify(empty)); }
  empty = initializeFeatureStream(bounded.plan); assert.equal(Buffer.byteLength(JSON.stringify(empty)), bounded.plan.limits.state_bytes);
  const exact = open(workspace(t), bounded), ep = publication(); ep.state = empty; ep.scope = bounded; ep.content_hash = hash(ep); exact.publish(ep); exact.close();
  bounded.plan.limits.state_bytes--; const short = open(workspace(t), bounded); const bad = structuredClone(ep); bad.scope = bounded; bad.state.plan = bounded.plan; invalid(() => short.publish(bad)); short.close();
});
test('FIFO, linked ancestor, live corruption and unresolved cleanup never release ownership', t => {
  const path = workspace(t), w = open(path, scope); const p = publication(); w.publish(p); const file = join(path, 'publication.json'), original = readFileSync(file);
  writeFileSync(file, '{}'); invalid(() => w.read()); invalid(() => w.close()); assert.ok(statSync(join(path, 'writer.lock')).isFile()); writeFileSync(file, original);
  writeFileSync(join(path, 'stage-unknown'), 'ambiguous', { mode: 0o600 }); invalid(() => w.close()); unlinkSync(join(path, 'stage-unknown')); w.close();
  unlinkSync(file); execFileSync('mkfifo', ['-m', '600', file], { timeout: 2000 }); invalid(() => open(path, scope)); unlinkSync(file); writeFileSync(file, original, { mode: 0o600 });
  const linked = path + '-linked'; symlinkSync(path, linked); invalid(() => open(join(linked, 'new'), scope));
  chmodSync(path, 0o777); invalid(() => open(path, scope)); chmodSync(path, 0o700);
});
test('one MiB persisted envelope exact boundary and one-over publication preserve committed inode', t => {
  const config = structuredClone(scope); config.plan.limits.records = 2000; config.plan.limits.revisions = 2000; config.plan.limits.capture_bytes = 2097152;
  const path = workspace(t), w = open(path, config), file = join(path, 'publication.json');
  const envelope = JSON.parse(readFileSync(file));
  const p = publication(); p.scope = config; p.state = initializeFeatureStream(config.plan); p.state.next_offset = 2000;
  p.state.deliveries = Array.from({ length: 2000 }, (_, offset) => ({ identity: plan.identity, topic: plan.topic, partition: 0, offset,
    event: { ...corpus.events[0], transaction_id: `synthetic_t${offset}`, sender: 'synthetic_s', receiver: 'synthetic_r' } }));
  envelope.publication = p;
  let remaining = 1048576 - Buffer.byteLength(JSON.stringify(envelope)); assert.ok(remaining > 0);
  for (const d of p.state.deliveries) for (const field of ['sender', 'receiver']) {
    const add = Math.min(remaining, 69); d.event[field] += 'x'.repeat(add); remaining -= add;
  }
  assert.equal(remaining, 0); p.content_hash = hash(p); w.publish(p); assert.equal(statSync(file).size, 1048576);
  const before = statSync(file), bytes = readFileSync(file), bigger = structuredClone(p);
  bigger.generation = 2; bigger.predecessor = { generation: 1, content_hash: p.content_hash }; bigger.content_hash = hash(bigger);
  invalid(() => w.publish(bigger)); assert.deepEqual(readFileSync(file), bytes); assert.equal(statSync(file).ino, before.ino); w.close();
  const otherPath = workspace(t), other = open(otherPath, config), otherFile = join(otherPath, 'publication.json'), empty = readFileSync(otherFile);
  const oneOver = structuredClone(p); oneOver.state.deliveries.at(-1).event.receiver += 'x'; oneOver.content_hash = hash(oneOver);
  const candidate = JSON.parse(empty); candidate.publication = oneOver; assert.equal(Buffer.byteLength(JSON.stringify(candidate)), 1048577);
  invalid(() => other.publish(oneOver)); assert.deepEqual(readFileSync(otherFile), empty); assert.equal(other.receipt().generation, 0); other.close();
});
