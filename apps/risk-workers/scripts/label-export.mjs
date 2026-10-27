import { randomUUID } from 'node:crypto';
import { resolve,join,dirname,isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabase,readLabelReview } from '@lmps/database';
import { riskHash,ALERT_UUID } from '@lmps/risk';
import { dsn,loadState,localMode } from '../../../packages/database/scripts/local.mjs';
import { readPrivateJson,savePrivateReport,privateDirectory } from './private-json.mjs';
export async function exportLabels(dsnValue,ids,output,runId){
  localMode();if(!Array.isArray(ids)||!ids.length||ids.length>1000||new Set(ids).size!==ids.length||!ids.every(id=>typeof id==='string'&&ALERT_UUID.test(id))||!isAbsolute(output)||!ALERT_UUID.test(runId))throw new Error();
  try{
    for(const path of [dirname(output),output,join(output,'v1'),join(output,'v1',runId)])await privateDirectory(path);
    const prior=await readPrivateJson(join(output,'v1',runId,'labels.json'),4*1024*1024);
    if(prior.format!=='lmps-label-export-1'||prior.provenance!=='local_synthetic'||prior.population_claims!==false||!Array.isArray(prior.records)
      ||JSON.stringify(prior.records.map(r=>r.label_id))!==JSON.stringify(ids))throw new Error();
    for(const record of prior.records){const {sha256,...body}=record;if(riskHash(body)!==sha256)throw new Error();}
    return {status:'duplicate',rows:prior.records.length,eligible:prior.records.filter(r=>r.eligibility==='eligible').length,run_id:runId};
  }catch(error){if(error.code!=='ENOENT')throw error;}
  const database=createDatabase(dsnValue),at=new Date().toISOString();
  try{const records=[];for(const id of ids){const view=await readLabelReview(database.pool,'synthetic_local',id,at);if(!view)throw new Error();
      const record={label_id:view.label_id,version:view.version,target:view.target,task:view.command.task,eligibility:view.eligibility,reason_code:view.reason_code,label:view.label};
      records.push({...record,sha256:riskHash(record)});}
    const report={format:'lmps-label-export-1',provenance:'local_synthetic',exported_at:at,population_claims:false,records};
    await savePrivateReport(output,'v1',runId,'labels.json',report,4*1024*1024);return {status:'complete',rows:records.length,eligible:records.filter(r=>r.eligibility==='eligible').length,run_id:runId};
  }finally{await database.close();}
}
export async function main(args=process.argv.slice(2)){
  try{localMode();if(args.length!==3)throw new Error();const ids=await readPrivateJson(args[0],65536),result=await exportLabels(dsn(await loadState(process.env.LMPS_LOCAL_STATE_DIR),'app'),ids,args[1],args[2]);console.info(JSON.stringify(result));return 0;}
  catch{console.error('LABEL_EXPORT_FAILED; private diagnostics withheld.');return 1;}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))process.exitCode=await main();
