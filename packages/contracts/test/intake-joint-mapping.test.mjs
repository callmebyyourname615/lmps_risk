import assert from 'node:assert/strict';
import test from 'node:test';
import { jointIntakeLifecycle, INTAKE_JOINT_MAPPING, INTAKE_SOURCE_MAPPING, intakeSourceFacts } from '../dist/intake-source-contract.js';

test('joint v2 requires both declared values and keeps refund completion unverified', () => {
  assert.notEqual(INTAKE_JOINT_MAPPING, INTAKE_SOURCE_MAPPING);
  const normal = jointIntakeLifecycle({result:'OK',shouldrevert:'0'});
  assert.equal(normal.transaction_status,'succeeded');assert.equal(normal.refund_instruction,'not_indicated');
  for(const result of ['ERROR','LMPS PAYMENT TIME IS EXPIRE','TRANSACTION_FAILED','OTHER_SOURCE_CODE']){
    const actual = jointIntakeLifecycle({result,shouldrevert:'1'});
    assert.equal(actual.transaction_status,'failed');assert.equal(actual.refund_instruction,'required');
    assert.equal(actual.refund_completion,'unverified');assert.equal(actual.occurred_at,null);
    assert.equal(actual.account_identity,'unverified');assert.equal(actual.source_semantics,'unverified');
    assert.ok(!Object.hasOwn(actual,'result')&&!Object.hasOwn(actual,'shouldrevert'));
  }
});

test('null, empty, conflicting and undeclared pairs remain unknown', () => {
  for(const [result,shouldrevert] of [['OK','1'],['OK',null],['ERROR','0'],['ERROR',null],
    [null,'1'],['','1'],[' ','1'],[' OK','1'],['ERROR ','1'],['ERROR','2']]){
    const actual=jointIntakeLifecycle({result,shouldrevert});
    assert.equal(actual.transaction_status,'unknown');assert.equal(actual.refund_instruction,'unknown');
  }
  for(const result of ['ERROR','LMPS PAYMENT TIME IS EXPIRE']){
    assert.equal(intakeSourceFacts(['1','2026-11-03 00:00:00','1.00','LAK',result,'2026-11-03 00:00:01']).transaction_status,'unknown');
  }
});

test('invalid inputs and accessors are rejected without reading private values or coercing numbers', () => {
  let invoked=false;const getter={shouldrevert:'1'};Object.defineProperty(getter,'result',{enumerable:true,get(){invoked=true;return 'ERROR';}});
  for(const input of [null,[],{},getter,{result:'ERROR',shouldrevert:1},{result:'ERROR',shouldrevert:true},
    {result:'ERROR',shouldrevert:'01'},{result:'ERROR',shouldrevert:'2147483648'},
    {result:'SECRET\nVALUE',shouldrevert:'1'},{result:'x'.repeat(201),shouldrevert:'1'},
    {result:'ERROR',shouldrevert:'1',extra:'SECRET_VALUE'}]){
    assert.throws(()=>jointIntakeLifecycle(input),/^Error: INTAKE_JOINT_MAPPING_INVALID; source values withheld\.$/);
  }
  assert.equal(invoked,false);
});

test('joint mapping is refused in production and does not mutate inputs', () => {
  const input={result:'ERROR',shouldrevert:'1'};const before=structuredClone(input);
  jointIntakeLifecycle(input);assert.deepEqual(input,before);
  const old=process.env.NODE_ENV;
  try{process.env.NODE_ENV='production';assert.throws(()=>jointIntakeLifecycle(input));}
  finally{if(old===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=old;}
});
