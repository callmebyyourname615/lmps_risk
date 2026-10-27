import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RISK_CATALOG, evaluateTransactionRisk, riskHash, validateRiskRequest, localizeRiskResult, localizedRiskCatalog, selectRiskLocale } from '../dist/index.js';
import { riskFixture } from '../fixtures/request.mjs';

const golden = { FRAUD_HIGH_AMOUNT: '900.00', FRAUD_COUNT_VELOCITY: '3', FRAUD_AMOUNT_VELOCITY: '2650.00', FRAUD_NEW_COUNTERPARTY: '1',
  FRAUD_AMOUNT_DEVIATION: '90000', FRAUD_FREQUENCY_DEVIATION: '30000', MULE_FAN_IN: '2', MULE_FAN_OUT: '3', MULE_RAPID_PASS_THROUGH: '14722',
  MULE_NETWORK_CYCLE: '3', MULE_FLAGGED_NEIGHBOR: '1', AML_STRUCTURING_PATTERN: '3', AML_REPEATED_HIGH_VALUE: '3', AML_MULTI_HOP_FLOW: '3', AML_NETWORK_DEVIATION: '30000' };

for (const entry of RISK_CATALOG) test(`${entry.code}: executes the declared detector, meets threshold equality and distinguishes below-threshold`, () => {
  const { request, observation } = riskFixture();
  let result = evaluateTransactionRisk(request, observation), finding = result.findings.find(f => f.code === entry.code);
  assert.equal(finding.status, 'triggered'); assert.ok(finding.evidence_refs.length);
  assert.equal(finding.metric.value, golden[entry.code]);
  const rule = request.policy.rules.find(r => r.code === entry.code); rule.threshold = finding.metric.value;
  assert.equal(evaluateTransactionRisk(request, observation).findings.find(f => f.code === entry.code).status, 'triggered');
  if (entry.unit === 'amount') { const cents = BigInt(finding.metric.value.replace('.', '')) + 1n; rule.threshold = `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`; }
  else rule.threshold = String(BigInt(finding.metric.value) + 1n);
  assert.equal(evaluateTransactionRisk(request, observation).findings.find(f => f.code === entry.code).status, 'not_triggered');
});

test('three scores are reproducible policy-weighted indices with complete coverage, never probabilities or payment decisions', () => {
  const { request, observation } = riskFixture(); const report = evaluateTransactionRisk(request, observation);
  assert.equal(report.findings.length, 15); assert.equal(report.risk_types.length, 15); assert.equal(report.assessment_status, 'complete');
  for (const key of ['fraud_score', 'mule_network_score', 'aml_suspicion_score']) {
    assert.equal(report[key].value, 1); assert.equal(report[key].meaning, 'risk_index'); assert.equal(report[key].severity, 'critical'); assert.equal(report[key].coverage.unavailable, 0);
  }
  assert.equal(report.enforcement, false); assert.equal(report.decision.action, null);
  const reordered = structuredClone(request); reordered.context.events.reverse(); reordered.policy.rules.reverse();
  assert.deepEqual(evaluateTransactionRisk(reordered, observation), report);
  assert.equal(riskHash(request), riskHash(JSON.parse(JSON.stringify(request))));
  const rule = request.policy.rules.find(r => r.code === 'FRAUD_HIGH_AMOUNT'); rule.threshold = '999999.00'; rule.weight_bps = 5000;
  const partialSignals = evaluateTransactionRisk(request, observation); assert.equal(partialSignals.fraud_score.value, 0.5);
});

test('missing, invalid and unknown source revisions never produce negative risk or fabricated zero scores', () => {
  for (const status of ['missing', 'invalid', 'not_normalized']) {
    const { request } = riskFixture(); const report = evaluateTransactionRisk(request, { status, revision_sha256: status === 'missing' ? null : 'a'.repeat(64), amount: null,
      reversed_amount: null, currency: null, transaction_status: null, observed_at: null });
    assert.equal(report.assessment_status, 'unavailable'); assert.equal(report.fraud_score.value, null); assert.equal(report.risk_types.length, 0);
    assert.ok(report.findings.every(f => f.status === 'unavailable'));
  }
});

test('unverified identities, missing/incomplete history, cold start and missing flags stay explicit and preserve partial coverage', () => {
  for (const [change, reason] of [
    [r => { r.context = null; }, 'CONTEXT_NOT_PROVIDED'],
    [r => { r.context.identity_status = 'unverified'; }, 'IDENTITY_UNVERIFIED'],
    [r => { r.context.coverage_complete = false; }, 'HISTORY_INCOMPLETE'],
    [r => { r.context.events = r.context.events.filter(e => e.occurred_at >= '2026-01-01T11:00:00.000Z'); }, 'BASELINE_UNAVAILABLE'],
    [r => { r.context.flagged_accounts = null; r.context.flagged_accounts_version = null; }, 'FLAGS_UNAVAILABLE'],
  ]) {
    const { request, observation } = riskFixture(); change(request); const report = evaluateTransactionRisk(request, observation);
    assert.equal(report.assessment_status, 'partial'); assert.ok(report.findings.some(f => f.reason_code === reason));
    assert.equal(report.findings[0].status, 'triggered');
    assert.ok([report.fraud_score, report.mule_network_score, report.aml_suspicion_score].some(s => s.value === null));
  }
});

test('currency and net-execution scope, disabled detectors and absent policies do not become a safe verdict', () => {
  for (const state of ['pending', 'failed', 'reversed']) {
    const { request, observation } = riskFixture(); observation.transaction_status = state; observation.reversed_amount = state === 'reversed' ? observation.amount : '0.00'; request.context = null;
    const r = evaluateTransactionRisk(request, observation); assert.equal(r.assessment_status, 'not_applicable'); assert.equal(r.fraud_score.value, null);
  }
  const { request, observation } = riskFixture(); request.policy.currency = 'ZZZ';
  assert.equal(evaluateTransactionRisk(request, observation).response_code, 'RISK_NOT_APPLICABLE');
  request.policy = null; assert.equal(evaluateTransactionRisk(request, observation).response_code, 'RISK_NOT_EVALUATED');
  const f = riskFixture(); f.request.policy.rules.forEach(r => { r.enabled = false; }); assert.equal(evaluateTransactionRisk(f.request, f.observation).fraud_score.value, null);
});

test('deduplication and correction revisions replace contributions once; reversed or failed records cannot inflate counts', () => {
  const { request, observation } = riskFixture();
  request.context.events.push(structuredClone(request.context.events[6]));
  const before = evaluateTransactionRisk(request, observation);
  assert.equal(before.findings.find(f => f.code === 'FRAUD_COUNT_VELOCITY').metric.value, '3');
  const correction = structuredClone(request.context.events[6]); correction.revision_number = 2; correction.status = 'reversed'; correction.reversed_amount = correction.amount;
  correction.available_at = '2026-01-01T11:50:00.000Z'; request.context.events.push(correction);
  const after = evaluateTransactionRisk(request, observation);
  assert.equal(after.findings.find(f => f.code === 'FRAUD_COUNT_VELOCITY').metric.value, '2');
  assert.equal(after.findings.find(f => f.code === 'FRAUD_AMOUNT_VELOCITY').metric.value, '1800.00');
  correction.status = 'partially_reversed'; correction.reversed_amount = '350.00';
  assert.equal(evaluateTransactionRisk(request, observation).findings.find(f => f.code === 'FRAUD_AMOUNT_VELOCITY').metric.value, '2300.00');
});

test('availability is filtered before revision selection; future events and different currencies cannot leak into window metrics', () => {
  const { request, observation } = riskFixture(); const before = evaluateTransactionRisk(request, observation);
  const futureCorrection = structuredClone(request.context.events[6]); futureCorrection.revision_number = 2; futureCorrection.status = 'failed'; futureCorrection.available_at = '2026-01-01T13:00:00.000Z';
  const future = structuredClone(request.context.events[8]); future.transaction_id = 'synthetic_future'; future.occurred_at = future.available_at = '2026-01-01T13:00:00.000Z';
  const foreign = structuredClone(request.context.events[6]); foreign.transaction_id = 'synthetic_foreign'; foreign.currency = 'ZZZ';
  request.context.events.push(futureCorrection, future, foreign);
  const after = evaluateTransactionRisk(request, observation); assert.deepEqual(after.findings, before.findings); assert.notEqual(after.input_sha256, before.input_sha256);
});

test('window boundaries and maximum amounts use exact cents above JavaScript integer precision', () => {
  const { request, observation } = riskFixture(); const boundary = structuredClone(request.context.events[6]); boundary.transaction_id = 'synthetic_boundary'; boundary.occurred_at = boundary.available_at = '2026-01-01T11:00:00.000Z';
  request.context.events.push(boundary); assert.equal(evaluateTransactionRisk(request, observation).findings.find(f => f.code === 'FRAUD_COUNT_VELOCITY').metric.value, '3');
  request.context.events.find(e => e.transaction_id === 'synthetic_chain').occurred_at = '2026-01-01T11:00:00.000Z';
  assert.equal(evaluateTransactionRisk(request, observation).findings.find(f => f.code === 'AML_MULTI_HOP_FLOW').metric.value, '2');
  request.context = null; observation.amount = '9999999999999999999999.99'; request.policy.rules.find(r => r.code === 'FRAUD_HIGH_AMOUNT').threshold = observation.amount;
  const r = evaluateTransactionRisk(request, observation); assert.equal(r.findings[0].status, 'triggered'); assert.equal(r.findings[0].metric.value, observation.amount);
});

test('binding, contradictory revisions, malformed DSL, thresholds, reversal amounts and unsupported modes reject without mutating input', () => {
  for (const change of [
    r => { r.context.binding.revision_number = 2; }, r => { r.policy.rules.pop(); }, r => { r.policy.rules[0].threshold = '-1'; },
    r => { r.policy.severity_bps.high = 100; }, r => { r.context.events[0].reversed_amount = '999.00'; }, r => { r.context.events[0].sender = 'real_account'; },
    r => { r.policy.extra = 'executable'; }, r => { r.execution_mode = 'live'; }, r => { r.context.events.push({ ...r.context.events[0], amount: '99.00' }); },
  ]) { const f = riskFixture(); change(f.request); assert.throws(() => validateRiskRequest(f.request), /RISK_INPUT_INVALID/); }
  const { request, observation } = riskFixture(); const original = structuredClone(request); evaluateTransactionRisk(request, observation); assert.deepEqual(request, original);
  request.context.binding.revision_sha256 = 'b'.repeat(64); assert.throws(() => evaluateTransactionRisk(request, observation), /RISK_CONTEXT_CONFLICT/);
});

test('graph paths preserve temporal order, depth and unique accounts; unavailable results expose an exceeded work budget', () => {
  const f = riskFixture(); const before = evaluateTransactionRisk(f.request, f.observation); assert.equal(before.findings.find(x => x.code === 'MULE_NETWORK_CYCLE').metric.value, '3');
  f.request.policy.graph_depth = 2; assert.equal(evaluateTransactionRisk(f.request, f.observation).findings.find(x => x.code === 'MULE_NETWORK_CYCLE').metric.value, '0');
  const dense = riskFixture(); const base = dense.request.context.events[6];
  for (let i = 0; i < 170; i++) dense.request.context.events.push({ ...base, transaction_id: 'synthetic_dense_' + i, sender: 'synthetic_N' + (i % 7), receiver: i % 5 === 0 ? 'synthetic_A' : 'synthetic_N' + ((i + 1) % 7), occurred_at: `2026-01-01T11:${String(i % 59).padStart(2, '0')}:00.000Z` });
  for (const e of dense.request.context.events) if (e.available_at < e.occurred_at) e.available_at = e.occurred_at;
  dense.request.policy.graph_depth = 5; const report = evaluateTransactionRisk(dense.request, dense.observation);
  assert.ok(report.findings.some(x => x.reason_code === 'GRAPH_LIMIT_EXCEEDED'));
});

test('Lao/English catalog coverage and localization never change risk codes, evidence, scores or the core result', () => {
  const { request, observation } = riskFixture(); const core = evaluateTransactionRisk(request, observation), digest = riskHash(core);
  for (const locale of ['lo', 'en']) {
    const catalog = localizedRiskCatalog(locale); assert.equal(catalog.risk_types.length, 15);
    for (const entry of catalog.risk_types) for (const key of ['title', 'definition', 'condition', 'limitation']) { assert.ok(entry[key].length); if (locale === 'lo') assert.match(entry[key], /[\u0e80-\u0eff]/); }
    for (const item of [...catalog.codes, ...catalog.statuses, ...catalog.dimensions, ...catalog.units]) {
      const label = item.definition ?? item.label ?? item.title; assert.ok(label.length); if (locale === 'lo') assert.match(label, /[\u0e80-\u0eff]/);
    }
    const view = localizeRiskResult(core, locale); assert.deepEqual(view.risk_types, core.risk_types); assert.deepEqual(view.fraud_score, core.fraud_score);
    for (const finding of view.findings) assert.ok(finding.reason.length);
  }
  assert.equal(riskHash(core), digest);
  for (const [header, locale] of [[undefined, 'lo'], ['la', 'lo'], ['lo-LA', 'lo'], ['en-US', 'en'], ['fr,en;q=0.8,lo;q=0.5', 'en'], ['lo;q=0,en;q=1', 'en'], ['invalid;q=xyz', 'en']]) assert.equal(selectRiskLocale(header), locale);
});

test('input and output bounds, zero baselines and disabled dimensions preserve honest coverage', () => {
  const f = riskFixture();
  f.request.policy.rules.filter(r => r.code.startsWith('MULE_')).forEach(r => { r.enabled = false; });
  const result = evaluateTransactionRisk(f.request, f.observation); assert.equal(result.mule_network_score.status, 'not_evaluated'); assert.equal(result.mule_network_score.value, null);
  f.request.context.events = Array.from({ length: 201 }, (_, i) => ({ ...f.request.context.events[0], transaction_id: 'synthetic_bound_' + i }));
  assert.throws(() => validateRiskRequest(f.request), /RISK_INPUT_INVALID/);
  assert.equal(selectRiskLocale('x'.repeat(257)), 'en');
  const zero = riskFixture(); zero.observation.amount = '0.00'; zero.request.context = null;
  assert.equal(evaluateTransactionRisk(zero.request, zero.observation).response_code, 'RISK_NOT_APPLICABLE');
  const partial = riskFixture(); partial.observation.transaction_status = partial.request.context.events.at(-1).status = 'partially_reversed';
  partial.observation.reversed_amount = partial.request.context.events.at(-1).reversed_amount = '350.00';
  assert.equal(evaluateTransactionRisk(partial.request, partial.observation).findings[0].metric.value, '550.00');
});
