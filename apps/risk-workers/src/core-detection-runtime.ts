import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';
import { createHash, createSecretKey } from 'node:crypto';
import { createCoreDetectionJournal, createCoreInbox, CoreDetectionError, type CoreJournalState } from '@lmps/database';
import { detachFeatureJSON } from '@lmps/contracts/feature-catalog';
import { validateIdentityMapping } from '@lmps/contracts/account-identity';
import { publicationTransaction } from '@lmps/contracts/synthetic-publication';
import { normalizeSynthetic } from '@lmps/contracts/synthetic-normalization';
import { validateFeatureStreamPlan, type FeatureStreamEvent } from '@lmps/contracts/feature-stream';
import { featurePublicationContentHash, type FeaturePublication } from '@lmps/contracts/feature-serving';
import { createAccountIdentityResolver, createLocalIdentityKeyProvider, riskHash, localRiskMode, validatePolicy, validateAlertPolicy,
  initializeFeatureStream, applyFeatureStreamDelivery, materializeFeatureStreamSnapshot, evaluateFeatureRisk,
  evaluateTransactionRisk, bindFeatureRiskRequest, modelFeatureRequest, projectAlert,
  type RiskObservation, type TransactionRiskRequest, type TransactionRiskResult, type RiskPolicy, type AlertPolicy } from '@lmps/risk';
import { resolveWorkerTransactionIdentity } from './account-identity.js';

const check = (v: unknown): void => { if (!v) throw new CoreDetectionError(); };
const exact = (v: unknown, keys: string): boolean => !!v && typeof v === 'object' && !Array.isArray(v)
  && Object.keys(v).sort().join(',') === keys.split(' ').sort().join(',');
const utc = (ms: number) => new Date(ms).toISOString().replace('.000Z','Z');
const stamp = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(v)
  && Number.isFinite(Date.parse(v)) && utc(Date.parse(v)) === v;
const uuid = (v: unknown) => { const s=riskHash(v); return `${s.slice(0,8)}-${s.slice(8,12)}-4${s.slice(13,16)}-a${s.slice(17,20)}-${s.slice(20,32)}`; };
export interface CoreRuntimeConfig {
  format:1; runtime_id:string; mappings: ReturnType<typeof validateIdentityMapping>[];
  key_files:Array<{ id:string; version:string; path:string; sha256:string }>;
  policy:RiskPolicy; alert_policy:AlertPolicy; feature_plan:ReturnType<typeof validateFeatureStreamPlan>;
  freshness_seconds:number; maximum_inputs:number;
}
export interface CorePrepared {
  logical_sha256:string; publication_sha256:string; provenance:'local_synthetic'|'user_supplied_file';
  target:TransactionRiskRequest['target']; observation:RiskObservation; event:FeatureStreamEvent|null;
  now:string; coverage_complete:boolean; gates:string[];
  identity_versions: { sender:string|null; receiver:string|null };
}
export interface CoreDetectionEntry {
  input_sha256:string; prepared:CorePrepared; assessment:TransactionRiskResult;
  feature:{status:'available'|'withheld';reason:string|null;count:string|null;amount:string|null};
  model_request:ReturnType<typeof modelFeatureRequest>; alert:ReturnType<typeof projectAlert>;
  alert_id:string|null; duplicate_of:number|null;
}
export interface CoreState { entries:CoreDetectionEntry[] }

/** Private regular single-link input, owned by this process; never log content or errors. */
export async function readCorePrivate(path:string, maximum:number):Promise<Buffer> {
  check(typeof path === 'string' && isAbsolute(path));
  const parent=await open(dirname(path),constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  try { const s=await parent.stat(); check(s.isDirectory() && s.uid===process.getuid?.() && (s.mode&0o077)===0); }
  finally { await parent.close(); }
  const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try {
    const s=await file.stat(); check(s.isFile() && s.nlink===1 && s.uid===process.getuid?.() && (s.mode&0o077)===0 && s.size<=maximum);
    const buffer=Buffer.alloc(maximum+1); let length=0;
    while(length<buffer.length) { const n=(await file.read(buffer,length,buffer.length-length,null)).bytesRead; if(!n)break; length+=n; }
    check(length<=maximum); return buffer.subarray(0,length);
  } finally { await file.close(); }
}
export function validateCoreRuntimeConfig(input:unknown):CoreRuntimeConfig {
  localRiskMode(); const v=detachFeatureJSON(input) as CoreRuntimeConfig;
  check(exact(v,'format runtime_id mappings key_files policy alert_policy feature_plan freshness_seconds maximum_inputs') && v.format===1
    && /^synthetic_[A-Za-z0-9_]{1,60}$/.test(v.runtime_id) && Array.isArray(v.mappings) && v.mappings.length>0 && v.mappings.length<=32
    && Array.isArray(v.key_files) && v.key_files.length>0 && v.key_files.length<=32 && Number.isInteger(v.freshness_seconds)
    && v.freshness_seconds>=0 && v.freshness_seconds<=3600 && Number.isInteger(v.maximum_inputs) && v.maximum_inputs>0 && v.maximum_inputs<=64);
  v.mappings=v.mappings.map(validateIdentityMapping); v.policy=validatePolicy(v.policy); v.alert_policy=validateAlertPolicy(v.alert_policy);
  v.feature_plan=validateFeatureStreamPlan(v.feature_plan); check(v.policy.window_seconds===3600 && v.feature_plan.limits.records>=v.maximum_inputs);
  const keys=new Set<string>(), mappings=new Set<string>();
  for(const k of v.key_files) {
    check(exact(k,'id version path sha256') && typeof k.path==='string' && isAbsolute(k.path) && /^[a-f0-9]{64}$/.test(k.sha256));
    const id=JSON.stringify([k.id,k.version]); check(!keys.has(id)); keys.add(id);
  }
  for(const m of v.mappings) {
    const id=JSON.stringify([m.namespace,m.owning_institution_id,m.version]); check(!mappings.has(id) && keys.has(JSON.stringify([m.key.id,m.key.version]))); mappings.add(id);
  }
  return v;
}

/** Reconstruct P04 state from committed source prefixes; never create guessed history. */
function reconstructCorePrepared(prepared:CorePrepared, previous:CoreDetectionEntry[], config:CoreRuntimeConfig, policyInput:unknown=config.policy) {
  const policy=validatePolicy(policyInput), source=prepared.observation;
  const request:TransactionRiskRequest={format:1,provenance:prepared.provenance,execution_mode:'test',workspace_key:'synthetic_local',
    run_id:uuid([config.runtime_id,prepared.logical_sha256,riskHash(policy)]),target:prepared.target,
    policy:source.currency===policy.currency?policy:null,context:null};
  let feature:CoreDetectionEntry['feature']={status:'withheld',reason:prepared.gates[0]??'SOURCE_CONTEXT_UNAVAILABLE',count:null,amount:null};
  let assessment:TransactionRiskResult;
  const priorMissing=previous.some(e=>e.duplicate_of===null && e.prepared.observation.currency===source.currency && !e.prepared.event);
  const epochChanged=previous.some(e=>e.prepared.event && e.prepared.event.currency===source.currency
    && e.prepared.identity_versions.sender!==prepared.identity_versions.sender);
  if(epochChanged)feature.reason='IDENTITY_EPOCH_MISMATCH';
  if(prepared.event && request.policy && !prepared.gates.length && !epochChanged) {
    const query={id:'synthetic_core_current',target:request.target.transaction_id,as_of:source.observed_at!,currency:source.currency!,
      evidence:'available' as const,coverage_complete:prepared.coverage_complete&&!priorMissing,flags_available:false};
    const plan=validateFeatureStreamPlan({...config.feature_plan,queries:[query]});
    let state=initializeFeatureStream(plan);
    const events=[...previous.filter(e=>e.duplicate_of===null).map(e=>e.prepared.event).filter((e):e is FeatureStreamEvent=>e!==null),prepared.event];
    for(const event of events) state=applyFeatureStreamDelivery(state,{identity:'synthetic_declared',topic:plan.topic,partition:0,offset:state.next_offset,event});
    state=materializeFeatureStreamSnapshot(state,query.id).state;
    const scope={version:'synthetic-feature-serving-1' as const,mode:'local_synthetic' as const,workspace_key:'synthetic_local',plan,
      policy:{id:'synthetic_core_freshness',version:'synthetic_v1',max_age_seconds:config.freshness_seconds}};
    const publication:FeaturePublication={version:scope.version,scope,generation:1,predecessor:null,state,published_at:query.as_of,
      expires_at:utc(Date.parse(query.as_of)+Math.max(120,config.freshness_seconds*2+1)*1000),content_hash:Array(8).fill('00000000').join('-')};
    publication.content_hash=featurePublicationContentHash(publication);
    const serving={version:scope.version,workspace_key:scope.workspace_key,plan,query,currency:query.currency,policy:scope.policy,now:prepared.now};
    const result=evaluateFeatureRisk(publication,scope,serving,request,source);
    feature={status:result.context.status,reason:result.context.reason,count:result.feature.status==='available'?result.feature.count:null,amount:result.feature.status==='available'?result.feature.amount:null};
    request.context=bindFeatureRiskRequest(publication,scope,serving,request,source).context;
    assessment=result.assessment;
  } else { assessment=evaluateTransactionRisk(request,source); }
  const alert=projectAlert(assessment,config.alert_policy);
  const modelRequest=modelFeatureRequest(request,source);
  if(prepared.provenance==='user_supplied_file') {modelRequest.provenance='user_supplied_file';modelRequest.source_semantics='unverified';}
  return {request,observation:source,evaluation:{assessment,feature,model_request:modelRequest,alert,
    alert_id:alert.snapshot?uuid([config.runtime_id,request.target,riskHash(config.alert_policy),riskHash(policy)]):null}};
}
export function evaluateCorePrepared(prepared:CorePrepared, previous:CoreDetectionEntry[], config:CoreRuntimeConfig, policyInput:unknown=config.policy) {
  return reconstructCorePrepared(prepared,previous,config,policyInput).evaluation;
}

/** Explicit local opt-in runtime. Existing services and real-file publications remain untouched. */
export async function openCoreDetectionRuntime(dsn:string, configPath:string) {
  localRiskMode(); let journal:ReturnType<typeof createCoreDetectionJournal>|undefined;
  try {
    const bytes=await readCorePrivate(configPath,65536), config=validateCoreRuntimeConfig(JSON.parse(bytes.toString('utf8')));
    const keys:Array<{key:{id:string;version:string};material:ReturnType<typeof createSecretKey>}>=[];
    for(const k of config.key_files) {
      const raw=await readCorePrivate(k.path,32);
      try { check(raw.length===32 && createHash('sha256').update(raw).digest('hex')===k.sha256); keys.push({key:{id:k.id,version:k.version},material:createSecretKey(raw)}); }
      finally { raw.fill(0); }
    }
    const local=createLocalIdentityKeyProvider(keys); journal=createCoreDetectionJournal(dsn); const store=journal;
    const {key_files,...metadata}=config;
    const configHash=riskHash({...metadata,keys:key_files.map(({path:_path,...k})=>k)});
    await store.register(config.mappings,config.key_files,{runtime_id:config.runtime_id,config_sha256:configHash});
    const resolver=createAccountIdentityResolver(config.mappings,{async mac(input) {
      check(await store.keyActive(input.key.id,input.key.version)); return local.provider.mac(input);
    }},1000);
    await store.read(config.runtime_id,configHash);
    let closed=false; const live=()=>{localRiskMode();check(!closed);};
    return {
      async consume(input:unknown) {
        live(); const v=detachFeatureJSON(input);
        check(exact(v,'format offset publication identity_evidence time') && v.format===1 && Number.isSafeInteger(v.offset) && v.offset>=0 && v.offset<config.maximum_inputs);
        const projected=publicationTransaction(v.publication), tx=projected.transaction, pub=projected.publication;
        check(pub.source.source_namespace===config.feature_plan.namespace);
        if(v.time!==null) check(exact(v.time,'occurred_at available_at now coverage_complete') && stamp(v.time.occurred_at) && stamp(v.time.available_at)
          && stamp(v.time.now) && v.time.available_at>=v.time.occurred_at && v.time.now>=v.time.available_at && typeof v.time.coverage_complete==='boolean'
          && Date.parse(v.time.available_at)===Date.parse(tx.observed_at));
        const inputHash=riskHash(v), logicalHash=riskHash({publication:pub,identity_evidence:v.identity_evidence,time:v.time?{...v.time,now:null}:null});
        const result=await store.append(config.runtime_id,configHash,v.offset,inputHash,async rawState=>{
          const state=rawState as unknown as CoreState, target={namespace:pub.source.source_namespace,transaction_id:tx.transaction_id,revision_number:pub.binding.expected_revision+1};
          const same=state.entries.findIndex(e=>e.prepared.target.transaction_id===target.transaction_id && e.prepared.target.revision_number===target.revision_number);
          if(same>=0) {
            const old=state.entries[same]!; check(old.prepared.logical_sha256===logicalHash);
            return {entries:[...state.entries,{...old,input_sha256:inputHash,duplicate_of:same}]} as unknown as CoreJournalState;
          }
          const prior=state.entries.filter(e=>e.prepared.target.transaction_id===target.transaction_id).at(-1);
          check(target.revision_number===(prior?.prepared.target.revision_number??0)+1);
          const identity=await resolveWorkerTransactionIdentity({publication:pub,evidence:v.identity_evidence},resolver);
          const normalization=normalizeSynthetic(pub.normalization_input);
          const observed=v.time?.available_at??tx.observed_at, gates:string[]=[];
          if(pub.provenance!=='local_synthetic') gates.push('SOURCE_IDENTITY_UNVERIFIED');
          if(!v.time) gates.push('SOURCE_TIME_UNVERIFIED');
          if(identity.transaction.sender.status!=='resolved'||identity.transaction.receiver.status!=='resolved') gates.push('IDENTITY_UNAVAILABLE');
          if(tx.transaction_status==='unknown') gates.push('LIFECYCLE_UNMAPPED');
          if(v.time && state.entries.length) check(v.time.now>=state.entries.at(-1)!.prepared.now);
          const event:FeatureStreamEvent|null=!gates.length?{...target,sender:(identity.transaction.sender as {account_token:string}).account_token,
            receiver:(identity.transaction.receiver as {account_token:string}).account_token,occurred_at:v.time.occurred_at,available_at:observed,
            amount:tx.amount,currency:tx.currency,reversed_amount:normalization.candidate?.cumulative_reversed_amount??'0.00',
            status:tx.transaction_status as FeatureStreamEvent['status']}:null;
          if(prior?.prepared.event&&event) check(event.available_at>=prior.prepared.event.available_at
            && event.sender===prior.prepared.event.sender && event.receiver===prior.prepared.event.receiver);
          const observation:RiskObservation={status:tx.transaction_status==='unknown'?'not_normalized':'available',revision_sha256:riskHash(pub),
            amount:tx.amount,reversed_amount:normalization.candidate?.cumulative_reversed_amount??'0.00',currency:tx.currency,
            transaction_status:tx.transaction_status==='unknown'?null:tx.transaction_status,observed_at:observed};
          const prepared:CorePrepared={logical_sha256:logicalHash,publication_sha256:riskHash(pub),provenance:pub.provenance,target,observation,event,
            now:v.time?.now??tx.observed_at,coverage_complete:v.time?.coverage_complete??false,gates,identity_versions:identity.mapping_sha256};
          const evaluation=evaluateCorePrepared(prepared,state.entries,config);
          const entry:CoreDetectionEntry={input_sha256:inputHash,prepared,...evaluation,duplicate_of:null};
          return {entries:[...state.entries,entry]} as unknown as CoreJournalState;
        });
        return {duplicate:result.duplicate||result.entry.duplicate_of!==null,entry:result.entry as unknown as CoreDetectionEntry};
      },
      async read():Promise<CoreState> {live();return await store.read(config.runtime_id,configHash) as unknown as CoreState;},
      async comparePolicy(candidate:unknown) {
        live(); const p=validatePolicy(candidate); check(p.currency===config.policy.currency && p.window_seconds===3600);
        const state=await store.read(config.runtime_id,configHash) as unknown as CoreState;
        const rows=state.entries.flatMap((entry,index)=>entry.duplicate_of!==null?[]:[{
          target:entry.prepared.target,source_sha256:entry.prepared.publication_sha256,
          baseline:evaluateCorePrepared(entry.prepared,state.entries.slice(0,index),config),
          candidate:evaluateCorePrepared(entry.prepared,state.entries.slice(0,index),config,p),
        }]);
        return {format:'core-policy-comparison-1',cohort_sha256:riskHash(rows.map(r=>({target:r.target,source:r.source_sha256}))),
          baseline_sha256:riskHash(config.policy),candidate_sha256:riskHash(p),rows,activation_performed:false};
      },
      async exportCohort() {
        live(); const state=await store.read(config.runtime_id,configHash) as unknown as CoreState;
        const rows=state.entries.filter(e=>e.duplicate_of===null).map(e=>({row_id:'synthetic_'+riskHash(e.prepared.target).slice(0,32),
          request:e.model_request,rules:Object.fromEntries([['fraud',e.assessment.fraud_score.value],['mule_network',e.assessment.mule_network_score.value],['aml',e.assessment.aml_suspicion_score.value]]
            .map(([task,value])=>[task,value===null?null:(value as number).toFixed(6)])),alert_id:e.alert_id}));
        const body={format:'lmps-core-shadow-cohort-1',source_semantics:'unverified',runtime_sha256:configHash,rows};
        return {...body,cohort_sha256:riskHash(body)};
      },
      async publishCandidate(index:number) {
        live();check(Number.isSafeInteger(index) && index>=0 && index<config.maximum_inputs);
        const state=await store.read(config.runtime_id,configHash) as unknown as CoreState, entry=state.entries[index];
        if(!entry)throw new CoreDetectionError();
        check(entry.duplicate_of===null && entry.prepared.provenance==='local_synthetic' && entry.alert_id!==null);
        const reconstructed=reconstructCorePrepared(entry.prepared,state.entries.slice(0,index),config);
        check(riskHash(reconstructed.evaluation)===riskHash({assessment:entry.assessment,feature:entry.feature,model_request:entry.model_request,alert:entry.alert,alert_id:entry.alert_id}));
        const inbox=createCoreInbox(dsn);
        try {return await inbox.publish({runtime_id:config.runtime_id,config_sha256:configHash,index,request:reconstructed.request,observation:reconstructed.observation,
          assessment:entry.assessment,alert:entry.alert,policy:config.alert_policy});}
        finally {await inbox.close();}
      },
      revokeKey:(id:string,version:string)=>{live();return store.revokeKey(id,version);},
      async close(){if(!closed){closed=true;await store.close();}},
    };
  } catch {await journal?.close();throw new CoreDetectionError('CORE_RUNTIME_OPEN_FAILED');}
}
