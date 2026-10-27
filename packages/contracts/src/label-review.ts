import { Ajv2020 } from 'ajv/dist/2020.js';
import formats from 'ajv-formats';
import type { RiskDimension,RiskTarget } from './transaction-risk.js';
export interface LabelCommand {
  request_id:string;expected_version:number;outcome_version:number;alert_id:string;task:RiskDimension;
  outcome:0|1|null;action:'adjudicate'|'revoke';mature_at:string;
  evidence:{kind:'synthetic_fixture'|'external_resolution_unverified';reference:string;sha256:string};
}
export interface LabelReviewView {
  label_id:string;version:number;case_id:string;command:LabelCommand;actor_subject:string;recorded_at:string;target:RiskTarget;
  source_status:'synthetic_declared'|'unverified';eligibility:'eligible'|'unavailable';reason_code:string;
  label:{outcome:0|1|null;review_status:'adjudicated'|'unreviewed';source_status:'synthetic_declared'|'unverified';reviewed_at:string;available_at:string;mature_at:string;reviewer_ref:string;evidence_sha256:string};
  population_claims:false;enforcement:false;
}
const text=(pattern:string,maxLength:number)=>({type:'string',pattern,maxLength});
const uuid=text('^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',36);
const object=(properties:Record<string,unknown>)=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
export const labelCommandSchema=object({request_id:uuid,expected_version:{type:'integer',minimum:0,maximum:99},outcome_version:{type:'integer',minimum:1,maximum:1000},alert_id:uuid,
  task:{enum:['fraud','mule_network','aml']},outcome:{enum:[0,1,null]},action:{enum:['adjudicate','revoke']},
  mature_at:{...text('^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$',24),format:'date-time'},
  evidence:object({kind:{enum:['synthetic_fixture','external_resolution_unverified']},reference:text('^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,95}$',96),sha256:text('^[0-9a-f]{64}$',64)})});
const ajv=new Ajv2020({strict:true,coerceTypes:false});formats.default(ajv,{mode:'full',formats:['date-time']});
const check=ajv.compile<LabelCommand>(labelCommandSchema);
export const isLabelCommand=(value:unknown):value is LabelCommand=>check(value)===true;
