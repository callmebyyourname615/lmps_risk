import assert from 'node:assert/strict';
import test from 'node:test';
import {sourceContentHash,sourceTransactionId} from '../packages/contracts/dist/source-publication.js';
import {buildJointMappingPreview} from './preview-intake-joint-mapping.mjs';

function fixture(){
  const rows=['OK','ERROR','OK'].map((result,i)=>({values:[String(i+1),'2026-11-03 00:00:00','1.00','LAK',result,'2026-11-03 00:00:01'],
    review_row_number:i+1,review_row_sha256:String(i+1).repeat(64)}));
  const shared={manifest_sha256:'a'.repeat(64),review_sha256:'b'.repeat(64),import_sha256:'c'.repeat(64),
    review_file:'review/transfer-0000.csv',import_file:'import/transfer-0000.csv'};
  const input={binding:{...shared,format:'lmps-review-binding-input-1',rows},
    pairs:[{result:'OK',shouldrevert:'0'},{result:'ERROR',shouldrevert:'1'},{result:'OK',shouldrevert:null}]};
  const bound={...shared,format:'lmps-intake-review-binding-1',workspace:'synthetic_local',namespace:'synthetic_csv',
    mapping_applied:false,revisions_created:false,rows:rows.map(r=>({...r,values:undefined,transaction_id:sourceTransactionId(r.values),
      import_values_sha256:sourceContentHash(r.values),revision_number:1}))};
  return {input,bound};
}

test('bound preview reports both failed and newly unknown transitions without applying changes',()=>{
  const {input,bound}=fixture(),before=structuredClone(input);
  const report=buildJointMappingPreview(input,bound);
  assert.deepEqual(report.counts,{succeeded:1,failed:1,unknown:1});
  assert.deepEqual(report.transitions,{'succeeded->succeeded':1,'unknown->failed':1,'succeeded->unknown':1});
  assert.equal(report.mapping_applied,false);assert.equal(report.revisions_created,false);
  assert.ok(report.rows.every(r=>r.refund_completion==='unverified'));
  assert.deepEqual(input,before);
});

test('changed commitments, projection, row selection or scope prevent preview publication',()=>{
  for(const change of [
    f=>f.bound.manifest_sha256='e'.repeat(64),
    f=>f.bound.review_sha256='e'.repeat(64),
    f=>f.bound.import_sha256='e'.repeat(64),
    f=>f.bound.rows[0].import_values_sha256='e'.repeat(64),
    f=>f.bound.rows[0].review_row_sha256='e'.repeat(64),
    f=>f.input.pairs[0].result='ERROR',
    f=>f.input.binding.rows[0].values[2]='2.00',
    f=>f.bound.rows.pop(),
    f=>f.bound.namespace='synthetic_other',
    f=>f.bound.rows[1].review_row_number=1,
  ]){const f=fixture();change(f);assert.throws(()=>buildJointMappingPreview(f.input,f.bound));}
});
