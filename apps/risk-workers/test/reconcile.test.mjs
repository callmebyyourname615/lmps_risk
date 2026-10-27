import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createDatabase, createSourceIntake } from '@lmps/database';
import { reconcileSnapshot } from '../dist/reconcile.js';
import { importSnapshot, validateSnapshot } from '../dist/snapshot.js';
import { availablePort, dsn, initializeCluster, loadState, startCluster, stopCluster } from '../../../packages/database/scripts/local.mjs';
import { migrations } from '../../../packages/database/scripts/migrations.mjs';

const fixture = JSON.parse(await readFile(new URL('../../../packages/database/fixtures/source-event.json', import.meta.url), 'utf8'));
let scratch, state, intake, owner;
function snapshot() {
  const capture_id = randomUUID(); const source_generation = randomUUID();
  const events = [1, 2].map(id => ({ ...structuredClone(fixture), workspace_key: 'synthetic_local', source_namespace: 'synthetic_snapshot', source_generation, capture_epoch: capture_id, event_key: `transfer:${id}`, operation: 'snapshot', source_key: { ...fixture.source_key, id: String(id) } }));
  events.push({ ...structuredClone(events[0]), source_table: 'member', event_key: 'member:1', source_key: { code: 'SYNTHETIC_MEMBER' }, fields: { status: null, member_type: 'synthetic' } });
  return validateSnapshot({ format: 1, capture_id, events });
}
before(async () => {
  scratch = await mkdtemp('/tmp/lmps-recon-');
  state = await initializeCluster(join(scratch, 'pg'), await availablePort());
  await startCluster(state); await migrations(dsn(state, 'migration'), true);
  intake = createSourceIntake(dsn(state, 'intake')); owner = createDatabase(dsn(state, 'migration'), 'migration');
});
after(async () => {
  await intake?.close(); await owner?.close();
  if (scratch && !state) { try { state = await loadState(join(scratch, 'pg')); } catch { return; } }
  if (state) await stopCluster(state);
  if (scratch) await rm(scratch, { recursive: true, force: true });
});

test('empty capture passes only when its exact scoped capture has no target events', async () => {
  const value = { format: 1, capture_id: randomUUID(), events: [] };
  const report = await reconcileSnapshot(value, dsn(state));
  assert.equal(report.status, 'PASS'); assert.equal(report.expected, 0); assert.equal(report.observed, 0);
  const extra = snapshot().events[0]; extra.capture_epoch = value.capture_id;
  await intake.append(extra);
  const changed = await reconcileSnapshot(value, dsn(state));
  assert.equal(changed.status, 'FAIL'); assert.equal(changed.unexpected, 1);
});

test('missing and partially committed imports report exact gaps, then pass after replay and duplicate replay', async () => {
  const value = snapshot();
  let report = await reconcileSnapshot(value, dsn(state));
  assert.equal(report.status, 'FAIL'); assert.equal(report.missing, 3); assert.equal(report.matched, 0);
  await intake.append(value.events[0]);
  report = await reconcileSnapshot(value, dsn(state));
  assert.equal(report.missing, 2); assert.equal(report.matched, 1); assert.equal(report.observed, 1);
  await importSnapshot(value, dsn(state, 'intake')); await importSnapshot(value, dsn(state, 'intake'));
  report = await reconcileSnapshot(value, dsn(state));
  assert.equal(report.status, 'PASS'); assert.equal(report.matched, 3); assert.equal(report.observed, 3);
  assert.deepEqual(report.by_table.member, { expected: 1, observed: 1, matched: 1, missing: 0, mismatched: 0, unexpected: 0 });
});

test('stored evidence comparison is field-exact, order-independent JSON, including decimal strings and microseconds', async () => {
  const value = snapshot(); await importSnapshot(value, dsn(state, 'intake'));
  const changed = structuredClone(value); changed.events[0].fields.amount = '9999999999999999999999.99';
  let report = await reconcileSnapshot(changed, dsn(state));
  assert.equal(report.status, 'FAIL'); assert.equal(report.mismatched, 1); assert.equal(report.matched, 2);
  const reordered = structuredClone(value); reordered.events[0].source_key = { requesttime: reordered.events[0].source_key.requesttime, id: reordered.events[0].source_key.id };
  assert.equal((await reconcileSnapshot(reordered, dsn(state))).status, 'PASS');
  await owner.pool.query("UPDATE platform.source_events SET observed_at=observed_at+interval '1 microsecond' WHERE capture_epoch=$1 AND event_key='transfer:1'", [value.capture_id]);
  report = await reconcileSnapshot(value, dsn(state));
  assert.equal(report.mismatched, 1);
  assert.ok(!JSON.stringify(report).includes('amount'));
});

test('unexpected event/generation are detected, other captures and workspaces are excluded', async () => {
  const value = snapshot(); await importSnapshot(value, dsn(state, 'intake'));
  await intake.append({ ...value.events[0], event_key: 'unexpected' });
  await intake.append({ ...value.events[0], source_generation: randomUUID() });
  await intake.append({ ...value.events[0], workspace_key: 'synthetic_other' });
  await intake.append({ ...value.events[0], capture_epoch: randomUUID() });
  const report = await reconcileSnapshot(value, dsn(state));
  assert.equal(report.status, 'FAIL'); assert.equal(report.unexpected, 2); assert.equal(report.observed, 5);
  assert.equal(report.expected, report.matched + report.missing + report.mismatched);
  assert.equal(report.observed, report.matched + report.mismatched + report.unexpected);
});

test('bounded target read fails explicitly rather than claim exact totals from a truncated result', async () => {
  const value = snapshot();
  for (let i = 0; i < 401; i++) await intake.append({ ...value.events[0], event_key: `overflow:${i}` });
  const report = await reconcileSnapshot(value, dsn(state));
  assert.equal(report.status, 'LIMIT_EXCEEDED'); assert.equal(report.observed, 401); assert.equal(report.observed_is_exact, false);
  assert.equal(report.matched, null); assert.equal(report.by_table, null);
});

test('outage is UNAVAILABLE with unknown counts, never a successful empty result; app role and input guards hold', async () => {
  const value = snapshot();
  await assert.rejects(reconcileSnapshot(value, dsn(state, 'intake')), /Invalid local PostgreSQL/);
  await assert.rejects(reconcileSnapshot({ ...value, capture_id: '../private' }, dsn(state)), { code: 'INVALID_SNAPSHOT' });
  await stopCluster(state);
  try {
    const report = await reconcileSnapshot(value, dsn(state));
    assert.equal(report.status, 'UNAVAILABLE'); assert.equal(report.observed, null); assert.equal(report.missing, null);
    for (const secret of Object.values(state.passwords)) assert.ok(!JSON.stringify(report).includes(secret));
  } finally { await startCluster(state); }
  assert.equal((await reconcileSnapshot(value, dsn(state))).missing, 3);
});
