import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { Reflector, NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { FeatureServingService, loadFeatureFixture, FEATURE_READS } from '../dist/feature-serving.service.js';
import { FeaturesController } from '../dist/features.controller.js';
import { LocalAccessGuard, LOCAL_SCOPE, LOCAL_AUTH, loadLocalAuthenticator, LOCAL_ISSUER, LOCAL_AUDIENCE } from '../dist/local-auth.js';
import { readConfig } from '../dist/config.js';
import { initializeFeatureStream, applyFeatureStreamDelivery, materializeFeatureStreamSnapshot } from '@lmps/risk';
import { featurePublicationContentHash } from '../../../packages/contracts/dist/feature-serving.js';
import { testFeatureCache } from '../../risk-workers/dist/feature-cache.js';
const corpus = JSON.parse(readFileSync(new URL('../../../packages/risk/test/fixtures/feature-streams/golden.json', import.meta.url)));
const plan = { version: 'synthetic-feature-stream-1', identity: 'synthetic_declared', run_id: 'synthetic_run', input_identity: 'synthetic_golden_v1', namespace: 'synthetic_golden', topic: 'synthetic_golden.synthetic_run', window_seconds: 3600, coverage_start: corpus.coverage_start, queries: corpus.snapshots.map(({expected,...q}) => q), limits: { records: 32, revisions: 32, snapshots: 8, capture_bytes: 32768, state_bytes: 1048576 } };
const scope = { version: 'synthetic-feature-serving-1', mode: 'local_synthetic', workspace_key: 'synthetic_cache', plan, policy: {id: 'synthetic_fixture', version: 'synthetic_v1', max_age_seconds: 3600} };
const fixture = { mode: 'local_synthetic', scope, cache_policy: 'no_cache', store_directory: resolve('.local/feature-unit-absent') };
const principal = { subject: 'synthetic_reader', workspace: scope.workspace_key };
const query = (i = 0, extra = {}) => ({ version: scope.version, query_id: plan.queries[i].id, currency: plan.queries[i].currency, as_of: plan.queries[i].as_of, now: '2026-01-01T12:01:00Z', minimum_generation: '1', ...extra });
function publication(events = corpus.events, selected = scope) {
  let state = initializeFeatureStream(selected.plan);
  events.forEach((event, offset) => { state = applyFeatureStreamDelivery(state, {identity: plan.identity, topic: plan.topic, partition: 0, offset, event}); });
  for (const q of selected.plan.queries) state = materializeFeatureStreamSnapshot(state, q.id).state;
  const p = { version: scope.version, scope: selected, generation: 1, predecessor: null, state, published_at: '2026-01-01T12:01:00Z', expires_at: '2026-01-02T12:01:00Z', content_hash: Array(8).fill('00000000').join('-') };
  p.content_hash = featurePublicationContentHash(p); return p;
}
const service = (p) => new FeatureServingService(fixture, undefined, {publication: () => p});
function redacted(dto) {
  const text = JSON.stringify(dto); assert.ok(Buffer.byteLength(text) <= 4096);
  for (const field of ['state','plan','request','publication','snapshot','deliveries','events','sender','receiver','store_directory','authorization','principal']) assert.ok(!Object.hasOwn(dto, field), field);
  assert.ok(!text.includes('synthetic_target')); assert.ok(!text.includes(fixture.store_directory));
}
test('independent fixed typed reads, compact provenance and null versus valid zero', async () => {
  const s = service(publication());
  const expected = [['11','14.11',null], ['11','13.14',null], [null,null,'INPUT_MISSING'], [null,null,'HISTORY_INCOMPLETE'], ['11','13.14',null], ['1','7.00',null]];
  for (let i=0;i<expected.length;i++) { const dto = await s.read(principal,query(i)); assert.deepEqual([dto.count,dto.amount,dto.reason],expected[i]); assert.equal(dto.coverage,dto.status === 'available' ? 'complete' : 'unavailable'); redacted(dto); }
  assert.deepEqual((await s.read(principal,query())).freshness,{as_of:'2026-01-01T12:00:00Z',now:'2026-01-01T12:01:00Z',source_age_seconds:60,max_age_seconds:3600});
  const zeroScope = structuredClone(scope); zeroScope.plan.queries = [zeroScope.plan.queries[0]];
  const zero = new FeatureServingService({...fixture,scope:zeroScope},undefined,{publication:()=>publication([{...corpus.events[0],status:'failed'}],zeroScope)});
  const dto = await zero.read(principal,query()); assert.deepEqual([dto.status,dto.count,dto.amount],['available','0','0.00']); assert.equal(dto.source.generation,1); redacted(dto);
});
test('source time, expiry equality, minimum generation, missing and corrupt evidence', async () => {
  const p = publication(), s = service(p);
  assert.equal((await s.read(principal,query(0,{now:'2026-01-01T13:00:00Z'}))).status,'available');
  for (const [extra,reason] of [[{now:'2026-01-01T13:00:01Z'},'SOURCE_STALE'],[{now:p.expires_at},'PUBLICATION_EXPIRED'],[{minimum_generation:'2'},'GENERATION_TOO_OLD'],[{now:'2026-01-01T11:59:59Z'},'FUTURE_PUBLICATION']]) { const dto=await s.read(principal,query(0,extra)); assert.equal(dto.reason,reason); assert.equal(dto.count,null); redacted(dto); }
  assert.equal((await service(null).read(principal,query())).reason,'PUBLICATION_MISSING');
  for (const bad of [{...p,version:'real'}, {...p,content_hash:'private raw failure'}, {...p,state:{}}]) { const dto=await service(bad).read(principal,query()); assert.equal(dto.reason,'EVIDENCE_UNAVAILABLE'); assert.equal(dto.amount,null); redacted(dto); }
  const recent = {...p,published_at:'2026-01-01T13:00:01Z'}; recent.content_hash=featurePublicationContentHash(recent);
  assert.equal((await service(recent).read(principal,query(0,{now:recent.published_at}))).reason,'SOURCE_STALE');
});
test('scope and malformed inputs reject before evidence IO; strict local configuration', async () => {
  let reads=0; const s=new FeatureServingService(fixture,undefined,{publication:()=>{reads++;throw Error('private raw diagnostics');}});
  await assert.rejects(s.read({...principal,workspace:'synthetic_foreign'},query()),e=>e.getStatus()===403);
  for(const bad of [{...query(),extra:true},query(0,{query_id:'unknown'}),query(0,{currency:'USD'}),query(0,{as_of:'2026-01-01T11:00:00Z'}),query(0,{minimum_generation:'1001'}),query(0,{version:'real'}),query(0,{query_id:'x'.repeat(2097153)}),query(0,{now:['bad']})]) await assert.rejects(s.read(principal,bad),e=>e.getStatus()===400);
  assert.equal(reads,0); const dto=await s.read(principal,query()); assert.equal(dto.reason,'EVIDENCE_UNAVAILABLE'); redacted(dto);
  for (const bad of [{...fixture,mode:'real'}, {...fixture,cache_policy:'fallback'}, {...fixture,remote:'localhost'}, {...fixture,scope:{...scope,mode:'real'}}]) assert.throws(()=>new FeatureServingService(bad));
  for(const env of [{LMPS_LOCAL_FEATURE_MODE:'real'}, {LMPS_LOCAL_FEATURE_CONFIG:'/private/fixture'}, {LMPS_LOCAL_FEATURE_REMOTE:'localhost'}]) assert.throws(()=>readConfig(env));
  assert.equal(readConfig({}).environment,'local'); assert.throws(()=>loadFeatureFixture('/nonexistent/private/fixture'));
});
test('required cache outage/timeout is explicit and never invokes no-cache reader', async () => {
  let reads=0; const f={...fixture,cache_policy:'required'};
  const io={publication:()=>{reads++;return publication();}};
  assert.equal((await new FeatureServingService(f,undefined,io).read(principal,query())).reason,'CACHE_UNAVAILABLE');
  let hang=false;
  const runtime={ready:()=>true,receipt:()=>({mode:'local_synthetic',unit_only:true,native_acceptance:false,production_ready:false,binarySha256:'48a07c3892d5982a1af6c3fbb9db896b50e7aa564b1d4e6abcb12fcb6b6b6e0d'}),request:async()=>{if(hang)return new Promise(()=>{});throw Error('private auth and store path');}};
  const cache=testFeatureCache(runtime,scope),s=new FeatureServingService(f,undefined,{...io,cache:cache.serve});
  for(const hanging of [false,true]){hang=hanging;const dto=await s.read(principal,query());assert.equal(dto.reason,'CACHE_UNAVAILABLE');assert.equal(dto.count,null);redacted(dto);} assert.equal(reads,0);
});
test('US1002 unit cache adapter preserves typed reads, missing/invalid state and generation without writes', async () => {
  let value=null;const commands=[];
  const runtime={ready:()=>true,receipt:()=>({mode:'local_synthetic',unit_only:true,native_acceptance:false,production_ready:false,binarySha256:'48a07c3892d5982a1af6c3fbb9db896b50e7aa564b1d4e6abcb12fcb6b6b6e0d'}),request:async(args)=>{commands.push(args[0]);if(args[0]==='GET')return value;assert.equal(args[0],'EVAL');value=args[4];return 'published';}};
  // Deliberate unit transport, not Redis/CAS/native acceptance.
  const cache=testFeatureCache(runtime,scope),s=new FeatureServingService({...fixture,cache_policy:'required'},undefined,{cache:cache.serve,publication:()=>assert.fail('fallback')});
  assert.equal((await s.read(principal,query())).reason,'PUBLICATION_MISSING');await cache.publish(publication());commands.length=0;
  const dto=await s.read(principal,query());assert.deepEqual([dto.count,dto.amount,dto.source.generation],['11','14.11',1]);redacted(dto);
  assert.equal((await s.read(principal,query(0,{minimum_generation:'2'}))).reason,'GENERATION_TOO_OLD');
  value='private invalid cache payload';const bad=await s.read(principal,query());assert.equal(bad.reason,'CACHE_INVALID');assert.equal(bad.amount,null);redacted(bad);
  assert.ok(commands.every(command=>command==='GET'));
});
test('private B07 fixture reads are bounded, scope-bound and read only; config rejects extensions', async () => {
  const root=resolve('.local');mkdirSync(root,{recursive:true,mode:0o700});const dir=mkdtempSync(join(root,'feature-unit-'));
  try {
    const f={...fixture,store_directory:dir},file=join(dir,'fixture.json'),owner='11111111-1111-4111-8111-111111111111';
    writeFileSync(file,JSON.stringify(f),{mode:0o600});
    assert.deepEqual(loadFeatureFixture(file),f);
    const ownerFile=join(dir,'owner.json'),publicationFile=join(dir,'publication.json');
    writeFileSync(ownerFile,JSON.stringify({version:1,owner}),{mode:0o600});
    const p=publication();writeFileSync(publicationFile,JSON.stringify({version:1,owner,scope,publication:p}),{mode:0o600});
    const before=readFileSync(publicationFile),stat=statSync(publicationFile),s=new FeatureServingService(loadFeatureFixture(file));
    const dto=await s.read(principal,query());assert.equal(dto.amount,'14.11');redacted(dto);
    assert.deepEqual(readFileSync(publicationFile),before);assert.equal(statSync(publicationFile).mtimeMs,stat.mtimeMs);
    writeFileSync(publicationFile,JSON.stringify({version:1,owner,scope:{...scope,workspace_key:'synthetic_foreign'},publication:p}));
    assert.equal((await s.read(principal,query())).reason,'EVIDENCE_UNAVAILABLE');
    writeFileSync(publicationFile,'x'.repeat(1048577));assert.equal((await s.read(principal,query())).amount,null);
    for(const bad of [{...f,mode:'real'}, {...f,scope:{...scope,source:'real'}}, {...f,cache_policy:'fallback'}, {...f,remote:'127.0.0.1'}]) {writeFileSync(file,JSON.stringify(bad));assert.throws(()=>loadFeatureFixture(file),/Invalid private local feature configuration/);}
    const link=join(dir,'link.json');symlinkSync(file,link);assert.throws(()=>loadFeatureFixture(link));
    writeFileSync(file,'x'.repeat(1048577));assert.throws(()=>loadFeatureFixture(file));
  } finally {rmSync(dir,{recursive:true,force:true});}
});
test('feature and app imports are inert without fixtures or native services', () => {
  for(const name of ['feature-serving.service.js','features.controller.js','app.js']) execFileSync(process.execPath,['--input-type=module','-e',`await import(${JSON.stringify(new URL('../dist/'+name,import.meta.url).href)})`],{timeout:10000,stdio:'pipe'});
});
test('real existing auth guard enforces token/permission before controller and workspace IO', async () => {
  const root=resolve('.local');mkdirSync(root,{recursive:true,mode:0o700});const dir=mkdtempSync(join(root,'feature-unit-'));
  try {
    const keys=await generateKeyPair('ES256'),jwk=await exportJWK(keys.publicKey);Object.assign(jwk,{kid:'synthetic_unit',alg:'ES256',use:'sig'});
    const file=join(dir,'fixture.json');writeFileSync(file,JSON.stringify({format:1,kind:'local_synthetic',issuer:LOCAL_ISSUER,audience:LOCAL_AUDIENCE,jwks:{keys:[jwk]}}),{mode:0o600});
    const auth=await loadLocalAuthenticator(file),guard=new LocalAccessGuard(auth,new Reflector());
    let reads=0;const controller=new FeaturesController(new FeatureServingService(fixture,undefined,{publication:()=>{reads++;return publication();}}));
    assert.equal(Reflect.getMetadata(LOCAL_SCOPE,FeaturesController),'risk:read');
    const token=async(scopeValue,workspace=principal.workspace)=>new SignJWT({scope:scopeValue,workspace_key:workspace}).setProtectedHeader({alg:'ES256',kid:'synthetic_unit',typ:'at+jwt'}).setIssuer(LOCAL_ISSUER).setAudience(LOCAL_AUDIENCE).setSubject('synthetic_reader').setIssuedAt().setNotBefore('0s').setExpirationTime('60s').setJti('synthetic_unit').sign(keys.privateKey);
    const run=async(header)=>{const request={headers:{authorization:header}};const context={getHandler:()=>FeaturesController.prototype.read,getClass:()=>FeaturesController,switchToHttp:()=>({getRequest:()=>request,getResponse:()=>({header(){}})})};await guard.canActivate(context);return controller.read(request,query());};
    await assert.rejects(run(undefined),e=>e.getStatus()===401);
    await assert.rejects(run('Bearer '+await token('source:read')),e=>e.getStatus()===403);
    await assert.rejects(run('Bearer '+await token('risk:read','synthetic_other')),e=>e.getStatus()===403);assert.equal(reads,0);
    assert.equal((await run('Bearer '+await token('risk:read'))).amount,'14.11');assert.equal(reads,1);
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('actual Fastify HTTP query shape accepts valid fields and rejects duplicates before evidence IO', async () => {
  const root=resolve('.local');mkdirSync(root,{recursive:true,mode:0o700});const dir=mkdtempSync(join(root,'feature-query-http-'));
  let app;
  try {
    const keys=await generateKeyPair('ES256'),jwk=await exportJWK(keys.publicKey);Object.assign(jwk,{kid:'synthetic_http',alg:'ES256',use:'sig'});
    const file=join(dir,'auth.json');writeFileSync(file,JSON.stringify({format:1,kind:'local_synthetic',issuer:LOCAL_ISSUER,audience:LOCAL_AUDIENCE,jwks:{keys:[jwk]}}),{mode:0o600});
    const auth=await loadLocalAuthenticator(file);
    const token=await new SignJWT({scope:'risk:read',workspace_key:principal.workspace}).setProtectedHeader({alg:'ES256',kid:jwk.kid,typ:'at+jwt'}).setIssuer(LOCAL_ISSUER).setAudience(LOCAL_AUDIENCE).setSubject(principal.subject).setIssuedAt().setNotBefore('0s').setExpirationTime('60s').setJti('synthetic_http').sign(keys.privateKey);
    let reads=0;
    class QueryModule {}
    Module({controllers:[FeaturesController],providers:[LocalAccessGuard,{provide:LOCAL_AUTH,useValue:auth},{provide:FEATURE_READS,useValue:new FeatureServingService(fixture,undefined,{publication:()=>{reads++;return publication();}})}]})(QueryModule);
    app=await NestFactory.create(QueryModule,new FastifyAdapter({logger:false}),{logger:false,abortOnError:false});
    await app.listen(0,'127.0.0.1');
    const base='http://127.0.0.1:'+app.getHttpServer().address().port+'/v1/local/features?';
    const get=async(params)=>{const r=await fetch(base+params,{headers:{authorization:'Bearer '+token},signal:AbortSignal.timeout(5000)});return {status:r.status,body:await r.json()};};
    const valid=await get(new URLSearchParams(query()));
    assert.equal(valid.status,200);assert.deepEqual([valid.body.count,valid.body.amount],['11','14.11']);assert.equal(reads,1);
    const duplicate=new URLSearchParams(query());duplicate.append('currency','SYN');
    for(const params of [duplicate,new URLSearchParams(query(0,{extra:'unexpected'})),new URLSearchParams(query(0,{version:'real'}))]) {
      const rejected=await get(params);assert.equal(rejected.status,400);assert.deepEqual(rejected.body,{code:'INVALID_FEATURE_QUERY'});
    }
    assert.equal(reads,1);
  } finally {if(app)await app.close();rmSync(dir,{recursive:true,force:true});}
});
