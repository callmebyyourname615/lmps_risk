import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { validateBulkPlan } from '../dist/bulk-dataset.js';

const plan=()=>({format:'lmps-bulk-plan-1',execution_mode:'offline_analysis',source_semantics:'unverified',source_manifest_sha256:'a'.repeat(64),
  source_format:'lmps-transfer-escaped-tsv-gzip-1',source_rows:3,source_windows:1,requested_rows:3,selected_rows:3,unique_rows:3,duplicate_rows:0,conflicting_rows:0,
  selection:'source_file_order_prefix_not_random',chunks:[{number:0,csv:'chunk-00000.csv',lineage:'chunk-00000.jsonl',lineage_sha256:'b'.repeat(64),input:{format:1,execution_mode:'offline_analysis',batch_ref:randomUUID(),workspace_key:'offline_bulk_trial',source_namespace:'offline_bulk_'+ 'a'.repeat(16),source_table:'transfer',profile_version:'offline-dataset-profile-1',dataset_sha256:'c'.repeat(64),input_bytes:100,expected_rows:3}}]});
test('bulk plan preserves explicit prefix selection, scopes and detached standard staging manifests',()=>{
  const input=plan(),result=validateBulkPlan(input);assert.deepEqual(result,input);result.chunks[0].input.expected_rows=2;assert.equal(input.chunks[0].input.expected_rows,3);
});
test('invalid limits, totals, source provenance and unexpected fields cannot claim a valid plan',()=>{
  for(const patch of [{requested_rows:1000001},{selected_rows:4},{duplicate_rows:1},{conflicting_rows:1},{source_semantics:'verified'},{source_rows:0},{script:'PRIVATE'},{source_manifest_sha256:'a'.repeat(64)+'\n'}])
    assert.throws(()=>validateBulkPlan({...plan(),...patch}),/BULK_INVALID_PLAN/);
});
test('chunk paths, scope, duplicate aliases and per-chunk bounds fail closed',()=>{
  for(const change of [p=>p.chunks[0].csv='../private.csv',p=>p.chunks[0].input.workspace_key='offline_other',p=>p.chunks[0].input.expected_rows=25001,p=>p.chunks.push(p.chunks[0])]){
    const value=plan();change(value);assert.throws(()=>validateBulkPlan(value),/BULK_INVALID_PLAN/);
  }
});
test('production mode never accepts a bulk plan',()=>{
  const before=process.env.NODE_ENV;try{process.env.NODE_ENV='production';assert.throws(()=>validateBulkPlan(plan()));}finally{if(before===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=before;}
});
