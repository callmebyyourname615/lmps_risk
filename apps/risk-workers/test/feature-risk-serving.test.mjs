import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, chmodSync, rmSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { serveFeatureRisk, FeatureRiskStorageUnavailableError } from '../dist/feature-risk-serving.js';
import { openFeatureServingAdapter } from '../dist/feature-serving-adapter.js';
import { replayFeatureRisk, compareFeatureRiskReplay } from '../dist/feature-risk-replay.js';
import { FeatureServingError, featurePublicationContentHash } from '@lmps/contracts/feature-serving';
import { riskHash } from '@lmps/risk';
import { riskFixture } from '../../../packages/risk/fixtures/request.mjs';

function fixture({ missing = false, partial = false, zero = false } = {}) {
  const { request, observation } = riskFixture();
  request.context = null;
  observation.amount = zero ? '0.00' : '10.00'; observation.observed_at = '2026-01-01T12:00:00Z';
  const query = { id: 'current', target: request.target.transaction_id, as_of: observation.observed_at,
    currency: 'SYN', evidence: missing ? 'missing' : 'available', coverage_complete: !partial, flags_available: false };
  const plan = { version: 'synthetic-feature-stream-1', identity: 'synthetic_declared', run_id: 'synthetic_run', input_identity: 'synthetic_serving',
    namespace: request.target.namespace, topic: request.target.namespace + '.synthetic_run', window_seconds: 3600,
    coverage_start: '2026-01-01T08:00:00Z', queries: [query],
    limits: { records: 32, revisions: 32, snapshots: 8, capture_bytes: 32768, state_bytes: 1048576 } };
  const scope = { version: 'synthetic-feature-serving-1', mode: 'local_synthetic', workspace_key: request.workspace_key, plan,
    policy: { id: 'synthetic_fixture', version: 'synthetic_v1', max_age_seconds: 120 } };
  const serving_request = { version: scope.version, workspace_key: scope.workspace_key, plan, query,
    currency: 'SYN', policy: scope.policy, now: '2026-01-01T12:02:00Z' };
  const event = (transaction_id, amount, extra = {}) => ({ ...request.target, transaction_id, amount,
    reversed_amount: '0.00', currency: 'SYN', status: 'succeeded', sender: 'synthetic_A', receiver: 'synthetic_B',
    occurred_at: '2026-01-01T11:30:00Z', available_at: '2026-01-01T11:30:00Z', ...extra });
  const events = [event(request.target.transaction_id, observation.amount, { occurred_at: query.as_of, available_at: query.as_of })];
  if (!zero) events.push(event('synthetic_prior', '1.01'), event('synthetic_prior', '1.01'),
    event('synthetic_prior', '1.01', { revision_number: 2, reversed_amount: '0.01', status: 'partially_reversed' }),
    event('synthetic_reversed', '9.00', { reversed_amount: '9.00', status: 'reversed' }),
    event('synthetic_future', '999.00', { available_at: '2026-01-01T12:00:01Z' }));
  const deliveries = events.map((event, offset) => ({ identity: plan.identity, topic: plan.topic, partition: 0, offset, event }));
  return { scope, serving_request, risk_request: request, observation, deliveries };
}
const at = '2026-01-01T12:00:00Z', expiry = '2026-01-01T13:00:00Z';
const assess = (store, f) => serveFeatureRisk(store, f.scope, f.serving_request, f.risk_request, f.observation);
const tuple = f => ({ serving_request: f.serving_request, risk_request: f.risk_request, observation: f.observation });
function local(t, f) {
  const root = mkdtempSync(fileURLToPath(new URL('../.risk-serving-test-', import.meta.url)));
  chmodSync(root, 0o700);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const consumer = join(root, 'consumer'), directory = join(root, 'store');
  return { directory, open: (scope = f.scope) => openFeatureServingAdapter(consumer, directory, scope) };
}
function parity(store, f) {
  const result = assess(store, f), publication = store.read();
  const replay = replayFeatureRisk(publication, f.scope, [tuple(f)]);
  assert.equal(compareFeatureRiskReplay(publication, f.scope, [tuple(f)], [result]).status, 'match');
  assert.equal(replay.rows[0].assessment_sha256, riskHash(result.assessment));
  assert.deepEqual(replay.rows[0].context, result.context);
  return result;
}

test('actual private persisted adapter: missing, correction/reversal/duplicate, retry, close/reopen and later generation', t => {
  const f = fixture(), disk = local(t, f), before = structuredClone(f);
  let store = disk.open();
  let old;
  try {
    assert.equal(parity(store, f).feature.reason, 'PUBLICATION_MISSING');
    assert.equal(store.publish(f.deliveries, at, expiry).generation, 1);
    old = parity(store, f);
    assert.equal(old.assessment.findings.length, 15);
    const metric = code => old.assessment.findings.find(x => x.code === code).metric.value;
    assert.equal(metric('FRAUD_COUNT_VELOCITY'), '2'); assert.equal(metric('FRAUD_AMOUNT_VELOCITY'), '11.00');
    assert.equal(old.assessment.findings.find(x => x.code === 'MULE_FLAGGED_NEIGHBOR').reason_code, 'FLAGS_UNAVAILABLE');
    assert.equal(store.publish(f.deliveries, at, expiry).generation, 1);
    assert.deepEqual(parity(store, f), old);
    const bytes = readFileSync(join(disk.directory, 'publication.json'));
    assert.equal(JSON.parse(bytes).publication.content_hash, old.publication.content_hash);
    const detached = assess(store, f); detached.assessment.findings.length = 0;
    assert.deepEqual(assess(store, f), old);
  } finally { store.close(); }
  store = disk.open();
  try {
    assert.deepEqual(parity(store, f), old);
    const correction = { ...f.deliveries[0], offset: f.deliveries.length,
      event: { ...f.deliveries[0].event, revision_number: 2, amount: '999.00', available_at: '2026-01-01T12:00:01Z' } };
    assert.equal(store.publish([...f.deliveries, correction], at, expiry).generation, 2);
    const next = parity(store, f);
    assert.equal(next.publication.generation, 2);
    assert.deepEqual(next.assessment, old.assessment);
    assert.equal(next.lineage.source_prefix, old.lineage.source_prefix);
    assert.notEqual(next.publication.content_hash, old.publication.content_hash);
    assert.deepEqual(f, before);
  } finally { store.close(); }
  store = disk.open(); try { assert.equal(parity(store, f).publication.generation, 2); } finally { store.close(); }
});

test('persisted missing/partial/zero, age boundary, expiry and minimum generation preserve withholding and replay hashes', t => {
  for (const options of [{ missing: true }, { partial: true }, { zero: true }, {}]) {
    const f = fixture(options), disk = local(t, f), store = disk.open();
    try {
      store.publish(f.deliveries, at, expiry);
      const result = parity(store, f);
      assert.equal(result.production_ready, false);
      assert.equal(result.feature.reason, options.missing ? 'INPUT_MISSING' : options.partial ? 'HISTORY_INCOMPLETE' : null);
      if (options.missing || options.partial) assert.equal(result.context.status, 'withheld');
      if (options.zero) assert.equal(result.feature.amount, '0.00');
      for (const [extra, reason] of [[{ now: '2026-01-01T12:02:01Z' }, 'SOURCE_STALE'],
        [{ now: expiry }, 'PUBLICATION_EXPIRED'], [{ minimum_generation: 2 }, 'GENERATION_TOO_OLD']]) {
        const changed = { ...f, serving_request: { ...f.serving_request, ...extra } };
        const unavailable = parity(store, changed);
        const expected = reason === 'SOURCE_STALE' && (options.missing || options.partial)
          ? options.missing ? 'INPUT_MISSING' : 'HISTORY_INCOMPLETE' : reason;
        assert.equal(unavailable.feature.reason, expected); assert.equal(unavailable.context.status, 'withheld');
      }
    } finally { store.close(); }
  }
});

test('unit seam: all inputs validated/detached before exactly one read; unexpected exceptions retain identity', () => {
  const f = fixture(); let reads = 0;
  const reader = { read() { reads++; return null; } };
  const invalid = [x => { x.scope.extra = true; }, x => { x.scope.mode = 'production'; },
    x => { x.serving_request.workspace_key = 'synthetic_other'; }, x => { x.serving_request.plan = { ...x.serving_request.plan, input_identity: 'synthetic_other' }; },
    x => { x.risk_request.context = {}; }, x => { x.observation.observed_at = '2026-01-01T12:00:01Z'; },
    x => { x.risk_request.policy.currency = 'USD'; }, x => { x.serving_request.query.as_of = 'bad'; }];
  for (const change of invalid) { const v = structuredClone(f); change(v); assert.throws(() => assess(reader, v)); }
  assert.throws(() => assess(reader, { ...f, observation: { get status() { assert.fail('getter ran'); } } }));
  assert.equal(reads, 0);
  assert.equal(assess(reader, f).feature.reason, 'PUBLICATION_MISSING'); assert.equal(reads, 1);
  assert.throws(() => assess({ read() { throw new FeatureServingError(); } }, f), FeatureRiskStorageUnavailableError);
  const unexpected = new Error('unit unexpected');
  assert.throws(() => assess({ read() { throw unexpected; } }, f), error => error === unexpected);
  assert.throws(() => assess({ read: () => ({ status: 'available', count: '2', amount: '11.00' }) }, f));
});

test('unit seam: caller mutation during a read cannot change frozen requests, and async/summary readers are rejected', t => {
  const f = fixture(), disk = local(t, f), store = disk.open();
  try {
    store.publish(f.deliveries, at, expiry);
    const publication = store.read(), saved = structuredClone(publication), expected = assess(store, f);
    let reads = 0;
    const result = assess({ read() {
      reads++;
      f.risk_request.policy.version = 'synthetic_later';
      f.serving_request.now = expiry;
      f.observation.revision_sha256 = 'b'.repeat(64);
      return publication;
    } }, f);
    assert.equal(reads, 1); assert.deepEqual(result, expected); assert.deepEqual(publication, saved);
    result.feature.provenance.publication.state.snapshots[0].amount = '0.00';
    assert.deepEqual(publication, saved);
    assert.throws(() => assess({ read: () => Promise.resolve(publication) }, fixture()));
    const future = fixture(); future.serving_request.now = '2026-01-01T11:59:59Z';
    const withheld = assess(store, future);
    assert.equal(withheld.feature.reason, 'FUTURE_PUBLICATION'); assert.equal(withheld.context.status, 'withheld');
  } finally { store.close(); }
});

test('actual persisted read outage/corruption is typed unavailable; scope mismatch and forged publication fail closed', t => {
  const f = fixture(), disk = local(t, f), store = disk.open();
  store.publish(f.deliveries, at, expiry);
  const file = join(disk.directory, 'publication.json'), bytes = readFileSync(file);
  try {
    // Exercise an actual filesystem outage rather than only a throwing reader.
    const offline = join(disk.directory, 'publication.offline');
    renameSync(file, offline);
    try { assert.throws(() => assess(store, f), FeatureRiskStorageUnavailableError); }
    finally { renameSync(offline, file); }
    assert.equal(assess(store, f).feature.status, 'available');
    writeFileSync(file, 'corrupt');
    assert.throws(() => assess(store, f), FeatureRiskStorageUnavailableError);
  } finally { writeFileSync(file, bytes); store.close(); }
  assert.throws(() => assess(store, f), FeatureRiskStorageUnavailableError);
  const otherScope = structuredClone(f.scope);
  otherScope.workspace_key = 'synthetic_other';
  assert.throws(() => disk.open(otherScope), FeatureServingError);
  const reopened = disk.open();
  try {
    const p = reopened.read();
    const wrong = structuredClone(p); wrong.scope.workspace_key = 'synthetic_other';
    wrong.content_hash = featurePublicationContentHash(wrong);
    const mismatch = assess({ read: () => wrong }, f);
    assert.equal(mismatch.feature.reason, 'SCOPE_MISMATCH'); assert.equal(mismatch.context.status, 'withheld');
    p.state.snapshots[0].amount = '0.00'; p.content_hash = featurePublicationContentHash(p);
    assert.throws(() => assess({ read: () => p }, f));
    const dto = reopened.serve(f.serving_request);
    assert.throws(() => assess({ read: () => dto }, f));
  } finally { reopened.close(); }
  writeFileSync(file, 'corrupt');
  assert.throws(() => disk.open(), FeatureServingError);
  writeFileSync(file, bytes);
});

test('import is inert in a separate bounded process', () => {
  execFileSync(process.execPath, ['--input-type=module', '-e',
    `await import(${JSON.stringify(new URL('../dist/feature-risk-serving.js', import.meta.url).href)})`], { timeout: 10000 });
});
