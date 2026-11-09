import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify, parseArgs } from 'node:util';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, localMode } from '../packages/database/scripts/local.mjs';
import { sourceContentHash, sourceTransactionId } from '../packages/contracts/dist/source-publication.js';
import { intakeSourceFacts, jointIntakeLifecycle, INTAKE_JOINT_MAPPING } from '../packages/contracts/dist/intake-source-contract.js';
import { readPrivateJson, savePrivateReport } from '../apps/risk-workers/scripts/private-json.mjs';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const check = ok => { if (!ok) throw Error('JOINT_PREVIEW_INVALID'); };

export function buildJointMappingPreview(input, bound) {
  localMode();
  const {binding: review,pairs} = input;
  check(bound.format === 'lmps-intake-review-binding-1' && bound.mapping_applied === false && bound.revisions_created === false
    && bound.workspace === 'synthetic_local' && bound.namespace === 'synthetic_csv'
    && review.format === 'lmps-review-binding-input-1'
    && Array.isArray(review.rows) && review.rows.length > 0 && review.rows.length <= 1000
    && Array.isArray(bound.rows) && Array.isArray(pairs) && pairs.length === review.rows.length && bound.rows.length === pairs.length);
  for(const key of ['manifest_sha256','review_sha256','import_sha256','review_file','import_file'])
    check(review[key] === bound[key]);
  const indexed = new Map(bound.rows.map(row=>[row.review_row_number,row]));
  check(indexed.size === pairs.length);
  const seen = new Set(), counts={succeeded:0,failed:0,unknown:0}, transitions={};
  const rows=review.rows.map((row,i)=>{
    const match=indexed.get(row.review_row_number), id=sourceTransactionId(row.values);
    check(!seen.has(id) && match && match.transaction_id===id && match.review_row_sha256===row.review_row_sha256
      && match.import_values_sha256===sourceContentHash(row.values) && pairs[i].result===row.values[4]);
    seen.add(id);
    const proposed=jointIntakeLifecycle(pairs[i]), prior=intakeSourceFacts(row.values);
    counts[proposed.transaction_status]++;
    const change=prior.transaction_status+'->'+proposed.transaction_status;
    transitions[change]=(transitions[change]??0)+1;
    return {transaction_id:id,revision_number:match.revision_number,review_row_sha256:row.review_row_sha256,
      previous_mapping_status:prior.transaction_status,proposed_status:proposed.transaction_status,
      reason:proposed.reason,refund_instruction:proposed.refund_instruction,refund_completion:proposed.refund_completion};
  });
  return {format:'lmps-intake-joint-preview-1',mapping:INTAKE_JOINT_MAPPING,binding_sha256:digest(bound),
    manifest_sha256:review.manifest_sha256,authority:'operator_declared_test_only',reference:'previously_bound_revision',
    counts,transitions,rows,mapping_applied:false,revisions_created:false,refund_completion_verified:false,production_ready:false};
}

async function main() {
  localMode();
  const {values}=parseArgs({options:{bundle:{type:'string'},binding:{type:'string'}}});
  check(values.bundle && values.binding);
  const bound=await readPrivateJson(resolve(values.binding),2*1024*1024);
  const bridge='import json,sys;from verify_csv_export import review_mapping_rows;print(json.dumps(review_mapping_rows(sys.argv[1])))';
  const {stdout}=await promisify(execFile)(join(ROOT,'.venv/bin/python'),['-B','-c',bridge,resolve(values.bundle)],
    {cwd:join(ROOT,'../Data_Requirement'),timeout:30000,maxBuffer:4*1024*1024});
  const report=buildJointMappingPreview(JSON.parse(stdout),bound), sha=digest(report);
  const id=sha.slice(0,8)+'-'+sha.slice(8,12)+'-'+sha.slice(12,16)+'-'+sha.slice(16,20)+'-'+sha.slice(20,32);
  const base=join(ROOT,'.local/intake-mapping-previews');
  const created=await savePrivateReport(base,'v2',id,'preview.json',report,2*1024*1024);
  console.log(JSON.stringify({status:created?'previewed':'duplicate',mapping:report.mapping,counts:report.counts,
    transitions:report.transitions,receipt:join(base,'v2',id,'preview.json'),mapping_applied:false,revisions_created:false}));
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(()=>{console.error('JOINT_PREVIEW_FAILED; source values and credentials withheld.');process.exitCode=1;});
