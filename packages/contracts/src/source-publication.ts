import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { normalizeSynthetic, CODEBOOK_VERSION, type SyntheticNormalizationInput } from './synthetic-normalization.js';
import { DATASET_UUID, DATASET_DIGEST, validateDatasetValues, type DatasetValues } from './offline-dataset.js';
import type { SyntheticPublicationRecord } from './synthetic-publication.js';
import type { Transaction } from './generated/transaction.js';
import { intakeSourceFacts, jointIntakeLifecycle, INTAKE_JOINT_MAPPING } from './intake-source-contract.js';
import { unresolvedIdentityAccount } from './account-identity.js';

export const SOURCE_PUBLISHER_VERSION = 'source-intake-publisher-1';
export const JOINT_SOURCE_PUBLISHER_VERSION = 'source-intake-publisher-2';
export interface JointReviewEvidence {
  manifest_sha256: string; review_sha256: string; review_row_sha256: string; binding_sha256: string;
  previous_publication_sha256: string; previous_payload_sha256: string;
  review_row_number: number; shouldrevert: string | null;
}
interface SourceOrigin {
  source_namespace: string; batch_ref: string; row_number: number; values: DatasetValues;
  amount_semantics: 'raw_recorded_for_test';
}
interface SourcePublicationV1 extends Omit<SyntheticPublicationRecord,'provenance'|'publisher_version'> {
  provenance: 'user_supplied_file'; publisher_version: typeof SOURCE_PUBLISHER_VERSION;
  origin: SourceOrigin & { mapping: 'operator_intake_test_ok_failed_v1' };
}
interface SourcePublicationV2 extends Omit<SyntheticPublicationRecord,'provenance'|'publisher_version'> {
  provenance: 'user_supplied_file'; publisher_version: typeof JOINT_SOURCE_PUBLISHER_VERSION;
  origin: SourceOrigin & { mapping: typeof INTAKE_JOINT_MAPPING; review: JointReviewEvidence };
}
export type SourcePublication = SourcePublicationV1 | SourcePublicationV2;
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
  ?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>[k,canonical(v)])):value;
/** Stable across PostgreSQL jsonb key ordering. */
export const sourceEvidenceHash=(value:unknown)=>hash(canonical(value));
const exact=(value:unknown,keys:string[])=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
const namespace=(v:unknown):v is string=>typeof v==='string'&&/^synthetic_[a-z0-9_]{1,40}$/.test(v);
export function sourceTransactionId(values: DatasetValues): string {
  const [id,requesttime]=validateDatasetValues('transfer',values);
  return `lmps_${id}_${requesttime!.replace(/[- :]/g,'')}`;
}
export function sourceContentHash(values: DatasetValues): string { return hash(validateDatasetValues('transfer',values)); }

function projection(p:SourcePublication):SyntheticNormalizationInput {
  const values=validateDatasetValues('transfer',p.origin.values);
  const facts=p.publisher_version===JOINT_SOURCE_PUBLISHER_VERSION
    ?jointIntakeLifecycle({result:values[4],shouldrevert:p.origin.review.shouldrevert}):intakeSourceFacts(values);
  return { format:1,provenance:'local_synthetic',execution_mode:'test',codebook_version:CODEBOOK_VERSION,
    source_reference:{namespace:p.source.source_namespace,record_ref:p.source.event_key},observed_at:p.source.observed_at,
    operation_code:'SYNTH_PAYMENT',status_code:facts.transaction_status==='succeeded'?'SYNTH_SUCCEEDED':facts.transaction_status==='failed'?'SYNTH_FAILED':'SYNTH_STATUS_UNKNOWN',
    reversal_code:'SYNTH_REVERSAL_NONE',amount:values[2],currency:values[3],source_time:values[5],synthetic_payment_ref:null };
}

export function sourcePublicationTransaction(input:unknown):{publication:SourcePublication;transaction:Transaction} {
  try {
    const p=structuredClone(input) as SourcePublication;
    if(!exact(p,['format','provenance','execution_mode','publisher_version','capture_id','snapshot_sha256','evidence_sha256','source','binding','normalization_input','origin'])
      ||p.format!==1||p.provenance!=='user_supplied_file'||p.execution_mode!=='test'||![SOURCE_PUBLISHER_VERSION,JOINT_SOURCE_PUBLISHER_VERSION].includes(p.publisher_version)
      ||!DATASET_UUID.test(p.capture_id)||![p.snapshot_sha256,p.evidence_sha256].every(v=>typeof v==='string'&&DATASET_DIGEST.test(v))
      ||Buffer.byteLength(JSON.stringify(p))>49152||!isDeepStrictEqual(p,JSON.parse(JSON.stringify(p))))throw Error();
    const s=p.source,b=p.binding,o=p.origin;
    const joint=p.publisher_version===JOINT_SOURCE_PUBLISHER_VERSION;
    if(!exact(o,['source_namespace','batch_ref','row_number','values','mapping','amount_semantics',...(joint?['review']:[])])
      ||o.mapping!==(joint?INTAKE_JOINT_MAPPING:'operator_intake_test_ok_failed_v1')
      ||o.amount_semantics!=='raw_recorded_for_test'||typeof o.source_namespace!=='string'||!/^[a-z][a-z0-9_]{0,63}$/.test(o.source_namespace)
      ||o.batch_ref!==p.capture_id||!Number.isInteger(o.row_number)||o.row_number<1||o.row_number>100000)throw Error();
    const values=validateDatasetValues('transfer',o.values),[id,requesttime,amount,ccy]=values;
    if(p.publisher_version===JOINT_SOURCE_PUBLISHER_VERSION){
      const r=p.origin.review;
      if(!exact(r,['manifest_sha256','review_sha256','review_row_sha256','binding_sha256','previous_publication_sha256','previous_payload_sha256','review_row_number','shouldrevert'])
        ||![r.manifest_sha256,r.review_sha256,r.review_row_sha256,r.binding_sha256,r.previous_publication_sha256,r.previous_payload_sha256].every(v=>typeof v==='string'&&DATASET_DIGEST.test(v))
        ||!Number.isInteger(r.review_row_number)||r.review_row_number<1||r.review_row_number>1000
        ||b.expected_revision<1||p.evidence_sha256!==sourceEvidenceHash(r))throw Error();
      jointIntakeLifecycle({result:values[4],shouldrevert:r.shouldrevert});
    }
    const content=p.publisher_version===JOINT_SOURCE_PUBLISHER_VERSION?sourceEvidenceHash(p.origin):sourceContentHash(values);
    if(!exact(s,['workspace_key','source_namespace','source_generation','capture_epoch','event_key','source_table','source_key','operation','observed_at'])
      ||!namespace(s.workspace_key)||!namespace(s.source_namespace)||!DATASET_UUID.test(s.source_generation)||s.capture_epoch!==p.capture_id
      ||s.source_table!=='transfer'||s.operation!=='snapshot'||s.event_key!==`transfer:${o.row_number}`
      ||!isDeepStrictEqual(s.source_key,{id,requesttime})||!exact(b,['event_key','transaction_id','transaction_revision','expected_revision','currency'])
      ||b.event_key!==s.event_key||b.transaction_id!==sourceTransactionId(values)||!Number.isInteger(b.expected_revision)||b.expected_revision<0||b.expected_revision>2147483646
      ||b.transaction_revision!==`synthetic_${joint?'joint':'csv'}_${b.expected_revision+1}_${content.slice(0,48)}`
      ||!exact(b.currency,['raw','code','decimal_places'])||b.currency.raw!==ccy||b.currency.code!==ccy||b.currency.decimal_places!==2||!(/^[A-Z]{3}$/).test(ccy!))throw Error();
    const raw=projection(p);
    if(!isDeepStrictEqual(raw,p.normalization_input))throw Error();
    const normalized=normalizeSynthetic(raw);
    if(normalized.state==='invalid'||!normalized.time||!amount||amount.startsWith('-'))throw Error();
    const reference=hash([s.workspace_key,s.source_namespace,b.transaction_id,b.transaction_revision]);
    const account=unresolvedIdentityAccount();
    return {publication:p,transaction:{schema_version:'0.1.0-draft.1',execution_mode:'test',run_id:'synthetic_capture_'+p.capture_id,correlation_id:'synthetic_'+reference,
      transaction_id:b.transaction_id,transaction_revision:b.transaction_revision,source_reference:{namespace:s.source_namespace,record_ref:'synthetic_'+reference,mapping_version:null},
      observed_at:s.observed_at,occurred_at:null,sender:{...account},receiver:{...account},source_bank_id:null,destination_bank_id:null,transaction_type:null,channel:null,
      amount,currency:ccy!,transaction_status:normalized.candidate?.transaction_status??'unknown'}};
  }catch{throw Error('SOURCE_PUBLICATION_INVALID; source values withheld.');}
}

export function makeSourcePublication(input:{ workspace:string; namespace:string; generation:string; batch:string; dataset_sha256:string; rows_sha256:string;
  source_namespace:string; row_number:number; values:DatasetValues; observed_at:string; expected_revision:number }) {
  const p:SourcePublicationV1={format:1,provenance:'user_supplied_file',execution_mode:'test',publisher_version:SOURCE_PUBLISHER_VERSION,
    capture_id:input.batch,snapshot_sha256:input.dataset_sha256,evidence_sha256:input.rows_sha256,
    origin:{source_namespace:input.source_namespace,batch_ref:input.batch,row_number:input.row_number,values:input.values,mapping:'operator_intake_test_ok_failed_v1',amount_semantics:'raw_recorded_for_test'},
    source:{workspace_key:input.workspace,source_namespace:input.namespace,source_generation:input.generation,capture_epoch:input.batch,event_key:`transfer:${input.row_number}`,
      source_table:'transfer',source_key:{id:input.values[0]!,requesttime:input.values[1]!},operation:'snapshot',observed_at:input.observed_at},
    binding:{event_key:`transfer:${input.row_number}`,transaction_id:sourceTransactionId(input.values),transaction_revision:`synthetic_csv_${input.expected_revision+1}_${sourceContentHash(input.values).slice(0,48)}`,
      expected_revision:input.expected_revision,currency:{raw:input.values[3]!,code:input.values[3]!,decimal_places:2}},normalization_input:null as unknown as SyntheticNormalizationInput};
  p.normalization_input=projection(p);return sourcePublicationTransaction(p);
}

/** Append an interpretation of the same source observation; never a financial reversal event. */
export function makeJointSourcePublication(previous:unknown,review:JointReviewEvidence){
  const checked=sourcePublicationTransaction(previous), prior=checked.publication;
  if(prior.publisher_version!==SOURCE_PUBLISHER_VERSION
    ||review.previous_publication_sha256!==sourceEvidenceHash(prior)
    ||review.previous_payload_sha256!==sourceEvidenceHash(checked.transaction))throw Error('JOINT_PREDECESSOR_INVALID');
  const p:SourcePublicationV2={...prior,publisher_version:JOINT_SOURCE_PUBLISHER_VERSION,
    evidence_sha256:sourceEvidenceHash(review),origin:{...prior.origin,mapping:INTAKE_JOINT_MAPPING,review:structuredClone(review)},
    binding:{...prior.binding,expected_revision:prior.binding.expected_revision+1,transaction_revision:''}};
  p.binding.transaction_revision=`synthetic_joint_${p.binding.expected_revision+1}_${sourceEvidenceHash(p.origin).slice(0,48)}`;
  p.normalization_input=projection(p);return sourcePublicationTransaction(p);
}
