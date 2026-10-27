import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeFeatureWindowState as init, applyFeatureWindowState as apply, advanceFeatureWatermark as advance, snapshotFeatureWindowState as snapshot } from '../dist/index.js';
import { VECTOR_FIELDS } from '@lmps/contracts/feature-catalog';
import { evaluateTransactionRisk } from '../dist/index.js';
import { riskFixture } from '../fixtures/request.mjs';
const raw=readFileSync(new URL('./fixtures/feature-streams/p04-extended-golden.json',import.meta.url));
const f=JSON.parse(raw);
test('independent extended lifecycle vectors, currency and unavailable outputs',()=>{
  assert.ok(raw.length<=65536); assert.ok(f.deliveries.length<=32); assert.ok(f.queries.length<=8);
  let s=init(f.policy);
  for(const d of f.deliveries){
    const applied=apply(s,d); s=applied.state;
    if(d.position<6) assert.deepEqual(VECTOR_FIELDS.map(k=>applied.corrections[0].delta[k]),f.expected_prefix_deltas[d.position]);
    if(d.position<6){const out=snapshot(s,f.queries[0]).snapshot.result; assert.deepEqual(VECTOR_FIELDS.map(k=>out.vector[k]),f.expected_prefix_vectors[d.position]);}
  }
  for(const [i,q] of f.queries.entries()){
    const out=snapshot(s,q); s=out.state;
    if(f.expected_final[i].reason) assert.deepEqual(out.snapshot.result,{status:'unavailable',reason:f.expected_final[i].reason});
    else assert.deepEqual(VECTOR_FIELDS.map(k=>out.snapshot.result.vector[k]),f.expected_final[i].vector);
  }
  const frozen=snapshot(s,f.queries[0]).snapshot;
  assert.equal(advance(s,f.boundaries.ttl_equal).active.positions.length,8);
  s=advance(s,f.boundaries.ttl_expired); assert.deepEqual(s.active.positions,[]);
  assert.deepEqual(snapshot(s,f.queries[0]).snapshot,frozen);
  assert.deepEqual(apply(s,f.deliveries[0]).state,s);
});
test('independent left-window/lateness equality and retained hot-key bound',()=>{
  const d=structuredClone(f.deliveries[0]); d.revision.occurred_at=f.boundaries.left;
  let s=apply(init(f.policy),d).state;
  assert.deepEqual(Object.values(snapshot(s,f.queries[0]).snapshot.result.vector),Array(8).fill('0'));
  d.revision.occurred_at=f.boundaries.late;
  assert.equal(apply(init(f.policy),d).reason,'LATE_EVENT');
  s=init(f.policy);
  for(let position=0;position<8;position++) s=apply(s,{...f.deliveries[0],position}).state;
  const before=JSON.stringify(s);
  assert.equal(apply(s,{...f.deliveries[0],position:8}).reason,'LIMIT_EXCEEDED');
  assert.equal(JSON.stringify(s),before);
});
test('unchanged reference net parity only for matching occurred-time evidence',()=>{
 const {request,observation}=riskFixture();
 let s=init(f.policy);
 const events=request.context.events.filter(e=>e.sender==='synthetic_A'&&e.occurred_at>'2026-01-01T11:00:00.000Z');
 for(const [position,e] of events.entries()){
  const revision={...f.deliveries[2].revision,payment_id:e.transaction_id,attempt_id:`synthetic_ref${position}`,revision_id:`synthetic_ref${position}`,revision_number:1,attempt_amount:e.amount,gross_amount:e.amount,occurred_at:e.occurred_at.replace('.000Z','Z'),available_at:e.available_at.replace('.000Z','Z')};
  s=apply(s,{position,revision}).state;
 }
 const v=snapshot(s,f.queries[0]).snapshot.result.vector;
 assert.equal(v.net_amount,'265000'); assert.equal(v.net_active_count,'3');
 const out=evaluateTransactionRisk(request,observation);
 assert.equal(out.findings.find(x=>x.code==='FRAUD_COUNT_VELOCITY').metric.value,v.net_active_count);
 assert.equal(out.findings.find(x=>x.code==='FRAUD_AMOUNT_VELOCITY').metric.value,'2650.00');
 // Attempts, gross/reversal vectors and different anchors have no reference parity claim.
});
