import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {randomBytes,randomUUID,createECDH} from 'node:crypto';
import {writeFile,chmod} from 'node:fs/promises';
import {join} from 'node:path';
import webpush from 'web-push';
import {createDatabase} from '@lmps/database';
import {dsn} from '../../../packages/database/scripts/local.mjs';
import {overviewFixture} from './fixtures/overview.mjs';
import {createApp} from '../dist/app.js';
import {WebPushRuntime,readPushConfig,validDeviceSubscription,sealSubscription,openSubscription,endpointHash,quietDelay} from '../dist/web-push-runtime.js';
let f,app,db,config,first;
const device=()=>{const key=createECDH('prime256v1');key.generateKeys();return {endpoint:'https://fcm.googleapis.com/fcm/send/'+randomUUID(),keys:{p256dh:key.getPublicKey().toString('base64url'),auth:randomBytes(16).toString('base64url')}};};
before(async()=>{f=await overviewFixture();db=createDatabase(dsn(f.state));config={subject:'mailto:operator@example.com',...webpush.generateVAPIDKeys(),storageKey:randomBytes(32).toString('base64url')};const path=join(f.temporary,'push.json');await writeFile(path,JSON.stringify(config),{mode:0o600});({app}=await createApp({LMPS_ENVIRONMENT:'test',LMPS_POSTGRES_DSN:dsn(f.state),LMPS_LOCAL_AUTH_CONFIG:join(f.temporary,'auth.json'),LMPS_WEB_PUSH_CONFIG:path,LMPS_WEB_PUSH_WORKER:'0'}));await app.init();});
after(async()=>{await app?.close();await db?.close();await f?.close();});
async function request(path,{method='GET',payload,...claims}={}){return app.inject({method,url:'/v1/local/'+path,headers:{authorization:'Bearer '+await f.token({sub:'synthetic_push_owner',scope:'alerts:read',...claims})},...(payload===undefined?{}:{payload})});}
async function ok(path,options){const r=await request(path,options);assert.equal(r.statusCode,200,r.body);return r.json();}
const register=async input=>ok('web-push/subscriptions',{method:'POST',payload:input??device()});
const queue=async id=>ok('web-push/subscriptions/'+id+'/test',{method:'POST',payload:{}});
const delivered=async id=>(await ok('web-push/deliveries')).items.find(d=>d.delivery_id===id);
test('workspace badge counts current states, not snapshot/page counts; scopes and workspace enforced',async()=>{assert.deepEqual((await ok('alerts/summary')).counts,{open:5,acknowledged:1,reviewed:1});assert.deepEqual((await ok('alerts/summary',{workspace_key:'synthetic_other'})).counts,{open:0,acknowledged:0,reviewed:0});assert.equal((await request('alerts/summary',{scope:'risk:read'})).statusCode,403);assert.equal((await request('alerts/summary?workspace_key=synthetic_other')).statusCode,400);});
test('private config, binding encryption, SSRF allowlist and actual Web Push message encryption',async()=>{
 const path=join(f.temporary,'push.json');assert.deepEqual(await readPushConfig(path),config);await chmod(path,0o644);await assert.rejects(readPushConfig(path));await chmod(path,0o600);
 const value=device(),sealed=sealSubscription(value,config,'owner');assert.deepEqual(openSubscription(sealed,config,'owner'),value);assert.throws(()=>openSubscription(sealed,config,'other'));assert.ok(!sealed.includes(value.endpoint));
 for(const endpoint of ['http://fcm.googleapis.com/a','https://127.0.0.1/a','https://fcm.googleapis.com.attacker.test/a','https://user@fcm.googleapis.com/a','https://fcm.googleapis.com:8443/a'])assert.equal(validDeviceSubscription({...value,endpoint}),false);
 const details=webpush.generateRequestDetails(value,JSON.stringify({kind:'monitoring_update'}),{vapidDetails:{subject:config.subject,publicKey:config.publicKey,privateKey:config.privateKey},TTL:60});assert.equal(details.headers['Content-Encoding'],'aes128gcm');assert.ok(!details.body.toString().includes('monitoring_update'));
});
test('personal registration is encrypted/idempotent and never returns endpoint or auth secrets',async()=>{
 const value=device();first=await register(value);assert.equal((await register(value)).subscription_id,first.subscription_id);const response=await ok('web-push');assert.equal(response.public_key,config.publicKey);assert.equal(response.items[0].endpoint_hash,endpointHash(value));assert.ok(!JSON.stringify(response).includes(value.endpoint));assert.ok(!JSON.stringify(response).includes(value.keys.auth));
 const stored=(await f.owner.pool.query('SELECT encrypted_subscription FROM platform.local_web_push_subscriptions WHERE subscription_id=$1',[first.subscription_id])).rows[0];assert.ok(!stored.encrypted_subscription.includes(value.endpoint));assert.deepEqual((await ok('web-push',{sub:'synthetic_other'})).items,[]);
 assert.equal((await request('web-push/subscriptions',{method:'POST',sub:'synthetic_other',payload:value})).statusCode,409);assert.equal((await request('web-push/subscriptions',{method:'POST',payload:{...value,subject:'synthetic_other'}})).statusCode,400);assert.equal((await request('web-push/subscriptions/'+first.subscription_id+'/revoke',{method:'POST',sub:'synthetic_other',payload:{}})).statusCode,404);
});
test('durable queue, rate limit, fenced acceptance, future Alert enqueue and no historical registration burst',async()=>{
 const queued=await queue(first.subscription_id);assert.equal((await request('web-push/subscriptions/'+first.subscription_id+'/test',{method:'POST',payload:{}})).statusCode,409);let count=0;
 const runtime=new WebPushRuntime(db,config,async(s,p,o)=>{count++;assert.deepEqual(JSON.parse(p),{kind:'monitoring_update'});assert.equal(o.timeout,5000);return {statusCode:201,headers:{},body:''};},false);await runtime.tick();assert.equal((await delivered(queued.delivery_id)).state,'accepted');assert.equal(count,1);
 assert.equal((await db.pool.query('SELECT platform.finish_web_push_delivery($1,$2,$3,$4) AS ok',[queued.delivery_id,randomUUID(),'ACCEPTED',0])).rows[0].ok,false);
 const e=f.entries[0];await f.alerts.generate({format:1,provenance:'local_synthetic',execution_mode:'test',workspace_key:'synthetic_local',assessment_run_id:e.request.run_id,policy:{policy_id:'synthetic_push',version:'synthetic_new',minimum_severity:'low',included_codes:['FRAUD_HIGH_AMOUNT'],include_partial:true}});await runtime.tick();await runtime.tick();assert.equal(count,2);assert.equal((await f.owner.pool.query("SELECT count(*)::int AS n FROM platform.local_web_push_deliveries WHERE kind='alert'")).rows[0].n,1);
});
test('gone endpoints disable subscriptions; retryable provider errors stop after five attempts and hide provider diagnostics',async()=>{
 const gone=await register();await queue(gone.subscription_id);await new WebPushRuntime(db,config,async()=>{throw {statusCode:410,body:'PRIVATE_BODY'};},false).tick();assert.equal((await ok('web-push')).items.find(d=>d.subscription_id===gone.subscription_id).active,false);
 const retry=await register(),q=await queue(retry.subscription_id),runtime=new WebPushRuntime(db,config,async()=>{throw {statusCode:429,body:'PRIVATE_BODY'};},false);for(let i=0;i<5;i++){await f.owner.pool.query('UPDATE platform.local_web_push_deliveries SET available_at=clock_timestamp() WHERE delivery_id=$1',[q.delivery_id]);await runtime.tick();}const row=await delivered(q.delivery_id);assert.equal(row.attempt_count,5);assert.equal(row.state,'failed');assert.ok(!JSON.stringify(row).includes('PRIVATE_BODY'));
});
test('quiet hours defer without consuming retries and revoke cancels pending deliveries; app has no direct writes',async()=>{
 const sub=await register(),q=await queue(sub.subscription_id),settings={enabled:true,severities:['high'],dimensions:['fraud'],quiet_hours:{enabled:true,start:'00:00',end:'00:00',timezone:'UTC'}};await db.pool.query('SELECT * FROM platform.save_notification_preferences($1,$2,$3,$4)',['synthetic_local','synthetic_push_owner',0,settings]);assert.equal(quietDelay(settings,new Date('2026-01-01T12:00:00Z')),3600);assert.equal(quietDelay({...settings,quiet_hours:{enabled:true,start:'22:00',end:'07:00',timezone:'Asia/Vientiane'}},new Date('2026-01-01T12:00:00Z')),0);
 await new WebPushRuntime(db,config,async()=>assert.fail('must not send during quiet hours'),false).tick();assert.equal((await delivered(q.delivery_id)).state,'pending');assert.equal((await delivered(q.delivery_id)).attempt_count,0);await ok('web-push/subscriptions/'+sub.subscription_id+'/revoke',{method:'POST',payload:{}});assert.equal((await delivered(q.delivery_id)).state,'revoked');assert.equal((await db.pool.query("SELECT has_table_privilege(current_user,'platform.local_web_push_subscriptions','INSERT,UPDATE,DELETE') AS writes")).rows[0].writes,false);
});
