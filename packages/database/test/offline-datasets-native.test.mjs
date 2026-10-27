import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { before, beforeEach, after, test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createDatabase, createOfflineDatasets } from '../dist/index.js';
import { availablePort, dsn, initializeCluster, loadState, startCluster, stopCluster } from '../scripts/local.mjs';
import { migrations } from '../scripts/migrations.mjs';
import { createBackup, restoreDrill, verifyBackup } from '../scripts/backup.mjs';
import { datasetFixture } from './fixtures/offline-dataset.mjs';

let temp, state, owner, repo, f;
before(async () => {
  temp = await mkdtemp('/tmp/lmps-offline-datasets-'); state = await initializeCluster(join(temp,'pg'), await availablePort());
  await startCluster(state); await migrations(dsn(state,'migration'), true);
  owner = createDatabase(dsn(state,'migration'),'migration'); repo = createOfflineDatasets(dsn(state,'intake'));
});
beforeEach(async () => { await owner.pool.query('TRUNCATE platform.offline_dataset_rows,platform.offline_dataset_batches'); f=datasetFixture(); });
after(async () => {
  await repo?.close(); await owner?.close();
  if (temp && !state) { try { state=await loadState(join(temp,'pg')); } catch { return; } }
  if (state) await stopCluster(state); if (temp) await rm(temp,{recursive:true,force:true});
});
const count = async () => (await owner.pool.query('SELECT count(*)::int AS n FROM platform.offline_dataset_rows')).rows[0].n;
async function load(value=f) { await repo.register(value.manifest); for(let i=0;i<value.rows.length;i+=500) await repo.append(value.manifest,i+1,value.rows.slice(i,i+500)); }

test('same-file UUID aliases register once, scopes remain distinct and reused IDs conflict', async () => {
  const alias={...f.manifest,batch_ref:randomUUID()}; const results=await Promise.all([repo.register(f.manifest),repo.register(alias)]);
  assert.deepEqual(results.map(r=>r.registration).sort(),['duplicate','inserted']); assert.equal(results[0].batch_ref,results[1].batch_ref);
  const canonical=results[0].batch_ref; await assert.rejects(repo.register({...f.manifest,batch_ref:canonical,source_namespace:'offline_changed'}),e=>e.code==='DATASET_INPUT_CONFLICT');
  const other=await repo.register({...f.manifest,batch_ref:randomUUID(),workspace_key:'offline_other'});assert.notEqual(other.batch_ref,canonical);
  await assert.rejects(repo.status('offline_other',canonical),e=>e.code==='DATASET_NOT_FOUND');
});
test('partial import reconciles as incomplete; completion needs all source rows and exact values', async () => {
  await repo.register(f.manifest); await repo.append(f.manifest,1,f.rows.slice(0,1));
  const partial=await repo.reconcile(f);assert.equal(partial.status,'importing');assert.equal(partial.reconciliation_status,'incomplete');assert.equal(partial.counts.missing,2);
  await repo.append(f.manifest,2,f.rows.slice(1)); const result=await repo.reconcile(f);
  assert.equal(result.status,'complete');assert.deepEqual(result.counts,{expected:3,observed:3,matched:3,missing:0,mismatched:0,unexpected:0});
  assert.equal((await repo.append(f.manifest,1,f.rows)).loaded_rows,3);assert.equal(await count(),3);
  const row=(await owner.pool.query('SELECT fields FROM platform.offline_dataset_rows ORDER BY row_number LIMIT 1')).rows[0];assert.equal(row.fields.amount,'9999999999999999999999.99');
});
test('concurrent chunk replays preserve one prefix and different replay content fails', async () => {
  await repo.register(f.manifest); const results=await Promise.all([repo.append(f.manifest,1,f.rows),repo.append(f.manifest,1,f.rows)]);
  assert.ok(results.every(r=>r.loaded_rows===3));assert.equal(await count(),3);
  const changed=structuredClone(f.rows);changed[0][2]='1.00';await assert.rejects(repo.append(f.manifest,1,changed),e=>e.code==='DATASET_INPUT_CONFLICT');
  await assert.rejects(repo.append(f.manifest,2,f.rows),e=>e.code==='DATASET_INVALID_INPUT');
});
test('checkpoint failure rolls back rows and progress in the same real transaction', async () => {
  await repo.register(f.manifest);
  await owner.pool.query("CREATE FUNCTION platform.synthetic_dataset_checkpoint() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'SYNTHETIC_PRIVATE_VALUE'; END $$");
  await owner.pool.query('CREATE TRIGGER synthetic_dataset_checkpoint BEFORE UPDATE ON platform.offline_dataset_batches FOR EACH ROW EXECUTE FUNCTION platform.synthetic_dataset_checkpoint()');
  try {await assert.rejects(repo.append(f.manifest,1,f.rows),e=>e.code==='DATASET_STORAGE_UNAVAILABLE'&&!e.message.includes('PRIVATE'));}
  finally {await owner.pool.query('DROP TRIGGER synthetic_dataset_checkpoint ON platform.offline_dataset_batches');await owner.pool.query('DROP FUNCTION platform.synthetic_dataset_checkpoint()');}
  assert.equal(await count(),0);assert.equal((await repo.status('offline_local',f.manifest.batch_ref)).loaded_rows,0);
  await repo.append(f.manifest,1,f.rows);assert.equal((await repo.reconcile(f)).status,'complete');
});
test('tampered row payload/hash blocks completion without replacing stored evidence', async () => {
  await load();await repo.reconcile(f);
  await owner.pool.query("UPDATE platform.offline_dataset_rows SET fields=jsonb_set(fields,'{amount}',$1::jsonb) WHERE row_number=1",[JSON.stringify('2.00')]);
  const result=await repo.reconcile(f);assert.equal(result.status,'blocked');assert.equal(result.counts.mismatched,1);
  await assert.rejects(repo.append(f.manifest,1,f.rows),e=>e.code==='DATASET_BLOCKED');
  assert.equal((await owner.pool.query('SELECT fields FROM platform.offline_dataset_rows WHERE row_number=1')).rows[0].fields.amount,'2.00');
});
test('missing committed-prefix rows are a mismatch rather than a resumable missing suffix', async () => {
  await load();await owner.pool.query('DELETE FROM platform.offline_dataset_rows WHERE row_number=2');
  const result=await repo.reconcile(f);assert.equal(result.status,'blocked');assert.equal(result.counts.missing,1);assert.equal(result.loaded_rows,3);
});
test('unexpected rows and corrupt immutable manifests fail closed with bounded counts/errors', async () => {
  await load();
  await owner.pool.query(`INSERT INTO platform.offline_dataset_rows(workspace_key,batch_ref,source_table,row_number,source_key,fields,row_sha256)
    SELECT workspace_key,batch_ref,source_table,4,jsonb_set(source_key,'{id}','"4"'),fields,row_sha256 FROM platform.offline_dataset_rows WHERE row_number=1`);
  const result=await repo.reconcile(f);assert.equal(result.counts.unexpected,1);assert.equal(result.status,'blocked');
  await owner.pool.query('UPDATE platform.offline_dataset_batches SET manifest_sha256=$1',['0'.repeat(64)]);
  await assert.rejects(repo.status('offline_local',f.manifest.batch_ref),e=>e.code==='DATASET_STORAGE_UNAVAILABLE');
});
test('actual child process kill after a chunk commit resumes without duplicating rows', async () => {
  f=datasetFixture(1001);
  const child=spawn(process.execPath,['--input-type=module','-e',`import {createOfflineDatasets} from './packages/database/dist/index.js'; import {datasetFixture} from './packages/database/test/fixtures/offline-dataset.mjs'; const f=datasetFixture(1001);f.manifest=JSON.parse(process.env.LMPS_DATASET_TEST_MANIFEST);const r=createOfflineDatasets(process.env.LMPS_DATASET_TEST_DSN);await r.register(f.manifest);await r.append(f.manifest,1,f.rows.slice(0,500));process.send('committed');setInterval(()=>{},1000);`],
    {cwd:new URL('../../../',import.meta.url),env:{...process.env,LMPS_DATASET_TEST_MANIFEST:JSON.stringify(f.manifest),LMPS_DATASET_TEST_DSN:dsn(state,'intake')},stdio:['ignore','ignore','ignore','ipc']});
  const exited=once(child,'exit');
  try {await Promise.race([once(child,'message'),exited.then(()=>{throw new Error('Child exited before commit');}),new Promise((_,reject)=>{const t=setTimeout(()=>reject(new Error('Child checkpoint timeout')),10000);t.unref();})]);}
  finally {if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await exited;}
  assert.equal((await repo.status('offline_local',f.manifest.batch_ref)).loaded_rows,500);
  for(let i=500;i<f.rows.length;i+=500)await repo.append(f.manifest,i+1,f.rows.slice(i,i+500));
  assert.equal((await repo.reconcile(f)).status,'complete');assert.equal(await count(),1001);
});
test('database outage is redacted and the committed prefix survives restart', async () => {
  await repo.register(f.manifest);await repo.append(f.manifest,1,f.rows.slice(0,1));await stopCluster(state);
  try {await assert.rejects(repo.status('offline_local',f.manifest.batch_ref),e=>e.code==='DATASET_STORAGE_UNAVAILABLE');}
  finally {await startCluster(state);}
  assert.equal((await repo.status('offline_local',f.manifest.batch_ref)).loaded_rows,1);
});
test('app/reviewer/outbox cannot read raw staging, and intake cannot rewrite evidence or recording metadata', async () => {
  await load();
  for(const role of ['app','reviewer','outbox']){
    const db=createDatabase(dsn(state,role),role);
    try {for(const table of ['offline_dataset_batches','offline_dataset_rows'])for(const sql of [`SELECT * FROM platform.${table}`,`DELETE FROM platform.${table}`,`TRUNCATE platform.${table}`])await assert.rejects(db.pool.query(sql),e=>e.code==='42501');}
    finally{await db.close();}
  }
  const writer=createDatabase(dsn(state,'intake'),'intake');
  try{
    for(const sql of ["UPDATE platform.offline_dataset_batches SET manifest='{}'", "UPDATE platform.offline_dataset_batches SET recorded_by='synthetic_changed'",'DELETE FROM platform.offline_dataset_rows',"UPDATE platform.offline_dataset_rows SET fields='{}'"])
      await assert.rejects(writer.pool.query(sql),e=>e.code==='42501');
  }finally{await writer.close();}
});
test('SQL allowlists reject extra account fields, key duplicates and cross-batch source-table mismatches', async () => {
  await load();
  await assert.rejects(owner.pool.query(`UPDATE platform.offline_dataset_rows SET fields=fields||' {"fromaccount":"SYNTHETIC_PRIVATE"}'::jsonb WHERE row_number=1`),e=>e.code==='23514');
  await assert.rejects(owner.pool.query('UPDATE platform.offline_dataset_rows SET source_key=(SELECT source_key FROM platform.offline_dataset_rows WHERE row_number=1) WHERE row_number=2'),e=>e.code==='23505');
  await assert.rejects(owner.pool.query("UPDATE platform.offline_dataset_rows SET source_table='transfer_hist' WHERE row_number=1"),e=>e.code==='23503');
  const log=await readFile(join(state.base,'server.log'),'utf8');assert.ok(!log.includes('SYNTHETIC_PRIVATE'));
});
test('maximum100000-row dataset imports, reconciles and restores with raw staging denied to app', async () => {
  f=datasetFixture(100000,'member');await load();const result=await repo.reconcile(f);assert.equal(result.counts.matched,100000);assert.equal(result.status,'complete');
  const backup=await createBackup(state,join(temp,'full-backups')), manifest=await verifyBackup(backup.directory);
  assert.equal(manifest.format,'local_pg_backup_v2');assert.equal(manifest.provenance,'local_workspace');assert.equal(manifest.tables['platform.offline_dataset_rows'].rows,100000);
  const restored=await restoreDrill(backup.directory);assert.equal(restored.status,'PASS');assert.equal(restored.table_counts['platform.offline_dataset_rows'],100000);
  assert.equal((await repo.status('offline_local',f.manifest.batch_ref)).status,'complete');
});
