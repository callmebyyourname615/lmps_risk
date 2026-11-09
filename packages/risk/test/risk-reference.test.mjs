import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateRiskReferences } from '../dist/index.js';
const time = hour => `2026-01-01T${hour}:00:00.000Z`;
const subject = {namespace:'synthetic_bank',subject_id:'synthetic_subject',match_level:'exact'};
const entry = {reference_id:'synthetic_ref',version:1,task:'fraud',subject,known_at:time('08'),valid_from:time('09'),valid_to:time('13'),revoked_at:null,evidence_sha256:'a'.repeat(64)};
const fixture = () => ({version:'synthetic-risk-reference-1',mode:'local_synthetic',source:{publisher:'synthetic_owner',version:'synthetic_v1',payload_sha256:'b'.repeat(64),complete:true},subject:structuredClone(subject),as_of:time('12'),entries:[structuredClone(entry)]});
test('explicit synthetic identity, boundaries and expiry never imply a safe or training claim',()=>{
  const f=fixture(); assert.equal(evaluateRiskReferences(f).status,'exact');
  f.as_of=time('09'); assert.equal(evaluateRiskReferences(f).status,'exact');
  f.as_of=time('13'); const result=evaluateRiskReferences(f); assert.equal(result.status,'no_match');assert.equal(result.entries[0].reason,'expired');
  assert.equal(result.safe_claim,false);assert.equal(result.enforcement,false);assert.equal(result.training_eligible,false);
});
test('known-at version selection and revocation never resurrect the older active version',()=>{
  const f=fixture();f.entries.push({...structuredClone(entry),version:2,known_at:time('11'),revoked_at:time('11')});
  assert.equal(evaluateRiskReferences(f).entries[0].reason,'revoked');
  f.as_of=time('10');assert.equal(evaluateRiskReferences(f).status,'exact');
  f.entries.reverse();assert.equal(evaluateRiskReferences(f).status,'exact');
});
test('namespace, partial, unresolved and incomplete coverage stay distinct',()=>{
  const f=fixture();f.subject.namespace='synthetic_other';assert.equal(evaluateRiskReferences(f).status,'no_match');
  f.subject.namespace=subject.namespace;f.subject.match_level='partial';assert.equal(evaluateRiskReferences(f).status,'partial');
  f.subject.match_level='unresolved';assert.equal(evaluateRiskReferences(f).status,'unresolved');
  f.source.complete=false;assert.equal(evaluateRiskReferences(f).status,'unavailable');
});
test('malformed, duplicate, oversized and accessor inputs fail without disclosure or getter execution',()=>{
  for(const mutate of [f=>f.entries.push(f.entries[0]),f=>f.entries[0].valid_to=time('08'),f=>f.as_of='2026-02-30T12:00:00.000Z',f=>f.mode='production',f=>f.subject.subject_id='masked-account',f=>f.extra=true,f=>f.entries=Array(101).fill(entry)]){
    const f=fixture();mutate(f);assert.throws(()=>evaluateRiskReferences(f));
  }
  const f=fixture();let calls=0;Object.defineProperty(f,'source',{enumerable:true,get(){calls++;return {};}});assert.throws(()=>evaluateRiskReferences(f));assert.equal(calls,0);
});
test('exact 100-entry boundary is accepted; returned references detach from callers',()=>{
  const f=fixture();f.entries=Array.from({length:100},(_,i)=>({...structuredClone(entry),reference_id:`synthetic_ref_${i}`}));
  const result=evaluateRiskReferences(f);assert.equal(result.entries.length,100);
  f.source.publisher='synthetic_changed';assert.equal(result.source.publisher,'synthetic_owner');
});
