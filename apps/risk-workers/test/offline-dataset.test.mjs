import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { before, beforeEach, after, test } from 'node:test';
import { chmod, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DATASET_COLUMNS } from '@lmps/contracts/offline-dataset';
import { createDatabase, createOfflineDatasets } from '@lmps/database';
import { datasetFixture } from '../../../packages/database/test/fixtures/offline-dataset.mjs';
import { availablePort, dsn, initializeCluster, startCluster, stopCluster, loadState } from '../../../packages/database/scripts/local.mjs';
import { migrations } from '../../../packages/database/scripts/migrations.mjs';
import { importOfflineDataset, reconcileOfflineDataset } from '../dist/offline-dataset.js';
import { readOfflineDataset, main } from '../scripts/dataset-import.mjs';

let temp,state,owner,repo,sequence=0;
before(async()=>{
  temp=await mkdtemp('/tmp/lmps-offline-worker-');state=await initializeCluster(join(temp,'pg'),await availablePort());await startCluster(state);await migrations(dsn(state,'migration'),true);
  owner=createDatabase(dsn(state,'migration'),'migration');repo=createOfflineDatasets(dsn(state,'intake'));
});
beforeEach(async()=>{await owner.pool.query('TRUNCATE platform.offline_dataset_rows,platform.offline_dataset_batches');});
after(async()=>{
  await repo?.close();await owner?.close();if(temp&&!state){try{state=await loadState(join(temp,'pg'));}catch{return;}}
  if(state)await stopCluster(state);if(temp)await rm(temp,{recursive:true,force:true});
});
async function file(count=3,table='transfer',mutate){
  const fixture=datasetFixture(count,table);if(mutate)mutate(fixture.rows);
  const quote=v=>v===null?'\\N':'"'+v.replaceAll('"','""')+'"';
  const content=DATASET_COLUMNS[table].join(',')+'\n'+fixture.rows.map(r=>r.map(quote).join(',')).join('\n')+'\n';
  const path=join(temp,`dataset-${++sequence}.csv`);await writeFile(path,content,{mode:0o600});
  const {rows_sha256:_rows,...input}=fixture.manifest;input.dataset_sha256=createHash('sha256').update(content).digest('hex');input.input_bytes=Buffer.byteLength(content);
  return {path,input,rows:fixture.rows};
}
async function command(args){
  const output=[],errors=[],info=console.info,error=console.error;console.info=v=>output.push(v);console.error=v=>errors.push(v);
  try{const exit=await main(args,dsn(state,'intake'));return{exit,output:output.join('\n'),error:errors.join('\n')};}
  finally{console.info=info;console.error=error;}
}
async function manifest(input){const path=join(temp,`manifest-${++sequence}.json`);await writeFile(path,JSON.stringify(input),{mode:0o600});return path;}
const count=async table=>(await owner.pool.query(`SELECT count(*)::int AS n FROM platform.${table}`)).rows[0].n;

test('private CSV bridge reuses all4 profiles and preserves money/null/Unicode/keys without stdout',async()=>{
  for(const table of Object.keys(DATASET_COLUMNS)){
    const f=await file(3,table,rows=>{if(table==='member')rows[0][0]='🟢'.repeat(100);else rows[0][3]='🟢'.repeat(200);});
    const snapshot=await readOfflineDataset(f.input,f.path);assert.deepEqual(snapshot.rows,f.rows);assert.equal(snapshot.manifest.source_table,table);
  }
  const f=await file(1,'member',r=>{r[0][1]='"\\\u2028';});assert.deepEqual((await readOfflineDataset(f.input,f.path)).rows,f.rows);
});
test('changed files/hash/count/bytes and invalid/duplicate CSVs are rejected before database registration',async()=>{
  const f=await file(), path=await manifest(f.input);
  for(const change of [{dataset_sha256:'0'.repeat(64)},{expected_rows:2},{input_bytes:1}])await assert.rejects(readOfflineDataset({...f.input,...change},f.path),e=>e.code==='DATASET_FILE_REJECTED');
  await writeFile(f.path,'id,fromaccount\nSYNTHETIC_PRIVATE,SYNTHETIC_PRIVATE\n');
  const result=await command(['import','--manifest',path,'--input',f.path]);assert.equal(result.exit,1);assert.equal(await count('offline_dataset_batches'),0);assert.ok(!result.error.includes('PRIVATE'));
  const duplicate=await file(2,'transfer',rows=>{rows[1]=[...rows[0]];});await assert.rejects(readOfflineDataset(duplicate.input,duplicate.path),e=>e.code==='DATASET_FILE_REJECTED');
});
test('bridge rejects insecure/link inputs and malformed/private manifests without echoing paths',async()=>{
  const f=await file();await chmod(f.path,0o644);await assert.rejects(readOfflineDataset(f.input,f.path),e=>e.code==='DATASET_FILE_REJECTED');await chmod(f.path,0o600);
  const alias=join(temp,'alias.csv');await symlink(f.path,alias);await assert.rejects(readOfflineDataset(f.input,alias),e=>e.code==='DATASET_FILE_REJECTED');
  const m=await manifest(f.input);await chmod(m,0o644);const result=await command(['import','--manifest',m,'--input',f.path]);assert.equal(result.exit,1);assert.ok(!result.error.includes(m));assert.equal(await count('offline_dataset_batches'),0);
});
test('worker imports/reconciles and repeated UUID aliases resolve to one canonical batch',async()=>{
  const f=await file(1001), snapshot=await readOfflineDataset(f.input,f.path);
  const first=await importOfflineDataset(dsn(state,'intake'),snapshot);assert.equal(first.status,'complete');assert.equal(first.counts.matched,1001);
  snapshot.manifest.batch_ref=randomUUID();const repeated=await importOfflineDataset(dsn(state,'intake'),snapshot);
  assert.equal(repeated.batch_ref,first.batch_ref);assert.equal(repeated.registration,'duplicate');assert.equal(await count('offline_dataset_rows'),1001);assert.equal(await count('offline_dataset_batches'),1);
  const reconciled=await reconcileOfflineDataset(dsn(state,'intake'),snapshot);assert.equal(reconciled.status,'complete');
});
test('worker resumes an existing checkpoint and does not silently fix corrupted target data',async()=>{
  const f=await file(1001), snapshot=await readOfflineDataset(f.input,f.path);await repo.register(snapshot.manifest);await repo.append(snapshot.manifest,1,snapshot.rows.slice(0,500));
  assert.equal((await importOfflineDataset(dsn(state,'intake'),snapshot)).status,'complete');
  await owner.pool.query("UPDATE platform.offline_dataset_rows SET row_sha256=$1 WHERE row_number=1",['0'.repeat(64)]);
  const result=await importOfflineDataset(dsn(state,'intake'),snapshot);assert.equal(result.status,'blocked');assert.equal(result.counts.mismatched,1);assert.equal(await count('offline_dataset_rows'),1001);
});
test('concurrent workers produce one batch and recovery handles a transaction contention outcome',async()=>{
  const f=await file(1001), snapshot=await readOfflineDataset(f.input,f.path),other=structuredClone(snapshot);other.manifest.batch_ref=randomUUID();
  const results=await Promise.allSettled([importOfflineDataset(dsn(state,'intake'),snapshot),importOfflineDataset(dsn(state,'intake'),other)]);
  assert.ok(results.some(r=>r.status==='fulfilled'&&r.value.status==='complete'));
  for(const r of results)if(r.status==='rejected')assert.equal(r.reason.code,'DATASET_STORAGE_UNAVAILABLE');
  assert.equal((await importOfflineDataset(dsn(state,'intake'),snapshot)).status,'complete');assert.equal(await count('offline_dataset_batches'),1);assert.equal(await count('offline_dataset_rows'),1001);
});
test('CLI import/status/reconcile use bounded projections and do not expose raw input or hashes',async()=>{
  const f=await file(), m=await manifest(f.input),args=['import','--manifest',m,'--input',f.path];
  const first=await command(args);assert.equal(first.exit,0);const result=JSON.parse(first.output);assert.equal(result.status,'complete');
  const status=await command(['status','--workspace',f.input.workspace_key,'--batch',result.batch_ref]);assert.equal(status.exit,0);
  const recon=await command(['reconcile','--manifest',m,'--input',f.path]);assert.equal(recon.exit,0);
  for(const value of [f.path,m,f.input.dataset_sha256,'9999999999999999999999.99','SYNTHETIC_CCY'])assert.ok(!(first.output+status.output+recon.output+first.error).includes(value));
  const cross=await command(['status','--workspace','offline_other','--batch',result.batch_ref]);assert.equal(cross.exit,1);assert.equal(cross.output,'');
});
test('actual Node CLI process returns count/status-only output and uses no project state',async()=>{
  const f=await file(),m=await manifest(f.input);
  const {stdout,stderr}=await promisify(execFile)(process.execPath,['--input-type=module','-e',"import {main} from './apps/risk-workers/scripts/dataset-import.mjs';process.exitCode=await main(process.argv.slice(1),process.env.LMPS_DATASET_TEST_DSN);",'--','import','--manifest',m,'--input',f.path],
    {cwd:new URL('../../../',import.meta.url),env:{...process.env,LMPS_DATASET_TEST_DSN:dsn(state,'intake')},timeout:15000});
  assert.equal(stderr,'');assert.equal(JSON.parse(stdout).status,'complete');assert.ok(!stdout.includes(f.path));
});
test('invalid CLI arguments are redacted and missing prefixes return incomplete instead of complete',async()=>{
  const invalid=await command(['import','--SYNTHETIC_PRIVATE','SYNTHETIC_PRIVATE']);assert.equal(invalid.exit,1);assert.ok(!invalid.error.includes('PRIVATE'));
  const f=await file(),snapshot=await readOfflineDataset(f.input,f.path);await repo.register(snapshot.manifest);const m=await manifest(f.input);
  const status=await command(['status','--workspace',f.input.workspace_key,'--batch',f.input.batch_ref]);assert.equal(status.exit,2);
  const partial=await command(['reconcile','--manifest',m,'--input',f.path]);assert.equal(partial.exit,2);assert.equal(JSON.parse(partial.output).counts.missing,3);
});
test('full100000-row private bridge stays within the shared profile cap',async()=>{
  const f=await file(100000,'member');const snapshot=await readOfflineDataset(f.input,f.path);assert.equal(snapshot.rows.length,100000);assert.deepEqual(snapshot.rows.at(-1),f.rows.at(-1));
  assert.equal(await count('offline_dataset_batches'),0);
});
