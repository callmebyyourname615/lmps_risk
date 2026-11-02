import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { normalizeSynthetic, CODEBOOK_VERSION, type SyntheticNormalizationInput } from './synthetic-normalization.js';
import { DATASET_UUID, DATASET_DIGEST, validateDatasetValues, type DatasetValues } from './offline-dataset.js';
import type { SyntheticPublicationRecord } from './synthetic-publication.js';
import type { Transaction } from './generated/transaction.js';

export const SOURCE_PUBLISHER_VERSION = 'source-intake-publisher-1';
export interface SourcePublication extends Omit<SyntheticPublicationRecord,'provenance'|'publisher_version'> {
  provenance: 'user_supplied_file'; publisher_version: typeof SOURCE_PUBLISHER_VERSION;
  origin: { source_namespace: string; batch_ref: string; row_number: number; values: DatasetValues;
    mapping: 'operator_intake_test_ok_failed_v1'; amount_semantics: 'raw_recorded_for_test' };
}
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const exact=(value:unknown,keys:string[])=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
const namespace=(v:unknown):v is string=>typeof v==='string'&&/^synthetic_[a-z0-9_]{1,40}$/.test(v);
export function sourceTransactionId(values: DatasetValues): string {
  const [id,requesttime]=validateDatasetValues('transfer',values);
  return `lmps_${id}_${requesttime!.replace(/[- :]/g,'')}`;
}
export function sourceContentHash(values: DatasetValues): string { return hash(validateDatasetValues('transfer',values)); }

function projection(p:SourcePublication):SyntheticNormalizationInput {
  const values=validateDatasetValues('transfer',p.origin.values);
  const result=values[4];
  return { format:1,provenance:'local_synthetic',execution_mode:'test',codebook_version:CODEBOOK_VERSION,
    source_reference:{namespace:p.source.source_namespace,record_ref:p.source.event_key},observed_at:p.source.observed_at,
    operation_code:'SYNTH_PAYMENT',status_code:result==='OK'?'SYNTH_SUCCEEDED':result==='TRANSACTION_FAILED'?'SYNTH_FAILED':'SYNTH_STATUS_UNKNOWN',
    reversal_code:'SYNTH_REVERSAL_NONE',amount:values[2],currency:values[3],source_time:values[5],synthetic_payment_ref:null };
}

export function sourcePublicationTransaction(input:unknown):{publication:SourcePublication;transaction:Transaction} {
  try {
    const p=structuredClone(input) as SourcePublication;
    if(!exact(p,['format','provenance','execution_mode','publisher_version','capture_id','snapshot_sha256','evidence_sha256','source','binding','normalization_input','origin'])
      ||p.format!==1||p.provenance!=='user_supplied_file'||p.execution_mode!=='test'||p.publisher_version!==SOURCE_PUBLISHER_VERSION
      ||!DATASET_UUID.test(p.capture_id)||![p.snapshot_sha256,p.evidence_sha256].every(v=>typeof v==='string'&&DATASET_DIGEST.test(v))
      ||Buffer.byteLength(JSON.stringify(p))>49152||!isDeepStrictEqual(p,JSON.parse(JSON.stringify(p))))throw Error();
    const s=p.source,b=p.binding,o=p.origin;
    if(!exact(o,['source_namespace','batch_ref','row_number','values','mapping','amount_semantics'])||o.mapping!=='operator_intake_test_ok_failed_v1'
      ||o.amount_semantics!=='raw_recorded_for_test'||typeof o.source_namespace!=='string'||!/^[a-z][a-z0-9_]{0,63}$/.test(o.source_namespace)
      ||o.batch_ref!==p.capture_id||!Number.isInteger(o.row_number)||o.row_number<1||o.row_number>100000)throw Error();
    const values=validateDatasetValues('transfer',o.values),[id,requesttime,amount,ccy]=values;
    if(!exact(s,['workspace_key','source_namespace','source_generation','capture_epoch','event_key','source_table','source_key','operation','observed_at'])
      ||!namespace(s.workspace_key)||!namespace(s.source_namespace)||!DATASET_UUID.test(s.source_generation)||s.capture_epoch!==p.capture_id
      ||s.source_table!=='transfer'||s.operation!=='snapshot'||s.event_key!==`transfer:${o.row_number}`
      ||!isDeepStrictEqual(s.source_key,{id,requesttime})||!exact(b,['event_key','transaction_id','transaction_revision','expected_revision','currency'])
      ||b.event_key!==s.event_key||b.transaction_id!==sourceTransactionId(values)||!Number.isInteger(b.expected_revision)||b.expected_revision<0||b.expected_revision>2147483646
      ||b.transaction_revision!==`synthetic_csv_${b.expected_revision+1}_${sourceContentHash(values).slice(0,48)}`
      ||!exact(b.currency,['raw','code','decimal_places'])||b.currency.raw!==ccy||b.currency.code!==ccy||b.currency.decimal_places!==2||!(/^[A-Z]{3}$/).test(ccy!))throw Error();
    const raw=projection(p);
    if(!isDeepStrictEqual(raw,p.normalization_input))throw Error();
    const normalized=normalizeSynthetic(raw);
    if(normalized.state==='invalid'||!normalized.time||!amount||amount.startsWith('-'))throw Error();
    const reference=hash([s.workspace_key,s.source_namespace,b.transaction_id,b.transaction_revision]);
    const account={status:'unresolved' as const,source_representation:'unknown' as const,reason_code:'STABLE_IDENTITY_UNVERIFIED'};
    return {publication:p,transaction:{schema_version:'0.1.0-draft.1',execution_mode:'test',run_id:'synthetic_capture_'+p.capture_id,correlation_id:'synthetic_'+reference,
      transaction_id:b.transaction_id,transaction_revision:b.transaction_revision,source_reference:{namespace:s.source_namespace,record_ref:'synthetic_'+reference,mapping_version:null},
      observed_at:s.observed_at,occurred_at:null,sender:{...account},receiver:{...account},source_bank_id:null,destination_bank_id:null,transaction_type:null,channel:null,
      amount,currency:ccy!,transaction_status:normalized.candidate?.transaction_status??'unknown'}};
  }catch{throw Error('SOURCE_PUBLICATION_INVALID; source values withheld.');}
}

export function makeSourcePublication(input:{ workspace:string; namespace:string; generation:string; batch:string; dataset_sha256:string; rows_sha256:string;
  source_namespace:string; row_number:number; values:DatasetValues; observed_at:string; expected_revision:number }) {
  const p:SourcePublication={format:1,provenance:'user_supplied_file',execution_mode:'test',publisher_version:SOURCE_PUBLISHER_VERSION,
    capture_id:input.batch,snapshot_sha256:input.dataset_sha256,evidence_sha256:input.rows_sha256,
    origin:{source_namespace:input.source_namespace,batch_ref:input.batch,row_number:input.row_number,values:input.values,mapping:'operator_intake_test_ok_failed_v1',amount_semantics:'raw_recorded_for_test'},
    source:{workspace_key:input.workspace,source_namespace:input.namespace,source_generation:input.generation,capture_epoch:input.batch,event_key:`transfer:${input.row_number}`,
      source_table:'transfer',source_key:{id:input.values[0]!,requesttime:input.values[1]!},operation:'snapshot',observed_at:input.observed_at},
    binding:{event_key:`transfer:${input.row_number}`,transaction_id:sourceTransactionId(input.values),transaction_revision:`synthetic_csv_${input.expected_revision+1}_${sourceContentHash(input.values).slice(0,48)}`,
      expected_revision:input.expected_revision,currency:{raw:input.values[3]!,code:input.values[3]!,decimal_places:2}},normalization_input:null as unknown as SyntheticNormalizationInput};
  p.normalization_input=projection(p);return sourcePublicationTransaction(p);
}
