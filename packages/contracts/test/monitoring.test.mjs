import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseMonitoringFilters, parseMonitoringRecordsQuery } from '../dist/monitoring.js';
test('monitoring UTC interval retains microsecond precision and rejects a range wider than 31 days', () => {
  const valid = { from: '2026-01-01T00:00:00.000001Z', to: '2026-01-01T00:00:00.000002Z' };
  assert.deepEqual(parseMonitoringFilters(valid).from, valid.from);
  for (const v of [ { from: valid.to, to: valid.from }, { from: valid.from, to: valid.from }, { from: '2026-01-01T00:00:00Z', to: '2026-02-01T00:00:00.000001Z' }, { from: '2026-02-30T00:00:00Z', to: '2026-03-01T00:00:00Z' } ]) assert.throws(() => parseMonitoringFilters(v));
  assert.equal(parseMonitoringFilters({ from: '2026-01-01T00:00:00Z', to: '2026-02-01T00:00:00Z' }).timezone, 'Asia/Vientiane');
});
test('monitoring query has no tenant, arbitrary timezone, institution or snapshot override', () => {
  for (const input of [null, [], { namespace: ['synthetic_one', 'synthetic_two'] }, { workspace_key: 'synthetic_other' }, { as_of: '2026-01-01T00:00:00Z' }, { currency: 'usd' }, { institution: 'one' }, { timezone: 'Europe/Paris' }, { severity: ' high' }]) assert.throws(() => parseMonitoringFilters(input));
});
test('record queries have bounded pages and explicit KPI modes, with no tenant/filter override in a pinned context', () => {
  assert.deepEqual(parseMonitoringRecordsQuery({ mode: 'flagged', q: '001', sort: 'severity_desc', limit: '10' }), { mode: 'flagged', q: '001', sort: 'severity_desc', limit: 10, after: null });
  for (const v of [{ mode: 'safe' }, { limit: '500' }, { limit: ['10', '25'] }, { sort: 'amount' }, { q: ' 001' }, { q: 'a b' }, { workspace_key: 'synthetic_other' }, { currency: 'EUR' }, { after: 'unsafe' }]) assert.throws(() => parseMonitoringRecordsQuery(v));
});
