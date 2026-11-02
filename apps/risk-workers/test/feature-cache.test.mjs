import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { testFeatureCache, openFeatureCache, FEATURE_CACHE_CAS, FEATURE_CACHE_LIMITS, validateFeatureCacheBytes } from '../dist/feature-cache.js';
import { initializeFeatureStream, applyFeatureStreamDelivery, materializeFeatureStreamSnapshot } from '@lmps/risk';
import { featurePublicationContentHash } from '@lmps/contracts/feature-serving';

const corpus = JSON.parse(readFileSync(new URL('../../../packages/risk/test/fixtures/feature-streams/golden.json', import.meta.url)));
const plan = { version: 'synthetic-feature-stream-1', identity: 'synthetic_declared', run_id: 'synthetic_run', input_identity: 'synthetic_golden_v1',
  namespace: 'synthetic_golden', topic: 'synthetic_golden.synthetic_run', window_seconds: 3600, coverage_start: corpus.coverage_start,
  queries: corpus.snapshots.map(({ expected, ...q }) => q), limits: { records: 32, revisions: 32, snapshots: 8, capture_bytes: 32768, state_bytes: 1048576 } };
const scope = { version: 'synthetic-feature-serving-1', mode: 'local_synthetic', workspace_key: 'synthetic_cache', plan,
  policy: { id: 'synthetic_fixture', version: 'synthetic_v1', max_age_seconds: 3600 } };
const at = '2026-01-01T12:01:00Z', expires = '2026-01-02T12:01:00Z';
function publication(config = scope, events = corpus.events) {
  let state = initializeFeatureStream(config.plan);
  events.forEach((event, offset) => { state = applyFeatureStreamDelivery(state, { identity: plan.identity, topic: config.plan.topic, partition: 0, offset, event }); });
  for (const q of config.plan.queries) state = materializeFeatureStreamSnapshot(state, q.id).state;
  return signed({ version: config.version, scope: config, generation: 1, predecessor: null, state, published_at: at, expires_at: expires, content_hash: Array(8).fill('00000000').join('-') });
}
function signed(p) { p.content_hash = featurePublicationContentHash(p); return p; }
const req = (i = 0, extra = {}) => ({ version: scope.version, workspace_key: scope.workspace_key, plan, query: plan.queries[i], currency: plan.queries[i].currency, policy: scope.policy, now: at, ...extra });
const rejected = p => assert.rejects(p);

/** Deliberate atomic model only. These tests do NOT execute Redis/Lua and cannot
 * prove native atomicity. Host acceptance must run the actual exported script. */
function model() {
  return {
    value: null, extraKeys: 0, calls: [], failure: false, hang: false,
    ready: () => true,
    receipt: () => ({ mode: 'local_synthetic', unit_only: true, native_acceptance: false, production_ready: false,
      binarySha256: '48a07c38 92d5982a 1af6c3fb b9db896b 50e7aa56 4b1d4e6a bcb12fcb 6b6b6e0d'.replaceAll(' ', '') }),
    async request(args) {
      this.calls.push(args);
      if (this.failure) throw Error('private diagnostics');
      if (this.hang) return new Promise(() => {});
      if (args[0] === 'GET') return this.value;
      assert.equal(args[0], 'EVAL'); assert.equal(args[1], FEATURE_CACHE_CAS); assert.equal(args[2], '1');
      const text = args[4], n = JSON.parse(text), p = this.value && JSON.parse(this.value);
      if (this.extraKeys || Buffer.byteLength(text) > 1048576) return 'capacity';
      if (p) {
        if (p.scope !== n.scope) return 'conflict';
        if (text === this.value) return 'idempotent';
        if (args[5] === 'rebuild') return 'conflict';
        if (createHash('sha1').update(this.value).digest('hex') !== args[6]) return 'conflict';
        if (n.generation !== p.generation + 1 || n.previous_generation !== p.generation || n.previous_hash !== p.hash) return 'conflict';
      } else if (args[6] !== '' || args[5] !== 'rebuild' && (n.generation !== 1 || n.previous_generation !== 0)) return 'conflict';
      this.value = text; return 'published';
    },
  };
}

test('full arithmetic, fixed expected values, idempotence and source freshness', async () => {
  const r = model(), a = testFeatureCache(r, scope), p = publication();
  assert.equal((await a.serve(req())).reason, 'PUBLICATION_MISSING');
  assert.equal((await a.publish(p)).status, 'published');
  const bytes = r.value;
  assert.equal((await a.publish(p)).status, 'idempotent'); assert.equal(r.value, bytes);
  const expected = [['11', '14.11', null], ['11', '13.14', null], [null, null, 'INPUT_MISSING'], [null, null, 'HISTORY_INCOMPLETE'], ['11', '13.14', null], ['1', '7.00', null]];
  for (let i = 0; i < expected.length; i++) { const s = await a.serve(req(i)); assert.deepEqual([s.count, s.amount, s.reason], expected[i]); }
  assert.equal((await a.serve(req(0, { now: '2026-01-01T13:00:00Z' }))).status, 'available');
  const stale = await a.serve(req(0, { now: '2026-01-01T13:00:01Z' })); assert.equal(stale.reason, 'SOURCE_STALE'); assert.equal(stale.source_age_seconds, 3601); assert.equal(stale.amount, null);
  assert.equal((await a.serve(req(0, { now: expires }))).reason, 'PUBLICATION_EXPIRED');
  assert.equal((await a.serve(req(0, { now: '2026-01-01T11:59:59Z' }))).reason, 'FUTURE_PUBLICATION');
  assert.equal((await a.serve(req(0, { minimum_generation: 2 }))).reason, 'GENERATION_TOO_OLD');
  assert.equal(r.value, bytes);
});

test('competing generation, changed retry, stale predecessor/rebuild and cross-scope cannot mutate winner', async () => {
  const r = model(), a = testFeatureCache(r, scope), b = testFeatureCache(r, scope), first = publication();
  await a.publish(first);
  const next = signed({ ...first, generation: 2, predecessor: { generation: 1, content_hash: first.content_hash }, published_at: '2026-01-01T12:02:00Z' });
  const firstBytes = r.value; await rejected(a.rebuild(next)); assert.equal(r.value, firstBytes);
  const rival = signed({ ...next, published_at: '2026-01-01T12:03:00Z' });
  const results = await Promise.allSettled([a.publish(next), b.publish(rival)]);
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
  const winner = r.value;
  await rejected(a.publish(first)); await rejected(a.rebuild(first));
  await rejected(a.publish(signed({ ...next, generation: 3, predecessor: { generation: 2, content_hash: first.content_hash } })));
  const foreignScope = { ...scope, workspace_key: 'synthetic_other' };
  await rejected(testFeatureCache(r, foreignScope).publish(publication(foreignScope)));
  assert.equal(r.value, winner);
  const fresh = model(), rebuilt = testFeatureCache(fresh, scope); await rebuilt.rebuild(next);
  assert.equal((await rebuilt.serve(req(0, { now: '2026-01-01T12:03:00Z' }))).amount, '14.11');
});

test('scope/currency/query isolation before IO; tamper and invalid arithmetic fail closed', async () => {
  const r = model(), a = testFeatureCache(r, scope), p = publication(); await a.publish(p);
  const original = r.value, calls = r.calls.length;
  assert.equal((await a.serve(req(0, { workspace_key: 'synthetic_other' }))).reason, 'SCOPE_MISMATCH');
  assert.equal((await a.serve(req(0, { policy: { ...scope.policy, version: 'synthetic_other' } }))).reason, 'POLICY_MISMATCH');
  await rejected(a.serve(req(0, { currency: 'ALT' }))); await rejected(a.serve(req(0, { query: { ...plan.queries[0], id: 'unknown' } })));
  assert.equal(r.calls.length, calls);
  for (const change of [x => x.content_hash = p.predecessor, x => x.state.snapshots[0].amount = '0.00', x => x.extra = true, x => x.scope.plan.input_identity = 'synthetic_other']) {
    const bad = structuredClone(p); change(bad); await rejected(a.publish(bad)); assert.equal(r.value, original);
  }
  for (const text of ['{', '{}', original.replace('14.11', '99.99'), original + ' ', 'x'.repeat(1048577)]) {
    r.value = text; const s = await a.serve(req()); assert.equal(s.reason, 'CACHE_INVALID'); assert.equal(s.count, null); assert.equal(r.value, text);
  }
});

test('capacity rejection and outage/timeout retain nulls and failed-operation state', async () => {
  const r = model(), a = testFeatureCache(r, scope), p = publication();
  assert.equal(a.capability.keys, 1); assert.equal(a.capability.bytes, 1048576);
  r.extraKeys = 1; await rejected(a.publish(p)); assert.equal(r.value, null);
  r.extraKeys = 0; await a.publish(p); const before = r.value;
  r.failure = true; await rejected(a.publish(p)); assert.equal(r.value, before);
  const down = await a.serve(req()); assert.deepEqual([down.reason, down.count, down.amount, down.provenance], ['CACHE_UNAVAILABLE', null, null, null]);
  r.failure = false; r.hang = true;
  assert.equal((await a.serve(req())).reason, 'CACHE_UNAVAILABLE'); assert.equal(r.value, before);
  assert.throws(() => openFeatureCache(r, scope));
  const config = structuredClone(scope); config.plan.limits.records = 2001; assert.throws(() => testFeatureCache(r, config));
  assert.equal(FEATURE_CACHE_LIMITS.records, 2000);
  validateFeatureCacheBytes('a'.repeat(1048576));
  assert.throws(() => validateFeatureCacheBytes('a'.repeat(1048577)));
  validateFeatureCacheBytes('é'.repeat(524288));
  assert.throws(() => validateFeatureCacheBytes('é'.repeat(524288) + 'a'));
});

test('valid zero is not unavailable and recent publication does not refresh source', async () => {
  const config = structuredClone(scope); config.plan.queries = [config.plan.queries[0]];
  const p = signed({ ...publication(config), published_at: '2026-01-01T13:00:01Z' }), r = model(), a = testFeatureCache(r, config);
  await a.publish(p);
  const request = { ...req(), plan: config.plan, query: config.plan.queries[0], now: '2026-01-01T13:00:01Z' };
  assert.equal((await a.serve(request)).reason, 'SOURCE_STALE');
  // A failed target has known evidence but contributes neither count nor net.
  const zeroConfig = structuredClone(scope); zeroConfig.plan.queries = [zeroConfig.plan.queries[0]];
  const zero = publication(zeroConfig, [{ ...corpus.events[0], status: 'failed' }]), z = testFeatureCache(model(), zeroConfig); await z.publish(zero);
  const result = await z.serve({ ...req(), plan: zeroConfig.plan, query: zeroConfig.plan.queries[0] });
  assert.deepEqual([result.status, result.count, result.amount], ['available', '0', '0.00']);
});

test('finite plan bounds, future source, partial snapshot and corrupt prior block mutation', async () => {
  const full = structuredClone(scope);
  full.plan.limits.records = 2000; full.plan.limits.revisions = 2000;
  full.plan.queries.push({ ...plan.queries[0], id: 'extra_seven' }, { ...plan.queries[0], id: 'extra_eight' });
  const a = testFeatureCache(model(), full); await a.publish(publication(full));
  const ninth = structuredClone(full); ninth.plan.queries.push({ ...plan.queries[0], id: 'extra_nine' });
  assert.throws(() => testFeatureCache(model(), ninth));
  const tooMany = structuredClone(full); tooMany.plan.limits.records++; assert.throws(() => testFeatureCache(model(), tooMany));
  const r = model(), b = testFeatureCache(r, scope), p = publication();
  p.state = initializeFeatureStream(plan); p.published_at = '2026-01-01T11:00:00Z'; p.expires_at = '2026-01-02T11:00:00Z'; signed(p); await b.publish(p);
  assert.equal((await b.serve(req(0, { now: '2026-01-01T11:30:00Z' }))).reason, 'FUTURE_EVIDENCE');
  assert.equal((await b.serve(req())).reason, 'QUERY_MISSING');
  const changed = JSON.parse(r.value); changed.publication.content_hash = Array(8).fill('11111111').join('-');
  r.value = JSON.stringify(changed); const bytes = r.value;
  await rejected(b.publish(publication())); assert.equal(r.value, bytes);
});

test('import inert; script contains server-side atomic mutation and byte/key guards', () => {
  execFileSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(new URL('../dist/feature-cache.js', import.meta.url).href)})`]);
  assert.match(FEATURE_CACHE_CAS, /redis.call\('DBSIZE'\)/); assert.match(FEATURE_CACHE_CAS, /string.len\(ARGV\[1\]\) > 1048576/);
  assert.match(FEATURE_CACHE_CAS, /redis.call\('SET'/);
});
