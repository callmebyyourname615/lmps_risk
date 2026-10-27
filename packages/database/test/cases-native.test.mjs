import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, beforeEach, after, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  createDatabase,
  createLocalCases,
  createTransactionRevisions,
  createTransactionRisks,
  createLocalAlerts,
  readLocalCase,
  readCaseHistory,
  listLocalCases,
} from '../dist/index.js';
import { availablePort, dsn, initializeCluster, startCluster, stopCluster, loadState } from '../scripts/local.mjs';
import { migrations } from '../scripts/migrations.mjs';
import { createBackup, restoreDrill } from '../scripts/backup.mjs';
import { alertFixture } from './fixtures/alert.mjs';
let temp, state, owner, reader, cases, writer, risks, alerts, f, id, alertId;
const ws = 'synthetic_local',
  analyst = 'synthetic_analyst',
  coordinator = 'synthetic_coordinator';
const command = (action, version, extra = {}) => ({
  action,
  request_id: randomUUID(),
  expected_version: version,
  note: 'Synthetic case test evidence',
  ...extra,
});
const dimensions = () =>
  Object.fromEntries(
    ['fraud', 'mule_network', 'aml'].map((k) => [
      k,
      { outcome: 'unknown', rationale: 'Additional evidence is required' },
    ]),
  );
const act = (body, actor = coordinator, caseId = id) => cases.command(ws, caseId, actor, body);
const count = async (table) => (await reader.pool.query(`SELECT count(*)::int AS n FROM platform.${table}`)).rows[0].n;
async function create() {
  return act(command('create', 0, { title: 'Synthetic investigation', alert_id: alertId }));
}
async function start() {
  await create();
  await act(command('assign', 1, { assignee_subject: analyst }));
  await act(command('start', 2), analyst);
}
async function extraAlert(index) {
  return (await alerts.generate({ ...f.generation, policy: { ...f.policy, version: 'synthetic_case_' + index } }))
    .alert_id;
}
before(async () => {
  temp = await mkdtemp('/tmp/lmps-case-native-');
  state = await initializeCluster(join(temp, 'pg'), await availablePort());
  await startCluster(state);
  await migrations(dsn(state, 'migration'), true);
  owner = createDatabase(dsn(state, 'migration'), 'migration');
  reader = createDatabase(dsn(state));
  cases = createLocalCases(dsn(state, 'case'));
  writer = createTransactionRevisions(dsn(state, 'intake'));
  risks = createTransactionRisks(dsn(state, 'intake'));
  alerts = createLocalAlerts(dsn(state, 'intake'));
});
beforeEach(async () => {
  await owner.pool.query(
    'TRUNCATE platform.local_label_adjudications,platform.local_model_receipts,platform.local_model_gate_policies,platform.local_case_outcomes,platform.local_case_events,platform.local_case_alerts,platform.local_cases,platform.local_risk_job_policy_bindings,platform.local_risk_job_attempts,platform.local_risk_jobs,platform.local_alert_reviews,platform.local_alerts,platform.local_alert_policies,platform.local_transaction_risks,platform.local_risk_policies,platform.local_transaction_revisions',
  );
  f = alertFixture();
  id = randomUUID();
  await writer.append(f.f.revision);
  await risks.evaluate(f.f.request);
  alertId = (await alerts.generate(f.generation)).alert_id;
});
after(async () => {
  for (const repo of [cases, alerts, risks, writer, reader, owner]) await repo?.close();
  if (temp && !state) {
    try {
      state = await loadState(join(temp, 'pg'));
    } catch {}
  }
  if (state) await stopCluster(state);
  if (temp) await rm(temp, { recursive: true, force: true });
});

test('Alert→Case→assignment→review→unknown outcome→close→reopen retains history and never labels legitimate', async () => {
  await start();
  await act(command('add_note', 3, { note: '<script>Synthetic original note</script>' }), analyst);
  await act(command('record_outcome', 4, { dimensions: dimensions() }), analyst);
  await act(command('close', 5), analyst);
  let view = await readLocalCase(reader.pool, ws, id);
  assert.equal(view.state, 'closed');
  assert.equal(view.current_outcome.dimensions.fraud.outcome, 'unknown');
  assert.equal(view.current_outcome.training_eligible, false);
  assert.equal(view.current_outcome.maturity, 'unverified');
  const notes = await readCaseHistory(reader.pool, ws, id, 'events', 0, 10);
  assert.equal(notes.items[3].note, '<script>Synthetic original note</script>');
  assert.equal(notes.items.at(-1).actor_subject, analyst);
  await act(command('reopen', 6));
  view = await readLocalCase(reader.pool, ws, id);
  assert.equal(view.state, 'open');
  assert.equal(view.review_cycle, 2);
  assert.equal(view.current_outcome, null);
  const history = await readCaseHistory(reader.pool, ws, id, 'outcomes');
  assert.equal(history.items[0].effective_current, false);
  assert.equal(history.items[0].dimensions.aml.outcome, 'unknown');
  assert.equal(await count('local_alert_reviews'), 0);
  assert.equal(await count('local_outbox_intents'), 0);
  assert.equal(await count('local_transaction_risks'), 1);
});
test('a case cannot close without all current outcomes and only its assignee can work', async () => {
  await create();
  await assert.rejects(act(command('start', 1), analyst), (e) => e.code === 'CASE_NOT_ASSIGNEE');
  await act(command('assign', 1, { assignee_subject: analyst }));
  await assert.rejects(act(command('start', 2), 'synthetic_other'), (e) => e.code === 'CASE_NOT_ASSIGNEE');
  await act(command('start', 2), analyst);
  await assert.rejects(act(command('close', 3), analyst), (e) => e.code === 'CASE_OUTCOME_REQUIRED');
  const bad = dimensions();
  delete bad.aml;
  await assert.rejects(
    act(command('record_outcome', 3, { dimensions: bad }), analyst),
    (e) => e.code === 'CASE_INVALID_INPUT',
  );
  await act(command('record_outcome', 3, { dimensions: dimensions() }), analyst);
  await act(command('close', 4), analyst);
  await assert.rejects(act(command('add_note', 5), analyst), (e) => e.code === 'CASE_INVALID_TRANSITION');
});
test('new linked evidence and reassignment invalidate current outcomes while preserving their original versions', async () => {
  await start();
  await act(command('record_outcome', 3, { dimensions: dimensions() }), analyst);
  const second = await extraAlert(2);
  await act(command('link_alert', 4, { alert_id: second }));
  assert.equal((await readLocalCase(reader.pool, ws, id)).current_outcome, null);
  await assert.rejects(act(command('close', 5), analyst), (e) => e.code === 'CASE_OUTCOME_REQUIRED');
  await act(command('record_outcome', 5, { dimensions: dimensions() }), analyst);
  await act(command('assign', 6, { assignee_subject: 'synthetic_next' }));
  await assert.rejects(act(command('close', 7), 'synthetic_next'), (e) => e.code === 'CASE_OUTCOME_REQUIRED');
  const history = await readCaseHistory(reader.pool, ws, id, 'outcomes');
  assert.equal(history.items.length, 2);
  assert.ok(history.items.every((o) => !o.effective_current && !o.training_eligible));
});
test('concurrent case creation from one Alert links it once and rolls back the losing case', async () => {
  const body = command('create', 0, { title: 'Synthetic investigation', alert_id: alertId });
  const results = await Promise.allSettled([
    act(body),
    act({ ...body, request_id: randomUUID() }, coordinator, randomUUID()),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.find((r) => r.status === 'rejected').reason.code, 'CASE_ALERT_ALREADY_LINKED');
  assert.equal(await count('local_cases'), 1);
  assert.equal(await count('local_case_events'), 1);
});
test('idempotency is actor/body/case bound; concurrent updates use CAS and exact retries return original results', async () => {
  const body = command('create', 0, { title: 'Synthetic case', alert_id: alertId }),
    first = await act(body);
  await act(command('assign', 1, { assignee_subject: analyst }));
  assert.deepEqual((await act(body)).result, first.result);
  for (const [actor, changed, caseId] of [
    ['synthetic_other', body, id],
    [coordinator, { ...body, note: 'Different intent' }, id],
    [coordinator, body, randomUUID()],
  ])
    await assert.rejects(act(changed, actor, caseId), (e) => e.code === 'CASE_CONFLICT');
  const concurrent = await Promise.allSettled([
    act(command('start', 2), analyst),
    act(command('add_note', 2), analyst),
  ]);
  assert.equal(concurrent.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(concurrent.find((r) => r.status === 'rejected').reason.code, 'CASE_CONFLICT');
  assert.equal(await count('local_case_events'), 3);
});
test('evidence projections keep exact frozen policy/revision hashes and reject altered or missing source evidence', async () => {
  await start();
  const evidence = await readCaseHistory(reader.pool, ws, id, 'evidence');
  assert.equal(evidence.items[0].assessment_run_id, f.f.request.run_id);
  assert.deepEqual(evidence.items[0].target, f.f.request.target);
  assert.equal(evidence.items[0].risk_policy.version, f.f.request.policy.version);
  await owner.pool.query('UPDATE platform.local_case_alerts SET evidence_sha256=$1', ['0'.repeat(64)]);
  await assert.rejects(readCaseHistory(reader.pool, ws, id, 'evidence'), (e) => e.code === 'CASE_STORAGE_UNAVAILABLE');
  await assert.rejects(
    act(command('record_outcome', 3, { dimensions: dimensions() }), analyst),
    (e) => e.code === 'CASE_STORAGE_UNAVAILABLE',
  );
});
test('foreign workspace and unknown case/Alert are isolated and bounded pages do not leak protected payloads', async () => {
  await create();
  assert.equal(await readLocalCase(reader.pool, 'synthetic_other', id), null);
  assert.equal((await listLocalCases(reader.pool, 'synthetic_other')).items.length, 0);
  assert.equal((await readCaseHistory(reader.pool, 'synthetic_other', id, 'events')).case, null);
  await assert.rejects(
    cases.command('synthetic_other', id, analyst, command('add_note', 1)),
    (e) => e.code === 'CASE_INVALID_INPUT',
  );
  await assert.rejects(
    act(command('create', 0, { title: 'Missing alert', alert_id: randomUUID() }), coordinator, randomUUID()),
    (e) => e.code === 'CASE_ALERT_NOT_FOUND',
  );
  await assert.rejects(act(command('add_note', 1), analyst, randomUUID()), (e) => e.code === 'CASE_NOT_FOUND');
  await assert.rejects(listLocalCases(reader.pool, ws, { limit: 11 }), (e) => e.code === 'CASE_INVALID_INPUT');
  const events = await readCaseHistory(reader.pool, ws, id, 'events', 0, 1);
  assert.equal(events.items.length, 1);
  assert.equal('command' in events.items[0], false);
  assert.equal('alert_id' in events.items[0], false);
});
test('event insertion failure rolls back state, notes and initial Alert link atomically', async () => {
  await owner.pool.query(
    "CREATE FUNCTION platform.synthetic_case_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'PRIVATE_CASE_CANARY'; END $$",
  );
  await owner.pool.query(
    'CREATE TRIGGER synthetic_case_fail BEFORE INSERT ON platform.local_case_events FOR EACH ROW EXECUTE FUNCTION platform.synthetic_case_fail()',
  );
  try {
    await assert.rejects(create(), (e) => e.code === 'CASE_STORAGE_UNAVAILABLE' && !e.message.includes('CANARY'));
  } finally {
    await owner.pool.query('DROP TRIGGER synthetic_case_fail ON platform.local_case_events');
    await owner.pool.query('DROP FUNCTION platform.synthetic_case_fail()');
  }
  assert.equal(await count('local_cases'), 0);
  assert.equal(await count('local_case_alerts'), 0);
  assert.equal(await count('local_case_events'), 0);
});
test('case mutation privilege belongs only to the dedicated function; other roles cannot alter notes/outcomes/links', async () => {
  for (const role of ['app', 'intake', 'reviewer', 'outbox', 'policy', 'case']) {
    const db = createDatabase(dsn(state, role), role);
    try {
      for (const table of ['local_cases', 'local_case_alerts', 'local_case_events', 'local_case_outcomes'])
        for (const sql of [`DELETE FROM platform.${table}`, `TRUNCATE platform.${table}`])
          await assert.rejects(db.pool.query(sql), (e) => e.code === '42501');
      await assert.rejects(db.pool.query("UPDATE platform.local_cases SET state='closed'"), (e) => e.code === '42501');
      if (role !== 'case')
        await assert.rejects(
          db.pool.query(
            "SELECT platform.command_local_case('synthetic_local',gen_random_uuid(),'synthetic_actor','{}',NULL,NULL)",
          ),
          (e) => e.code === '42501',
        );
    } finally {
      await db.close();
    }
  }
});
test('twenty-Alert evidence cap rejects another link without changing the case or history', async () => {
  await create();
  for (let i = 2; i <= 20; i++) await act(command('link_alert', i - 1, { alert_id: await extraAlert(i) }));
  await assert.rejects(
    act(command('link_alert', 20, { alert_id: await extraAlert(21) })),
    (e) => e.code === 'CASE_LIMIT_REACHED',
  );
  const current = await readLocalCase(reader.pool, ws, id);
  assert.equal(current.alert_count, 20);
  assert.equal(current.version, 20);
  const p = await readCaseHistory(reader.pool, ws, id, 'evidence', 0, 10);
  assert.equal(p.items.length, 10);
  assert.ok(p.next_cursor);
});
test('current case, old outcome and reopen cycle survive backup/restore with permissions intact and no worker starts', async () => {
  await start();
  await act(command('record_outcome', 3, { dimensions: dimensions() }), analyst);
  await act(command('close', 4), analyst);
  await act(command('reopen', 5));
  const backup = await createBackup(state, join(temp, 'case-backups')),
    restored = await restoreDrill(backup.directory);
  assert.equal(restored.status, 'PASS');
  assert.equal(restored.table_counts['platform.local_cases'], 1);
  assert.equal(restored.table_counts['platform.local_case_events'], 6);
  assert.equal(restored.table_counts['platform.local_case_outcomes'], 1);
  assert.equal(restored.workers_started, false);
});

test('the1000-event history boundary refuses further mutations while exact original retry stays valid', async () => {
  const first = command('create', 0, { title: 'Synthetic bounded history', alert_id: alertId });
  await act(first);
  await act(command('assign', 1, { assignee_subject: analyst }));
  await act(command('start', 2), analyst);
  // Generate valid synthetic note fixtures in one owner transaction to exercise the row/history cap without1000 round trips.
  const current = await readLocalCase(reader.pool, ws, id);
  const base = {
    case_id: id,
    state: 'in_review',
    assignee_subject: analyst,
    review_cycle: 1,
    evidence_version: 1,
    active_outcome_version: null,
  };
  const client = await owner.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO platform.local_case_events(workspace_key,case_id,version,request_id,action,actor_subject,actor_role,command,result)
 SELECT $1,$2,n,id,'add_note',$3,'lmps_case',jsonb_build_object('action','add_note','request_id',id::text,'expected_version',n-1,'note','Synthetic bounded history fixture'),$4::jsonb||jsonb_build_object('version',n)
 FROM (SELECT n,gen_random_uuid() AS id FROM generate_series(4,1000) n) fixture`,
      [ws, id, analyst, base],
    );
    await client.query('UPDATE platform.local_cases SET version=1000 WHERE workspace_key=$1 AND case_id=$2', [ws, id]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release(true);
  }
  assert.equal(current.version, 3);
  assert.equal((await readLocalCase(reader.pool, ws, id)).version, 1000);
  await assert.rejects(act(command('add_note', 1000), analyst), (e) => e.code === 'CASE_LIMIT_REACHED');
  assert.equal((await act(first)).status, 'duplicate');
  assert.equal(await count('local_case_events'), 1000);
});

test('Lao and supplementary Unicode rationales remain exact at the16KiB command boundary',async()=>{
 await start();const values=dimensions();for(const value of Object.values(values))value.rationale='😀'.repeat(1000);
 const body=command('record_outcome',3,{note:'',dimensions:values});
 while(Buffer.byteLength(JSON.stringify(body),'utf8')<16381)body.note+='ລ';
 while(Buffer.byteLength(JSON.stringify(body),'utf8')<16384)body.note+='a';
 assert.equal(Buffer.byteLength(JSON.stringify(body),'utf8'),16384);assert.ok(body.note.length<=2000);assert.ok(Buffer.byteLength(JSON.stringify(values),'utf8')>8192);
 await act(body,analyst);const current=await readLocalCase(reader.pool,ws,id);assert.deepEqual(current.current_outcome.dimensions,values);assert.equal(current.current_outcome.training_eligible,false);
});
