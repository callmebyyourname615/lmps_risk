import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const c = await import(new URL('../dist/feature-catalog.js', import.meta.url).href);
const version = c.FEATURE_CATALOG_VERSION;
const t = '2026-01-01T01:00:00Z';
const policy = () => ({ version, scope: 'local_synthetic', identity: 'synthetic_declared', run_id: 'synthetic_run', namespace: 'synthetic_ns', input_identity: 'synthetic_input', semantics: version, currencies: ['USD','LAK'], anchor: 'occurred_at', window_seconds: 3600, watermark: t, coverage_start: '2026-01-01T00:00:00Z', allowed_lateness_seconds: 60, active_ttl_seconds: 3660, freshness_seconds: 60, limits: { deliveries: 2000, payments: 2000, attempts: 2000, revisions_per_payment: 2000, deliveries_per_key: 2000, queries: 8, bytes: 2097152 } });
const revision = () => ({ namespace: 'synthetic_ns', payment_id: 'synthetic_payment', attempt_id: 'synthetic_attempt', revision_id: 'synthetic_revision', revision_number: 1, account_id: 'synthetic_account', occurred_at: t, available_at: t, currency: 'USD', attempt_amount: '10.00', gross_amount: '10.00', reversed_amount: '0.00', lifecycle: 'succeeded', identity: 'synthetic_declared', coverage: 'complete' });
const delivery = () => ({ position: 0, revision: revision() });
const query = (i=0) => ({ id: `synthetic_query${i}`, account_id: 'synthetic_account', currency: 'USD', as_of: t });
const vector = () => Object.fromEntries(c.VECTOR_FIELDS.map(k=>[k,'0']));
const snapshot = () => ({ version, query: query(), watermark: t, result: {status:'available',vector:vector()} });
const state = () => ({version,policy:policy(),next_position:1,watermark:t,deliveries:[delivery()],snapshots:[snapshot()]});
const input = () => ({policy:policy(),deliveries:[delivery()],queries:[query()]});
const invalid = fn => assert.throws(fn, e=> e instanceof c.FeatureCatalogError && ['FEATURE_MALFORMED','FEATURE_LIMIT'].includes(e.code));
test('all public envelopes detach, restart roundtrip, immutable failure and strict fields',()=>{
  for (const [value, validate] of [[policy(),c.validateFeaturePolicy],[delivery(),v=>c.validateFeatureDelivery(v,policy())],[query(),v=>c.validateFeatureQuery(v,policy())],[snapshot(),v=>c.validateFeatureSnapshot(v,policy())],[state(),c.validateFeatureState],[input(),c.validateFeatureInput],[vector(),c.validateFeatureVector]]) {
    const before=structuredClone(value), out=validate(value); assert.deepEqual(out,before); assert.notEqual(out,value);
    assert.deepEqual(validate(JSON.parse(JSON.stringify(out))),out);
    invalid(()=>validate({...value, extra:true})); assert.deepEqual(value,before);
    const key=Object.keys(out)[0]; out[key]=null; assert.deepEqual(value,before);
  }
  const x=state(); x.deliveries[0].revision.gross_amount='-1.00'; const before=structuredClone(x); invalid(()=>c.validateFeatureState(x)); assert.deepEqual(x,before);
});
test('descriptor JSON rejects dangerous or lossy inputs without executing accessors',()=>{
  let calls=0; const getter={}; Object.defineProperty(getter,'x',{enumerable:true,get(){calls++;return 1;}});
  const hidden={}; Object.defineProperty(hidden,'x',{value:1}); const symbol={[Symbol('x')]:1}; const cycle={};cycle.x=cycle;
  const array=[1];array.extra=1;
  for(const x of [getter,hidden,symbol,cycle,array,new Date(),Object.create(null),Object.create({x:1}),[,,],undefined,NaN,Infinity,-0,1.5,9007199254740992,1n,()=>1,'\ud800','\udc00',{toJSON(){calls++;return 1;}}]) invalid(()=>c.detachFeatureJSON(x));
  assert.equal(calls,0); assert.equal(c.detachFeatureJSON('😀'),'😀');
  const a=JSON.parse('{"__proto__":{"polluted":true}}'); assert.deepEqual(c.detachFeatureJSON(a),a); assert.equal({}.polluted,undefined);
});
test('real UTC, identity, currency, money and safe bounds',()=>{
  for(const [field,values] of Object.entries({occurred_at:['2026-02-30T01:00:00Z','2026-01-01T01:00:00+00:00','2026-01-01T01:00:00.000Z','2026-01-01T01:00:60Z'], payment_id:['real_account','synthetic_','synthetic_é','synthetic_a\n'],currency:['usd','US','EUR','USD\n'],attempt_amount:['01.00','1','1.0','-1.00','1e2','10.00\n','99999999999999999999999.00'],revision_number:[0,-1,1.1,Number.MAX_SAFE_INTEGER+1]})) {
    for(const value of values){ const d=delivery();d.revision[field]=value;invalid(()=>c.validateFeatureDelivery(d,policy())); }
  }
  for(const key of Object.keys(policy().limits)){for(const v of [0,-1,1.1,Number.MAX_SAFE_INTEGER+1]){const p=policy();p.limits[key]=v;invalid(()=>c.validateFeaturePolicy(p));}}
  const p=policy();p.active_ttl_seconds=3659;invalid(()=>c.validateFeaturePolicy(p));
  assert.equal(c.featureMoneyMinor('9999999999999999999999.99'),999999999999999999999999n);
  assert.equal(c.featureMoneyMinor('0.00'),0n);
});
test('lifecycle matrix and explicit semantic unavailability precede arithmetic',()=>{
  const cases=[['pending','0.00','0.00'],['failed','0.00','0.00'],['succeeded','10.00','0.00'],['partially_reversed','10.00','2.00'],['reversed','10.00','10.00'],['succeeded','0.00','0.00']];
  for(const [lifecycle,gross_amount,reversed_amount] of cases){const r={...revision(),lifecycle,gross_amount,reversed_amount};assert.equal(c.featureRevisionAvailability(r,policy()),null);}
  for(const [field,value,reason] of [['identity','unknown','IDENTITY_UNAVAILABLE'],['coverage','unknown','COVERAGE_INCOMPLETE'],['lifecycle','unknown','UNKNOWN_LIFECYCLE'],['reversed_amount',null,'UNKNOWN_REVERSAL']]) assert.equal(c.featureRevisionAvailability({...revision(),[field]:value},policy()),reason);
  for(const [lifecycle,gross_amount,reversed_amount] of [['pending','1.00','0.00'],['failed','1.00','0.00'],['succeeded','10.00','1.00'],['partially_reversed','10.00','0.00'],['partially_reversed','10.00','10.00'],['reversed','10.00','9.00'],['reversed','10.00','11.00']]) invalid(()=>c.validateFeatureDelivery({position:0,revision:{...revision(),lifecycle,gross_amount,reversed_amount}},policy()));
  for(const reason of c.UNAVAILABLE_REASONS){const s=snapshot();s.result={status:'unavailable',reason};assert.deepEqual(c.validateFeatureSnapshot(s,policy()),s);}
  for(const result of [{status:'success'},{status:'unavailable',reason:'guessed'},{status:'available',vector:vector(),success:true}]) invalid(()=>c.validateFeatureSnapshot({...snapshot(),result},policy()));
});
test('signed correction strings and nonnegative output are distinct',()=>{
  const v=vector();v.net_amount='-200';assert.equal(c.validateFeatureVector(v,true).net_amount,'-200');invalid(()=>c.validateFeatureVector(v));
  for(const x of ['-0','+1','01','1.00','1e2','1\n','9'.repeat(33)])invalid(()=>c.validateFeatureVector({...vector(),net_amount:x},true));
});
test('independent exact and one-over UTF8 complete byte limits',()=>{
  const x={x:'é😀'};const n=Buffer.byteLength(JSON.stringify(x)); assert.deepEqual(c.detachFeatureJSON(x,n),x);invalid(()=>c.detachFeatureJSON(x,n-1));
  for(const [make,validate] of [[state,c.validateFeatureState],[input,c.validateFeatureInput]]){
    const x=make(); let n=0; do {n=Buffer.byteLength(JSON.stringify(x));x.policy.limits.bytes=n;} while(Buffer.byteLength(JSON.stringify(x))!==n);
    assert.deepEqual(validate(x),x); x.policy.limits.bytes--;invalid(()=>validate(x));
  }
  const s='x'.repeat(2097150);assert.equal(c.detachFeatureJSON(s).length,s.length);invalid(()=>c.detachFeatureJSON(s+'x'));
});
test('independent history/key/revision/payment/attempt and query bounds',()=>{
  for(const bound of ['deliveries','payments','attempts','revisions_per_payment','deliveries_per_key']){
    const s=state();s.snapshots=[];s.policy.limits[bound]=2;
    const make=i=>({position:i,revision:{...revision(),payment_id:bound==='payments'?`synthetic_p${i}`:'synthetic_payment',attempt_id:`synthetic_a${i}`,revision_id:`synthetic_r${i}`,revision_number:i+1}});
    s.deliveries=[make(0),make(1)];s.next_position=2;assert.deepEqual(c.validateFeatureState(s),s);
    s.deliveries.push(make(2));s.next_position=3;invalid(()=>c.validateFeatureState(s));
  }
  const x=input();x.queries=Array.from({length:8},(_,i)=>query(i));assert.equal(c.validateFeatureInput(x).queries.length,8);x.queries.push(query(8));invalid(()=>c.validateFeatureInput(x));
  const s=state();s.snapshots=Array.from({length:8},(_,i)=>({...snapshot(),query:query(i)}));assert.equal(c.validateFeatureState(s).snapshots.length,8);s.snapshots.push({...snapshot(),query:query(8)});invalid(()=>c.validateFeatureState(s));
  const h=state();h.snapshots=[];h.next_position=2000;h.deliveries=Array.from({length:2000},(_,position)=>({...delivery(),position}));assert.equal(c.validateFeatureState(h).deliveries.length,2000);h.deliveries.push({...delivery(),position:2000});h.next_position++;invalid(()=>c.validateFeatureState(h));
});
test('golden independent record and bundle caps; canonical grouped hashing',()=>{
  const x=input();x.deliveries=Array.from({length:32},(_,position)=>({...delivery(),position}));assert.equal(c.validateFeatureInput(x,true).deliveries.length,32);x.deliveries.push({...delivery(),position:32});invalid(()=>c.validateFeatureInput(x,true));
  assert.equal(c.canonicalFeatureJSON({z:1,a:{y:2,b:3}}),'{"a":{"b":3,"y":2},"z":1}');
  const expected=createHash('sha256').update('{"domain":"local-synthetic-features-1","groups":[{"a":1}]}').digest('hex');assert.equal(c.featureGroupedHash([{a:1}]),expected);
  assert.notEqual(c.featureGroupedHash(['ab','c']),c.featureGroupedHash(['a','bc']));assert.equal(c.featurePolicyIdentity(policy()),c.featureGroupedHash([policy()]));
  assert.equal(c.FEATURE_CATALOG.filter(x=>x.support==='supported').length,8);assert.deepEqual(c.FEATURE_CATALOG.filter(x=>x.support==='unsupported').map(x=>x.name),['counterparty','institution','baseline','graph']);
});
test('nested unknown fields, forged claims, configuration and recovery shape fail closed',()=>{
  for(const path of [['policy','limits'],['deliveries',0],['deliveries',0,'revision'],['snapshots',0],['snapshots',0,'query'],['snapshots',0,'result'],['snapshots',0,'result','vector']]){
    const s=state();let target=s;for(const k of path)target=target[k];target.trusted_hash='invented';invalid(()=>c.validateFeatureState(s));
  }
  for(const change of [s=>s.version='other',s=>s.policy.semantics='other',s=>s.policy.scope='production',s=>s.deliveries[0].position=1,s=>s.next_position=0,s=>s.watermark='2026-01-01T00:59:59Z',s=>s.snapshots[0].watermark='2026-01-01T01:00:01Z',s=>s.snapshots[0].query.as_of='2026-01-01T01:00:01Z',s=>s.snapshots.push(snapshot())]){const s=state();change(s);invalid(()=>c.validateFeatureState(s));}
  const p=policy();p.currencies=['USD','USD'];invalid(()=>c.validateFeaturePolicy(p));
  const x=input();x.queries.push(query());invalid(()=>c.validateFeatureInput(x));
  invalid(()=>c.validateFeatureVector(vector(),'yes'));invalid(()=>c.validateFeatureInput(input(),'yes'));
});
test('currency map, Unicode keys, proxy and all standalone byte gate equalities',()=>{
  const p=policy();p.currencies=Array.from({length:32},(_,i)=>`A${String.fromCharCode(65+Math.floor(i/26))}${String.fromCharCode(65+i%26)}`);
  assert.equal(c.validateFeaturePolicy(p).currencies.length,32);p.currencies.push('ZZZ');invalid(()=>c.validateFeaturePolicy(p));
  invalid(()=>c.detachFeatureJSON({'\ud800':1}));
  let traps=0;const proxy=new Proxy({}, {ownKeys(){traps++;return [];}});invalid(()=>c.detachFeatureJSON(proxy));assert.equal(traps,0);
  for(const max of [65536,2097152]){const text='x'.repeat(max-2);assert.equal(c.detachFeatureJSON(text,max),text);invalid(()=>c.detachFeatureJSON(text+'x',max));}
  assert.equal(c.canonicalFeatureJSON({'2':2,'10':10}),' {"10":10,"2":2}'.trim());
  const source=state(), out=c.validateFeatureState(source);out.deliveries[0].revision.currency='LAK';out.policy.currencies.push('EUR');out.snapshots[0].result.vector.net_amount='1';assert.equal(source.deliveries[0].revision.currency,'USD');assert.equal(source.policy.currencies.length,2);assert.equal(source.snapshots[0].result.vector.net_amount,'0');
});
