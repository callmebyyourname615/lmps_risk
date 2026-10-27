import assert from 'node:assert/strict';
import { before,after,test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp,writeFile,readFile,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT } from '../../../packages/database/scripts/local.mjs';
import { riskHash } from '@lmps/risk';
import { normalizeReal } from '../scripts/normalize-real.mjs';
import { draftSemantics } from '../scripts/source-semantics.mjs';
const execute=promisify(execFile);let root,adapted,schema,evidence;
before(async()=>{
  root=await mkdtemp('/tmp/lmps-real-normalize-');adapted=join(root,'adapted');schema=join(root,'source.sql');
  const r=await execute(join(ROOT,'.venv/bin/python'),['-B','-c',`import sys,json
from pathlib import Path
sys.path.insert(0,sys.argv[1]);from test_dataset_pilot import write_bundle,pilot
import dataset_semantics
source=Path(sys.argv[2]);adapted=Path(sys.argv[3])
write_bundle(source,mutate=lambda row,i:row.update(amount='100.00',originalreference=None))
pilot.adapt(source,adapted)
ddl='CREATE TABLE transfer ('+','.join(name+' '+('DECIMAL(24,2)' if name in {'amount','fee'} else 'VARCHAR(200)') for name in pilot.export.PILOT_COLUMNS)+');'
Path(sys.argv[4]).write_text(ddl)
print(json.dumps(dataset_semantics.evidence(adapted)))`,join(ROOT,'apps/risk-workers/test'),join(root,'source'),adapted,schema],{cwd:ROOT,timeout:10000});evidence=JSON.parse(r.stdout);
});
after(async()=>{if(root)await rm(root,{recursive:true,force:true});});
test('real-file bridge binds DDL/evidence and remains unavailable without a source-owner document',async()=>{
  const output=join(root,'draft'),first=await normalizeReal({adapted,schema,output});assert.equal(first.counts.unavailable,3);assert.equal(first.structurally_compatible,true);
  assert.equal((await normalizeReal({adapted,schema,output})).status,'duplicate');
  const report=JSON.parse(await readFile(join(output,'normalized.json'),'utf8'));assert.ok(report.rows.every(r=>r.target===null&&r.amount===null));
  assert.ok(!JSON.stringify(report).includes('SYNTHETIC_PRIVATE_ACCOUNT'));assert.equal(report.independently_verified,false);
  await assert.rejects(normalizeReal({adapted,schema,output:join(adapted,'nested-output')}));
});
test('explicit document/review permits declared observations only; changed proof refuses publication',async()=>{
  const mapping=draftSemantics(evidence),document=join(root,'codebook.txt'),mappingPath=join(root,'mapping.json'),review=join(root,'review.json');
  const text='Invented fixture source-owner document';await writeFile(document,text,{mode:0o600});const docSha=createHash('sha256').update(text).digest('hex');
  mapping.status='owner_declared';mapping.evidence={reference:'synthetic-document',sha256:docSha,owner_role:'lmps_source_owner'};
  for(const row of mapping.lifecycle){row.operation='payment';row.state='succeeded';}
  for(const row of mapping.currencies){row.currency='SYN';row.amount_unit='major';row.fee_unit='major';}
  mapping.time={field:'txtime',meaning:'business_occurrence',timezone:'+07:00'};await writeFile(mappingPath,JSON.stringify(mapping),{mode:0o600});
  const proof={format:1,mapping_sha256:riskHash(mapping),ddl_sha256:createHash('sha256').update(await readFile(schema)).digest('hex'),document_sha256:docSha,reviewer_ref:'synthetic_source_reviewer',
    reviewed_at:'2026-10-03T00:00:00Z',snapshot_observed_at:'2026-10-02T00:00:00Z',currency_exponents:{SYN:2}};await writeFile(review,JSON.stringify(proof),{mode:0o600});
  const result=await normalizeReal({adapted,schema,output:join(root,'declared'),mapping:mappingPath,review,document});assert.equal(result.counts.normalized_declared,3);
  const report=JSON.parse(await readFile(join(root,'declared/normalized.json'),'utf8'));assert.equal(report.canonical_emission,false);assert.ok(report.rows.every(r=>r.net_executed_amount===null));
  await writeFile(document,text+' changed',{mode:0o600});await assert.rejects(normalizeReal({adapted,schema,output:join(root,'wrong'),mapping:mappingPath,review,document}));
});
