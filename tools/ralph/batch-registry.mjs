import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { ROOT, digest, readJson, sourceSnapshot, trackerDefinition } from './state.mjs';

export const REGISTRY = '.local/ralph/batches/registry.json';
const same = (left, right) => digest(left) === digest(right);
const keys = (object, expected) => object && same(Object.keys(object).sort(), expected.slice().sort());
const CHECKS = Object.freeze({
  docs: [],
  contracts: [['--filter','@lmps/contracts','typecheck'], ['--filter','@lmps/contracts','test']],
  risk: [['--filter','@lmps/risk','typecheck'], ['--filter','@lmps/risk','test']],
  workers: [['--filter','@lmps/risk-workers','typecheck'], ['--filter','@lmps/risk-workers','test']],
  full: [['typecheck'], ['test'], ['build'], ['verify:fresh']],
  api: [['--filter','@lmps/contracts','typecheck'], ['--filter','@lmps/contracts','test'], ['--filter','@lmps/risk-api','typecheck'], ['--filter','@lmps/risk-api','test']],
});
const API_FILES = Object.freeze({
  'US-1004': ['apps/risk-api/src/features.controller.ts', 'apps/risk-api/src/feature-serving.service.ts', 'apps/risk-api/src/app.ts', 'apps/risk-api/src/config.ts', 'apps/risk-api/test/features.test.mjs'],
  'US-1005': ['apps/risk-api/test/features-native.test.mjs'],
});
function reviewedApiFile(batch, task, name) { return batch === 'rlp-b10' && (API_FILES[task] ?? []).includes(name); }
function safePath(name) {
  return typeof name === 'string' && name.length < 240 && posix.normalize(name) === name && !name.startsWith('/') && !name.startsWith('../') && !/[\\\x00-\x1f*?]/.test(name) && !name.split('/').some(part => part.startsWith('.'));
}
export function validateManifest(value, id) {
  if (!/^rlp-b\d{2}$/.test(id) || !keys(value,['version','batchId','predecessor','tracker','document','proposal','tasks']) || value.version !== 1 || value.batchId !== id || !/^rlp-b\d{2}$/.test(value.predecessor) || Number(value.predecessor.slice(-2))>=Number(id.slice(-2)) || value.tracker !== `tasks/ralph/batches/${id}.json` || value.document !== `tasks/ralph/batches/${id}.md` || value.proposal !== `.local/ralph/proposals/implementation-batch-${id.slice(-2).padStart(3,'0')}.md` || !Array.isArray(value.tasks) || value.tasks.length < 1 || value.tasks.length > 20) throw new Error('Unreviewed or invalid batch manifest.');
  const seen = new Set();
  for (const task of value.tasks) {
    if (!keys(task,['id','dependsOn','files','checkGroup','edits']) || !/^US-\d{3,5}$/.test(task.id) || seen.has(task.id) || !Array.isArray(task.dependsOn) || task.dependsOn.some(id => !seen.has(id)) || new Set(task.dependsOn).size !== task.dependsOn.length || !Object.hasOwn(CHECKS,task.checkGroup) || (task.checkGroup === 'api' && (id !== 'rlp-b10' || task.id !== 'US-1004')) || !Array.isArray(task.files) || !task.files.length || task.files.length > 12 || new Set(task.files).size !== task.files.length || task.files.some(name => !safePath(name) || !/^(packages\/(contracts|risk)\/|apps\/risk-workers\/|services\/ml-inference\/(lmps_ml|tests)\/|docs\/(operations|implementation-status|architecture|data-dictionary|security)\/|package\.json$)/.test(name) && !reviewedApiFile(id,task.id,name)) || !task.edits || Array.isArray(task.edits)) throw new Error('Invalid task, dependency, check identifier or file permission.');
    for (const [name, edit] of Object.entries(task.edits)) {
      if (!task.files.includes(name) || !edit || !['export','script','append'].includes(edit.kind) || typeof edit.value !== 'string' || edit.value.length > 1000) throw new Error('Invalid manifest-field permission.');
      if (edit.kind === 'append' ? !keys(edit,['kind','value']) || name !== 'packages/risk/src/index.ts' : !keys(edit,['kind','key','value']) || typeof edit.key !== 'string' || !['package.json','packages/contracts/package.json'].includes(name)) throw new Error('Unexpected manifest edit.');
    }
    for (const name of task.files.filter(name => ['package.json','packages/contracts/package.json','packages/risk/src/index.ts'].includes(name))) if (!task.edits[name]) throw new Error('Exact manifest/export permission required.');
    seen.add(task.id);
  }
  return { ...value, tasks: value.tasks.map(task => ({...task,checks:structuredClone(CHECKS[task.checkGroup])})) };
}

export function activeRegisteredBatch(root = ROOT) {
  if (!existsSync(join(root,REGISTRY))) return null;
  const registry = readJson(join(root,REGISTRY));
  if (registry.version !== 1 || typeof registry.active !== 'string') throw new Error('Registry requires review.');
  loadRegisteredBatch(root,registry.active);
  return registry.active;
}

export function loadRegisteredBatch(root, id) {
  if (!/^rlp-b\d{2}$/.test(id) || id === 'rlp-b01') throw new Error('Unknown active implementation batch.');
  const registry = readJson(join(root,REGISTRY));
  const registration = registry.entries?.[id];
  const name = `tasks/ralph/batches/${id}.manifest.json`;
  if (registry.version !== 1 || !registration || registration.authorization !== 'explicit-user-approval' || registration.manifestSha256 !== digest(readFileSync(join(root,name)))) throw new Error('Batch is not registered against an explicit reviewed manifest.');
  const manifest = validateManifest(readJson(join(root,name)),id);
  if (registration.proposalSha256 !== digest(readFileSync(join(root,manifest.proposal))) || registration.predecessorSealSha256 !== digest(readFileSync(join(root,historicalSealPath(manifest.predecessor))))) throw new Error('Proposal or predecessor seal changed.');
  const tracker = readJson(join(root,manifest.tracker));
  if (!same(tracker.userStories.map(({id,dependsOn})=>({id,dependsOn})),manifest.tasks.map(({id,dependsOn})=>({id,dependsOn}))) || digest(trackerDefinition(tracker)) !== registration.definitionSha256 || tracker.userStories.some(story => typeof story.passes !== 'boolean' || story.acceptanceCriteria.length < 6)) throw new Error('Registered task definition changed.');
  historicalBatchStatus(root,manifest.predecessor);
  if (registration.baseline && !existsSync(join(root,'.local/ralph/batches',id,'approved.json'))) {
    const current=sourceSnapshot(root);current.source=current.source.filter(row=>row.name!==manifest.tracker);
    if (!same(current,registration.baseline)) throw new Error('Source, plan or Git changed since registration; review before first run.');
  }
  if (registration.planTaskIds) {
    const catalog=loadMasterCatalog(root);
    if (registration.planTaskIds.length!==manifest.tasks.length || new Set(registration.planTaskIds).size!==manifest.tasks.length || registration.planTaskIds.some((planId,index)=>{const task=catalog.tasks.find(task=>task.id===planId);return !task || task.blockedBy.length || task.state!=='registered' || task.runner?.batchId!==id || task.runner?.taskId!==manifest.tasks[index].id;})) throw new Error('Blocked or unregistered master task cannot be activated.');
  }
  return { ...manifest, registration, manifestPath:name };
}

export function historicalSealPath(id) {
  if (!/^rlp-b\d{2}$/.test(id)) throw new Error('Unknown historical batch.');
  return id==='rlp-b01' ? '.local/ralph/registry-preparation/b01-seal.json' : `.local/ralph/batches/${id}/historical-seal.json`;
}

export function historicalBatchStatus(root = ROOT,id='rlp-b01') {
  if (id!=='rlp-b01') {
    const registry=readJson(join(root,REGISTRY));const path=historicalSealPath(id);
    if (registry.historicalBatches?.[id]?.sealSha256!==digest(readFileSync(join(root,path)))) throw new Error('Historical seal changed or is not registered.');
    const seal=readJson(join(root,path));
    const ids=seal.tracker?.userStories?.map(story=>story.id);
    if (seal.batchId!==id || seal.status?.status!=='verified' || !ids?.length || new Set(ids).size!==ids.length || seal.status.verifiedCount!==ids.length || seal.status.remainingCount!==0 || !same(ids,seal.status.completed) || seal.tracker.userStories.some(story=>story.passes!==true) || !same(readJson(join(root,`tasks/ralph/batches/${id}.json`)),seal.tracker)) throw new Error('Historical completion is incomplete or tracker changed.');
    const expected=['approved.json','maintenance.json','completion-audit.json','host-verification-approval.json','response.schema.json',...ids.map(taskId=>`tasks/${taskId}/receipt.json`)];
    if (!same(seal.records.map(row=>row.name).sort(),expected.sort())) throw new Error('Historical completion inventory is incomplete.');
    for (const record of seal.records) if (!safePath(record.name) || digest(readFileSync(join(root,'.local/ralph/batches',id,record.name)))!==record.sha256) throw new Error('Historical batch evidence changed.');
    return {...seal.status,selectedHome:seal.selectedHome,historical:true,agentInvoked:false,automaticRetry:false,automaticAccountRotation:false};
  }
  const seal = readJson(join(root,'.local/ralph/registry-preparation/b01-seal.json'));
  if (seal.batchId !== 'rlp-b01' || seal.status.status !== 'verified' || seal.status.verifiedCount !== 5 || seal.status.remainingCount !== 0) throw new Error('Predecessor is not a complete sealed batch.');
  const registryFile = join(root,REGISTRY);
  if (existsSync(registryFile) && readJson(registryFile).historicalSealSha256 !== digest(readFileSync(join(root,'.local/ralph/registry-preparation/b01-seal.json')))) throw new Error('Historical seal changed.');
  const expected = ['approved.json','maintenance.json','completion-audit.json',...['US-101','US-102','US-103','US-104','US-105'].map(id=>`tasks/${id}/receipt.json`)];
  if (!same(seal.records.map(row=>row.name).sort(),expected.sort()) || !same(seal.status.completed,['US-101','US-102','US-103','US-104','US-105']) || !same(seal.tracker.userStories.map(row=>({id:row.id,passes:row.passes})),seal.status.completed.map(id=>({id,passes:true})))) throw new Error('Historical completion inventory is incomplete.');
  for (const record of seal.records) {
    if (!safePath(record.name) || digest(readFileSync(join(root,'.local/ralph/batches/rlp-b01',record.name))) !== record.sha256) throw new Error('Historical batch evidence changed.');
  }
  if (!same(readJson(join(root,'tasks/ralph/batches/rlp-b01.json')),seal.tracker)) throw new Error('Historical tracker changed.');
  return {...seal.status,selectedHome:seal.run.selectedHome,historical:true,agentInvoked:false,automaticRetry:false,automaticAccountRotation:false};
}

export function validateMasterCatalog(value) {
  if (value.format!=='lmps-ralph-catalog-v1' || value.version!==1 || value.executable!==false || value.requirements?.length!==104 || new Set(value.requirements.map(row=>row.id)).size!==104 || value.tasks?.length!==135 || new Set(value.tasks.map(task=>task.id)).size!==135) throw new Error('Incomplete master registration.');
  const ids=new Set(value.tasks.map(task=>task.id)),requirements=new Set(value.requirements.map(row=>row.id));
  const runners=new Set();const visiting=new Set(),visited=new Set();
  const tasks=new Map(value.tasks.map(task=>[task.id,task]));
  function visit(id){if(visiting.has(id))throw new Error('Master dependency cycle.');if(visited.has(id))return;visiting.add(id);for(const dep of tasks.get(id).dependsOn){if(!ids.has(dep))throw new Error('Unknown master dependency.');visit(dep);}visiting.delete(id);visited.add(id);}
  for(const task of value.tasks){
    if(!requirements.has(task.requirement)||!Array.isArray(task.blockedBy)||!Array.isArray(task.dependsOn)||task.blockedBy.some(gate=>!Object.hasOwn(value.gates,gate))||!['verified','registered','blocked'].includes(task.state)||task.executable!==false)throw new Error('Invalid master task state or gate.');
    if(task.blockedBy.length?(task.state!=='blocked'||task.runner):(task.state==='blocked'||!task.runner))throw new Error('Gated tasks cannot be registered for execution.');
    if(task.runner){const key=`${task.runner.batchId}/${task.runner.taskId}`;if(!/^rlp-b\d{2}\/US-\d{3,5}$/.test(key)||runners.has(key))throw new Error('Invalid or duplicate runner mapping.');runners.add(key);}
    if(!value.requirements.find(row=>row.id===task.requirement).remainingTasks.includes(task.id))throw new Error('Master task missing from requirement coverage.');
    visit(task.id);
  }
  for(const row of value.requirements){if(row.remainingTasks.some(id=>!ids.has(id)||tasks.get(id).requirement!==row.id))throw new Error('Missing requirement-to-task coverage.');}
  return value;
}

export function loadMasterCatalog(root=ROOT) {
  const registry=readJson(join(root,REGISTRY)),registration=registry.master;
  if(registration?.catalogPath!=='tasks/ralph/master.json'||registration.catalogSha256!==digest(readFileSync(join(root,'tasks/ralph/master.json'))))throw new Error('Master catalog is not registered or changed.');
  const catalog=validateMasterCatalog(readJson(join(root,'tasks/ralph/master.json')));
  const currentPlan=sourceSnapshot(root).plan;
  if(!same(currentPlan,registration.sourceDocuments)||!same(currentPlan.map(row=>row.name),catalog.sourceDocuments.map(row=>row.name)))throw new Error('Original plan changed since master registration.');
  for(const task of catalog.tasks.filter(task=>task.state==='verified')){
    const history=historicalBatchStatus(root,task.runner.batchId);
    const path=`.local/ralph/batches/${task.runner.batchId}/tasks/${task.runner.taskId}/receipt.json`;
    if(!history.completed.includes(task.runner.taskId)||task.receiptRef!==path||digest(readFileSync(join(root,path)))!==registration.completedReceipts?.[task.id])throw new Error('Master completion lacks historical receipt.');
  }
  return catalog;
}

export function masterStatus(root=ROOT,activeState=null) {
  const catalog=loadMasterCatalog(root),registry=readJson(join(root,REGISTRY));
  const completed=new Set(activeState?.completed??[]);
  const verified=catalog.tasks.filter(task=>task.state==='verified'||(task.runner?.batchId===registry.master.readyBatch&&completed.has(task.runner.taskId)));
  const blocked=catalog.tasks.filter(task=>task.state==='blocked');
  const verifiedIds=new Set(verified.map(task=>task.id));
  const pending=catalog.tasks.filter(task=>task.state==='registered'&&!verifiedIds.has(task.id));
  const next=pending.find(task=>task.dependsOn.every(id=>verifiedIds.has(id)));
  return {scope:'registered-complete-plan',batchId:'rlp-master',status:activeState?.status==='review-required'?'review-required':activeState?.manualActionRequired&&!activeState.running?'stopped':next?'ready':verified.length===catalog.tasks.length?'verified':'blocked',requirements:104,phases:12,totalTasks:catalog.tasks.length,verifiedCount:verified.length,registeredPendingCount:pending.length,blockedCount:blocked.length,nextTask:next?{planTaskId:next.id,...next.runner}:null,executionBatch:registry.master.readyBatch,selectedHome:activeState?.selectedHome??'plusb',running:activeState?.running??false,automaticContinuation:true,automaticRetry:false,automaticAccountRotation:false,manualActionRequired:!!activeState?.manualActionRequired||activeState?.status==='review-required'||!next,execution:activeState,blockedGates:[...new Set(blocked.flatMap(task=>task.blockedBy))].sort(),planComplete:verified.length===catalog.tasks.length};
}
