import assert from 'node:assert/strict';
import { before,after,test } from 'node:test';
import { mkdtemp,mkdir,rm,writeFile,readFile } from 'node:fs/promises';
import { dirname,join } from 'node:path';
import { createDatabase,readLocalAlert } from '@lmps/database';
import { openCoreDetectionRuntime } from '../dist/core-detection-runtime.js';
import { availablePort,initializeCluster,startCluster,stopCluster,dsn } from '../../../packages/database/scripts/local.mjs';
import { migrations } from '../../../packages/database/scripts/migrations.mjs';
import { coreConfig,coreDelivery } from './fixtures/core-detection.mjs';
import { createBackup,restoreDrill } from '../../../packages/database/scripts/backup.mjs';
import { execFile,spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

let temp,state,owner,sequence=0;
const workspace=fileURLToPath(new URL('../../../',import.meta.url));
before(async()=>{temp=await mkdtemp('/tmp/lmps-core-native-');state=await initializeCluster(join(temp,'pg'),await availablePort());await startCluster(state);await migrations(dsn(state,'migration'),true);owner=createDatabase(dsn(state,'migration'),'migration');});
after(async()=>{await owner?.close();if(state)await stopCluster(state);if(temp)await rm(temp,{recursive:true,force:true});});
async function fixture(changes={}) {const dir=join(temp,'trial'+sequence++);await mkdir(dir,{mode:0o700});return coreConfig(dir,{runtime_id:'synthetic_trial_'+sequence,...changes});}
const open=path=>openCoreDetectionRuntime(dsn(state,'intake'),path);
const finding=(result,code)=>result.entry.assessment.findings.find(f=>f.code===code);

test('all detector outcomes and policy comparison retain the same committed synthetic cohort',async()=>{
  const f=await fixture();let runtime=await open(f.path);
  try {
    const rows=[
      ['baseline',{amount:'100.00',occurred_at:'2026-01-01T09:30:00Z',available_at:'2026-01-01T09:30:01Z',receiver:'synthetic_old'}],
      ['incoming',{amount:'1800.00',occurred_at:'2026-01-01T11:15:00Z',available_at:'2026-01-01T11:15:01Z',sender:'synthetic_other',receiver:'synthetic_raw_private_A'}],
      ['out1',{amount:'850.00',occurred_at:'2026-01-01T11:30:00Z',available_at:'2026-01-01T11:30:01Z',receiver:'synthetic_receiver_d'}],
      ['out2',{amount:'900.00',occurred_at:'2026-01-01T11:40:00Z',available_at:'2026-01-01T11:40:01Z',receiver:'synthetic_receiver_e'}],
      ['target',{amount:'900.00',occurred_at:'2026-01-01T12:00:00Z',available_at:'2026-01-01T12:00:01Z'}],
    ];
    let result;for(const [index,[id,options]] of rows.entries()) result=await runtime.consume(coreDelivery(index,id,options));
    const expected={FRAUD_HIGH_AMOUNT:['triggered','900.00'],FRAUD_COUNT_VELOCITY:['triggered','3'],FRAUD_AMOUNT_VELOCITY:['triggered','2650.00'],
      FRAUD_NEW_COUNTERPARTY:['triggered','1'],FRAUD_AMOUNT_DEVIATION:['triggered','90000'],FRAUD_FREQUENCY_DEVIATION:['triggered','60000'],
      MULE_FAN_IN:['not_triggered','1'],MULE_FAN_OUT:['triggered','3'],MULE_RAPID_PASS_THROUGH:['triggered','14722'],
      MULE_NETWORK_CYCLE:['not_triggered','0'],MULE_FLAGGED_NEIGHBOR:['unavailable',null],AML_STRUCTURING_PATTERN:['triggered','3'],
      AML_REPEATED_HIGH_VALUE:['triggered','3'],AML_MULTI_HOP_FLOW:['triggered','2'],AML_NETWORK_DEVIATION:['triggered','60000']};
    assert.equal(result.entry.assessment.findings.length,15);
    for(const finding of result.entry.assessment.findings) {
      assert.deepEqual([finding.status,finding.metric?.value??null],expected[finding.code]);
      if(finding.code==='MULE_FLAGGED_NEIGHBOR')assert.equal(finding.reason_code,'FLAGS_UNAVAILABLE');
    }
    const frozen=await runtime.read();
    assert.ok(frozen.entries.some(e=>[e.assessment.fraud_score.value,e.assessment.mule_network_score.value,e.assessment.aml_suspicion_score.value].some(v=>v!==null&&!Number.isInteger(v))));
    assert.ok(result.entry.alert_id);await runtime.close();runtime=await open(f.path);
    assert.deepEqual(await runtime.read(),frozen);
    const duplicate=await runtime.consume(coreDelivery(5,'target',rows[4][1]));
    assert.equal(duplicate.duplicate,true);assert.equal(duplicate.entry.alert_id,result.entry.alert_id);
    const candidate=structuredClone(f.config.policy);candidate.version='synthetic_candidate_all';
    candidate.rules.find(rule=>rule.code==='FRAUD_HIGH_AMOUNT').threshold='9999.00';
    const comparison=await runtime.comparePolicy(candidate);
    assert.equal(comparison.rows.length,5);assert.equal(comparison.activation_performed,false);
    assert.equal(comparison.rows[4].baseline.assessment.findings[0].status,'triggered');
    assert.equal(comparison.rows[4].candidate.assessment.findings[0].status,'not_triggered');
    assert.deepEqual((await runtime.read()).entries.slice(0,5),frozen.entries);
  } finally {await runtime.close();}
});

test('persistent registry and automatic identity -> P04 ->15 findings -> durable candidate survive restart and exact retries',async()=>{
  const f=await fixture();let runtime=await open(f.path);
  try {
    const one=coreDelivery(0,'p1'),a=await runtime.consume(one);assert.equal(a.entry.feature.status,'available');assert.equal(a.entry.feature.amount,'400.00');assert.equal(finding(a,'FRAUD_HIGH_AMOUNT').status,'not_triggered');
    const token=a.entry.prepared.event.sender;await runtime.close();runtime=await open(f.path);
    assert.deepEqual((await runtime.consume(one)).entry,a.entry);
    const two=coreDelivery(1,'p2',{amount:'600.00',occurred_at:'2026-01-01T11:40:00Z',available_at:'2026-01-01T11:40:01Z'});
    const b=await runtime.consume(two);assert.equal(b.entry.prepared.event.sender,token);assert.equal(b.entry.feature.count,'2');assert.equal(b.entry.feature.amount,'1000.00');
    assert.equal(finding(b,'FRAUD_HIGH_AMOUNT').status,'triggered');assert.equal(finding(b,'FRAUD_COUNT_VELOCITY').status,'triggered');assert.equal(b.entry.assessment.findings.length,15);assert.ok(b.entry.alert_id);
    const bytes=JSON.stringify(await runtime.read());assert.ok(!bytes.includes('synthetic_raw_private_A'));assert.ok(!bytes.includes('synthetic_raw_private_B'));
    const same=await runtime.consume({...two,offset:2});assert.equal(same.duplicate,true);assert.equal(same.entry.alert_id,b.entry.alert_id);
    assert.equal((await runtime.read()).entries.filter(e=>e.duplicate_of===null&&e.alert_id).length,2);
    const candidate=structuredClone(f.config.policy);candidate.version='synthetic_candidate';candidate.rules.find(r=>r.code==='FRAUD_HIGH_AMOUNT').threshold='9999.00';
    const comparison=await runtime.comparePolicy(candidate);assert.equal(comparison.rows.length,2);assert.equal(comparison.activation_performed,false);
    assert.equal(comparison.rows[1].candidate.assessment.findings[0].status,'not_triggered');assert.equal((await runtime.read()).entries[1].assessment.findings[0].status,'triggered');
  }finally{await runtime.close();}
});
test('corrections, cumulative reversals and failed payments replace prior contributions without altering frozen assessments',async()=>{
  const f=await fixture();const runtime=await open(f.path);
  try{
    await runtime.consume(coreDelivery(0,'p1'));const old=await runtime.consume(coreDelivery(1,'p2',{amount:'600.00'}));
    const corrected=await runtime.consume(coreDelivery(2,'p2',{revision:2,amount:'200.00',available_at:'2026-01-01T11:31:00Z'}));assert.equal(corrected.entry.feature.amount,'600.00');
    const partial=await runtime.consume(coreDelivery(3,'p2',{revision:3,amount:'200.00',reversed_amount:'50.00',available_at:'2026-01-01T11:32:00Z'}));assert.equal(partial.entry.feature.amount,'550.00');
    const full=await runtime.consume(coreDelivery(4,'p2',{revision:4,amount:'200.00',reversed_amount:'200.00',available_at:'2026-01-01T11:33:00Z'}));assert.equal(full.entry.feature.amount,'400.00');assert.equal(full.entry.feature.count,'1');assert.equal(full.entry.assessment.assessment_status,'not_applicable');
    const failed=await runtime.consume(coreDelivery(5,'failed',{failed:true,available_at:'2026-01-01T11:34:00Z'}));assert.equal(failed.entry.feature.amount,'400.00');assert.equal(failed.entry.alert_id,null);
    assert.deepEqual((await runtime.read()).entries[1].assessment,old.entry.assessment);
    await assert.rejects(runtime.consume(coreDelivery(6,'p2',{revision:5,receiver:'synthetic_wrong',available_at:'2026-01-01T11:35:00Z'})));
    assert.equal((await runtime.read()).entries.length,6);
  }finally{await runtime.close();}
});
test('unresolved identity, missing/partial history, stale features and future availability withhold context explicitly',async()=>{
  const f=await fixture();const runtime=await open(f.path);
  try{
    const input=coreDelivery(0,'masked');input.identity_evidence.sender.source_representation='masked';
    const missing=await runtime.consume(input);assert.equal(missing.entry.prepared.event,null);assert.equal(missing.entry.feature.status,'withheld');assert.equal(missing.entry.model_request.snapshot.status,'unavailable');
    const next=await runtime.consume(coreDelivery(1,'next',{available_at:'2026-01-01T11:31:00Z'}));assert.equal(next.entry.feature.reason,'HISTORY_INCOMPLETE');
  }finally{await runtime.close();}
  const g=await fixture();const r=await open(g.path);
  try{const stale=await r.consume(coreDelivery(0,'stale',{now:'2026-01-01T11:32:00Z'}));assert.equal(stale.entry.feature.status,'withheld');assert.equal(stale.entry.feature.reason,'SOURCE_STALE');}finally{await r.close();}
  const h=await fixture({freshness_seconds:3600});const future=await open(h.path);
  try{
    await future.consume(coreDelivery(0,'future',{available_at:'2026-01-01T12:30:00Z'}));
    const out=await future.consume(coreDelivery(1,'current',{occurred_at:'2026-01-01T11:45:00Z',available_at:'2026-01-01T12:00:00Z',now:'2026-01-01T12:31:00Z'}));
    assert.equal(out.entry.feature.count,'1');assert.equal(out.entry.feature.amount,'400.00');
  }finally{await future.close();}
});
test('bounded synthetic core load reports measured latency and recovers the committed prefix',async t=>{
  const f=await fixture();let runtime=await open(f.path);
  try {
    const latencies=[];
    for(let i=0;i<64;i++) {
      const start=performance.now();await runtime.consume(coreDelivery(i,'load_'+i));latencies.push(performance.now()-start);
    }
    await runtime.close();const start=performance.now();runtime=await open(f.path);
    assert.equal((await runtime.read()).entries.length,64);
    assert.equal((await runtime.consume(coreDelivery(63,'load_63'))).duplicate,true);
    const retries=await Promise.all(Array.from({length:4},()=>runtime.consume(coreDelivery(63,'load_63'))));
    assert.ok(retries.every(retry=>retry.duplicate));assert.equal((await runtime.read()).entries.length,64);
    await assert.rejects(runtime.consume(coreDelivery(64,'over_limit')));
    const recovery=performance.now()-start;latencies.sort((a,b)=>a-b);
    t.diagnostic(`synthetic sequential 64 deliveries: p50=${latencies[31].toFixed(1)}ms p95=${latencies[60].toFixed(1)}ms restart_and_retries=${recovery.toFixed(1)}ms; no SLA claim`);
  }finally{await runtime.close();}
});
test('explicit synthetic candidate publication writes a verifiable Inbox alert and retry is idempotent',async()=>{
  const f=await fixture();f.config.alert_policy.included_codes=['FRAUD_HIGH_AMOUNT'];
  await writeFile(f.path,JSON.stringify(f.config),{mode:0o600});
  const runtime=await open(f.path),app=createDatabase(dsn(state));
  try {
    const quiet=await runtime.consume(coreDelivery(0,'quiet',{amount:'100.00'}));
    assert.equal(quiet.entry.alert_id,null);await assert.rejects(runtime.publishCandidate(0));
    const candidate=await runtime.consume(coreDelivery(1,'alert',{amount:'900.00',available_at:'2026-01-01T11:31:00Z'}));
    assert.ok(candidate.entry.alert_id);
    await owner.pool.query(`CREATE FUNCTION platform.synthetic_inbox_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic failure'; END $$`);
    await owner.pool.query('CREATE TRIGGER synthetic_inbox_failure BEFORE INSERT ON platform.local_alerts FOR EACH ROW EXECUTE FUNCTION platform.synthetic_inbox_failure()');
    try {
      await assert.rejects(runtime.publishCandidate(1));
      const rows=await app.pool.query('SELECT count(*)::int AS n FROM platform.local_transaction_risks WHERE workspace_key=$1 AND run_id=$2',['synthetic_local',candidate.entry.assessment.run_id]);
      assert.equal(rows.rows[0].n,0);
    } finally {
      await owner.pool.query('DROP TRIGGER synthetic_inbox_failure ON platform.local_alerts');
      await owner.pool.query('DROP FUNCTION platform.synthetic_inbox_failure()');
    }
    const [first,second]=await Promise.all([runtime.publishCandidate(1),runtime.publishCandidate(1)]);
    assert.deepEqual([first.status,second.status].sort(),['duplicate','inserted']);assert.equal(first.alert_id,second.alert_id);
    const view=await readLocalAlert(app.pool,'synthetic_local',first.alert_id);
    assert.deepEqual(view.assessment,candidate.entry.assessment);
    assert.deepEqual(view.snapshot,candidate.entry.alert.snapshot);
    assert.equal((await runtime.read()).entries.length,2);
  } finally {await runtime.close();await app.close();}
});
test('explicit CLI Inbox publication retries committed synthetic candidates without duplicates',async()=>{
  const f=await fixture();f.config.alert_policy.included_codes=['FRAUD_HIGH_AMOUNT'];f.config.alert_policy.version='synthetic_inbox_cli_v1';
  await writeFile(f.path,JSON.stringify(f.config),{mode:0o600});
  const dir=dirname(f.path),input=join(dir,'deliveries.json');
  await writeFile(input,JSON.stringify([coreDelivery(0,'cli_alert',{amount:'900.00'})]),{mode:0o600});
  const script=join(workspace,'apps/risk-workers/scripts/core-detection.mjs');
  async function run(output,publish=true){
    const {stdout}=await promisify(execFile)(process.execPath,[script,'--config',f.path,'--input',input,'--output',output,...(publish?['--publish-inbox']:[])],
      {cwd:workspace,env:{...process.env,LMPS_POSTGRES_DSN:dsn(state,'intake')}});
    return JSON.parse(stdout);
  }
  const initial=await run(join(dir,'no-inbox.json'),false);
  assert.equal(initial.accepted,1);assert.equal(initial.inbox_inserted,undefined);
  const before=await owner.pool.query('SELECT count(*)::int AS n FROM platform.local_alerts WHERE policy_version=$1',['synthetic_inbox_cli_v1']);
  assert.equal(before.rows[0].n,0);
  const first=await run(join(dir,'first.json')),second=await run(join(dir,'second.json'));
  assert.equal(first.inbox_inserted,1);assert.equal(first.inbox_duplicates,0);
  assert.equal(second.inbox_inserted,0);assert.equal(second.inbox_duplicates,1);assert.equal(second.duplicates,1);
});
test('registry refuses version rebinding and key substitution; revocation persists across restart',async()=>{
  const f=await fixture();let runtime=await open(f.path);
  try{
    await runtime.consume(coreDelivery(0,'first'));await runtime.revokeKey(f.config.key_files[0].id,f.config.key_files[0].version);await runtime.close();runtime=await open(f.path);
    const result=await runtime.consume(coreDelivery(1,'second'));assert.equal(result.entry.prepared.event,null);assert.ok(result.entry.prepared.gates.includes('IDENTITY_UNAVAILABLE'));
    const config=JSON.parse(await readFile(f.path,'utf8'));config.runtime_id='synthetic_conflicting_mapping';config.mappings[0].canonicalization='trim';await writeFile(f.path,JSON.stringify(config),{mode:0o600});await assert.rejects(open(f.path));
    config.mappings=f.config.mappings;config.runtime_id=f.config.runtime_id;config.policy.version='synthetic_changed';await writeFile(f.path,JSON.stringify(config),{mode:0o600});await assert.rejects(open(f.path));
    assert.equal((await runtime.read()).entries.length,2);
    await assert.rejects(owner.pool.query(`UPDATE platform.core_identity_keys SET revoked=false WHERE key_id=$1`,[f.config.key_files[0].id]));
  }finally{await runtime.close();}
});
test('parallel workers commit a revision once, gaps/conflicting replay leave the checkpoint unchanged, app cannot read private core tables',async()=>{
  const f=await fixture(),a=await open(f.path),b=await open(f.path),app=createDatabase(dsn(state));
  try{
    const delivery=coreDelivery(0,'parallel'),results=await Promise.all([a.consume(delivery),b.consume(delivery)]);
    assert.equal(results.filter(r=>!r.duplicate).length,1);assert.deepEqual(results[0].entry,results[1].entry);
    await assert.rejects(a.consume(coreDelivery(2,'gap')));await assert.rejects(a.consume(coreDelivery(0,'conflict')));assert.equal((await a.read()).entries.length,1);
    for(const table of ['core_identity_keys','core_identity_mappings','core_detection_checkpoints'])await assert.rejects(app.pool.query('SELECT * FROM platform.'+table),e=>e.code==='42501');
  }finally{await a.close();await b.close();await app.close();}
});
test('new core tables participate in real backup/restore fingerprints and retained reader denials',async()=>{
  const path=join(temp,'backups');await mkdir(path,{mode:0o700});const backup=await createBackup(state,path);const restored=await restoreDrill(backup.directory);
  assert.equal(restored.status,'PASS');assert.equal(Object.keys(restored.table_counts).length,38);assert.ok(restored.table_counts['platform.core_detection_checkpoints']>0);
});
test('actual exported core cohort is scored by pinned synthetic models in the Python shadow evaluator',{timeout:60000},async()=>{
  const f=await fixture();
  f.config.key_files[0].id='synthetic_cohort_key';f.config.mappings[0].key.id='synthetic_cohort_key';
  f.config.mappings[0].version='synthetic_cohort_mapping';
  // This explicitly scoped synthetic policy evaluates only an evidence-supported rule.
  for(const rule of f.config.policy.rules) rule.enabled=rule.code==='FRAUD_HIGH_AMOUNT';
  await writeFile(f.path,JSON.stringify(f.config),{mode:0o600});
  const runtime=await open(f.path);
  try {
    for(let i=0;i<4;i++) {
      const stamp=`2026-01-01T11:3${i}:01Z`,delivery=coreDelivery(i,'cohort_'+i,{amount:['100.00','900.00','1200.00','700.00'][i],available_at:stamp});
      delivery.identity_evidence.sender.mapping_version=delivery.identity_evidence.receiver.mapping_version='synthetic_cohort_mapping';
      if(i===3)delivery.identity_evidence.sender.source_representation='masked';
      await runtime.consume(delivery);
    }
    const cohort=await runtime.exportCohort(),input=join(dirname(f.path),'cohort.json'),output=join(dirname(f.path),'evaluation.json');
    await writeFile(input,JSON.stringify(cohort),{mode:0o600});
    const script=`
from pathlib import Path
import sys
from lmps_ml.core_evaluation import evaluate_core_cohort
from lmps_ml.dataset import build_dataset
from lmps_ml.demo import synthetic_input
from lmps_ml.private import read_json,write,encoded
from lmps_ml.serving import register_model
from lmps_ml.training import train
root=Path(sys.argv[3]); data=build_dataset(synthetic_input()); refs=[]
for algorithm in ('baseline','logistic'):
    train(data,root/algorithm,root/'tracking',algorithm)
    ref=register_model(root,'synthetic_core_'+algorithm,root/algorithm)
    refs.append({k:ref[k] for k in ('name','version','artifact_sha256')})
write(Path(sys.argv[2]),encoded(evaluate_core_cohort(read_json(Path(sys.argv[1]),2097152),root,refs)))
`;
    await promisify(execFile)('uv',['run','--locked','--directory','services/ml-inference','python','-c',script,input,output,dirname(f.path)],{cwd:workspace});
    const report=JSON.parse(await readFile(output,'utf8'));
    assert.equal(report.cohort_sha256,cohort.cohort_sha256);
    assert.equal(report.rows.length,4);
    assert.equal(report.models.length,2);
    assert.equal(Object.values(report.rows[0].models).filter(model=>model.status==='available').length,2);
    assert.equal(report.tasks.fraud.comparison_status,'available');
    assert.equal(report.tasks.fraud.common_rows,3);
    assert.equal(report.tasks.mule_network.comparison_status,'unavailable');
    assert.equal(report.rows[3].feature_status,'unavailable');
    assert.ok(Object.values(report.rows[3].models).every(model=>model.reason==='FEATURE_UNAVAILABLE'));
    assert.equal(report.tasks.fraud.precision,null);
    assert.equal(report.production_ready,false);
  } finally {await runtime.close();}
});
test('process death inside a checkpoint transaction rolls back and death after commit preserves retry',{timeout:30000},async()=>{
  const f=await fixture(),runtime=await open(f.path),delivery=coreDelivery(0,'crash');
  const childCode=`
    import { createCoreDetectionJournal } from './packages/database/dist/index.js';
    import { openCoreDetectionRuntime } from './apps/risk-workers/dist/core-detection-runtime.js';
    let raw=''; for await (const chunk of process.stdin) raw+=chunk;
    const v=JSON.parse(raw);
    if(v.stage==='transaction') {
      const store=createCoreDetectionJournal(v.dsn);
      await store.append(v.id,v.hash,0,'a'.repeat(64),async state=>{
        process.stdout.write('ready\\n'); await new Promise(()=>{}); return state;
      });
    } else {
      const core=await openCoreDetectionRuntime(v.dsn,v.path);
      await core.consume(v.delivery); process.stdout.write('ready\\n'); await new Promise(()=>{});
    }
  `;
  async function killAt(stage,hash){
    const child=spawn(process.execPath,['--input-type=module','-e',childCode],{cwd:workspace,stdio:['pipe','pipe','pipe']});
    child.stdin.end(JSON.stringify({stage,hash,id:f.config.runtime_id,dsn:dsn(state,'intake'),path:f.path,delivery}));
    child.stderr.resume();
    const ready=await Promise.race([once(child.stdout,'data').then(([data])=>data.toString()),once(child,'exit').then(()=>{throw Error('child exited before checkpoint');})]);
    assert.equal(ready,'ready\n');child.kill('SIGKILL');await once(child,'exit');
  }
  try {
    const row=await owner.pool.query('SELECT config_sha256 FROM platform.core_detection_checkpoints WHERE runtime_id=$1',[f.config.runtime_id]);
    await killAt('transaction',row.rows[0].config_sha256);
    assert.equal((await runtime.read()).entries.length,0);
    await killAt('committed',row.rows[0].config_sha256);
    assert.equal((await runtime.read()).entries.length,1);
    assert.equal((await runtime.consume(delivery)).duplicate,true);
  } finally {await runtime.close();}
});
