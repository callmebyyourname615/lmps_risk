import { createHash } from 'node:crypto';
import { createPolicyWorkspace,policyHash } from '../../LMPS_Risk_Portal/src/policies.ts';
import { createDatabase,createRiskPolicies,createRiskJobs,createDetectionHandoff,createRuleAssessments,RULE_EVALUATOR_VERSION } from '../packages/database/dist/index.js';
import { dsn } from '../packages/database/scripts/local.mjs';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const uuid=value=>{const h=hash(value);return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;};

// Copy the existing Portal binding and its literal values into the owned Intake test environment.
// The original Portal two amount rules also execute unchanged through the existing backtest module.
export async function configurePortalIntakePolicy(state) {
  const portal=createPolicyWorkspace(),ids=[...new Set(portal.bindings.map(binding=>binding.policyId))];
  if(ids.length!==1)throw Error('Ambiguous Portal policy binding.');
  const selected=portal.policies.find(policy=>policy.id===ids[0]);
  if(!selected||selected.state!=='approved'||selected.currency!=='LAK'||await policyHash(selected)!==selected.hash)throw Error('Portal policy evidence invalid.');
  const db=createDatabase(dsn(state,'intake'),'intake'),policies=createRiskPolicies(dsn(state,'policy')),jobs=createRiskJobs(dsn(state,'intake'));
  const namespace='synthetic_csv',workspace='synthetic_local',note='Intake test copy of existing Portal binding; no production authority or verified source identity.';
  try{
    const baseline=(await db.pool.query(`SELECT DISTINCT p.policy FROM platform.local_risk_policy_versions p JOIN platform.local_risk_policy_bindings b
      ON (p.workspace_key,p.policy_id,p.policy_version,p.policy_sha256)=(b.workspace_key,b.policy_id,b.policy_version,b.policy_sha256)
      WHERE b.workspace_key=$1 AND b.currency='SYN'`,[workspace])).rows;
    if(baseline.length!==1)throw Error('Existing backend test policy is ambiguous.');
    const policy=structuredClone(baseline[0].policy);policy.policy_id='synthetic_intake_portal_pol3';policy.version='synthetic_v'+selected.version;
    policy.currency=selected.currency;policy.minimum_amount=selected.condition.amlThreshold;
    policy.rules.find(rule=>rule.code==='FRAUD_HIGH_AMOUNT').threshold=selected.condition.fraudThreshold;
    const reference={policy_id:policy.policy_id,policy_version:policy.version};
    for(const [action,actor,extra] of [
      ['create','synthetic_portal_author',{policy}],['submit','synthetic_portal_author',{...reference,expected_revision:0}],
      ['approve','synthetic_portal_checker',{...reference,expected_revision:1}],['activate','synthetic_portal_checker',{...reference,namespace,currency:policy.currency,expected_generation:0}],
    ])await policies.command(workspace,actor,{action,request_id:uuid([selected.hash,action]),note,...extra});
    const binding=(await db.pool.query('SELECT * FROM platform.local_risk_policy_bindings WHERE workspace_key=$1 AND namespace=$2 AND currency=$3',[workspace,namespace,policy.currency])).rows[0];
    if(binding.policy_id!==policy.policy_id||binding.policy_version!==policy.version)throw Error('Current Intake binding differs; refusing to override.');
    const target=(await db.pool.query(`SELECT namespace,transaction_id,revision_number FROM platform.local_transaction_revisions WHERE workspace_key=$1 AND namespace=$2 AND payload->>'currency'=$3 ORDER BY transaction_id,revision_number DESC LIMIT 1`,[workspace,namespace,policy.currency])).rows[0];
    if(target){
      const job_ref=uuid([namespace,target,selected.hash]);
      await jobs.enqueueApproved({format:1,provenance:'local_synthetic',execution_mode:'test',workspace_key:workspace,job_ref,
        risk_request:{format:1,provenance:'user_supplied_file',execution_mode:'test',workspace_key:workspace,run_id:job_ref,target,policy:null,context:null},
        alert_policy:{policy_id:'synthetic_csv_alerts',version:'synthetic_v1',minimum_severity:'high',included_codes:policy.rules.map(rule=>rule.code),include_partial:true}},
      {...reference,namespace,currency:policy.currency,expected_generation:binding.generation});
    }
    const receipt={source:'existing_portal_binding',source_policy_id:selected.id,source_policy_hash:selected.hash,execution_mode:'test',namespace,currency:policy.currency,
      fraud_amount_threshold:selected.condition.fraudThreshold,aml_amount_threshold:selected.condition.amlThreshold,backend_policy_id:policy.policy_id,backend_policy_version:policy.version,
      mapping:'Fraud amount -> FRAUD_HIGH_AMOUNT; original AML amount rule -> existing stateless backtest; remaining 15-pattern settings retained from existing backend test policy, with missing context unavailable.',production_ready:false};
    return {receipt,selected};
  }finally{await jobs.close();await policies.close();await db.close();}
}

export async function evaluatePortalAmountRules(state,selected) {
  const db=createDatabase(dsn(state,'intake'),'intake'),assessments=createRuleAssessments(dsn(state,'intake'));
  try{
    const targets=(await db.pool.query(`SELECT DISTINCT ON(namespace,transaction_id) namespace,transaction_id,revision_number FROM platform.local_transaction_revisions
      WHERE workspace_key='synthetic_local' AND namespace='synthetic_csv' ORDER BY namespace,transaction_id,revision_number DESC`)).rows;
    const rules=[['fraud',selected.condition.fraudThreshold],['aml',selected.condition.amlThreshold]].map(([risk_dimension,threshold])=>({rule_id:'synthetic_portal_'+risk_dimension+'_amount',rule_version:'synthetic_v'+selected.version,risk_dimension,kind:'amount_gte',currency:selected.currency,statuses:selected.condition.lifecycle==='completed'?['succeeded','partially_reversed','reversed']:['pending','succeeded','failed','partially_reversed','reversed'],threshold}));
    const reports=[];
    for(let i=0;i<targets.length;i+=100){const group=targets.slice(i,i+100);const manifest={format:1,provenance:'user_supplied_file',execution_mode:'test',evaluator_version:RULE_EVALUATOR_VERSION,run_id:uuid([selected.hash,group]),workspace_key:'synthetic_local',targets:group,rules};
      const result=await assessments.evaluate(manifest);reports.push({run_id:manifest.run_id,status:result.status,report:result.report});}
    return reports;
  }finally{await assessments.close();await db.close();}
}
export async function drainIntakeDetection(state) {
  const detector=createDetectionHandoff(dsn(state,'intake'));let enqueued=0,processed=0;
  try{for(let i=0;i<40;i++){const added=await detector.handoff(100),worked=await detector.work(20);enqueued+=added;processed+=worked;if(!added&&!worked)break;}return {enqueued,processed};}
  finally{await detector.close();}
}
