/** Import-inert parent-host acceptance. No environment/runner/receipt seam. */
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { constants as C, lstatSync, readdirSync, mkdirSync, openSync, closeSync, writeFileSync, fsyncSync, linkSync, unlinkSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseCli, runFeatureCacheComparison, verifyFeatureCacheComparison, readFeatureCacheEvidence as read } from './feature-cache-compare.mjs';
import { createRuntime, ownedProcessHandles, verifyRuntime } from './feature-cache-runtime.mjs';
export { parseCli };
const root=fileURLToPath(new URL('../../../',import.meta.url)),self=fileURLToPath(import.meta.url);
const check=v=>{if(!v)throw Error('FEATURE_CACHE_ACCEPTANCE_FAILED');};
const encode=v=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a<b?-1:a>b?1:0)):x);
const hash=v=>createHash('sha256').update(v).digest('hex');
const same=(a,b)=>check(encode(a)===encode(b));
const json=p=>JSON.parse(read(p,true));
const fixed=[['11','14.11',null],['11','13.14',null],[null,null,'INPUT_MISSING'],[null,null,'HISTORY_INCOMPLETE'],['11','13.14',null],['1','7.00',null]];
const now='2026-01-01T12:02:00Z';
let apiHandles=0;
export const ownedApiHandles=()=>apiHandles;
export function assertHttpRuntimeReceipt(v,i){
 check(i===0||i===1);same(Object.keys(v).sort(),['format','mode','unit_only','native_acceptance','production_ready','state','cleanup_verified','requests','outputBytes','binarySha256','configSha256'].sort());
 check(v.format===1&&v.mode==='local_synthetic'&&v.unit_only===false&&v.native_acceptance===false&&v.production_ready===false&&v.cleanup_verified===true&&v.state===(i===0?'unavailable':'stopped'));
 check(v.binarySha256==='48a07c38 92d5982a 1af6c3fb b9db896b 50e7aa56 4b1d4e6a bcb12fcb 6b6b6e0d'.replaceAll(' ', '')&&/^[a-f0-9]{64}$/.test(v.configSha256)&&Number.isSafeInteger(v.requests)&&v.requests>0&&v.requests<=64&&Number.isSafeInteger(v.outputBytes)&&v.outputBytes>=0&&v.outputBytes<=65536);
}
function privateDir(p){const s=lstatSync(p);check(s.isDirectory()&&!s.isSymbolicLink()&&s.uid===process.getuid()&&(s.mode&0o777)===0o700);}
function parents(p){for(let d=dirname(p);;d=dirname(d)){const s=lstatSync(d);check(s.isDirectory()&&!s.isSymbolicLink()&&!(s.mode&0o022));if(d===join(root,'.local')||d.startsWith(join(root,'.local')+'/'))privateDir(d);if(d===dirname(d))break;}}
function inventory(base,privateFiles=false){const out={};let bytes=0,count=0;function walk(p,rel=''){const s=lstatSync(p);check(!s.isSymbolicLink());if(s.isDirectory()){if(privateFiles)privateDir(p);for(const n of readdirSync(p).sort())walk(join(p,n),join(rel,n));}else{check(++count<=4096);const b=read(p,privateFiles);bytes+=b.length;check(bytes<=(privateFiles?16*1024**2:64*1024**2));out[rel]=hash(b);}}walk(base);return out;}
function provenance(){const out={};for(const p of ['apps/risk-api/src','apps/risk-api/dist','apps/risk-workers/src','apps/risk-workers/dist','packages/contracts/src','packages/contracts/dist','packages/risk/src','packages/risk/dist'])out[p]=inventory(join(root,p));for(const p of ['apps/risk-workers/scripts/feature-cache-acceptance.mjs','apps/risk-workers/scripts/feature-cache-compare.mjs','apps/risk-workers/scripts/feature-cache-runtime.mjs','apps/risk-workers/fixtures/feature-cache-runtime.json','apps/risk-api/test/features-native.test.mjs','packages/risk/test/fixtures/feature-streams/golden.json'])out[p]=hash(read(join(root,p)));return out;}
function write(p,v){writeFileSync(p,encode(v),{mode:0o600,flag:'wx'});}
/** Independent exact DTO oracle; retained HTTP evidence contains only hashes. */
export function expectedDto(p,i=0,reason=fixed[i]?.[2],time=now,zero=false){
 check(Number.isInteger(i)&&i>=0&&i<6);const q=p.scope.plan.queries[i];
 return {version:p.scope.version,mode:'local_synthetic',production_ready:false,freshness:{as_of:q.as_of,now:time,source_age_seconds:(Date.parse(time)-Date.parse(q.as_of))/1000,max_age_seconds:p.scope.policy.max_age_seconds},status:reason?'unavailable':'available',reason:reason??null,count:reason?null:zero?'0':fixed[i][0],amount:reason?null:zero?'0.00':fixed[i][1],coverage:reason?'unavailable':'complete',source:reason?null:{generation:p.generation,content_hash:p.content_hash}};
}
export function assertHttpDto(dto,expected){same(dto,expected);check(Buffer.byteLength(JSON.stringify(dto))<=4096);}
function cases(p){return [
 ...['no_cache','required'].flatMap(policy=>fixed.map((v,i)=>({id:policy+'_'+i,policy,i,reason:v[2],time:now}))),
 ...[['stale','SOURCE_STALE','2026-01-01T13:00:01Z'],['expired','PUBLICATION_EXPIRED',p.expires_at],['generation','GENERATION_TOO_OLD',now],['missing','PUBLICATION_MISSING',now],['malformed','CACHE_INVALID',now],['timeout','CACHE_UNAVAILABLE',now],['outage','CACHE_UNAVAILABLE',now]].map(([id,reason,time])=>({id,policy:'required',i:0,reason,time})),
 {id:'zero',policy:'required',i:0,reason:null,time:now,zero:true}
 ];}
async function zeroPublication(p){
 const {initializeFeatureStream,applyFeatureStreamDelivery,materializeFeatureStreamSnapshot}=await import('../../../packages/risk/dist/index.js');
 const {featurePublicationContentHash}=await import('../../../packages/contracts/dist/feature-serving.js');
 const scope=structuredClone(p.scope);scope.plan.queries=[scope.plan.queries[0]];
 const corpus=JSON.parse(read(join(root,'packages/risk/test/fixtures/feature-streams/golden.json')));
 let state=initializeFeatureStream(scope.plan);state=applyFeatureStreamDelivery(state,{identity:scope.plan.identity,topic:scope.plan.topic,partition:0,offset:0,event:{...corpus.events[0],status:'failed'}});state=materializeFeatureStreamSnapshot(state,scope.plan.queries[0].id).state;
 const selected={...p,scope,state,generation:1,predecessor:null};selected.content_hash=featurePublicationContentHash(selected);return selected;
}
async function httpTrial(output,p,budgetMs){
 check(Number.isFinite(budgetMs)&&budgetMs>0&&budgetMs<=160000);
 const require=createRequire(new URL('../../risk-api/package.json',import.meta.url));
 await import(require.resolve('reflect-metadata'));
 const {Module}=await import(require.resolve('@nestjs/common'));
 const {NestFactory}=await import(require.resolve('@nestjs/core'));
 const {FastifyAdapter}=await import(require.resolve('@nestjs/platform-fastify'));
 const {generateKeyPair,exportJWK,SignJWT}=await import(require.resolve('jose'));
 const {FeaturesController}=await import('../../risk-api/dist/features.controller.js');
 const {FeatureServingService,FEATURE_READS}=await import('../../risk-api/dist/feature-serving.service.js');
 const authModule=await import('../../risk-api/dist/local-auth.js');
 const {openFeatureCache}=await import('../dist/feature-cache.js');
 const {featureStoreScopeIdentity}=await import('../../../packages/contracts/dist/feature-serving.js');
 const keys=await generateKeyPair('ES256'),jwk=await exportJWK(keys.publicKey);Object.assign(jwk,{kid:'synthetic_acceptance',alg:'ES256',use:'sig'});
 const scratch=join(output,'http-private');mkdirSync(scratch,{mode:0o700});
 let runtime,app,interrupted=false;const records=[],receipts=[];
 const close=async()=>{if(app){const a=app;await a.close();check(!a.getHttpServer().listening);app=null;apiHandles--;}};
 const interrupt=()=>{interrupted=true;Promise.allSettled([close(),runtime?.stop()]).catch(()=>{});};
 process.once('SIGTERM',interrupt);process.once('SIGINT',interrupt);
 const deadline=setTimeout(interrupt,budgetMs);
 try{
 const authFile=join(scratch,'auth.json');write(authFile,{format:1,kind:'local_synthetic',issuer:authModule.LOCAL_ISSUER,audience:authModule.LOCAL_AUDIENCE,jwks:{keys:[jwk]}});
 const auth=await authModule.loadLocalAuthenticator(authFile);
 const token=async(scope,workspace=p.scope.workspace_key)=>new SignJWT({scope,workspace_key:workspace}).setProtectedHeader({alg:'ES256',kid:jwk.kid,typ:'at+jwt'}).setIssuer(authModule.LOCAL_ISSUER).setAudience(authModule.LOCAL_AUDIENCE).setSubject('synthetic_acceptance').setIssuedAt().setNotBefore('0s').setExpirationTime('120s').setJti(randomUUID()).sign(keys.privateKey);
 const headers={good:'Bearer '+await token('risk:read'),permission:'Bearer '+await token('source:read'),foreign:'Bearer '+await token('risk:read','synthetic_foreign')};
 runtime=await createRuntime({output:'.local/cache-http-'+randomUUID()});
 const cache=openFeatureCache(runtime,p.scope),key='lmps:local_synthetic:feature-cache:1:'+hash(featureStoreScopeIdentity(p.scope));await cache.rebuild(p);
 async function start(policy,scope=p.scope){await close();class FixtureModule{};Module({controllers:[FeaturesController],providers:[authModule.LocalAccessGuard,{provide:authModule.LOCAL_AUTH,useValue:auth},{provide:FEATURE_READS,useValue:new FeatureServingService({mode:'local_synthetic',scope,cache_policy:policy,store_directory:join(output,'comparison/baseline/store')},runtime)}]})(FixtureModule);
 app=await NestFactory.create(FixtureModule,new FastifyAdapter({logger:false,bodyLimit:2048}),{logger:false,abortOnError:false});apiHandles++;await app.listen(0,'127.0.0.1');const server=app.getHttpServer();server.requestTimeout=3000;server.headersTimeout=3000;server.keepAliveTimeout=1;}
 async function get(query,header=headers.good){const address=app.getHttpServer().address();check(address.address==='127.0.0.1'&&address.port>0);const response=await fetch(`http://127.0.0.1:${address.port}/v1/local/features?`+new URLSearchParams(query),{headers:header?{authorization:header}:{},signal:AbortSignal.timeout(4000)});let text='';for await(const chunk of response.body){text+=Buffer.from(chunk).toString('utf8');check(Buffer.byteLength(text)<=4096);}return {status:response.status,dto:JSON.parse(text)};}
 const query=(i=0,time=now)=>({version:p.scope.version,query_id:p.scope.plan.queries[i].id,currency:p.scope.plan.queries[i].currency,as_of:p.scope.plan.queries[i].as_of,now:time,minimum_generation:'1'});
 await start('required');
 const requestsBefore=runtime.receipt().requests;
 for(const [id,header,status] of [['unauthorized',null,401],['permission',headers.permission,403],['foreign',headers.foreign,403]]){
  const r=await get(query(),header);check(r.status===status);
  same(r.dto,id==='unauthorized'?{code:'UNAUTHORIZED',message:'A valid local access token is required.'}:id==='permission'?{code:'FORBIDDEN',message:'Required local scope is unavailable.'}:{code:'FORBIDDEN'});
  check(runtime.receipt().requests===requestsBefore);records.push({id,status});
 }
 for(const q of [{...query(),extra:'forbidden'},{...query(),version:'real'},{...query(),query_id:'x'.repeat(2100)}]){const r=await get(q);check(r.status===400);same(r.dto,{code:'INVALID_FEATURE_QUERY'});check(runtime.receipt().requests===requestsBefore);}records.push({id:'invalid_queries',status:400,count:3});
 let policy='required';
 for(const c of cases(p)){
  if(policy!==c.policy){await start(c.policy);policy=c.policy;}const q=query(c.i,c.time);if(c.id==='generation')q.minimum_generation='3';
  if(c.id==='missing')await runtime.request(['DEL',key]);
  if(c.id==='malformed')await runtime.request(['SET',key,'malformed synthetic payload']);
  // Fixed bounded Lua on the owned runtime exceeds its 1s transport deadline.
  // It cannot touch keys or any external service. The runtime tears itself down.
  if(c.id==='timeout'){
   let rejected=false;try{await runtime.request(['EVAL',"local a=redis.call('TIME'); local s=a[1]*1000000+a[2]; local n=s; repeat local b=redis.call('TIME'); n=b[1]*1000000+b[2] until n-s>=1200000; return 1",'0']);}catch{rejected=true;}check(rejected);
  }
  if(c.id==='outage'){await runtime.stop();receipts.push(runtime.receipt());}
  let selected=p;
  if(c.zero){runtime=await createRuntime({output:'.local/cache-http-'+randomUUID()});selected=await zeroPublication(p);await openFeatureCache(runtime,selected.scope).publish(selected);await start('required',selected.scope);}
  const r=await get(q);check(!interrupted&&r.status===200);assertHttpDto(r.dto,expectedDto(selected,c.i,c.reason,c.time,!!c.zero));records.push({id:c.id,status:200,bytes:Buffer.byteLength(JSON.stringify(r.dto)),dto_hash:hash(encode(r.dto))});
 }
 await close();await runtime.stop();receipts.push(runtime.receipt());check(apiHandles===0&&ownedProcessHandles().length===0);receipts.forEach(assertHttpRuntimeReceipt);
 return {records,runtimes:receipts};
 }finally{
  clearTimeout(deadline);process.off('SIGTERM',interrupt);process.off('SIGINT',interrupt);
  const cleanup=await Promise.allSettled([close(),runtime?.stop()]);
  check(cleanup.every(r=>r.status==='fulfilled'));rmSync(scratch,{recursive:true,force:true});
 }
}
async function verify(output,receiptFile){
 parseCli(['--output',output]);parents(output);privateDir(output);same(readdirSync(output).sort(),[receiptFile,'comparison','http.json'].sort());
 const r=json(join(output,receiptFile));same(Object.keys(r).sort(),['version','mode','production_ready','native_acceptance','source_hashes','runtime_hash','files','elapsed_ms','cleanup_verified'].sort());
 check(r.version===1&&r.mode==='local_synthetic'&&r.production_ready===false&&r.native_acceptance===true&&r.cleanup_verified===true&&Number.isFinite(r.elapsed_ms)&&r.elapsed_ms>=0&&r.elapsed_ms<175000);
 same(r.source_hashes,provenance());check(r.runtime_hash===hash(encode(await verifyRuntime())));await verifyFeatureCacheComparison(join(output,'comparison'));
 const files=inventory(output,true);delete files[receiptFile];same(files,r.files);
 const h=json(join(output,'http.json'));same(Object.keys(h).sort(),['records','runtimes']);check(h.records.length===24&&h.runtimes.length===2);h.runtimes.forEach(assertHttpRuntimeReceipt);
 const p=json(join(output,'comparison/baseline/store/publication.json')).publication,zero=await zeroPublication(p);
 same(h.records.slice(0,4),[{id:'unauthorized',status:401},{id:'permission',status:403},{id:'foreign',status:403},{id:'invalid_queries',status:400,count:3}]);
 for(const [i,c] of cases(p).entries()){const dto=expectedDto(c.zero?zero:p,c.i,c.reason,c.time,!!c.zero);same(h.records[i+4],{id:c.id,status:200,bytes:Buffer.byteLength(JSON.stringify(dto)),dto_hash:hash(encode(dto))});}
 same(r.source_hashes,provenance());return r;
}
/** Read-only evidence consistency check; receipts alone never prove execution. */
export async function verifyFeatureCacheAcceptance(output){return verify(output,'acceptance.json');}
export async function runFeatureCacheAcceptance(options){
 check(arguments.length===1&&options&&Object.getPrototypeOf(options)===Object.prototype);same(Reflect.ownKeys(options),['output']);check('value'in Object.getOwnPropertyDescriptor(options,'output'));
 const {output}=parseCli(['--output',options.output]);parents(output);const before=provenance(),started=performance.now();mkdirSync(output,{mode:0o700});
 const runtime_hash=hash(encode(await verifyRuntime()));await runFeatureCacheComparison({output:join(output,'comparison')});const p=json(join(output,'comparison/baseline/store/publication.json')).publication;
 const h=await httpTrial(output,p,160000-(performance.now()-started));check(!apiHandles&&!ownedProcessHandles().length);same(before,provenance());write(join(output,'http.json'),h);
 check(runtime_hash===hash(encode(await verifyRuntime())));const result={version:1,mode:'local_synthetic',production_ready:false,native_acceptance:true,source_hashes:before,runtime_hash,files:inventory(output,true),elapsed_ms:performance.now()-started,cleanup_verified:true};check(result.elapsed_ms<160000);
 const stage='.stage-'+randomUUID(),stagePath=join(output,stage);write(stagePath,result);
 const fd=openSync(stagePath,C.O_RDONLY|C.O_NOFOLLOW);try{fsyncSync(fd);}finally{closeSync(fd);}
 // Bounded fresh process verifies all persisted evidence before publication.
 await promisify(execFile)(process.execPath,[self,'--verify-stage',output,stage],{timeout:15000,maxBuffer:4096,env:{PATH:process.env.PATH}});
 check(performance.now()-started<175000);same(before,provenance());check(!apiHandles&&!ownedProcessHandles().length);
 linkSync(stagePath,join(output,'acceptance.json'));unlinkSync(stagePath);const d=openSync(output,C.O_RDONLY|C.O_DIRECTORY|C.O_NOFOLLOW);try{fsyncSync(d);}finally{closeSync(d);}return verifyFeatureCacheAcceptance(output);
}
if(process.argv[1]&&resolve(process.argv[1])===self){Promise.resolve().then(()=>{
 const args=process.argv.slice(2);if(args.length===3&&args[0]==='--verify-stage'&&/^\.stage-[a-f0-9-]{36}$/.test(args[2]))return verify(args[1],args[2]);
 return runFeatureCacheAcceptance(parseCli(args));
 }).then(()=>process.stdout.write('Local synthetic acceptance verified; production_ready=false.\n'),()=>{process.stderr.write('Feature cache acceptance failed; no acceptance claim.\n');process.exitCode=1;});}
