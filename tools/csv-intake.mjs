import { constants } from 'node:fs';
import { open, mkdir, writeFile, readFile,stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs,promisify } from 'node:util';
import { ROOT,loadState,dsn } from '../packages/database/scripts/local.mjs';
import { runtimeProfile } from './runtime-profile.mjs';
import { readOfflineDataset } from '../apps/risk-workers/scripts/dataset-import.mjs';
import { importOfflineDataset } from '../apps/risk-workers/dist/offline-dataset.js';
import { publishOfflineBatch } from '../apps/risk-workers/dist/offline-publication.js';
import { privateDirectory,readPrivateJson } from '../apps/risk-workers/scripts/private-json.mjs';
import { configurePortalIntakePolicy,evaluatePortalAmountRules,drainIntakeDetection } from './portal-intake-policy.mjs';
const execute=promisify(execFile),digest=value=>createHash('sha256').update(value).digest('hex');
const uuid=hex=>`${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;

export async function importCsvFile(path) {
  const profile=runtimeProfile();if(profile.profile!=='intake')throw Error();
  const state=await loadState(profile.stateDirectory),source=await open(resolve(path),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  let bytes;
  try{const before=await source.stat();if(!before.isFile()||before.nlink!==1||before.uid!==process.getuid()||before.size>64*1024*1024)throw Error();
    bytes=await source.readFile();const after=await source.stat();if(bytes.length!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs)throw Error();
  }finally{await source.close();}
  const sha=digest(bytes),directory=join(ROOT,'.local/intake-csv',sha);await mkdir(directory,{recursive:true,mode:0o700});await privateDirectory(directory);
  const copy=join(directory,'transfer.csv');
  try{await writeFile(copy,bytes,{mode:0o600,flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;if(digest(await readFile(copy))!==sha)throw Error();}
  const requestPath=join(directory,'request-v2.json');let request;
  try{request=await readPrivateJson(requestPath,16384);}catch(error){
    // Only a missing file permits creating a request; corrupt/unsafe existing requests are never replaced.
    {
      const script='import json,sys;from pathlib import Path;from dataset_profile import profile_file;p=profile_file(Path(sys.argv[1]),"transfer");assert p["validation_status"]=="valid";print(json.dumps({"sha":p["dataset_sha256"],"bytes":p["input_bytes"],"rows":p["observed_rows"]}))';
      const {stdout}=await execute(join(ROOT,'.venv/bin/python'),['-B','-c',script,copy],{cwd:join(ROOT,'apps/risk-workers/scripts'),timeout:30000,maxBuffer:16384});const stats=JSON.parse(stdout);
      if(stats.sha!==sha||stats.bytes!==bytes.length)throw Error();
      request={manifest:{format:1,execution_mode:'offline_analysis',batch_ref:uuid(digest('lmps_transfer:'+sha)),workspace_key:'offline_intake',source_namespace:'offline_lmps_transfer_csv',source_table:'transfer',
        profile_version:'offline-dataset-profile-1',dataset_sha256:sha,input_bytes:bytes.length,expected_rows:stats.rows},
        publication:{format:1,source_workspace:'offline_intake',batch_ref:uuid(digest('lmps_transfer:'+sha)),dataset_sha256:sha,workspace:'synthetic_local',namespace:'synthetic_csv',
          generation:uuid(digest('lmps_transfer_csv_generation_v1')),observed_at:(await stat(copy)).birthtime.toISOString(),mapping:'operator_intake_test_ok_failed_v1'}};
      const probe=await open(requestPath,'wx',0o600);try{await probe.writeFile(JSON.stringify(request,null,2));await probe.sync();}finally{await probe.close();}
    }
  }
  const connection=dsn(state,'intake');
  const snapshot=await readOfflineDataset(request.manifest,copy);
  const staged=await importOfflineDataset(connection,snapshot);
  const published=await publishOfflineBatch(connection,{...request.publication,batch_ref:staged.batch_ref});
  let risk={status:'publication_incomplete'};
  if(published.status==='complete'){
    const {selected,receipt}=await configurePortalIntakePolicy(state);
    await writeFile(join(ROOT,'.local/environments/intake/portal-policy.json'),JSON.stringify(receipt,null,2),{mode:0o600});
    const assessments=await evaluatePortalAmountRules(state,selected);
    await writeFile(join(directory,'amount-assessments.json'),JSON.stringify(assessments,null,2),{mode:0o600});
    risk={status:'evaluated',amount_assessment_batches:assessments.length,...await drainIntakeDetection(state)};
  }
  const report={...published,staging_status:staged.status,publication_request_sha256:digest(JSON.stringify(request.publication)),risk_dispatch:'existing_detection_worker_policy_binding',risk,production_sync:false};
  await writeFile(join(directory,'result.json'),JSON.stringify(report,null,2),{mode:0o600});return report;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const {values}=parseArgs({options:{input:{type:'string'}}});if(!values.input)throw Error();const result=await importCsvFile(values.input);console.info(JSON.stringify(result));if(result.status!=='complete')process.exitCode=2;}
  catch{console.error('CSV_INTAKE_FAILED; committed progress and private receipts retained; source values and credentials withheld.');process.exitCode=1;}
}
