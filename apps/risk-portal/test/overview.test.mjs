import assert from 'node:assert/strict';
import { test } from 'node:test';
import { summarizeAlerts, prioritizeAlerts } from '../src/overview.ts';

const score = value => ({ value, status: value === null ? 'unavailable' : 'available' });
const item = (id, state, severity, fraud, mule, aml) => ({
  alert_id: id, state, severity, created_at: '2026-10-22T00:00:00Z', assessment_status: 'complete',
  fraud_score: score(fraud), mule_network_score: score(mule), aml_suspicion_score: score(aml),
});
test('page summary excludes unavailable scores from averages but retains genuine zero', () => {
  const result = summarizeAlerts([
    item('a', 'open', 'high', 0, null, null),
    item('b', 'acknowledged', 'medium', 1, 0.6, null),
    item('c', 'reviewed', 'critical', null, 0.2, null),
  ]);
  assert.equal(result.total, 3); assert.equal(result.pending, 2); assert.equal(result.priority, 2);
  assert.deepEqual(result.states, { open: 1, acknowledged: 1, reviewed: 1 });
  assert.equal(result.dimensions[0].average, 0.5);
  assert.equal(result.dimensions[0].available, 2); assert.equal(result.dimensions[0].unavailable, 1);
  assert.equal(result.dimensions[1].average, 0.4);
  assert.equal(result.dimensions[2].average, null); assert.equal(result.dimensions[2].unavailable, 3);
  assert.equal(result.incomplete, 3);
});
test('an empty returned page has zero counts and unavailable averages, not NaN or a safe score', () => {
  const result = summarizeAlerts([]);
  assert.equal(result.total, 0); assert.equal(result.pending, 0);
  for (const dimension of result.dimensions) { assert.equal(dimension.average, null); assert.equal(dimension.available, 0); }
});
test('review queue prioritises pending evidence then severity without mutating server order', () => {
  const rows = [item('reviewed', 'reviewed', 'critical', 1, 1, 1), item('low', 'open', 'low', 0, 0, 0), item('high', 'acknowledged', 'high', 1, 1, 1)];
  assert.deepEqual(prioritizeAlerts(rows).map(row => row.alert_id), ['high', 'low', 'reviewed']);
  assert.deepEqual(rows.map(row => row.alert_id), ['reviewed', 'low', 'high']);
});
