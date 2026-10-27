import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { validateCaseCommand, caseIdentity, caseMessage, CASE_MAX_ALERTS, CASE_MAX_EVENTS } from '../dist/index.js';
const base = () => ({ request_id: randomUUID(), expected_version: 1, note: 'Synthetic case evidence' });
const dims = () =>
  Object.fromEntries(
    ['fraud', 'mule_network', 'aml'].map((key) => [
      key,
      { outcome: 'unknown', rationale: 'Insufficient synthetic evidence' },
    ]),
  );
test('case commands are strict, bounded and preserve analyst text without coercion', () => {
  const command = {
    ...base(),
    action: 'create',
    expected_version: 0,
    title: 'Synthetic investigation',
    alert_id: randomUUID(),
  };
  assert.deepEqual(validateCaseCommand(command), command);
  for (const mutate of [
    (c) => (c.expected_version = 1),
    (c) => (c.title = ' '),
    (c) => (c.note = '\u0000private'),
    (c) => (c.actor_subject = 'synthetic_forged'),
    (c) => (c.alert_id = 'bad'),
    (c) => (c.note = 'x'.repeat(2001)),
    (c) => (c.execution_mode = 'live'),
  ]) {
    const bad = structuredClone(command);
    mutate(bad);
    assert.throws(
      () => validateCaseCommand(bad),
      (e) => e.code === 'CASE_INVALID_INPUT',
    );
  }
});
test('all three outcome dimensions and individual rationales are mandatory; unknown stays distinct', () => {
  const command = { ...base(), action: 'record_outcome', dimensions: dims() };
  assert.equal(validateCaseCommand(command).dimensions.aml.outcome, 'unknown');
  for (const mutate of [
    (c) => delete c.dimensions.aml,
    (c) => (c.dimensions.fraud.outcome = 'confirmed_crime'),
    (c) => (c.dimensions.aml.rationale = ' '),
    (c) => (c.training_eligible = true),
    (c) => (c.dimensions.mule_network.extra = true),
  ]) {
    const bad = structuredClone(command);
    mutate(bad);
    assert.throws(
      () => validateCaseCommand(bad),
      (e) => e.code === 'CASE_INVALID_INPUT',
    );
  }
});
test('case identities, assignment subjects and version limits reject malformed inputs', () => {
  caseIdentity('synthetic_local', randomUUID());
  assert.throws(() => caseIdentity('production', randomUUID()));
  assert.throws(() => caseIdentity('synthetic_local', 'bad'));
  for (const command of [
    { ...base(), action: 'assign', assignee_subject: 'real-account' },
    { ...base(), action: 'close', expected_version: 0 },
    { ...base(), action: 'reopen', expected_version: 1001 },
  ])
    assert.throws(() => validateCaseCommand(command));
  assert.equal(CASE_MAX_ALERTS, 20);
  assert.equal(CASE_MAX_EVENTS, 1000);
  assert.ok(caseMessage('CASE_CONFLICT', 'lo'));
  assert.notEqual(caseMessage('CASE_CONFLICT', 'lo'), caseMessage('CASE_CONFLICT', 'en'));
});
