import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeFeatureWindowState as init, restoreFeatureWindowState as restore,
  applyFeatureWindowState as apply, advanceFeatureWatermark as advance,
  snapshotFeatureWindowState as snapshot, evaluateTransactionRisk } from '../dist/index.js';
import { FEATURE_CATALOG_VERSION as version, featureGroupedHash, VECTOR_FIELDS } from '@lmps/contracts/feature-catalog';
import { riskFixture } from '../fixtures/request.mjs';
const clone = x => JSON.parse(JSON.stringify(x));
const p = () => ({ version, scope: 'local_synthetic', identity: 'synthetic_declared', run_id: 'synthetic_run', namespace: 'synthetic_scope', input_identity: 'synthetic_input', semantics: version,
  currencies: ['SYN', 'USD'], anchor: 'occurred_at', window_seconds: 3600, watermark: '2026-01-01T12:00:00Z', coverage_start: '2026-01-01T08:00:00Z', allowed_lateness_seconds: 3600, active_ttl_seconds: 7200, freshness_seconds: 3600,
  limits: { deliveries: 2000, payments: 2000, attempts: 2000, revisions_per_payment: 2000, deliveries_per_key: 2000, queries: 8, bytes: 2097152 } });
const r = (n = 1, changes = {}) => ({ namespace: 'synthetic_scope', payment_id: 'synthetic_p', attempt_id: 'synthetic_a', revision_id: `synthetic_r${n}`, revision_number: n, account_id: 'synthetic_A', occurred_at: '2026-01-01T11:30:00Z', available_at: '2026-01-01T11:30:00Z', currency: 'SYN', attempt_amount: '10.00', gross_amount: '10.00', reversed_amount: '0.00', lifecycle: 'succeeded', identity: 'synthetic_declared', coverage: 'complete', ...changes });
const q = (changes = {}) => ({ id: 'synthetic_q', account_id: 'synthetic_A', currency: 'SYN', as_of: '2026-01-01T12:00:00Z', ...changes });
const feed = (s, rev) => apply(s, { position: s.contributions.evidence.next_position, revision: rev });
const vector = s => VECTOR_FIELDS.map(k => snapshot(s, q({id:'synthetic_probe'})).snapshot.result.vector[k]);
const rehash = x => { x.sha256 = featureGroupedHash([{ contributions: x.contributions, admission_watermarks: x.admission_watermarks, active: x.active }]); return x; };

test('failed operations preserve caller state and frozen evidence', () => {
  const policy = p(); policy.limits.queries = 1;
  const s = snapshot(feed(init(policy), r()).state, q()).state;
  const before = JSON.stringify(s);
  for (const fail of [
    () => advance(s, '2026-01-01T11:59:59Z'),
    () => snapshot(s, q({ id: 'synthetic_over' })),
    () => snapshot(s, q({ currency: 'USD' })),
    () => apply(s, { position: 0, revision: r(1, { gross_amount: '9.00' }) }),
    () => restore(s, { ...policy, run_id: 'synthetic_changed' }),
  ]) {
    assert.throws(fail);
    assert.equal(JSON.stringify(s), before);
    assert.deepEqual(restore(clone(s), policy), s);
  }
  const delivery = { position: 1, revision: r(2) }, original = clone(delivery);
  const next = apply(s, delivery).state;
  delivery.revision.gross_amount = '1.00';
  assert.deepEqual(next.contributions.evidence.deliveries[1], original);
  assert.deepEqual(snapshot(next, q()).snapshot, s.contributions.evidence.snapshots[0]);
});

test('recovery rejects rehashed regressed admission evidence without mutation', () => {
  let s = feed(init(p()), r()).state;
  s = feed(advance(s, '2026-01-01T12:10:00Z'), r(2)).state;
  const bad = clone(s);
  bad.admission_watermarks.reverse(); rehash(bad);
  const before = JSON.stringify(bad);
  assert.throws(() => restore(bad, p()), e => e.code === 'WINDOW_STATE');
  assert.equal(JSON.stringify(bad), before);
});

test('window/lateness equality, explicit rejected cursor and detached failure', () => {
  const s = init(p());
  assert.deepEqual(vector(feed(s, r(1, { occurred_at: '2026-01-01T11:00:00Z' })).state), Array(8).fill('0'));
  assert.deepEqual(vector(feed(s, r(1, { occurred_at: '2026-01-01T12:00:00Z', available_at: '2026-01-01T12:00:00Z' })).state), ['1','1000','1','1000','0','0','1','1000']);
  const d = { position: 0, revision: r(1, { occurred_at: '2026-01-01T10:59:59Z' }) }, before = JSON.stringify([s,d]);
  const out = apply(s,d); assert.equal(out.reason, 'LATE_EVENT'); assert.deepEqual(out.state,s);
  assert.equal(JSON.stringify([s,d]), before);
  assert.throws(() => apply(s, { ...d, position: 1 }));
  assert.throws(() => advance(s, '2026-01-01T11:59:59Z'), e => e.code === 'WINDOW_TIME');
  assert.deepEqual(advance(s,p().watermark),s);
  assert.throws(() => advance(s,'2026-02-30T12:00:00Z'));
});

test('late out-of-order correction, reversals, future availability and frozen prefix', () => {
  let s = feed(init(p()),r()).state;
  const frozen = snapshot(s,q()); s = frozen.state;
  s = feed(s,r(3,{ lifecycle:'partially_reversed', reversed_amount:'3.00' })).state;
  const old = feed(s,r(2,{ gross_amount:'8.00' }));
  assert.equal(old.corrections[0].delta.net_amount,'0'); s = old.state;
  assert.deepEqual(vector(s),['1','1000','1','1000','1','300','1','700']);
  const future = feed(s,r(4,{ lifecycle:'reversed', reversed_amount:'10.00', available_at:'2026-01-01T12:01:00Z' }));
  assert.equal(future.corrections[0].delta.net_amount,'0');
  s = advance(future.state,'2026-01-01T12:01:00Z');
  const now = snapshot(s,q({ id:'synthetic_now',as_of:'2026-01-01T12:01:00Z' }));
  assert.deepEqual(VECTOR_FIELDS.map(k=>now.snapshot.result.vector[k]),['1','1000','1','1000','1','1000','0','0']);
  assert.deepEqual(snapshot(now.state,q()).snapshot,frozen.snapshot);
  assert.deepEqual(restore(clone(now.state),p()),now.state);
  const unknown = feed(init(p()),r(1,{reversed_amount:null})).state;
  assert.deepEqual(snapshot(unknown,q()).snapshot.result,{status:'unavailable',reason:'UNKNOWN_REVERSAL'});
});

test('future occurred events, TTL equality, frozen recovery and old conflicting replay', () => {
  let s = feed(init(p()),r()).state;
  const frozen = snapshot(s,q()); s = frozen.state;
  assert.deepEqual(advance(s,'2026-01-01T13:29:59Z').active.positions,[0]);
  // Catalog contract: equality remains active; expiration is strictly after TTL.
  const equality = advance(s,'2026-01-01T13:30:00Z');
  assert.deepEqual(equality.active.positions,[0]);
  assert.deepEqual(restore(clone(equality),p()),equality);
  s = advance(equality,'2026-01-01T13:30:01Z'); assert.deepEqual(s.active,{positions:[],buckets:[]});
  assert.equal(s.contributions.evidence.deliveries.length,1);
  assert.deepEqual(snapshot(restore(clone(s),p()),q()).snapshot,frozen.snapshot);
  assert.deepEqual(apply(s,{position:0,revision:r()}).state,s);
  const before = JSON.stringify(s);
  assert.throws(()=>apply(s,{position:0,revision:r(1,{gross_amount:'9.00'})}),e=>e.code==='CONTRIBUTION_CONFLICT');
  assert.equal(JSON.stringify(s),before);
  const future = feed(init(p()),r(1,{occurred_at:'2026-01-01T13:00:00Z',available_at:'2026-01-01T16:00:00Z'})).state;
  assert.deepEqual(vector(future),Array(8).fill('0'));
  assert.deepEqual(advance(future,'2026-01-01T15:00:00Z').active.positions,[0]);
  assert.deepEqual(advance(future,'2026-01-01T16:00:00Z').active.positions,[]);
});

test('independent admission/history/query caps: exact then one over without mutation', () => {
  for (const key of ['deliveries','payments','attempts','revisions_per_payment','deliveries_per_key']) {
    const policy=p(); policy.limits[key]=2; let s=init(policy);
    const rev = i => r(i, ['payments','attempts'].includes(key) ? {payment_id:`synthetic_p${i}`,attempt_id:`synthetic_a${i}`} : {});
    for(let i=1;i<=2;i++) {const out=feed(s,rev(i)); assert.equal(out.status,'applied'); s=out.state;}
    const before=JSON.stringify(s), out=feed(s,rev(3)); assert.equal(out.reason,'LIMIT_EXCEEDED'); assert.deepEqual(out.state,s); assert.equal(JSON.stringify(s),before);
    // TTL cannot reopen retained hot-key admission or erase dedup lineage.
    const expired=advance(s,'2026-01-01T14:00:00Z'); assert.equal(expired.contributions.evidence.next_position,2);
    assert.deepEqual(restore(clone(expired),policy),expired);
  }
  let s=init(p()); for(let i=0;i<8;i++) s=snapshot(s,q({id:`synthetic_q${i}`})).state;
  assert.throws(()=>snapshot(s,q({id:'synthetic_over'})),e=>e.code==='FEATURE_LIMIT');
});

test('complete envelope byte equality and one-over reject, including cache overhead', () => {
  const policy=p(); let s=feed(init(policy),r()).state;
  for(let i=0;i<5;i++) {policy.limits.bytes=Buffer.byteLength(JSON.stringify(s)); const out=feed(init(policy),r()); assert.equal(out.status,'applied'); s=out.state;}
  assert.equal(Buffer.byteLength(JSON.stringify(s)),policy.limits.bytes);
  assert.deepEqual(restore(clone(s),policy),s);
  const small=clone(policy); small.limits.bytes--;
  const out=feed(init(small),r()); assert.equal(out.reason,'LIMIT_EXCEEDED'); assert.equal(out.state.contributions.evidence.next_position,0);
});

test('absolute 2000 delivery recovery and explicit one-over rejection retain evidence', () => {
  const policy=p(), s=clone(feed(init(policy),r()).state);
  s.contributions.evidence.deliveries=Array.from({length:2000},(_,position)=>({position,revision:r()}));
  s.contributions.evidence.next_position=2000;
  s.contributions.sha256=featureGroupedHash([{evidence:s.contributions.evidence,frozen_positions:[]}]);
  s.admission_watermarks=Array(2000).fill(policy.watermark);
  s.active.positions=Array.from({length:2000},(_,i)=>i);
  const recovered=restore(rehash(s),policy), before=JSON.stringify(recovered);
  const out=apply(recovered,{position:2000,revision:r(2)});
  assert.equal(out.reason,'LIMIT_EXCEEDED'); assert.deepEqual(out.state,recovered);
  assert.equal(JSON.stringify(recovered),before);
});

test('namespace/currency isolation, changed config, corruption, missing recovery evidence', () => {
  let s=feed(init(p()),r()).state;
  s=feed(s,r(1,{payment_id:'synthetic_usd',attempt_id:'synthetic_usd',revision_id:'synthetic_usd',currency:'USD',gross_amount:'2.00'})).state;
  assert.equal(snapshot(s,q({currency:'USD'})).snapshot.result.vector.net_amount,'200');
  assert.equal(snapshot(s,q()).snapshot.result.vector.net_amount,'1000');
  assert.throws(()=>feed(s,r(2,{namespace:'synthetic_other'})));
  assert.throws(()=>feed(s,r(2,{currency:'USD'})),e=>e.code==='CONTRIBUTION_CONFLICT');
  assert.throws(()=>restore(s,{...p(),anchor:'available_at'}));
  assert.throws(()=>restore(s,{...p(),allowed_lateness_seconds:3599}));
  for(const mutate of [x=>{x.admission_watermarks=[];},x=>{x.active.positions=[];},x=>{x.active.buckets[0].result.vector.net_amount='999';},x=>{x.admission_watermarks[0]='2026-01-01T13:00:00Z';},x=>{delete x.contributions.evidence.deliveries[0];}]) {
    const bad=clone(s); mutate(bad); assert.throws(()=>restore(rehash(bad),p()));
  }
  let invoked=false; assert.throws(()=>restore({get contributions(){invoked=true;}},p())); assert.equal(invoked,false);
});

test('unchanged reference parity only at matching occurred-time query anchor', () => {
  assert.ok(JSON.parse(readFileSync(new URL('./fixtures/feature-streams/golden.json',import.meta.url))).events.length);
  const {request,observation}=riskFixture(); let s=init(p());
  const events=request.context.events.filter(e=>e.sender==='synthetic_A' && e.occurred_at>'2026-01-01T11:00:00.000Z');
  for(const [i,e] of events.entries()) s=feed(s,r(1,{payment_id:e.transaction_id,attempt_id:`synthetic_a${i}`,revision_id:`synthetic_ref${i}`,occurred_at:e.occurred_at.replace('.000Z','Z'),available_at:e.available_at.replace('.000Z','Z'),attempt_amount:e.amount,gross_amount:e.amount})).state;
  const v=snapshot(s,q()).snapshot.result.vector, out=evaluateTransactionRisk(request,observation);
  assert.equal(v.net_amount,'265000'); assert.equal(v.net_active_count,'3');
  assert.equal(out.findings.find(f=>f.code==='FRAUD_COUNT_VELOCITY').metric.value,v.net_active_count);
  assert.equal(out.findings.find(f=>f.code==='FRAUD_AMOUNT_VELOCITY').metric.value,'2650.00');
  // B06 target-anchored queries with a different end time are incompatible;
  // attempts/gross/reversal counts are additional semantics, not reference parity.
});

test('watermark-relative admission and historical availability never rewrite frozen evidence', () => {
  let s = feed(init(p()), r()).state;
  const frozen = snapshot(s, q());
  s = advance(frozen.state, '2026-01-01T12:30:00Z');
  // Lateness equality is admitted even when window equality excludes its effect.
  const corrected = feed(s, r(2, { gross_amount: '4.00', available_at: '2026-01-01T12:30:00Z' }));
  assert.equal(corrected.status, 'applied');
  assert.equal(corrected.corrections[0].delta.net_amount, '0');
  s = corrected.state;
  assert.equal(snapshot(s, q({ id: 'synthetic_before', as_of: '2026-01-01T12:29:59Z' })).snapshot.result.vector.net_amount, '1000');
  assert.equal(snapshot(s, q({ id: 'synthetic_equal', as_of: '2026-01-01T12:30:00Z' })).snapshot.result.vector.net_amount, '0');
  // The occurred-time left boundary excludes the payment at 12:30 even though its
  // revision becomes available then. An earlier query may not see that revision.
  const before = JSON.stringify(s);
  assert.throws(() => snapshot(s, q({ id: 'synthetic_future', as_of: '2026-01-01T12:30:01Z' })));
  const advanced = advance(s, '2026-01-01T12:30:01Z');
  const late = feed(advanced, r(3, { gross_amount: '3.00' }));
  assert.equal(late.status, 'rejected'); assert.equal(late.reason, 'LATE_EVENT');
  assert.deepEqual(late.state, advanced);
  assert.equal(JSON.stringify(s), before);
  assert.deepEqual(snapshot(restore(clone(advanced), p()), q()).snapshot, frozen.snapshot);
});
