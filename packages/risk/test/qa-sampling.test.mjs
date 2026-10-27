import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { selectQaSampling } from '../dist/index.js';
const boundary = { provenance: 'local_synthetic', execution_mode: 'test', simulation_only: true, enforcement: false, production_ready: false };
const version = 'synthetic-qa-sampling-1';
const now = '2026-10-25T00:00:00.000Z';
function fixture(n = 20) {
  const caller = { ...boundary, workspace_id: 'synthetic_workspace', client_id: 'synthetic_client' };
  const policy = { ...boundary, contract_version: version, policy_id: 'synthetic_policy', policy_version: 'synthetic_v1', as_of: now, seed: 'synthetic_seed', strata: [
    { stratum_id: 'synthetic_a', alert_status: 'alert', requested_count: 3 },
    { stratum_id: 'synthetic_b', alert_status: 'non_alert', requested_count: 3 },
    { stratum_id: 'synthetic_missing', alert_status: 'alert', requested_count: 1 },
  ] };
  const rows = Array.from({ length: n }, (_, i) => ({ fixture_id: `synthetic_row${i}`, stratum_id: i % 2 ? 'synthetic_b' : 'synthetic_a', alert_status: i % 2 ? 'non_alert' : 'alert', evidence: [
    { evidence_id: `synthetic_e${i}`, available_at: i % 3 ? now : '2026-10-25T00:00:00.001Z' },
    { evidence_id: `synthetic_old${i}`, available_at: '2026-10-24T00:00:00.000Z' },
  ] }));
  return [caller, { ...boundary, contract_version: version, pool_id: 'synthetic_pool', row_count: n, rows }, policy];
}
// Independent recursive canonical serializer; no production hash or selector utilities.
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
const hash = v => createHash('sha256').update(canonical(v)).digest('hex');
function reference([caller, pool, inputPolicy]) {
  const policy = structuredClone(inputPolicy);
  policy.strata.sort((a, b) => a.stratum_id < b.stratum_id ? -1 : 1);
  return policy.strata.map(s => pool.rows.filter(r => r.stratum_id === s.stratum_id && r.alert_status === s.alert_status && r.evidence.every(e => Date.parse(e.available_at) <= Date.parse(policy.as_of)))
    .map(r => [hash({ caller, policy_hash: hash(policy), seed: policy.seed, stratum_id: s.stratum_id, alert_status: s.alert_status, fixture_id: r.fixture_id }), r.fixture_id])
    .sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1)
    .slice(0, s.requested_count).map(x => x[1]));
}
test('independent reference, caller scope, reorder invariance and immutable inputs', () => {
  for (const n of [0, 1, 2, 9, 50, 101]) {
    const inputs = fixture(n), before = structuredClone(inputs);
    const result = selectQaSampling(...inputs);
    assert.deepEqual(result.strata.map(s => s.selected.map(r => r.fixture_id)), reference(inputs));
    assert.deepEqual(inputs, before);
    const reverse = structuredClone(inputs);
    reverse[1].rows.reverse().forEach(r => r.evidence.reverse()); reverse[2].strata.reverse();
    assert.deepEqual(selectQaSampling(...reverse), result);
    assert.equal(new Set(result.strata.flatMap(s => s.selected.map(r => r.fixture_id))).size, result.selected_count);
    const other = structuredClone(inputs); other[0].client_id = 'synthetic_other';
    assert.deepEqual(selectQaSampling(...other).strata.map(s => s.selected.map(r => r.fixture_id)), reference(other));
    assert.equal(result.population_claims, false);
    assert.deepEqual(Object.keys(result).sort(), ['caller','contract_version','enforcement','execution_mode','policy','policy_hash','pool_hash','pool_id','population_claims','production_ready','provenance','row_count','selected_count','simulation_only','strata'].sort());
    result.policy.seed = 'synthetic_changed'; assert.deepEqual(inputs, before);
  }
});
test('exact future counts, missing, insufficient, zero request and complete hashes', () => {
  const inputs = fixture(4), result = selectQaSampling(...inputs);
  assert.deepEqual(result.strata.map(s => [s.status,s.pool_count,s.eligible_count,s.excluded_future_evidence_count,s.fraction]), [
    ['insufficient',2,1,1,{numerator:1,denominator:2}], ['insufficient',2,1,1,{numerator:1,denominator:2}], ['missing',0,0,0,{numerator:0,denominator:0}],
  ]);
  const pool = structuredClone(inputs[1]); pool.rows.sort((a,b) => a.fixture_id < b.fixture_id ? -1 : 1); pool.rows.forEach(r => r.evidence.sort((a,b) => a.evidence_id < b.evidence_id ? -1 : 1));
  assert.equal(result.pool_hash, hash(pool)); assert.equal(result.policy_hash, hash(result.policy));
  inputs[1].rows[0].evidence[0].available_at = now;
  assert.notEqual(selectQaSampling(...inputs).pool_hash, result.pool_hash);
  inputs[2].strata[0].requested_count = 0;
  assert.equal(selectQaSampling(...inputs).strata[0].selected_count, 0);
});
test('reject duplicates, conflicts, undeclared strata, forbidden fields and caps with redacted errors', () => {
  const mutations = [
    x => { x[1].rows[1].fixture_id = x[1].rows[0].fixture_id; },
    x => { x[1].rows[0].alert_status = 'non_alert'; },
    x => { x[1].rows[0].stratum_id = 'synthetic_unknown'; },
    x => { x[1].row_count++; },
    x => { x[2].strata[0].requested_count = 1001; },
    x => { x[2].as_of = '2026-10-25'; },
    x => { x[0].training_eligible = true; },
    x => { x[1].rows[0].evidence = []; },
    x => { x[2].strata.push({...x[2].strata[0]}); },
  ];
  for (const mutate of mutations) {
    const inputs = fixture(); mutate(inputs); const before = structuredClone(inputs);
    assert.throws(() => selectQaSampling(...inputs), e => e.code === 'QA_SAMPLING_INVALID_INPUT' && !e.message.includes('synthetic_'));
    assert.deepEqual(inputs, before);
  }
});
test('maximum pool and selection remain bounded without replacement', () => {
  const inputs = fixture(10000); inputs[2].strata.forEach(s => { s.requested_count = s.stratum_id === 'synthetic_a' ? 1000 : 0; });
  const result = selectQaSampling(...inputs);
  assert.equal(result.selected_count, 1000); assert.equal(result.row_count, 10000);
});
test('forced canonical hash collisions use stable fixture ID tie-break', () => {
  const inputs = fixture(20);
  // Isolated process replaces the built-in hashing primitive before module loading.
  // This exercises real production sorting without a public ranking override.
  const script = `
    import crypto from 'node:crypto';
    import { syncBuiltinESMExports } from 'node:module';
    crypto.createHash = () => ({ update() { return this; }, digest() { return '0'.repeat(64); } });
    syncBuiltinESMExports();
    const { selectQaSampling } = await import(${JSON.stringify(new URL('../dist/index.js', import.meta.url).href)});
    const inputs = ${JSON.stringify(inputs)};
    const a = selectQaSampling(...inputs);
    inputs[1].rows.reverse();
    const b = selectQaSampling(...inputs);
    process.stdout.write(JSON.stringify([a,b]));
  `;
  const [a,b] = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' }));
  assert.deepEqual(a,b);
  for (const s of a.strata) {
    const expected = inputs[1].rows.filter(r => r.stratum_id === s.stratum_id && r.evidence.every(e => e.available_at <= now))
      .map(r => r.fixture_id).sort().slice(0, s.requested_count);
    assert.deepEqual(s.selected.map(r => r.fixture_id), expected);
  }
});
