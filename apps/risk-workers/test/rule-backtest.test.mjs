import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateBacktest, runBacktest, validateBacktestManifest, MAX_BACKTEST_REPORT_BYTES } from '../dist/rule-backtest.js';
import { backtestFixture, changePublication, observationFromRevision } from './fixtures/rule-backtest.mjs';
import { revision } from '../../../packages/database/test/fixtures/transaction-revision.mjs';

test('typed amount rules produce separate fraud/AML signals and exact threshold evidence without scores or enforcement', () => {
  const f = backtestFixture(); f.manifest.rules[0].threshold = '42.50'; f.manifest.rules[1].threshold = '42.51';
  const r = evaluateBacktest(f.manifest, f.observations);
  assert.equal(r.status, 'complete'); assert.equal(r.counts.rule_matches, 1); assert.equal(r.counts.no_matches, 1); assert.equal(r.counts.matched_observations, 1);
  const matched = r.rows[0].results.find(v => v.outcome === 'match');
  assert.equal(matched.risk_dimension, 'fraud'); assert.equal(matched.reason_code, 'AMOUNT_AT_OR_ABOVE_THRESHOLD');
  assert.equal(matched.evidence.amount, '42.50'); assert.equal(matched.evidence.threshold, '42.50');
  assert.equal(r.enforcement, false); assert.equal(r.canonical_emission, false); assert.equal(r.historical_availability, 'unverified');
  assert.ok(!Object.hasOwn(matched, 'score')); assert.match(r.rules_sha256, /^[0-9a-f]{64}$/);
});

test('exact cents include threshold equality and distinguish amounts above JavaScript safe integer precision', () => {
  const f = backtestFixture(); f.manifest.rules = [f.manifest.rules[0]];
  f.manifest.rules[0].threshold = '9999999999999999999999.99';
  for (const [amount, expected] of [['9999999999999999999999.99', 'match'], ['9999999999999999999999.98', 'no_match']]) {
    const observation = changePublication(f.observations[0], p => p.normalization_input.amount = amount);
    assert.equal(evaluateBacktest(f.manifest, [observation]).rows[0].results[0].outcome, expected);
  }
  f.manifest.rules[0].threshold = '0.00';
  assert.equal(evaluateBacktest(f.manifest, [changePublication(f.observations[0], p => p.normalization_input.amount = '0.00')]).counts.rule_matches, 1);
});

test('missing, invalid and legacy unknown input remain unavailable; currency/lifecycle mismatch is not_applicable', () => {
  const f = backtestFixture(), unknown = observationFromRevision(revision()), missing = { target: { ...f.manifest.targets[0], transaction_id: 'synthetic_missing' }, revision: null };
  f.observations.push(unknown, missing); f.manifest.targets.push(unknown.target, missing.target);
  f.observations[0].revision.publication.normalization_input.status_code = 'SYNTHETIC_PRIVATE_VALUE';
  const r = evaluateBacktest(f.manifest, f.observations); assert.equal(r.status, 'partial'); assert.equal(r.counts.unavailable_inputs, 3);
  assert.equal(r.counts.unavailable, 6); assert.equal(r.counts.no_matches, 0); assert.ok(!JSON.stringify(r).includes('SYNTHETIC_PRIVATE_VALUE'));
  for (const change of [p => p.binding.currency.code = 'USD', p => p.normalization_input.status_code = 'SYNTH_FAILED']) {
    const next = backtestFixture(); next.observations[0] = changePublication(next.observations[0], change);
    assert.equal(evaluateBacktest(next.manifest, next.observations).counts.not_applicable, 2);
  }
});

test('the manifest rejects executable/unknown DSL, account/window rules, invalid money, versions, duplicate identities and overrides before DB access', async () => {
  for (const change of [f => f.manifest.rules[0].kind = 'eval', f => f.manifest.rules[0].expression = 'process.exit(1)',
    f => f.manifest.rules[0].kind = 'account_velocity', f => f.manifest.rules[0].risk_dimension = 'mule',
    f => f.manifest.rules[0].threshold = 40, f => f.manifest.rules[0].threshold = '1e2', f => f.manifest.rules[0].threshold = '40.001',
    f => f.manifest.rules[0].statuses = ['unknown'], f => f.manifest.rules[0].statuses = ['succeeded', 'succeeded'],
    f => f.manifest.rules[0].rule_version = 'live', f => f.manifest.rules.push(f.manifest.rules[0]),
    f => f.manifest.targets.push(f.manifest.targets[0]), f => f.manifest.targets[0].revision_number = 0,
    f => f.manifest.targets[0].transaction_id = "';DROP TABLE platform.source_events;--", f => f.manifest.workspace_key = 'synthetic_other',
    f => f.manifest.execution_mode = 'live', f => f.manifest.evaluator_version = 'other', f => f.manifest.rules[0].currency = '840']) {
    const f = backtestFixture(); change(f); await assert.rejects(runBacktest(f.manifest, 'invalid-dsn'), /Invalid local synthetic rule backtest; details withheld/);
  }
});

test('same semantic manifest/input replay is deterministic, independent of ordering and detached from caller mutation', () => {
  const f = backtestFixture(); f.manifest.rules[0].statuses.push('pending'); const original = structuredClone(f);
  const report = evaluateBacktest(f.manifest, f.observations); assert.deepEqual(f, original);
  const reordered = structuredClone(f); reordered.manifest.rules.reverse(); reordered.manifest.rules[1].statuses.reverse(); reordered.observations.reverse();
  assert.deepEqual(evaluateBacktest(reordered.manifest, reordered.observations), report);
  report.rules[0].threshold = '0.00'; assert.deepEqual(f, original);
});

test('maximum 100 pinned targets ×20 typed rules is bounded; excess targets/rules and contradictory observation sets reject', () => {
  const f = backtestFixture(); const rule = f.manifest.rules[0];
  f.manifest.rules = Array.from({ length: 20 }, (_, i) => ({ ...structuredClone(rule), rule_id: 'synthetic_rule_' + i }));
  f.manifest.targets = Array.from({ length: 100 }, (_, i) => ({ ...f.manifest.targets[0], transaction_id: 'synthetic_target_' + i }));
  const observations = f.manifest.targets.map(target => ({ target, revision: null }));
  const report = evaluateBacktest(f.manifest, observations); assert.equal(report.counts.unavailable, 2000); assert.equal(report.counts.rule_matches, 0);
  assert.ok(Buffer.byteLength(JSON.stringify(report)) < MAX_BACKTEST_REPORT_BYTES);
  assert.throws(() => evaluateBacktest(f.manifest, observations.slice(1)));
  const extra = structuredClone(f.manifest); extra.targets.push({ ...extra.targets[0], transaction_id: 'synthetic_extra' }); assert.throws(() => validateBacktestManifest(extra));
  extra.targets.pop(); extra.rules.push({ ...extra.rules[0], rule_id: 'synthetic_extra' }); assert.throws(() => validateBacktestManifest(extra));
  const bad = structuredClone(observations); bad[1] = bad[0]; assert.throws(() => evaluateBacktest(f.manifest, bad));
});

test('changed rules/input/explicit revision produce distinct evidence fingerprints rather than rewriting previous findings', () => {
  const f = backtestFixture(), first = evaluateBacktest(f.manifest, f.observations);
  f.manifest.rules[0].threshold = '43.00'; const next = evaluateBacktest(f.manifest, f.observations);
  assert.notEqual(first.rules_sha256, next.rules_sha256); assert.equal(first.input_set_sha256, next.input_set_sha256);
  const observed = changePublication(f.observations[0], p => p.normalization_input.amount = '43.00');
  assert.notEqual(next.input_set_sha256, evaluateBacktest(f.manifest, [observed]).input_set_sha256);
  f.manifest.targets[0].revision_number = 2; assert.equal(evaluateBacktest(f.manifest, [{ ...observed, target: f.manifest.targets[0] }]).rows[0].availability, 'invalid');
});

test('reversed observations use the original amount only when that lifecycle is explicitly selected and never imply net moved money', () => {
  const f = backtestFixture(); const observation = changePublication(f.observations[0], p => {
    p.normalization_input.amount = '100.00'; p.normalization_input.reversal_code = 'SYNTH_REVERSAL_FULL_COMPLETED';
    p.normalization_input.synthetic_payment_ref = p.binding.transaction_id;
    p.normalization_input.reversal_evidence = { original_payment_ref: p.binding.transaction_id,
      events: [{ event_ref: 'synthetic_reverse_1', amount: '100.00', currency: p.binding.currency.raw, completed: true }] };
  });
  f.manifest.rules = [f.manifest.rules[0]]; f.manifest.rules[0].statuses = ['reversed']; f.manifest.rules[0].threshold = '100.00';
  const report = evaluateBacktest(f.manifest, [observation]); assert.equal(report.counts.rule_matches, 1);
  assert.equal(report.rows[0].results[0].evidence.amount_semantics, 'original_observed_amount'); assert.equal(report.enforcement, false);
});
