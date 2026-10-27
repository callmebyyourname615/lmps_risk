import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, writeFileSync, mkdtempSync, chmodSync, rmSync, statSync, mkdirSync, unlinkSync, linkSync, symlinkSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openFeatureServingAdapter as open, rebuildFeatureServingStore as rebuild } from '../dist/feature-serving-adapter.js';
import { openFeatureSnapshotStore } from '../dist/feature-snapshot-store.js';
import { evaluateTransactionRisk } from '@lmps/risk';
import { riskFixture } from '../../../packages/risk/fixtures/request.mjs';
const corpusBytes = readFileSync(new URL('../../../packages/risk/test/fixtures/feature-streams/golden.json', import.meta.url));
const corpus = JSON.parse(corpusBytes);
const plan = { version: 'synthetic-feature-stream-1', identity: 'synthetic_declared', run_id: 'synthetic_run', input_identity: 'synthetic_golden_v1',
  namespace: 'synthetic_golden', topic: 'synthetic_golden.synthetic_run', window_seconds: 3600, coverage_start: corpus.coverage_start,
  queries: corpus.snapshots.map(({ expected, ...q }) => q), limits: { records: 32, revisions: 32, snapshots: 8, capture_bytes: 32768, state_bytes: 1048576 } };
const scope = { version: 'synthetic-feature-serving-1', mode: 'local_synthetic', workspace_key: 'synthetic_adapter', plan,
  policy: { id: 'synthetic_fixture', version: 'synthetic_v1', max_age_seconds: 3600 } };
const at = '2026-01-01T12:01:00Z', expiry = '2026-01-02T12:01:00Z';
const deliveries = corpus.events.map((event, offset) => ({ identity: plan.identity, topic: plan.topic, partition: 0, offset, event }));
const fixed = [['11', '14.11', null], ['11', '13.14', null], [null, null, 'INPUT_MISSING'], [null, null, 'HISTORY_INCOMPLETE'], ['11', '13.14', null], ['1', '7.00', null]];
const invalid = f => assert.throws(f, e => e.code === 'FEATURE_SERVING_INVALID');
function paths(t) { const root = mkdtempSync(fileURLToPath(new URL('../.adapter-test-', import.meta.url))); chmodSync(root, 0o700); t.after(() => rmSync(root, { recursive: true, force: true })); return { root, c: join(root, 'consumer'), s: join(root, 'store') }; }
const request = (i = 0, extra = {}) => ({ version: scope.version, workspace_key: scope.workspace_key, plan, query: plan.queries[i], currency: plan.queries[i].currency, policy: scope.policy, now: at, ...extra });

test('actual golden consumer -> durable store -> serving, fixed and unchanged reference parity, retry/reopen/rebuild', t => {
  assert.ok(corpusBytes.length <= 32768 && deliveries.length <= 32);
  const { root, c, s } = paths(t), before = structuredClone({ scope, deliveries });
  let a = open(c, s, scope); assert.equal(a.serve(request()).reason, 'PUBLICATION_MISSING');
  const receipt = a.publish(deliveries, at, expiry), publication = a.read();
  assert.equal(receipt.generation, 1); assert.equal(receipt.next_offset, 18);
  assert.equal(publication.state.snapshots.length, 6);
  for (const [i, q] of plan.queries.entries()) {
    const r = a.serve(request(i)); assert.deepEqual([r.count, r.amount, r.reason], fixed[i]);
    const snap = publication.state.snapshots[i];
    assert.deepEqual(Object.fromEntries(Object.keys(corpus.snapshots[i].expected).map(k => [k, snap[k]])), corpus.snapshots[i].expected);
    const { request: req, observation } = riskFixture();
    const target = corpus.events.find(e => e.transaction_id === q.target);
    req.target = { namespace: target.namespace, transaction_id: target.transaction_id, revision_number: target.revision_number }; req.policy.currency = q.currency;
    Object.assign(req.context, { binding: { ...req.target, revision_sha256: observation.revision_sha256 }, as_of: q.as_of, coverage_start: plan.coverage_start,
      coverage_complete: q.coverage_complete, events: structuredClone(corpus.events), flagged_accounts: q.flags_available ? [] : null, flagged_accounts_version: q.flags_available ? 'synthetic_empty_v1' : null });
    Object.assign(observation, { amount: target.amount, reversed_amount: target.reversed_amount, currency: target.currency, transaction_status: target.status, observed_at: q.as_of });
    if (q.evidence === 'missing') for (const key of Object.keys(observation)) observation[key] = key === 'status' ? 'missing' : null;
    const reference = evaluateTransactionRisk(req, observation);
    for (const [code, expected] of [['FRAUD_COUNT_VELOCITY', fixed[i][0]], ['FRAUD_AMOUNT_VELOCITY', fixed[i][1]]]) assert.equal(reference.findings.find(f => f.code === code).metric?.value ?? null, expected);
  }
  assert.deepEqual({ scope, deliveries }, before);
  const file = join(s, 'publication.json'), inode = statSync(file).ino;
  assert.deepEqual(a.publish(deliveries, at, expiry), receipt); assert.equal(statSync(file).ino, inode);
  a.close(); a = open(c, s, scope); assert.deepEqual(a.publish(deliveries, at, expiry), receipt);
  const detached = a.read(); detached.state.snapshots[0].amount = '0.00'; assert.equal(a.read().state.snapshots[0].amount, '14.11');
  assert.equal(a.serve(request(0, { now: '2026-01-01T13:00:00Z' })).status, 'available');
  assert.equal(a.serve(request(0, { now: '2026-01-01T13:00:01Z' })).reason, 'SOURCE_STALE');
  assert.equal(a.serve(request(0, { now: expiry })).reason, 'PUBLICATION_EXPIRED');
  assert.equal(a.serve(request(0, { minimum_generation: 2 })).reason, 'GENERATION_TOO_OLD');
  a.close();
  const destination = join(root, 'rebuilt'); assert.equal(rebuild(c, destination, scope, at, expiry).generation, 1);
  const b = open(c, destination, scope); assert.deepEqual(b.read().state, publication.state); assert.equal(b.serve(request()).amount, '14.11'); b.close();
  invalid(() => rebuild(c, s, scope, at, expiry)); invalid(() => rebuild(c, c, scope, at, expiry));
  a = open(c, s, scope); a.publish([], '2026-01-01T12:02:00Z', expiry); a.close();
  const store = openFeatureSnapshotStore(s, scope); invalid(() => store.publish(publication)); assert.equal(store.receipt().generation, 2); store.close();
});

test('separate commit failure before/after publish retains ACK and converges after close/reopen', t => {
  for (const point of ['before_publish', 'after_publish']) {
    const { c, s } = paths(t); const a = open(c, s, scope, p => { if (p === point) throw Error('unit'); });
    invalid(() => a.publish(deliveries, at, expiry));
    const checkpoint = JSON.parse(readFileSync(join(c, 'checkpoint.json'))); assert.equal(checkpoint.next_offset, 18); assert.equal(checkpoint.state.snapshots.length, 6);
    invalid(() => a.serve(request())); a.close(); const b = open(c, s, scope);
    assert.equal(b.publish(deliveries, at, expiry).generation, 1); assert.equal(b.serve(request()).amount, '14.11'); b.close();
  }
});

test('controlled prefix close/reopen extends source while preserving frozen snapshots and failed input bytes', t => {
  const { c, s } = paths(t); let a = open(c, s, scope);
  a.publish(deliveries.slice(0, -1), at, expiry); const frozen = a.read().state.snapshots;
  assert.equal(frozen[1].amount, '14.11'); a.close(); a = open(c, s, scope);
  assert.equal(a.publish(deliveries, at, expiry).generation, 2);
  assert.equal(a.receipt().next_offset, 18); assert.deepEqual(a.read().state.snapshots, frozen);
  const bytes = readFileSync(join(c, 'checkpoint.json')), store = readFileSync(join(s, 'publication.json'));
  invalid(() => a.publish([{ ...deliveries[0], event: { ...deliveries[0].event, amount: '99.00' } }], at, expiry));
  invalid(() => a.publish([{ ...deliveries[0], offset: 19 }], at, expiry));
  invalid(() => a.publish([], '2026-02-30T12:01:00Z', expiry));
  invalid(() => a.publish([], at, '2026-01-02T12:01:01Z'));
  assert.deepEqual(readFileSync(join(c, 'checkpoint.json')), bytes); assert.deepEqual(readFileSync(join(s, 'publication.json')), store);
  a.close(); invalid(() => a.publish([], at, expiry));
});

test('scope, namespace, query, currency, policy and ownership isolation; no input getters', t => {
  const { c, s, root } = paths(t); const a = open(c, s, scope); a.publish(deliveries, at, expiry);
  for (const extra of [{ workspace_key: 'synthetic_other' }, { plan: { ...plan, namespace: 'synthetic_other', topic: 'synthetic_other.synthetic_run' } }]) assert.equal(a.serve(request(0, extra)).reason, 'SCOPE_MISMATCH');
  assert.equal(a.serve(request(0, { policy: { ...scope.policy, version: 'synthetic_other' } })).reason, 'POLICY_MISMATCH');
  invalid(() => a.serve(request(0, { currency: 'ALT' }))); invalid(() => a.serve(request(0, { query: { ...plan.queries[0], as_of: at } })));
  invalid(() => open(c, s, scope)); invalid(() => open(c, join(c, 'child'), scope));
  const checkpoint = readFileSync(join(c, 'checkpoint.json'));
  const getter = []; Object.defineProperty(getter, '0', { enumerable: true, get() { throw Error('must not invoke'); } }); invalid(() => a.publish(getter, at, expiry));
  invalid(() => a.publish([{ ...deliveries[0], event: { ...deliveries[0].event, namespace: 'synthetic_other' } }], at, expiry));
  assert.deepEqual(readFileSync(join(c, 'checkpoint.json')), checkpoint); a.close();
  invalid(() => open(c, s, { ...scope, workspace_key: 'synthetic_other' }));
  invalid(() => open(c, join(root, 'changed'), { ...scope, plan: { ...plan, input_identity: 'synthetic_other' } }));
  const empty = join(root, 'empty'); mkdirSync(empty, { mode: 0o700 }); invalid(() => rebuild(c, empty, scope, at, expiry));
});

test('closed corruption/missing checkpoint, unsafe files and stranded locks retain evidence', t => {
  const { c, s, root } = paths(t); const a = open(c, s, scope); a.publish(deliveries, at, expiry); a.close();
  const file = join(c, 'checkpoint.json'), original = readFileSync(file);
  for (const change of [v => v.extra = true, v => v.state_hash = 'forged', v => v.owner = 'forged', v => v.state.snapshots[0].amount = '0.00', v => v.next_offset--]) {
    const v = JSON.parse(original); change(v); const bad = JSON.stringify(v); writeFileSync(file, bad); invalid(() => open(c, s, scope)); assert.equal(readFileSync(file, 'utf8'), bad);
  }
  writeFileSync(file, original); chmodSync(file, 0o644); invalid(() => open(c, s, scope)); chmodSync(file, 0o600);
  linkSync(file, join(root, 'hard')); invalid(() => open(c, s, scope)); unlinkSync(join(root, 'hard'));
  unlinkSync(file); invalid(() => open(c, s, scope)); assert.equal(existsSync(file), false);
  symlinkSync(join(c, 'owner.json'), file); invalid(() => open(c, s, scope)); unlinkSync(file);
  execFileSync('mkfifo', ['-m', '600', file]); invalid(() => open(c, s, scope)); unlinkSync(file); writeFileSync(file, original, { mode: 0o600 });
  writeFileSync(file, Buffer.alloc(1048577)); invalid(() => open(c, s, scope)); assert.equal(statSync(file).size, 1048577); writeFileSync(file, original);
  writeFileSync(join(c, 'writer.lock'), 'ambiguous', { mode: 0o600 }); invalid(() => open(c, s, scope)); assert.equal(readFileSync(join(c, 'writer.lock'), 'utf8'), 'ambiguous');
});

test('bounded positioned input and eight frozen snapshots, one-over rejects without consumer changes', t => {
  const { c, s } = paths(t); const config = structuredClone(scope);
  config.plan.limits.records = 2000; config.plan.limits.revisions = 2000; config.plan.limits.capture_bytes = 2097152;
  config.plan.queries.push({ ...plan.queries[0], id: 'extra_seven' }, { ...plan.queries[0], id: 'extra_eight' });
  const input = Array.from({ length: 2000 }, (_, offset) => ({ ...(deliveries[offset] ?? deliveries[0]), offset }));
  const a = open(c, s, config), before = readFileSync(join(c, 'checkpoint.json'));
  invalid(() => a.publish([...input, { ...deliveries[0], offset: 2000 }], at, expiry)); assert.deepEqual(readFileSync(join(c, 'checkpoint.json')), before);
  assert.equal(a.publish(input, at, expiry).next_offset, 2000); assert.equal(a.read().state.snapshots.length, 8);
  const full = readFileSync(join(c, 'checkpoint.json')); invalid(() => a.publish([{ ...deliveries[0], offset: 2000 }], at, expiry)); assert.deepEqual(readFileSync(join(c, 'checkpoint.json')), full); a.close();
  config.plan.queries.push({ ...plan.queries[0], id: 'extra_nine' }); invalid(() => open(c, s, config));
});

test('import is inert and cwd-independent', () => {
  const module = new URL('../dist/feature-serving-adapter.js', import.meta.url).href;
  execFileSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(module)})`], { cwd: fileURLToPath(new URL('../../../packages/risk', import.meta.url)) });
});
