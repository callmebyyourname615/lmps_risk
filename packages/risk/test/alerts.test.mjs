import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { evaluateTransactionRisk, projectAlert, validateAlertGeneration, validateAlertReview, reviewState, localizedAlertCatalog, riskHash, RISK_CODES } from '../dist/index.js';
import { riskFixture } from '../fixtures/request.mjs';

const policy = () => ({ policy_id: 'synthetic_alerts', version: 'synthetic_v1', minimum_severity: 'high', included_codes: [...RISK_CODES], include_partial: true });
const acknowledge = () => ({ request_id: randomUUID(), expected_version: 0, action: 'acknowledge', outcome: null, note: null });
const event = command => ({ ...command, version: command.expected_version + 1, actor_subject: 'synthetic_reviewer', actor_role: 'lmps_reviewer', occurred_at: '2026-10-22T00:00:00.000Z' });
test('one projection groups all15 triggered types with their original assessment hash and severity equality', () => {
  const f = riskFixture(), result = evaluateTransactionRisk(f.request, f.observation), before = structuredClone(result);
  const projected = projectAlert(result, policy());
  assert.equal(projected.reason_code, 'ALERT_CREATED'); assert.equal(projected.snapshot.selected_risk_types.length, 15);
  assert.equal(projected.snapshot.severity, 'high'); assert.equal(projected.snapshot.assessment_sha256, riskHash(result)); assert.deepEqual(result, before);
  assert.equal(projectAlert(result, { ...policy(), minimum_severity: 'critical' }).reason_code, 'ALERT_NO_MATCH');
  assert.deepEqual(projectAlert(result, { ...policy(), included_codes: ['AML_MULTI_HOP_FLOW'] }).snapshot.selected_risk_types, ['AML_MULTI_HOP_FLOW']);
});
test('partial inclusion is explicit and never invents a score for unavailable data', () => {
  const f = riskFixture(); f.request.context.flagged_accounts = null; f.request.context.flagged_accounts_version = null;
  const result = evaluateTransactionRisk(f.request, f.observation); assert.equal(result.assessment_status, 'partial'); assert.equal(result.mule_network_score.value, null);
  const accepted = projectAlert(result, policy()); assert.equal(accepted.snapshot.selected_risk_types.length, 14);
  assert.ok(!accepted.snapshot.selected_risk_types.includes('MULE_FLAGGED_NEIGHBOR'));
  assert.equal(projectAlert(result, { ...policy(), include_partial: false }).reason_code, 'ALERT_PARTIAL_EXCLUDED');
  assert.equal(result.mule_network_score.value, null);
});
test('unavailable/not-evaluated/not-applicable and non-triggered findings cannot create an alert', () => {
  for (const mode of ['unavailable', 'not_evaluated', 'not_applicable']) {
    const f = riskFixture();
    if (mode === 'unavailable') {
      f.request.context = null;
      f.observation = { status: 'missing', revision_sha256: null, amount: null, reversed_amount: null, currency: null, transaction_status: null, observed_at: null };
    }
    if (mode === 'not_evaluated') f.request.policy = null;
    if (mode === 'not_applicable') { f.observation.transaction_status = 'failed'; f.request.context = null; }
    const result = evaluateTransactionRisk(f.request, f.observation); assert.equal(result.assessment_status, mode);
    assert.equal(projectAlert(result, policy()).reason_code, 'ALERT_ASSESSMENT_INELIGIBLE');
  }
  const f = riskFixture(); f.request.policy.rules.find(r => r.code === 'FRAUD_HIGH_AMOUNT').threshold = '999.00';
  assert.equal(projectAlert(evaluateTransactionRisk(f.request, f.observation), { ...policy(), included_codes: ['FRAUD_HIGH_AMOUNT'] }).reason_code, 'ALERT_NO_MATCH');
});
test('generation has a strict bounded synthetic contract and canonicalizes policy code order without mutating input', () => {
  const input = { format: 1, provenance: 'local_synthetic', execution_mode: 'test', workspace_key: 'synthetic_local', assessment_run_id: randomUUID(), policy: policy() };
  input.policy.included_codes.reverse(); const before = structuredClone(input), normalized = validateAlertGeneration(input);
  assert.deepEqual(input, before); assert.deepEqual(normalized.policy.included_codes, [...RISK_CODES]);
  for (const change of [r => r.workspace_key = 'synthetic_other', r => r.execution_mode = 'live', r => r.actor = 'synthetic_forged',
    r => r.policy.minimum_severity = 1, r => r.policy.include_partial = 'true', r => r.policy.included_codes.push(r.policy.included_codes[0]),
    r => r.policy.included_codes = [], r => r.policy.included_codes = ['UNKNOWN'], r => r.policy.extra = 'SYNTHETIC_PRIVATE_VALUE']) {
    const bad = structuredClone(input); change(bad); assert.throws(() => validateAlertGeneration(bad), /INVALID_ALERT_INPUT/);
  }
});
test('review requires acknowledgement first, explicit version and outcome, a note and no client-supplied actor', () => {
  assert.deepEqual(validateAlertReview(acknowledge()).action, 'acknowledge');
  for (const outcome of ['suspicious', 'legitimate', 'unknown']) assert.equal(validateAlertReview({ ...acknowledge(), action: 'review', expected_version: 1, outcome, note: 'ຫຼັກຖານ synthetic' }).outcome, outcome);
  for (const change of [r => r.actor_subject = 'synthetic_forged', r => r.expected_version = '0', r => r.outcome = 'legitimate',
    r => r.note = ' ', r => r.note = 'a'.repeat(1001), r => r.note = '\u0000', r => r.action = 'reopen',
    r => { r.action = 'review'; r.expected_version = 1; r.outcome = 'unknown'; }, r => r.request_id = 'invalid']) {
    const bad = acknowledge(); change(bad); assert.throws(() => validateAlertReview(bad), /INVALID_ALERT_INPUT/);
  }
});
test('append-only review ledger has only open→acknowledged→reviewed and preserves unknown outcome', () => {
  const ack = event(acknowledge()), reviewed = event({ ...acknowledge(), expected_version: 1, action: 'review', outcome: 'unknown', note: 'Insufficient synthetic evidence.' });
  assert.deepEqual(reviewState([]), { state: 'open', version: 0, outcome: null });
  assert.deepEqual(reviewState([ack]), { state: 'acknowledged', version: 1, outcome: null });
  assert.deepEqual(reviewState([ack, reviewed]), { state: 'reviewed', version: 2, outcome: 'unknown' });
  for (const history of [[reviewed], [ack, ack], [ack, { ...reviewed, actor_role: 'lmps_app' }], [ack, { ...reviewed, actor_subject: 'forged' }],
    [ack, { ...reviewed, request_id: ack.request_id }], [ack, reviewed, reviewed], [{ ...ack, extra: 'SYNTHETIC_PRIVATE_VALUE' }]])
    assert.throws(() => reviewState(history), e => e.code === 'ALERT_STORAGE_UNAVAILABLE' && !e.message.includes('PRIVATE'));
});
test('alert statuses, outcomes and response/error codes have Lao/English text with identical machine codes', () => {
  const lo = localizedAlertCatalog('lo'), en = localizedAlertCatalog('en');
  assert.deepEqual(lo.codes.map(x => x.code), en.codes.map(x => x.code));
  for (const row of lo.codes) assert.match(row.message, /[\u0e80-\u0eff]/);
  for (const row of en.codes) assert.match(row.message, /[A-Za-z]/);
  assert.match(en.review_semantics, /Unknown is not a negative/);
});
test('production environment rejects alert generation and review before any storage operation', () => {
  const previous = process.env.LMPS_ENVIRONMENT; process.env.LMPS_ENVIRONMENT = 'production';
  try {
    assert.throws(() => validateAlertGeneration({}), /INVALID_ALERT_INPUT/);
    assert.throws(() => validateAlertReview(acknowledge()), /INVALID_ALERT_INPUT/);
  } finally { if (previous === undefined) delete process.env.LMPS_ENVIRONMENT; else process.env.LMPS_ENVIRONMENT = previous; }
});
