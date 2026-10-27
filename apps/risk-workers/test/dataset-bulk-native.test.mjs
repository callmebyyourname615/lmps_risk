import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createDatabase } from '@lmps/database';
import { ROOT, LOCAL, dsn, loadState, running, stopCluster } from '../../../packages/database/scripts/local.mjs';
import { importBulk, main, prepareBulk } from '../scripts/dataset-bulk.mjs';

const execute=promisify(execFile);let scratch,sequence=0;
before(async()=>{scratch=await mkdtemp('/tmp/lmps-bulk-native-');});
after(async()=>{
  if(!scratch)return;
  for(const name of await readdir(scratch)){
    let state;try{state=await loadState(join(scratch,name,'trial/pg'));}catch{continue;}
    await stopCluster(state);
  }
  await rm(scratch,{recursive:true,force:true});
});
async function fixture(rows=12){
  const root=join(scratch,'case-'+ ++sequence);await mkdir(root,{mode:0o700});const source=join(root,'source'),prepared=join(root,'prepared');
  await execute(join(ROOT,'.venv/bin/python'),['-B','-c','import sys;from pathlib import Path;sys.path.insert(0,sys.argv[1]);from test_dataset_bulk import write_source;write_source(Path(sys.argv[2]),int(sys.argv[3]),int(sys.argv[4]))',join(ROOT,'apps/risk-workers/test'),source,String(rows),String(rows)],{cwd:ROOT,timeout:10000});
  await prepareBulk(source,prepared,rows);return{root,source,prepared,trial:join(root,'trial')};
}
async function quiet(fn){const saved=console.info;console.info=()=>{};try{return await fn();}finally{console.info=saved;}}

test('isolated real PG import reconciles, restores and retries without duplicate rows or extra migrations',async()=>{
  const f=await fixture();const first=await quiet(()=>importBulk(f.prepared,f.trial));
  assert.equal(first.loaded_rows,12);assert.equal(first.matched_rows,12);assert.equal(first.restore_status,'PASS');assert.equal(first.publication,'created');
  const state=await loadState(join(f.trial,'pg'));assert.equal(running(state),false);assert.notEqual(state.port,18503);
  const repeated=await quiet(()=>importBulk(f.prepared,f.trial));assert.equal(repeated.publication,'duplicate');assert.equal(repeated.completed_chunks,1);
  assert.equal(repeated.assessment_performed,false);assert.equal(repeated.operational_alerts,false);
  assert.equal(JSON.stringify(repeated).includes('INVENTED_REFERENCE'),false);
});

test('OS lock prevents concurrent runtime access and primary-cluster paths are rejected before writes',async()=>{
  const f=await fixture();await mkdir(f.trial,{mode:0o700});
  const guard=spawn(join(ROOT,'.venv/bin/python'),['-B',join(ROOT,'apps/risk-workers/scripts/dataset_bulk.py'),'lock',join(f.trial,'active.lock')],{stdio:['pipe','pipe','ignore']});
  const ended=once(guard,'exit');await once(guard.stdout,'data');
  try{await assert.rejects(importBulk(f.prepared,f.trial),/BULK_OPERATION_FAILED/);assert.deepEqual(await readdir(f.trial),['active.lock']);}
  finally{guard.stdin.end();await ended;}
  await assert.rejects(importBulk(f.prepared,LOCAL),/BULK_OPERATION_FAILED/);
  await assert.rejects(prepareBulk(f.source,join(LOCAL,'bulk-prepared'),12),/BULK_OPERATION_FAILED/);
});

test('actual SIGKILL after a committed file checkpoint resumes the owned cluster and completes exact restore',async()=>{
  const f=await fixture(50001);
  const child=spawn(process.execPath,[join(ROOT,'apps/risk-workers/scripts/dataset-bulk.mjs'),'import','--prepared',f.prepared,'--trial',f.trial],{cwd:ROOT,stdio:['ignore','pipe','pipe']});
  let output='',errors='',killed=false;
  child.stdout.on('data',chunk=>{output+=chunk.toString();if(!killed&&output.includes('"loaded_rows":25000')){killed=true;child.kill('SIGKILL');}});
  child.stderr.on('data',chunk=>{errors+=chunk.toString();});
  const [code,signal]=await once(child,'exit');assert.equal(killed,true,errors);assert.equal(code,null);assert.equal(signal,'SIGKILL');
  const progress=JSON.parse(await readFile(join(f.trial,'progress.json'),'utf8'));assert.equal(progress.loaded_rows,25000);
  await new Promise(resolve=>setTimeout(resolve,100));
  const result=await quiet(()=>importBulk(f.prepared,f.trial));assert.equal(result.loaded_rows,50001);assert.equal(result.completed_chunks,3);assert.equal(result.restore_status,'PASS');
  const state=await loadState(join(f.trial,'pg'));assert.equal(running(state),false);
});

test('a corrupted committed staging row is rejected rather than repaired or marked complete',async()=>{
  const f=await fixture();await quiet(()=>importBulk(f.prepared,f.trial));
  const state=await loadState(join(f.trial,'pg'));
  const {startCluster}=await import('../../../packages/database/scripts/local.mjs');await startCluster(state);
  const owner=createDatabase(dsn(state,'migration'),'migration');
  try{await owner.pool.query("UPDATE platform.offline_dataset_rows SET fields=jsonb_set(fields,'{amount}','\"0.01\"') WHERE row_number=1");}
  finally{await owner.close();await stopCluster(state);}
  await assert.rejects(quiet(()=>importBulk(f.prepared,f.trial)),/BULK_OPERATION_FAILED/);
  assert.equal(running(state),false);
});

test('invalid mode/limits/arguments return fixed errors without preparing a target',async()=>{
  const f=await fixture();await assert.rejects(prepareBulk(f.source,join(f.root,'bad'),1000001));
  let error='';const saved=console.error;console.error=value=>{error=value;};
  try{assert.equal(await main(['import','--prepared',f.prepared,'--trial',f.trial,'--through-rows','1000001']),1);assert.equal(error,'BULK_OPERATION_FAILED; private diagnostics withheld.');}
  finally{console.error=saved;}
  assert.equal((await readdir(f.root)).includes('trial'),false);
});
