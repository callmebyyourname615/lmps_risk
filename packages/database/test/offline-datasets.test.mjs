import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { validateDatasetInput, validateDatasetValues } from '../../contracts/dist/offline-dataset.js';
import { datasetIdentity, datasetRowsHash, validateDatasetSnapshot, createOfflineDatasets } from '../dist/index.js';
import { datasetFixture } from './fixtures/offline-dataset.mjs';

test('dataset identity excludes only UUID alias; all namespace/file/profile evidence stays bound',()=>{
  const f=datasetFixture(), alias={...f.manifest,batch_ref:randomUUID()};assert.equal(datasetIdentity(f.manifest),datasetIdentity(alias));
  for(const change of [{workspace_key:'offline_other'},{source_namespace:'offline_other'},{dataset_sha256:'0'.repeat(64)},{input_bytes:1},{source_table:'transfer_hist'}])assert.notEqual(datasetIdentity(f.manifest),datasetIdentity({...f.manifest,...change}));
});
test('strict manifest/snapshot boundaries reject extra/private/live/number-money/duplicate/hash inputs',()=>{
  const f=datasetFixture();
  for(const change of [{execution_mode:'live'},{workspace_key:'synthetic_local'},{extra:'SYNTHETIC_PRIVATE'},{expected_rows:100001},{profile_version:'unverified'},{batch_ref:'bad'},{rows_sha256:'bad'}])assert.throws(()=>validateDatasetInput({...f.manifest,...change},true),e=>e.code==='DATASET_INVALID_INPUT');
  for(const change of [v=>v.rows[0][2]=1,v=>v.rows[0][2]='1.001',v=>v.rows[1]=[...v.rows[0]],v=>v.manifest.rows_sha256='0'.repeat(64)]){const changed=structuredClone(f);change(changed);assert.throws(()=>validateDatasetSnapshot(changed),e=>e.code==='DATASET_INVALID_INPUT');}
  const changed=structuredClone(f);changed.rows[0][2]='-0.00';changed.manifest.rows_sha256=datasetRowsHash(changed.rows);assert.deepEqual(validateDatasetSnapshot(changed).rows,changed.rows);
});
test('calendar validation and Unicode source character widths match export semantics',()=>{
  assert.deepEqual(validateDatasetValues('member',['00001','',null]),['00001','',null]);
  assert.doesNotThrow(()=>validateDatasetValues('member',['🟢'.repeat(100),'',null]));
  assert.throws(()=>validateDatasetValues('member',['🟢'.repeat(101),'',null]));
  const f=datasetFixture();f.rows[0][1]='2026-02-30 00:00:00';assert.throws(()=>validateDatasetSnapshot(f));
  f.rows[0][1]='2026-01-01T00:00:00Z';assert.throws(()=>validateDatasetSnapshot(f));
});
test('offline services reject production/live context before any connection',()=>{
  const prior=process.env.LMPS_EXECUTION_MODE;process.env.LMPS_EXECUTION_MODE='live';
  try{assert.throws(()=>createOfflineDatasets('SYNTHETIC_PRIVATE_DSN'),e=>e.code==='DATASET_INVALID_INPUT'&&!e.message.includes('PRIVATE'));}
  finally{if(prior===undefined)delete process.env.LMPS_EXECUTION_MODE;else process.env.LMPS_EXECUTION_MODE=prior;}
});
