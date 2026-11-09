import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { resolve,dirname,isAbsolute } from 'node:path';
import { open,constants } from 'node:fs/promises';
import { openCoreDetectionRuntime,readCorePrivate } from '../dist/core-detection-runtime.js';
import { privateDirectory } from './private-json.mjs';

export async function runCoreDetection({config,input,output,candidate,publishInbox=false},dsn=process.env.LMPS_POSTGRES_DSN) {
  if(!dsn||typeof publishInbox!=='boolean'||![config,output,...(input?[input]:[]),...(candidate?[candidate]:[])].every(p=>typeof p==='string'&&isAbsolute(p)))throw Error();
  let deliveries=[];
  if(input){const bytes=await readCorePrivate(input,2097152);deliveries=JSON.parse(bytes.toString('utf8'));if(!Array.isArray(deliveries)||deliveries.length>64)throw Error();}
  // Reserve output before starting business work; no accidental overwrite of prior evidence.
  await privateDirectory(dirname(output));const file=await open(output,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  let runtime;
  try{
    runtime=await openCoreDetectionRuntime(dsn,config);let accepted=0,duplicates=0;
    const candidatePolicy=candidate?JSON.parse((await readCorePrivate(candidate,65536)).toString('utf8')):null;
    if(candidatePolicy)await runtime.comparePolicy(candidatePolicy);
    for(const delivery of deliveries){const result=await runtime.consume(delivery);if(result.duplicate)duplicates++;else accepted++;}
    let inboxInserted=0,inboxDuplicates=0;
    if(publishInbox){
      const state=await runtime.read();
      for(const [index,entry] of state.entries.entries()) if(entry.duplicate_of===null && entry.alert_id!==null){
        const result=await runtime.publishCandidate(index);if(result.status==='inserted')inboxInserted++;else inboxDuplicates++;
      }
    }
    const cohort=await runtime.exportCohort();
    const comparison=candidatePolicy?await runtime.comparePolicy(candidatePolicy):null;
    await file.writeFile(JSON.stringify({cohort,comparison}));await file.sync();
    return {format:'lmps-core-runtime-run-1',accepted,duplicates,cohort_rows:cohort.rows.length,
      ...(publishInbox?{inbox_inserted:inboxInserted,inbox_duplicates:inboxDuplicates}:{}),production_ready:false};
  }finally{await runtime?.close();await file.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const{values}=parseArgs({options:{config:{type:'string'},input:{type:'string'},output:{type:'string'},candidate:{type:'string'},'publish-inbox':{type:'boolean'}}});
    const {['publish-inbox']:publishInbox,...rest}=values;console.info(JSON.stringify(await runCoreDetection({...rest,publishInbox})));}
  catch{console.error('CORE_RUNTIME_FAILED; committed checkpoints retained; private diagnostics withheld.');process.exitCode=1;}
}
