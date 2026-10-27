import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  FEATURE_ENGINE_COMPARISON_VERSION as version, FEATURE_ENGINE_RUNTIME as runtime,
  FEATURE_ENGINE_SEMANTICS as semantics, FEATURE_ENGINE_COMPARISON_LIMITS as limits,
  validateFeatureEnginePlan as plan, validateFeatureEngineReport as report,
  serializeFeatureEnginePlan, serializeFeatureEngineReport, featureEnginePlanHash,
} from '../dist/feature-engine-comparison.js';

const hash = v => createHash('sha256').update(v).digest('hex');
const canonical = v => Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}` : JSON.stringify(v);
const h = 'a'.repeat(64);
function fixture() {
  return {
    version, mode: 'local_synthetic', run_id: 'synthetic_comparison',
    corpora: ['original', 'extended'].map((id, i) => ({ id, version: ['synthetic_golden_v1', 'synthetic_extended_v1'][i], sha256: hash(readFileSync(new URL(`../../risk/test/fixtures/feature-streams/${i ? 'p04-extended-golden' : 'golden'}.json`, import.meta.url))), records: [18, 8][i] })),
    semantics: { ...semantics }, runtime: { ...runtime }, candidates: ['bounded_consumer', 'kafka_streams'], currencies: ['SYN', 'USD'],
    queries: [{ id: 'synthetic_query', corpus: 'extended', key: 'synthetic_A', currency: 'SYN', as_of: '2026-01-01T12:00:00Z', anchor_at: '2026-01-01T11:30:00Z', eligible: true }],
    policy: { identity: 'synthetic_declared', availability: 'available_at_lte_as_of', anchor: 'explicit_occurred_at', window_seconds: 3600, coverage: 'explicit_fixture_only', lifecycle: 'latest_available_revision', money: 'integer_minor_units_no_fx', completeness: 'never_arrival_derived' },
    recovery: { fault: 'clean_stop_after_prefix', prefix_records: 13, replay_records: 13, suffix_records: 13, unsupported_fault: 'unclean_crash' },
    budgets: { records: 2000, queries: 8, partitions: 1, scratch_bytes: 2147483648, evidence_bytes: 16777216, invocation_ms: 180000, teardown_reserve_ms: 10000, process_output_bytes: 1048576, state_bytes: 1048576 },
  };
}
// Independently specified illustrative vector, not computed by the validator.
const vector = () => ({ attempt_count: '2', attempt_amount: '1500', gross_count: '1', gross_amount: '1000', reversed_count: '1', reversed_amount: '200', net_active_count: '1', net_amount: '800' });
function observed(p, candidate) {
  const input = hash(canonical(p.corpora));
  return { candidate, status: 'observed', failure: null,
    binding: { plan_sha256: hash(canonical(p)), runtime: { ...runtime }, source_before: h, source_after: h, compiled_before: h, compiled_after: h, input_before: input, input_after: input, evidence_sha256: h },
    outputs: p.queries.map(q => ({ query_id: q.id, result: { status: 'available', vector: vector() } })),
    recovery: { prefix_position: p.recovery.prefix_records, replay_records: p.recovery.replay_records, final_position: p.recovery.prefix_records + p.recovery.suffix_records, state_sha256: h, owned_processes: 0 },
    observations: { setup_ms: 20, processing_ms: 30, teardown_ms: 10, elapsed_ms: 60, peak_scratch_bytes: 1024, retained_evidence_bytes: 512, state_bytes: 256, process_output_bytes: 128 },
  };
}
function evidence(p = fixture()) {
  return { version, mode: 'local_synthetic', production_ready: false, acceptance: 'pending_independent_native_verification', plan: p,
    expected: p.queries.map(q => ({ query_id: q.id, result: { status: 'available', vector: vector() } })),
    trials: p.candidates.map(c => observed(p, c)), comparisons: p.queries.map(q => ({ query_id: q.id, status: 'match' })), status: 'matched_observations' };
}
function invalid(fn) { assert.throws(fn, e => e.code === 'FEATURE_ENGINE_COMPARISON_INVALID' && e.message === e.code && !e.cause); }
test('valid detached plans/reports, stable canonical serialization and subpath', async () => {
  const p = fixture(), r = evidence(p), before = structuredClone(r);
  assert.deepEqual(report(r), r); assert.deepEqual(plan(p), p); assert.deepEqual(r, before);
  const detached = report(r); detached.plan.currencies.push('ALT'); detached.trials[0].outputs[0].result.vector.net_amount = '0'; assert.deepEqual(r, before);
  assert.equal(featureEnginePlanHash(p), hash(canonical(p)));
  assert.equal(serializeFeatureEnginePlan(p), canonical(p)); assert.equal(serializeFeatureEngineReport(r), canonical(r));
  assert.deepEqual(report(JSON.parse(serializeFeatureEngineReport(r))), r);
  const subpath = await import('@lmps/contracts/feature-engine-comparison'); assert.equal(subpath.FEATURE_ENGINE_COMPARISON_VERSION, version);
});
test('mismatch, unavailable, unsupported, failed and missing trials stay distinct', () => {
  let r = evidence(); r.trials[1].outputs[0].result.vector.net_amount = '801'; r.comparisons[0].status = r.status = 'mismatch'; assert.equal(report(r).status, 'mismatch');
  r.comparisons[0].status = 'match'; r.status = 'matched_observations'; invalid(() => report(r));
  r = evidence(); for (const out of [r.expected, ...r.trials.map(t => t.outputs)]) out[0].result = { status: 'unavailable', reason: 'COVERAGE_INCOMPLETE' }; assert.equal(report(r).comparisons[0].status, 'match');
  r.trials[1].outputs[0].result = { status: 'available', vector: Object.fromEntries(Object.keys(vector()).map(k => [k, '0'])) }; r.status = r.comparisons[0].status = 'mismatch'; assert.equal(report(r).status, 'mismatch');
  const p = fixture(); p.queries[0].eligible = false; r = evidence(p); r.status = r.comparisons[0].status = 'unsupported'; assert.equal(report(r).status, 'unsupported');
  for (const status of ['not_run', 'failed']) { r = evidence(); r.trials[1] = { candidate: 'kafka_streams', status, failure: status === 'failed' ? 'RUNTIME_MISSING' : null, binding: null, outputs: [], recovery: null, observations: null }; r.status = r.comparisons[0].status = 'failure'; assert.equal(report(r).status, 'failure'); r.status = 'matched_observations'; invalid(() => report(r)); }
});
test('every version, corpus, semantic, runtime and before/after binding is enforced', () => {
  for (const mutate of [
    r => r.version = 'v2', r => r.plan.corpora.reverse(), r => r.plan.corpora[0].version = 'synthetic_extended_v1',
    r => r.plan.corpora[0].sha256 = h, r => r.plan.semantics.lifecycle = 'other', r => r.plan.runtime.streams = '4.2.0',
    r => r.trials[1].binding.runtime.java = '17', r => r.trials[1].binding.plan_sha256 = h,
    r => r.trials[1].binding.input_before = h, r => r.trials[1].binding.source_after = 'b'.repeat(64),
    r => r.trials[1].binding.compiled_after = 'b'.repeat(64), r => r.trials[1].binding.input_after = h,
    r => r.trials[1].outputs[0].query_id = 'synthetic_other', r => r.trials[1].outputs = [],
    r => r.trials[1].recovery.owned_processes = 1, r => r.trials[1].recovery.final_position++,
    r => r.acceptance = 'accepted', r => r.production_ready = true, r => r.completed = true,
    r => r.trials[1].binding = null, r => r.trials.reverse(), r => r.plan.queries[0].currency = 'ALT',
  ]) { const r = evidence(); mutate(r); invalid(() => report(r)); }
});
test('plan budgets exact and one over; finite positioned records, queries and currencies', () => {
  for (const k of ['records', 'queries', 'scratch_bytes', 'evidence_bytes', 'invocation_ms']) {
    const p = fixture(); p.budgets[k] = limits[k]; assert.doesNotThrow(() => plan(p)); p.budgets[k]++; invalid(() => plan(p));
  }
  let p = fixture(); p.corpora[0].records = 1992; p.recovery = { ...p.recovery, prefix_records: 1000, replay_records: 1000, suffix_records: 1000 }; assert.doesNotThrow(() => plan(p)); p.corpora[0].records++; invalid(() => plan(p));
  p = fixture(); p.queries = Array.from({ length: 8 }, (_, i) => ({ ...p.queries[0], id: `synthetic_q${i}` })); assert.doesNotThrow(() => plan(p)); p.queries.push({ ...p.queries[0], id: 'synthetic_extra' }); invalid(() => plan(p));
  p = fixture(); p.currencies = Array.from({ length: 32 }, (_, i) => `AA${String.fromCharCode(65 + i % 26)}`.replace('AA', i < 26 ? 'AA' : 'AB')); p.queries[0].currency = p.currencies[0]; assert.doesNotThrow(() => plan(p)); p.currencies.push('ZZZ'); invalid(() => plan(p));
  for (const [key, value] of [['partitions', 2], ['teardown_reserve_ms', 0], ['teardown_reserve_ms', 180000], ['records', -0], ['queries', NaN], ['state_bytes', 2147483649], ['process_output_bytes', 16777217]]) { p = fixture(); p.budgets[key] = value; invalid(() => plan(p)); }
});
test('observations exact/one-over limits and teardown reserve', () => {
  for (const [key, budget] of [['peak_scratch_bytes', 'scratch_bytes'], ['retained_evidence_bytes', 'evidence_bytes'], ['state_bytes', 'state_bytes'], ['process_output_bytes', 'process_output_bytes']]) {
    const r = evidence(); r.trials[1].observations[key] = r.plan.budgets[budget]; assert.doesNotThrow(() => report(r)); r.trials[1].observations[key]++; invalid(() => report(r));
  }
  const r = evidence(); const o = r.trials[1].observations; Object.assign(o, { setup_ms: 0, processing_ms: 170000, teardown_ms: 10000, elapsed_ms: 180000 }); assert.doesNotThrow(() => report(r)); o.elapsed_ms++; invalid(() => report(r)); o.elapsed_ms--; o.processing_ms++; o.teardown_ms--; invalid(() => report(r));
});
test('strict real timestamps, decimal minor units, safe counters and hashes', () => {
  for (const t of ['2026-02-30T12:00:00Z', '2026-01-01T25:00:00Z', '2026-01-01T12:00:00+00:00', '2026-01-01T12:00:00Z\n']) { const p = fixture(); p.queries[0].as_of = t; invalid(() => plan(p)); }
  for (const v of ['01', '-1', '1.00', '1e3', '1\n', '9'.repeat(33), 1, null]) { const r = evidence(); r.expected[0].result.vector.net_amount = v; invalid(() => report(r)); }
  let r = evidence(); for (const outputs of [r.expected, ...r.trials.map(t => t.outputs)]) outputs[0].result.vector.net_amount = '9'.repeat(32); assert.doesNotThrow(() => report(r));
  for (const n of ['2001', String(Number.MAX_SAFE_INTEGER)]) { r = evidence(); r.expected[0].result.vector.attempt_count = n; invalid(() => report(r)); }
  for (const h of ['a'.repeat(63), 'A'.repeat(64), 'a'.repeat(64) + '\n']) { const p = fixture(); p.corpora[0].sha256 = h; invalid(() => plan(p)); }
});
test('reject exotic, accessor, symbol, cyclic, proxy and oversized input without invocation', () => {
  let calls = 0;
  for (const mutate of [
    p => Object.defineProperty(p, 'run_id', { enumerable: true, get() { calls++; return 'synthetic_x'; } }),
    p => Object.setPrototypeOf(p, { polluted: true }), p => p[Symbol('hidden')] = true,
    p => p.cycle = p, p => p.toJSON = () => { calls++; return {}; },
    p => Object.defineProperty(p, 'hidden', { value: 1 }), p => p.shell = 'private payload',
    p => p.corpora[0] = new Date(), p => p.candidates.length = 3,
    p => p.run_id = 'x'.repeat(limits.report_bytes + 1),
  ]) { const p = fixture(); mutate(p); invalid(() => plan(p)); }
  const proxy = new Proxy({}, { get() { calls++; throw new Error('private'); }, ownKeys() { calls++; return []; } }); invalid(() => plan(proxy)); assert.equal(calls, 0);
  const p = fixture(); const before = structuredClone(p); p.queries[0].as_of = 'invalid'; invalid(() => plan(p)); assert.equal(p.queries[0].as_of, 'invalid'); assert.deepEqual(p.corpora, before.corpora);
});
