import { randomUUID } from 'node:crypto';
import { createTransactionRevisions,createTransactionRisks,createLocalAlerts,createLocalCases } from '../../dist/index.js';
import { dsn } from '../../scripts/local.mjs';
import { alertFixture } from './alert.mjs';
export async function closedLabelCase(state){
  const writer=createTransactionRevisions(dsn(state,'intake')),risks=createTransactionRisks(dsn(state,'intake')),alerts=createLocalAlerts(dsn(state,'intake')),cases=createLocalCases(dsn(state,'case'));
  try{
    const f=alertFixture();await writer.append(f.f.revision);await risks.evaluate(f.f.request);const alertId=(await alerts.generate(f.generation)).alert_id,caseId=randomUUID();
    const command=(action,expected_version,extra={})=>({action,expected_version,request_id:randomUUID(),note:'Synthetic label test evidence',...extra});
    const act=(body,actor='synthetic_coordinator')=>cases.command('synthetic_local',caseId,actor,body);
    await act(command('create',0,{title:'Synthetic adjudication case',alert_id:alertId}));await act(command('assign',1,{assignee_subject:'synthetic_analyst'}));await act(command('start',2),'synthetic_analyst');
    await act(command('record_outcome',3,{dimensions:Object.fromEntries(['fraud','mule_network','aml'].map(t=>[t,{outcome:'unknown',rationale:'Independent evidence required'}]))}),'synthetic_analyst');await act(command('close',4),'synthetic_analyst');
    return {caseId,alertId,target:f.f.request.target,labelId:randomUUID(),command:{request_id:randomUUID(),expected_version:0,outcome_version:4,alert_id:alertId,task:'fraud',outcome:1,action:'adjudicate',mature_at:'2026-01-01T00:00:00.000Z',
      evidence:{kind:'synthetic_fixture',reference:'synthetic-fixture-truth',sha256:'b'.repeat(64)}}};
  }finally{for(const repo of [cases,alerts,risks,writer])await repo.close();}
}
