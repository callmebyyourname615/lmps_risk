import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import pg from 'pg';
import { createRuleAssessments, evaluateBacktest, ruleEvidenceHash, validateBacktestManifest } from '../dist/index.js';
import { assessmentFixture } from './fixtures/rule-assessment.mjs';

async function fixture(t, query) {
  const calls = []; let released = false;
  const client = { async query(sql, args) { calls.push(sql); return query(sql, args); }, release() { released = true; } };
  const connect = t.mock.method(pg.Pool.prototype, 'connect', async () => client);
  const url = new URL('postgresql://127.0.0.1:18599/lmps_risk_local'); url.username = 'lmps_intake'; url.password = randomUUID();
  const repository = createRuleAssessments(url.toString()); t.after(() => repository.close());
  return { repository, calls, connect, released: () => released };
}

test('driver returns frozen duplicate without reading changed transaction inputs; a changed manifest rolls back', async t => {
  const f = assessmentFixture(); const report = evaluateBacktest(f.manifest, [{ target: f.manifest.targets[0], revision: null }]);
  const { repository, calls, released } = await fixture(t, async sql => ({ rows: sql.includes('SELECT report,report_sha256') ? [{ report, report_sha256: ruleEvidenceHash(report) }] : [] }));
  const result = await repository.evaluate(f.manifest); assert.equal(result.status, 'duplicate'); assert.deepEqual(result.report, report);
  assert.equal(calls.at(-1), 'COMMIT'); assert.equal(released(), true);
  assert.ok(calls.every(sql => !sql.includes('local_transaction_revisions') && !sql.startsWith('INSERT')));
  const changed = structuredClone(f.manifest); changed.rules[0].threshold = '2.00';
  await assert.rejects(repository.evaluate(changed), e => e.code === 'ASSESSMENT_CONFLICT'); assert.equal(calls.at(-1), 'ROLLBACK');
});

test('driver preserves exact evaluator output and rolls back when assessment insert fails after rule registration', async t => {
  const f = assessmentFixture(); const rules = validateBacktestManifest(f.manifest).rules; let fail = false;
  const { repository, calls } = await fixture(t, async (sql, args) => {
    if (sql.includes('WITH requested')) return { rows: [{ ...f.manifest.targets[0], payload: f.revision.transaction, publication: f.revision.publication, found: true }] };
    if (sql.startsWith('SELECT definition')) { const definition = rules.find(rule => rule.rule_id === args[1]); return { rows: [{ definition, rule_sha256: ruleEvidenceHash(definition) }] }; }
    if (fail && sql.includes('INSERT INTO platform.local_assessment_runs')) throw new Error('SYNTHETIC_PRIVATE_VALUE');
    return { rows: [] };
  });
  const result = await repository.evaluate(f.manifest); assert.equal(result.status, 'inserted'); assert.deepEqual(result.report, evaluateBacktest(f.manifest, f.observations));
  assert.equal(calls.at(-1), 'COMMIT'); calls.length = 0; fail = true;
  await assert.rejects(repository.evaluate(f.manifest), e => e.code === 'STORAGE_FAILED' && !e.message.includes('PRIVATE'));
  assert.equal(calls.at(-1), 'ROLLBACK'); assert.ok(!calls.includes('COMMIT'));
});

test('driver rejects conflicting immutable rule versions before writing the assessment', async t => {
  const f = assessmentFixture(); const rules = validateBacktestManifest(f.manifest).rules;
  const { repository, calls } = await fixture(t, async (sql, args) => {
    if (sql.includes('WITH requested')) return { rows: [{ ...f.manifest.targets[0], payload: f.revision.transaction, publication: f.revision.publication, found: true }] };
    if (sql.startsWith('SELECT definition')) { const definition = { ...rules.find(rule => rule.rule_id === args[1]), threshold: '777.00' }; return { rows: [{ definition, rule_sha256: ruleEvidenceHash(definition) }] }; }
    return { rows: [] };
  });
  await assert.rejects(repository.evaluate(f.manifest), e => e.code === 'RULE_VERSION_CONFLICT');
  assert.equal(calls.at(-1), 'ROLLBACK'); assert.ok(calls.every(sql => !sql.includes('INSERT INTO platform.local_assessment_runs')));
});

test('driver rejects malformed, foreign-workspace and production inputs before connecting', async t => {
  const f = assessmentFixture(); const { repository, connect } = await fixture(t, async () => { throw new Error('Must not query'); });
  for (const input of [{}, { ...f.manifest, workspace_key: 'synthetic_other' }]) await assert.rejects(repository.evaluate(input), e => e.code === 'INVALID_ASSESSMENT');
  const previous = process.env.LMPS_EXECUTION_MODE; process.env.LMPS_EXECUTION_MODE = 'live';
  try { await assert.rejects(repository.evaluate(f.manifest), e => e.code === 'INVALID_ASSESSMENT'); }
  finally { if (previous === undefined) delete process.env.LMPS_EXECUTION_MODE; else process.env.LMPS_EXECUTION_MODE = previous; }
  assert.equal(connect.mock.calls.length, 0);
});
