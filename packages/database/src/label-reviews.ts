import { isDeepStrictEqual } from 'node:util';
import type { PoolClient,Pool } from 'pg';
import { isLabelCommand,type LabelCommand,type LabelReviewView } from '@lmps/contracts/label-review';
import { ALERT_UUID,caseIdentity,localRiskMode,riskHash } from '@lmps/risk';
import { createDatabase } from './index.js';
import { readLocalCase } from './cases.js';
import { readLocalAlert } from './alerts.js';
export type {LabelCommand,LabelReviewView} from '@lmps/contracts/label-review';
export class LabelError extends Error {constructor(readonly code:'LABEL_INVALID_INPUT'|'LABEL_NOT_FOUND'|'LABEL_CONFLICT'|'LABEL_SELF_REVIEW'|'LABEL_SOURCE_NOT_CURRENT'|'LABEL_STORAGE_UNAVAILABLE'){super(code);}}
export function validateLabelCommand(input:unknown):LabelCommand {
  localRiskMode();if(!isLabelCommand(input)||(input.action==='revoke'&&input.outcome!==null))throw new LabelError('LABEL_INVALID_INPUT');return structuredClone(input);
}
type Queryable=Pick<Pool,'query'>|PoolClient;
function identity(workspace:string,id:string){try{caseIdentity(workspace,id);}catch{throw new LabelError('LABEL_INVALID_INPUT');}}
export async function labelCandidates(db:Queryable,workspace:string,caseId:string){
  identity(workspace,caseId);const current=await readLocalCase(db,workspace,caseId);if(!current)return {case:null,items:[]};
  const links=(await db.query('SELECT alert_id::text FROM platform.local_case_alerts WHERE workspace_key=$1 AND case_id=$2 ORDER BY added_version LIMIT 20',[workspace,caseId])).rows;
  const items=[];
  for(const row of links){const alert=await readLocalAlert(db,workspace,row.alert_id);if(!alert)throw new LabelError('LABEL_STORAGE_UNAVAILABLE');
    for(const task of ['fraud','mule_network','aml'] as const)items.push({alert_id:row.alert_id,target:alert.assessment.target,task,
      outcome_version:current.active_outcome_version,case_opinion:current.current_outcome?.dimensions[task].outcome??'unknown',
      label_outcome:null,training_eligible:false,reason_code:'INDEPENDENT_ADJUDICATION_REQUIRED'});}
  return {case:{case_id:caseId,state:current.state,version:current.version},items};
}
export async function readLabelReview(db:Queryable,workspace:string,id:string,at=new Date().toISOString()):Promise<LabelReviewView|null>{
  identity(workspace,id);if(typeof at!=='string'||!Number.isFinite(Date.parse(at))||new Date(at).toISOString()!==at||Date.parse(at)>Date.now()+1000)throw new LabelError('LABEL_INVALID_INPUT');
  try {
    const rows=(await db.query('SELECT * FROM platform.local_label_adjudications WHERE workspace_key=$1 AND label_id=$2 ORDER BY version LIMIT 101',[workspace,id])).rows;
    if(!rows.length)return null;
    const reference=rows[0];let record;
    for(const [i,row] of rows.entries()){
      const command=validateLabelCommand(row.command);
      if(row.version!==i+1||row.recorded_by!=='lmps_policy'||riskHash(command)!==row.command_sha256||command.expected_version!==i
        ||command.request_id!==row.request_id||command.alert_id!==row.alert_id||command.task!==row.task||command.outcome_version!==row.outcome_version
        ||row.case_id!==reference.case_id||row.task!==reference.task||row.alert_id!==reference.alert_id||!isDeepStrictEqual(row.target,reference.target)
        ||!/^synthetic_[a-z0-9_]{1,40}$/.test(row.actor_subject))throw new Error();
      const source=(await db.query('SELECT * FROM platform.local_case_outcomes WHERE workspace_key=$1 AND case_id=$2 AND version=$3',[workspace,row.case_id,row.outcome_version])).rows[0];
      if(!source||source.actor_subject===row.actor_subject||source.review_cycle!==row.case_cycle||source.evidence_version!==row.evidence_version
        ||riskHash(source.dimensions)!==source.dimensions_sha256)throw new Error();
      record=row;
    }
    const row=record!,command=validateLabelCommand(row.command),current=await readLocalCase(db,workspace,row.case_id),alert=await readLocalAlert(db,workspace,row.alert_id);
    if(!current||!alert||!isDeepStrictEqual(alert.assessment.target,row.target))throw new Error();
    const link=(await db.query('SELECT evidence,evidence_sha256 FROM platform.local_case_alerts WHERE workspace_key=$1 AND case_id=$2 AND alert_id=$3',[workspace,row.case_id,row.alert_id])).rows[0];
    if(!link||riskHash(link.evidence)!==link.evidence_sha256||!isDeepStrictEqual(link.evidence.target,row.target))throw new Error();
    const recorded=new Date(row.recorded_at).toISOString(),mature=new Date(Math.max(Date.parse(command.mature_at),Date.parse(recorded))).toISOString();
    let reason='LABEL_ELIGIBLE';
    if(command.action==='revoke')reason='LABEL_REVOKED';
    else if(current.state!=='closed'||current.active_outcome_version!==row.outcome_version||current.review_cycle!==row.case_cycle||current.evidence_version!==row.evidence_version)reason='CASE_EVIDENCE_CHANGED';
    else if(command.evidence.kind!=='synthetic_fixture')reason='LABEL_PROVENANCE_UNVERIFIED';
    else if(command.outcome===null)reason='LABEL_UNKNOWN';
    else if(Date.parse(at)<Date.parse(mature))reason='LABEL_IMMATURE';
    const sourceStatus=command.evidence.kind==='synthetic_fixture'?'synthetic_declared' as const:'unverified' as const;
    return {label_id:id,version:row.version,case_id:row.case_id,command,actor_subject:row.actor_subject,recorded_at:recorded,target:row.target,
      source_status:sourceStatus,eligibility:reason==='LABEL_ELIGIBLE'?'eligible':'unavailable',reason_code:reason,
      label:{outcome:reason==='LABEL_ELIGIBLE'?command.outcome:null,review_status:reason==='LABEL_ELIGIBLE'?'adjudicated':'unreviewed',source_status:sourceStatus,
        reviewed_at:recorded,available_at:recorded,mature_at:mature,reviewer_ref:row.actor_subject,evidence_sha256:command.evidence.sha256},population_claims:false,enforcement:false};
  }catch(error){if(error instanceof LabelError&&error.code==='LABEL_INVALID_INPUT')throw error;throw new LabelError('LABEL_STORAGE_UNAVAILABLE');}
}
export function createLabelReviews(dsn:string){
  localRiskMode();const database=createDatabase(dsn,'policy');
  return {close:database.close,onApplicationShutdown:database.close,async adjudicate(workspace:string,caseId:string,labelId:string,actor:string,input:unknown){
    identity(workspace,caseId);identity(workspace,labelId);const command=validateLabelCommand(input);
    if(typeof actor!=='string'||!/^synthetic_[a-z0-9_]{1,40}$/.test(actor))throw new LabelError('LABEL_INVALID_INPUT');
    let client:PoolClient|undefined,active=false;
    try {
      client=await database.pool.connect();await client.query('BEGIN');active=true;
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,49))',[workspace+':'+labelId]);
      // Share the Case writer's lock so reopen/link/outcome changes cannot race eligibility checks.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,372))',[workspace+':'+caseId]);
      const saved=(await client.query('SELECT * FROM platform.local_label_adjudications WHERE workspace_key=$1 AND request_id=$2',[workspace,command.request_id])).rows[0];
      if(saved){if(saved.label_id!==labelId||saved.case_id!==caseId||saved.actor_subject!==actor||!isDeepStrictEqual(saved.command,command))throw new LabelError('LABEL_CONFLICT');
        const view=await readLabelReview(client,workspace,labelId);await client.query('COMMIT');active=false;return {status:'duplicate' as const,view};}
      const current=await readLocalCase(client,workspace,caseId),prior=await readLabelReview(client,workspace,labelId);
      if(!current||current.state!=='closed'||current.active_outcome_version!==command.outcome_version)throw new LabelError('LABEL_SOURCE_NOT_CURRENT');
      if(actor===current.assignee_subject)throw new LabelError('LABEL_SELF_REVIEW');
      if((prior?.version??0)!==command.expected_version||prior&&(prior.case_id!==caseId||prior.command.task!==command.task||prior.command.alert_id!==command.alert_id))throw new LabelError('LABEL_CONFLICT');
      const link=(await client.query('SELECT evidence,evidence_sha256 FROM platform.local_case_alerts WHERE workspace_key=$1 AND case_id=$2 AND alert_id=$3',[workspace,caseId,command.alert_id])).rows[0];
      const alert=await readLocalAlert(client,workspace,command.alert_id);
      if(!link||!alert||riskHash(link.evidence)!==link.evidence_sha256||!isDeepStrictEqual(link.evidence.target,alert.assessment.target))throw new LabelError('LABEL_SOURCE_NOT_CURRENT');
      await client.query(`INSERT INTO platform.local_label_adjudications(workspace_key,label_id,version,request_id,case_id,outcome_version,alert_id,task,command,command_sha256,target,case_cycle,evidence_version,actor_subject)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,[workspace,labelId,command.expected_version+1,command.request_id,caseId,command.outcome_version,command.alert_id,command.task,JSON.stringify(command),riskHash(command),JSON.stringify(alert.assessment.target),current.review_cycle,current.evidence_version,actor]);
      const view=await readLabelReview(client,workspace,labelId);if(!view)throw new Error();await client.query('COMMIT');active=false;return {status:'inserted' as const,view};
    }catch(error){if(active&&client)try{await client.query('ROLLBACK');}catch{}if(error instanceof LabelError)throw error;throw new LabelError('LABEL_STORAGE_UNAVAILABLE');}
    finally{client?.release(true);}
  }};
}
