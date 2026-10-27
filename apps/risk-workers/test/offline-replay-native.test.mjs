import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { before, beforeEach, after, test } from 'node:test';
import { chmod, link, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createDatabase, createOfflineDatasets, datasetRowHash, ruleEvidenceHash } from '@lmps/database';
import { availablePort, dsn, identify, initializeCluster, loadState, startCluster, stopCluster } from '../../../packages/database/scripts/local.mjs';
import { migrations } from '../../../packages/database/scripts/migrations.mjs';
import { importOfflineDataset } from '../dist/offline-dataset.js';
import { evaluateOfflineReplay, replayOfflineDataset, replayCsv } from '../dist/offline-replay.js';
import { main } from '../scripts/dataset-replay.mjs';
import { readOfflineDataset } from '../scripts/dataset-import.mjs';
import { replayFixture } from './fixtures/offline-replay.mjs';

let temp,state,owner,repo,f,sequence=0;
before(async()=>{
  temp=await mkdtemp('/tmp/lmps-replay-native-');state=await initializeCluster(join(temp,'pg'),await availablePort());await startCluster(state);await migrations(dsn(state,'migration'),true);
  owner=createDatabase(dsn(state,'migration'),'migration');repo=createOfflineDatasets(dsn(state,'intake'));
});
beforeEach(async()=>{await owner.pool.query('TRUNCATE platform.offline_dataset_rows,platform.offline_dataset_batches');f=replayFixture();});
after(async()=>{
  await repo?.close();await owner?.close();if(temp&&!state){try{state=await loadState(join(temp,'pg'));}catch{return;}}
  if(state)await stopCluster(state);if(temp)await rm(temp,{recursive:true,force:true});
});
const load=async()=>importOfflineDataset(dsn(state,'intake'),f.snapshot);
const read=()=>repo.readComplete(f.input.workspace_key,f.input.batch_ref,f.input.dataset_sha256);
const reportPath=(base,name='replay.json',id=f.input.run_id)=>join(base,'v1',id,name);
async function manifest(){const path=join(temp,`manifest-${++sequence}.json`);await writeFile(path,JSON.stringify(f.input),{mode:0o600});return path;}
async function command(path,base,...extra){
  const output=[],errors=[],info=console.info,error=console.error;console.info=v=>output.push(v);console.error=v=>errors.push(v);
  try{return{exit:await main(['--manifest',path,'--output',base,...extra],dsn(state,'intake')),output:output.join('\n'),error:errors.join('\n')};}
  finally{console.info=info;console.error=error;}
}
const snapshots=async()=>ruleEvidenceHash((await owner.pool.query(`SELECT
  (SELECT jsonb_agg(to_jsonb(b) ORDER BY batch_ref) FROM platform.offline_dataset_batches b) AS batches,
  (SELECT jsonb_agg(to_jsonb(r) ORDER BY batch_ref,row_number) FROM platform.offline_dataset_rows r) AS rows,
  (SELECT count(*) FROM platform.local_transaction_risks) AS risks,
  (SELECT count(*) FROM platform.local_alerts) AS alerts,
  (SELECT count(*) FROM platform.local_outbox_intents) AS outbox`)).rows);

test('verified staging replay equals pure evaluation without database writes, alerts or provenance conversion',async()=>{
  await load();const before=await snapshots();assert.deepEqual(await read(),f.snapshot);
  assert.deepEqual(await replayOfflineDataset(dsn(state,'intake'),f.input),evaluateOfflineReplay(f.input,f.snapshot));assert.equal(await snapshots(),before);
  await assert.rejects(replayOfflineDataset(dsn(state),f.input));
});
test('incomplete/blocked/missing/cross-scope and unpinned inputs cannot produce a replay',async()=>{
  await assert.rejects(read(),e=>e.code==='DATASET_NOT_FOUND');await repo.register(f.snapshot.manifest);await repo.append(f.snapshot.manifest,1,f.snapshot.rows.slice(0,1));
  await assert.rejects(read(),e=>e.code==='DATASET_BLOCKED');await load();
  for(const change of [{workspace_key:'offline_other'},{batch_ref:randomUUID()},{dataset_sha256:'0'.repeat(64)}])
    await assert.rejects(replayOfflineDataset(dsn(state,'intake'),{...f.input,...change}));
  await owner.pool.query("UPDATE platform.offline_dataset_batches SET status='blocked',reconciliation_status='mismatch'");await assert.rejects(read(),e=>e.code==='DATASET_BLOCKED');
});
test('post-reconciliation row/hash/manifest corruption, missing rows and extra rows reject without repairing evidence',async()=>{
  for(const mutate of [
    ()=>owner.pool.query("UPDATE platform.offline_dataset_rows SET fields=jsonb_set(fields,'{amount}','\"1.00\"') WHERE row_number=1"),
    ()=>owner.pool.query('UPDATE platform.offline_dataset_rows SET row_sha256=$1 WHERE row_number=1',['0'.repeat(64)]),
    ()=>owner.pool.query('DELETE FROM platform.offline_dataset_rows WHERE row_number=2'),
    ()=>owner.pool.query(`INSERT INTO platform.offline_dataset_rows(workspace_key,batch_ref,source_table,row_number,source_key,fields,row_sha256)
      SELECT workspace_key,batch_ref,source_table,4,jsonb_set(source_key,'{id}','"4"'),fields,row_sha256 FROM platform.offline_dataset_rows WHERE row_number=1`),
    ()=>owner.pool.query('UPDATE platform.offline_dataset_batches SET manifest_sha256=$1',['0'.repeat(64)]),
    async()=>{const changed=[...f.snapshot.rows[0]];changed[2]='1.00';await owner.pool.query("UPDATE platform.offline_dataset_rows SET fields=jsonb_set(fields,'{amount}','\"1.00\"'),row_sha256=$1 WHERE row_number=1",[datasetRowHash(changed)]);},
  ]){
    await owner.pool.query('TRUNCATE platform.offline_dataset_rows,platform.offline_dataset_batches');await load();await mutate();const before=await snapshots();
    await assert.rejects(read());assert.equal(await snapshots(),before);
  }
});
test('read freezes manifest and rows in one repeatable snapshot despite a concurrent owner update',async()=>{
  await load();const client=await owner.pool.connect(),observer=await identify(state);let pending;
  try{
    await client.query('BEGIN');await client.query('LOCK TABLE platform.offline_dataset_rows IN ACCESS EXCLUSIVE MODE');
    pending=read();pending.catch(()=>{});
    let waiting=false;
    for(let i=0;i<30;i++){
      const activity=await observer.query("SELECT 1 FROM pg_stat_activity WHERE application_name='lmps-local-intake' AND wait_event_type='Lock' AND query LIKE 'SELECT row_number,%'");
      if(activity.rowCount){waiting=true;break;}await delay(10);
    }
    assert.ok(waiting,'reader reached the blocked row scan');
    await client.query("UPDATE platform.offline_dataset_rows SET fields=jsonb_set(fields,'{amount}','\"1.00\"') WHERE row_number=1");await client.query('COMMIT');
    assert.deepEqual(await pending,f.snapshot);
  }finally{await client.query('ROLLBACK');client.release(true);await observer.end();await pending?.catch(()=>{});}
  await assert.rejects(read());
});
test('CLI writes private JSON/CSV with count-only stdout; identical replay returns duplicate',async()=>{
  await load();const m=await manifest(),base=join(temp,`reports-${++sequence}`),before=await snapshots();const a=await command(m,base);assert.equal(a.exit,0,a.error);
  const json=JSON.parse(await readFile(reportPath(base),'utf8'));assert.deepEqual(json,evaluateOfflineReplay(f.input,f.snapshot));
  const csv=await readFile(reportPath(base,'replay.csv'),'utf8');assert.equal(csv,replayCsv(json));
  for(const path of [base,join(base,'v1'),join(base,'v1',f.input.run_id)])assert.equal((await lstat(path)).mode&0o777,0o700);
  for(const name of ['replay.json','replay.csv'])assert.equal((await lstat(reportPath(base,name))).mode&0o777,0o600);
  const b=await command(m,base);assert.equal(b.exit,0);assert.equal(JSON.parse(b.output).publication,'duplicate');assert.equal(await snapshots(),before);
  for(const raw of [m,base,f.input.dataset_sha256,'SYNTHETIC_CCY','9999999999999999999999.99'])assert.ok(!(a.output+a.error+b.output).includes(raw));
});
test('changed policy under the same run ID cannot overwrite reports; new run keeps both versions',async()=>{
  await load();const m=await manifest(),base=join(temp,`reports-${++sequence}`);assert.equal((await command(m,base)).exit,0);
  const before=await readFile(reportPath(base),'utf8'),csv=await readFile(reportPath(base,'replay.csv'),'utf8');
  f.input.policy.version='simulation_fixture_v2';f.input.policy.thresholds[0].amount_gte='1.00';await writeFile(m,JSON.stringify(f.input));
  assert.equal((await command(m,base)).exit,1);assert.equal(await readFile(reportPath(base),'utf8'),before);assert.equal(await readFile(reportPath(base,'replay.csv'),'utf8'),csv);
  f.input.run_id=randomUUID();await writeFile(m,JSON.stringify(f.input));assert.equal((await command(m,base)).exit,0);
});
test('partial report directories, modified CSV and linked outputs are preserved and rejected',async()=>{
  await load();const m=await manifest(),base=join(temp,`reports-${++sequence}`),dir=join(base,'v1',f.input.run_id);await mkdir(dir,{recursive:true,mode:0o700});
  await writeFile(join(dir,'pending-replay.json'),'PRIVATE_PARTIAL',{mode:0o600});assert.equal((await command(m,base)).exit,1);assert.equal(await readFile(join(dir,'pending-replay.json'),'utf8'),'PRIVATE_PARTIAL');
  await rm(dir,{recursive:true});assert.equal((await command(m,base)).exit,0);
  const csv=reportPath(base,'replay.csv');await writeFile(csv,'PRIVATE_MODIFIED');assert.equal((await command(m,base)).exit,1);assert.equal(await readFile(csv,'utf8'),'PRIVATE_MODIFIED');
  await rm(csv);const target=join(temp,'private-target');await writeFile(target,'PRIVATE_TARGET',{mode:0o600});await symlink(target,csv);assert.equal((await command(m,base)).exit,1);assert.equal(await readFile(target,'utf8'),'PRIVATE_TARGET');
});
test('concurrent publishers preserve one identical complete report bundle',async()=>{
  await load();const m=await manifest(),base=join(temp,`reports-${++sequence}`);
  const args=['--input-type=module','-e',"import {main} from './apps/risk-workers/scripts/dataset-replay.mjs';process.exitCode=await main(process.argv.slice(1),process.env.LMPS_REPLAY_TEST_DSN);",'--','--manifest',m,'--output',base];
  const run=()=>promisify(execFile)(process.execPath,args,{cwd:new URL('../../../',import.meta.url),env:{...process.env,LMPS_REPLAY_TEST_DSN:dsn(state,'intake')},timeout:15000});
  const results=await Promise.allSettled([run(),run()]);assert.ok(results.some(r=>r.status==='fulfilled'));
  for(const result of results)if(result.status==='fulfilled'){assert.equal(result.value.stderr,'');assert.ok(!result.value.stdout.includes('SYNTHETIC_CCY'));}
  assert.equal((await command(m,base)).exit,0);const report=JSON.parse(await readFile(reportPath(base),'utf8'));assert.equal(await readFile(reportPath(base,'replay.csv'),'utf8'),replayCsv(report));
});
test('missing-currency and member datasets publish partial reports with exit2 instead of negative findings',async()=>{
  for(const table of ['transfer','member']){
    f=replayFixture(2,table);f.input.policy.thresholds[0].source_ccy='OTHER';await load();const m=await manifest(),base=join(temp,`reports-${++sequence}`);
    const result=await command(m,base);assert.equal(result.exit,2,result.error);assert.deepEqual(JSON.parse(result.output).counts,{rows:2,matched:0,not_matched:0,unavailable:2});
  }
});
test('insecure/linked/oversized/invalid manifests and invalid CLI arguments never publish a report',async()=>{
  await load();const m=await manifest(),base=join(temp,`reports-${++sequence}`);
  await chmod(m,0o644);assert.equal((await command(m,base)).exit,1);await chmod(m,0o600);
  const alias=join(temp,'alias.json');await symlink(m,alias);assert.equal((await command(alias,base)).exit,1);
  const hard=join(temp,'hard.json');await link(m,hard);assert.equal((await command(hard,base)).exit,1);await rm(hard);
  await writeFile(m,' '.repeat(65537));assert.equal((await command(m,base)).exit,1);
  await writeFile(m,JSON.stringify({...f.input,private:'PRIVATE_CANARY'}));assert.equal((await command(m,base)).exit,1);
  const bad=await command(m,base,'--PRIVATE_CANARY','PRIVATE_CANARY');assert.equal(bad.exit,1);assert.ok(!bad.error.includes('PRIVATE_CANARY'));
  await assert.rejects(lstat(base),e=>e.code==='ENOENT');
});
test('database outage emits a fixed error and leaves no report or fabricated success',async()=>{
  await load();const m=await manifest(),base=join(temp,`reports-${++sequence}`);await stopCluster(state);
  try{const result=await command(m,base);assert.equal(result.exit,1);assert.equal(result.output,'');assert.match(result.error,/DATASET_STORAGE_UNAVAILABLE/);await assert.rejects(lstat(base),e=>e.code==='ENOENT');}
  finally{await startCluster(state);}
});
test('actual100000-row transfer dataset reads, screens and publishes deterministically within existing limits',async()=>{
  f=replayFixture(100000);await load();const m=await manifest(),base=join(temp,`reports-${++sequence}`),result=await command(m,base);assert.equal(result.exit,0,result.error);
  assert.equal(JSON.parse(result.output).counts.matched,100000);const report=JSON.parse(await readFile(reportPath(base),'utf8'));
  assert.equal(report.rows.length,100000);assert.equal(report.rows.at(-1).row_number,100000);assert.equal(await readFile(reportPath(base,'replay.csv'),'utf8'),replayCsv(report));
});
test('private CSV profile → import/reconciliation → replay uses the original file fingerprint end to end',async()=>{
  const path=join(temp,'invented-transfer.csv'),profile=join(temp,'invented-profile');
  await writeFile(path,'id,requesttime,amount,ccy,result,txtime\n1,2026-10-01 12:00:00,99.99,SYNTHETIC_CCY,\\N,2026-10-01 12:00:00\n2,2026-10-01 12:00:00,100.00,SYNTHETIC_CCY,UNKNOWN,2026-10-01 12:00:00\n3,2026-10-01 12:00:00,1000.00,OTHER,,2026-10-01 12:00:00\n',{mode:0o600});
  await promisify(execFile)(new URL('../../../.venv/bin/python',import.meta.url).pathname,
    ['-B','apps/risk-workers/scripts/dataset_profile.py','--table','transfer','--input',path,'--output-dir',profile],{cwd:new URL('../../../',import.meta.url),timeout:15000});
  const evidence=JSON.parse(await readFile(join(profile,'report.json'),'utf8'));
  const {rows_sha256:_rows,...input}=f.snapshot.manifest;input.dataset_sha256=evidence.dataset_sha256;input.input_bytes=evidence.input_bytes;input.expected_rows=evidence.observed_rows;
  f.snapshot=await readOfflineDataset(input,path);f.input.dataset_sha256=input.dataset_sha256;await load();
  const m=await manifest(),base=join(temp,`reports-${++sequence}`),result=await command(m,base);assert.equal(result.exit,2,result.error);
  const report=JSON.parse(await readFile(reportPath(base),'utf8'));assert.deepEqual(report.counts,{rows:3,matched:1,not_matched:1,unavailable:1});
  assert.equal(report.dataset.dataset_sha256,evidence.dataset_sha256);assert.equal(report.rows[1].reason_code,'AMOUNT_AT_OR_ABOVE_THRESHOLD');
});
