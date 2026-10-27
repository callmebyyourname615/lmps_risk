import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reviewWithModel } from '../dist/model-review.js';
import { readPrivateJson } from './private-json.mjs';
import { dsn,loadState,localMode } from '../../../packages/database/scripts/local.mjs';

export async function main(args=process.argv.slice(2),env=process.env) {
  try {
    localMode(); if(args.length!==1)throw new Error();
    const result=await reviewWithModel(await readPrivateJson(args[0],16384),{
      dsn:dsn(await loadState(env.LMPS_LOCAL_STATE_DIR),'intake'),endpoint:env.LMPS_MODEL_ENDPOINT ?? 'http://127.0.0.1:18502/v1/shadow/score',
      token_file:env.LMPS_ML_TOKEN_FILE,public_key_file:env.LMPS_ML_PUBLIC_KEY_FILE});
    console.info(JSON.stringify({status:result.status,request_id:result.view.request_id,decision:result.view.decision,alert_id:result.view.alert_id,scope:result.view.scope,enforcement:false}));return 0;
  } catch {console.error('ML_REVIEW_FAILED; private diagnostics withheld.');return 1;}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))process.exitCode=await main();
