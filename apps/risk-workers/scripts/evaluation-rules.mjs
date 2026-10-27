import { readPrivateJson } from './private-json.mjs';
import { evaluateTransactionRisk,modelFeatureRequest,RISK_CATALOG,RISK_ENGINE_VERSION,RISK_CATALOG_VERSION,riskHash } from '@lmps/risk';
import { randomUUID } from 'node:crypto';
try{
  if(process.argv.length!==3)throw new Error();const input=await readPrivateJson(process.argv[2],4*1024*1024),source=input.source;
  if(source.provenance!=='local_synthetic'||source.source_semantics!=='synthetic_declared'||source.identity_status!=='synthetic_declared'
    ||!Array.isArray(source.rows)||source.rows.length>2000||!Array.isArray(input.ids)||input.ids.length>2000)throw new Error();
  const currencies=new Set(source.rows.filter(r=>r.currency!==null).map(r=>r.currency));if(currencies.size!==1)throw new Error();
  const policy={policy_id:'synthetic_offline_evaluation',version:'synthetic_v1',currency:[...currencies][0],window_seconds:3600,baseline_windows:2,graph_depth:4,
    minimum_amount:'500.00',structuring_ceiling:'1000.00',near_threshold_bps:8000,severity_bps:{medium:3000,high:6000,critical:9000},
    rules:RISK_CATALOG.map(e=>({code:e.code,enabled:true,threshold:e.unit==='amount'?(e.code==='FRAUD_HIGH_AMOUNT'?'5000.00':'10000.00'):e.unit==='basis_points'?'15000':'2',weight_bps:1000,severity:'high'}))};
  const rows=[];
  for(const id of input.ids){const row=source.rows.find(r=>r.row_id===id);if(!row)throw new Error();
    let scores={fraud:null,mule_network:null,aml:null},reason='SOURCE_CONTEXT_UNAVAILABLE';
    if(row.target&&row.as_of&&row.available_at&&row.occurred_at&&row.sender&&row.receiver){
      const asOf=Date.parse(row.as_of),events=source.rows.filter(e=>e.target&&e.available_at&&e.occurred_at&&Date.parse(e.available_at)<=asOf&&Date.parse(e.occurred_at)<=asOf&&Date.parse(e.occurred_at)>=asOf-3*3600000);
      if(events.length<=200){
        const observation={status:'available',revision_sha256:row.revision_sha256,amount:row.amount,reversed_amount:row.reversed_amount,currency:row.currency,transaction_status:row.status,observed_at:row.as_of};
        const context={binding:{...row.target,revision_sha256:row.revision_sha256},identity_status:'synthetic_declared',as_of:row.as_of,coverage_start:source.coverage_start,
          coverage_complete:source.history_complete,flagged_accounts:null,flagged_accounts_version:null,
          events:events.map(e=>({...e.target,sender:e.sender,receiver:e.receiver,occurred_at:e.occurred_at,available_at:e.available_at,currency:e.currency,amount:e.amount,reversed_amount:e.reversed_amount,status:e.status}))};
        const request={format:1,provenance:'local_synthetic',execution_mode:'test',workspace_key:'synthetic_local',run_id:randomUUID(),target:row.target,policy,context};
        if(modelFeatureRequest(request,observation).snapshot.feature_sha256===input.expected_features[id]){
          const result=evaluateTransactionRisk(request,observation);scores={fraud:result.fraud_score.value,mule_network:result.mule_network_score.value,aml:result.aml_suspicion_score.value};reason=result.response_code;
        }else reason='RULE_FEATURE_BINDING_MISMATCH';
      }else reason='RULE_CONTEXT_CAPACITY';
    }
    rows.push({row_id:id,scores,reason_code:reason});
  }
  console.info(JSON.stringify({format:'lmps-rule-evaluation-1',engine_version:RISK_ENGINE_VERSION,catalog_version:RISK_CATALOG_VERSION,policy,policy_sha256:riskHash(policy),score_meaning:'risk_index_not_probability',rows,enforcement:false}));
}catch{console.error('RULE_EVALUATION_UNAVAILABLE; private diagnostics withheld.');process.exitCode=2;}
