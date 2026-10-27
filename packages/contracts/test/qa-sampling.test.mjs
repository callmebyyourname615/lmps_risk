import test from 'node:test';
import assert from 'node:assert/strict';
import * as q from '../dist/qa-sampling.js';

const boundary = q.QA_SAMPLING_BOUNDARY;
const version = { contract_version: q.QA_SAMPLING_VERSION };
const time = '2026-10-25T00:00:00.000Z';
const caller = () => ({ ...boundary, workspace_id: 'synthetic_workspace', client_id: 'synthetic_client' });
const row = (n = 0, status = 'alert') => ({ fixture_id: `synthetic_row_${n}`, stratum_id: `synthetic_${status}`,
  alert_status: status, evidence: [{ evidence_id: `synthetic_evidence_${n}`, available_at: time }] });
const policy = () => ({ ...boundary, ...version, policy_id: 'synthetic_policy', policy_version: 'synthetic_v1',
  as_of: time, seed: 'synthetic_public_seed', strata: [
    { stratum_id: 'synthetic_alert', alert_status: 'alert', requested_count: 1 },
    { stratum_id: 'synthetic_non_alert', alert_status: 'non_alert', requested_count: 1 },
  ] });
const pool = () => ({ ...boundary, ...version, pool_id: 'synthetic_pool', row_count: 2, rows: [row(), row(1, 'non_alert')] });
const result = () => ({ ...boundary, ...version, caller: caller(), pool_id: 'synthetic_pool',
  pool_hash: 'a'.repeat(64), policy_hash: 'b'.repeat(64), policy: policy(), population_claims: false,
  row_count: 2, selected_count: 2, strata: policy().strata.map((s, i) => ({ ...s, status: 'satisfied',
    pool_count: 1, eligible_count: 1, excluded_future_evidence_count: 0, selected_count: 1,
    fraction: { numerator: 1, denominator: 1 }, selected: [row(i, s.alert_status)] })) });
const rejectMutation = (factory, check, mutate) => { const value = factory(); mutate(value); assert.equal(check(value), false); };

test('valid caller/pool/policy/result round trips retain explicit evidence and strata without mutation', () => {
  for (const [factory, check, parse] of [[caller, q.isQaSamplingCaller, q.parseQaSamplingCaller],
    [pool, q.isQaSamplingPool, q.parseQaSamplingPool], [policy, q.isQaSamplingPolicy, q.parseQaSamplingPolicy],
    [result, q.isQaSamplingResult, q.parseQaSamplingResult]]) {
    const value = factory(); const before = structuredClone(value);
    assert.equal(check(value), true); assert.deepEqual(value, before); assert.deepEqual(parse(JSON.stringify(value)), value);
  }
});

test('every top-level contract requires exact boundaries and rejects coercion and extra claims', () => {
  for (const [factory, check] of [[caller, q.isQaSamplingCaller], [pool, q.isQaSamplingPool],
    [policy, q.isQaSamplingPolicy], [result, q.isQaSamplingResult]]) {
    for (const key of Object.keys(boundary)) {
      rejectMutation(factory, check, v => { delete v[key]; });
      rejectMutation(factory, check, v => { v[key] = String(!boundary[key]); });
    }
    for (const key of ['review', 'negative', 'identity', 'training_eligible', 'sample_weight', 'unknown']) {
      rejectMutation(factory, check, v => { v[key] = false; });
    }
    assert.equal(check(null), false); assert.equal(check([]), false);
  }
  rejectMutation(result, q.isQaSamplingResult, v => { v.population_claims = true; });
  rejectMutation(pool, q.isQaSamplingPool, v => { v.row_count = '2'; });
  rejectMutation(policy, q.isQaSamplingPolicy, v => { v.strata[0].requested_count = 0.5; });
  rejectMutation(result, q.isQaSamplingResult, v => { v.caller.production_ready = true; });
});

test('IDs, calendar UTC times, versions and nested fields are strict', () => {
  for (const id of ['', 'real_account', 'synthetic_', 'synthetic_å', 'synthetic_x\n', 'synthetic_' + 'a'.repeat(71)]) {
    rejectMutation(caller, q.isQaSamplingCaller, v => { v.client_id = id; });
    rejectMutation(pool, q.isQaSamplingPool, v => { v.rows[0].fixture_id = id; });
    rejectMutation(policy, q.isQaSamplingPolicy, v => { v.seed = id; });
  }
  for (const invalid of ['2026-02-30T00:00:00.000Z', '2026-10-25T00:00:00Z',
    '2026-10-25T00:00:00.000+00:00', '2026-10-25T24:00:00.000Z', 'yesterday']) {
    rejectMutation(policy, q.isQaSamplingPolicy, v => { v.as_of = invalid; });
    rejectMutation(pool, q.isQaSamplingPool, v => { v.rows[0].evidence[0].available_at = invalid; });
  }
  rejectMutation(policy, q.isQaSamplingPolicy, v => { delete v.policy_version; });
  rejectMutation(policy, q.isQaSamplingPolicy, v => { v.contract_version = 'other'; });
  rejectMutation(pool, q.isQaSamplingPool, v => { v.rows[0].alert_status = 'unknown'; });
  rejectMutation(pool, q.isQaSamplingPool, v => { v.rows[0].evidence = []; });
  rejectMutation(pool, q.isQaSamplingPool, v => { v.rows[0].evidence[0].identity = 'synthetic_x'; });
  rejectMutation(result, q.isQaSamplingResult, v => { v.strata[0].fraction.weight = 1; });
});

test('duplicate/conflicting IDs and inconsistent input counts reject', () => {
  rejectMutation(pool, q.isQaSamplingPool, v => { v.row_count++; });
  rejectMutation(pool, q.isQaSamplingPool, v => { v.rows[1].fixture_id = v.rows[0].fixture_id; });
  rejectMutation(pool, q.isQaSamplingPool, v => { v.rows[1].stratum_id = v.rows[0].stratum_id; });
  rejectMutation(pool, q.isQaSamplingPool, v => { v.rows[0].evidence.push(v.rows[0].evidence[0]); });
  rejectMutation(pool, q.isQaSamplingPool, v => { v.rows[1].evidence = [{ ...v.rows[0].evidence[0], available_at: '2026-10-26T00:00:00.000Z' }]; });
  rejectMutation(policy, q.isQaSamplingPolicy, v => { v.strata.push({ ...v.strata[0] }); });
  rejectMutation(policy, q.isQaSamplingPolicy, v => { v.strata[1].stratum_id = v.strata[0].stratum_id; });
});

test('result counts, fractions, membership, status and evidence availability must agree', () => {
  for (const mutate of [v => { v.row_count++; }, v => { v.selected_count--; },
    v => { v.strata[0].pool_count++; }, v => { v.strata[0].eligible_count = 0; },
    v => { v.strata[0].excluded_future_evidence_count++; }, v => { v.strata[0].selected_count = 0; },
    v => { v.strata[0].fraction.denominator = 0; }, v => { v.strata[0].fraction.numerator = 0; },
    v => { v.strata[0].status = 'insufficient'; }, v => { v.strata.pop(); },
    v => { v.strata[1].stratum_id = v.strata[0].stratum_id; },
    v => { v.strata[1].selected[0].fixture_id = v.strata[0].selected[0].fixture_id; },
    v => { v.strata[0].selected[0].alert_status = 'non_alert'; },
    v => { v.strata[0].selected[0].stratum_id = 'synthetic_other'; },
    v => { v.strata[0].selected[0].evidence[0].available_at = '2026-10-26T00:00:00.000Z'; },
    v => { v.policy_hash = 'not-a-hash'; }]) rejectMutation(result, q.isQaSamplingResult, mutate);
});

test('missing, insufficient and future unavailable strata stay explicit without backfill', () => {
  const v = result();
  Object.assign(v.strata[0], { status: 'missing', pool_count: 0, eligible_count: 0, selected_count: 0,
    fraction: { numerator: 0, denominator: 0 }, selected: [] });
  Object.assign(v.strata[1], { status: 'insufficient', eligible_count: 0, excluded_future_evidence_count: 1,
    selected_count: 0, fraction: { numerator: 0, denominator: 1 }, selected: [] });
  v.row_count = 1; v.selected_count = 0;
  assert.equal(q.isQaSamplingResult(v), true);
});

test('exact row/selection limits accept, over-limit and aggregate policy limits reject', () => {
  const v = pool(); v.rows = Array.from({ length: 10000 }, (_, i) => row(i)); v.row_count = v.rows.length;
  assert.equal(q.isQaSamplingPool(v), true);
  v.rows.push(row(10000)); v.row_count++; assert.equal(q.isQaSamplingPool(v), false);
  const p = policy(); p.strata[0].requested_count = 999; assert.equal(q.isQaSamplingPolicy(p), true);
  p.strata[0].requested_count++; assert.equal(q.isQaSamplingPolicy(p), false);
  p.strata[0].requested_count = 1001; assert.equal(q.isQaSamplingPolicy(p), false);
  const r = result(); r.strata = [r.strata[0]]; r.policy.strata = [r.policy.strata[0]];
  Object.assign(r.strata[0], { requested_count: 1000, pool_count: 1000, eligible_count: 1000, selected_count: 1000,
    fraction: { numerator: 1000, denominator: 1000 }, selected: Array.from({ length: 1000 }, (_, i) => row(i)) });
  r.policy.strata[0].requested_count = 1000; r.row_count = 1000; r.selected_count = 1000;
  assert.equal(q.isQaSamplingResult(r), true);
  r.selected_count = 1001; assert.equal(q.isQaSamplingResult(r), false);
});

test('raw byte caps include whitespace; oversized structured evidence is rejected', () => {
  for (const [factory, parse, cap] of [[pool, q.parseQaSamplingPool, q.MAX_QA_POOL_BYTES],
    [result, q.parseQaSamplingResult, q.MAX_QA_REPORT_BYTES]]) {
    const json = JSON.stringify(factory());
    assert.deepEqual(parse(json + ' '.repeat(cap - Buffer.byteLength(json))), factory());
    assert.throws(() => parse(json + ' '.repeat(cap - Buffer.byteLength(json) + 1)), q.QaSamplingContractError);
    assert.throws(() => parse('{'), /QA_SAMPLING_INVALID_INPUT/);
  }
  const v = pool(); v.rows = [row()]; v.row_count = 1;
  v.rows[0].evidence = Array.from({ length: 10000 }, (_, i) => ({ evidence_id: `synthetic_${i}`, available_at: time }));
  const r = result(); r.strata[0].selected[0].evidence = v.rows[0].evidence;
  r.strata[1].selected[0].evidence = v.rows[0].evidence;
  assert.equal(q.isQaSamplingResult(r), false);
  v.rows = Array.from({ length: 6 }, (_, i) => ({ ...v.rows[0], fixture_id: `synthetic_${i}` })); v.row_count = 6;
  assert.equal(q.isQaSamplingPool(v), false);
});
