import assert from 'node:assert/strict';
import { createHash,generateKeyPairSync,randomUUID } from 'node:crypto';
import { before,after,test } from 'node:test';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createDatabase,createModelSignals,createTransactionRisks,createTransactionRevisions } from '@lmps/database';
import { initializeCluster,availablePort,startCluster,stopCluster,dsn,loadState } from '../../../packages/database/scripts/local.mjs';
import { migrations } from '../../../packages/database/scripts/migrations.mjs';
import { transactionRiskFixture } from '../../../packages/database/test/fixtures/transaction-risk.mjs';
import { authFixture } from '../scripts/auth-fixture.mjs';
import { createApp } from '../dist/app.js';
let temp,state,app,unconfigured,auth,writer,risks,models,owner,id;
const get=(scope='risk:read alerts:read',changes={},path=id)=>app.inject({method:'GET',url:'/v1/local/model-receipts/'+path,
  headers:scope?{authorization:'Bearer '+auth.tokenValue(scope,changes)}:{}});
before(async()=>{
  temp=await mkdtemp('/tmp/lmps-model-api-');state=await initializeCluster(join(temp,'pg'),await availablePort());await startCluster(state);await migrations(dsn(state,'migration'),true);
  owner=createDatabase(dsn(state,'migration'),'migration');writer=createTransactionRevisions(dsn(state,'intake'));risks=createTransactionRisks(dsn(state,'intake'));
  auth=await authFixture(temp);const tokens=new Map();for(const scope of ['risk:read alerts:read','risk:read','alerts:read','source:read'])tokens.set(scope,await auth.token({scope}));
  tokens.set('foreign',await auth.token({scope:'risk:read alerts:read',workspace_key:'synthetic_other'}));auth.tokenValue=(scope,changes)=>tokens.get(changes.foreign?'foreign':scope);
  const raw=generateKeyPairSync('ed25519').publicKey.export({format:'der',type:'spki'}).subarray(-32),trust={public_key:raw.toString('hex'),key_id:'ml_'+createHash('sha256').update(raw).digest('hex').slice(0,16)};
  const path=join(temp,'model-public.json');await writeFile(path,JSON.stringify(trust),{mode:0o600});models=createModelSignals(dsn(state,'intake'),trust);
  const f=transactionRiskFixture();await writer.append(f.revision);await risks.evaluate(f.request);id=randomUUID();
  await models.record({format:1,execution_mode:'shadow',workspace_key:'synthetic_local',request_id:id,assessment_run_id:f.request.run_id,
    policy:{policy_id:'synthetic_gate',version:'synthetic_v1',task:'fraud',probability_threshold:'0.900000000',missing_model:'skip',model:{name:'synthetic_unavailable',version:'1',artifact_sha256:'a'.repeat(64)},
      alert_policy:{policy_id:'synthetic_alerts',version:'synthetic_v1',included_codes:['FRAUD_HIGH_AMOUNT'],minimum_severity:'high',include_partial:true}}},null);
  const env={LMPS_POSTGRES_DSN:dsn(state),LMPS_LOCAL_AUTH_CONFIG:auth.path};({app}=await createApp({...env,LMPS_ML_PUBLIC_KEY_FILE:path}));await app.init();
  ({app:unconfigured}=await createApp(env));await unconfigured.init();
});
after(async()=>{
  await app?.close();await unconfigured?.close();for(const r of [models,risks,writer,owner])await r?.close();
  if(temp&&!state)try{state=await loadState(join(temp,'pg'));}catch{}if(state)await stopCluster(state);if(temp)await rm(temp,{recursive:true,force:true});
});
test('Portal model receipts require both scopes, bind workspace, redact vectors and expose typed OpenAPI',async()=>{
  assert.equal((await get(null)).statusCode,401);for(const scope of ['risk:read','alerts:read','source:read'])assert.equal((await get(scope)).statusCode,403);
  const response=await get();assert.equal(response.statusCode,200);const view=response.json().receipt;
  assert.equal(view.decision.reason_code,'MODEL_UNAVAILABLE');assert.equal(view.decision.probability,null);assert.deepEqual(view.probabilities,{});assert.equal(view.training_eligible,false);
  assert.equal(response.headers['cache-control'],'no-store');assert.ok(!response.body.includes('values'));assert.equal((await get(undefined,{foreign:true})).json().receipt,null);
  assert.equal((await get(undefined,{},randomUUID())).json().receipt,null);assert.equal((await get(undefined,{},'bad')).statusCode,400);
  const schema=(await app.inject({url:'/openapi.json'})).json();assert.ok(schema.components.schemas.ModelReceiptDto.properties.probabilities);assert.ok(schema.paths['/v1/local/model-receipts/{request_id}']);
});
test('unconfigured trust and corrupt evidence return fixed unavailable errors',async()=>{
  const headers={authorization:'Bearer '+auth.tokenValue('risk:read alerts:read',{})};assert.equal((await unconfigured.inject({url:'/v1/local/model-receipts/'+id,headers})).statusCode,503);
  await owner.pool.query("UPDATE platform.local_model_receipts SET snapshot_sha256=repeat('b',64)");const failed=await get();assert.equal(failed.statusCode,503);assert.equal(failed.json().code,'ML_STORAGE_UNAVAILABLE');assert.ok(!failed.body.includes('SELECT'));
});
