import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerHooks } from 'node:module';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, mkdtemp, rm, lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArguments, validateCapture } from '../scripts/feature-stream-spike.mjs';
import { openFeatureStreamConsumer } from '../dist/feature-stream-consumer.js';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SCRIPT = new URL('../scripts/feature-stream-acceptance.mjs', import.meta.url);
const encode = v => JSON.stringify(v, (_k,x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0)) : x);
const hash = v => createHash('sha256').update(v).digest('hex').match(/.{8}/g).join(' ');
const invalid = e => e.code === 'FEATURE_ACCEPTANCE_FAILED';
// Test-process module substitution only. The shipping module has no test API.
let runner = async () => { throw Error('private native diagnostic'); }, verifies = 0, handles = [];
let provenanceMismatch = false;
globalThis.__featureAcceptanceTest = { parseArguments, validateCapture,
  runFeatureStreamSpike: options => runner(options), ownedFeatureProcessHandles: () => handles,
  ownedProcessHandles: () => handles, verifyRuntime: async () => { verifies++; } };
globalThis.__featureAcceptanceMismatch = () => provenanceMismatch;
const hook = registerHooks({ load(url, context, next) {
  const result = next(url, context);
  if (url === SCRIPT.href + '?unit') {
    let source = String(result.source);
    source = source.replace(/^import \{ runFeatureStreamSpike.*$/m, 'const { runFeatureStreamSpike, ownedFeatureProcessHandles, parseArguments, validateCapture } = globalThis.__featureAcceptanceTest;');
    source = source.replace(/^import \{ verifyRuntime.*$/m, 'const { verifyRuntime, ownedProcessHandles } = globalThis.__featureAcceptanceTest;');
    source += '\nconst originalProvenance = provenance; let provenanceCalls=0; provenance = async () => { const result=await originalProvenance(); if (globalThis.__featureAcceptanceMismatch() && ++provenanceCalls % 2 === 0) result.changed="test-process-only"; return result; }; export { verifyEvidence, publish, provenance };';
    return { ...result, source };
  }
  return result;
} });
const unit = await import(SCRIPT.href + '?unit'); hook.deregister();
async function space(t) {
  await mkdir(join(ROOT,'.local'), { recursive: true, mode: 0o700 });
  const p = await mkdtemp(join(ROOT,'.local/acceptance-unit-'));
  t.after(() => rm(p,{ recursive:true, force:true })); return p;
}
async function specimen(output) {
  await mkdir(output,{ mode:0o700 });
  const raw = await readFile(new URL('../../../packages/risk/test/fixtures/feature-streams/golden.json',import.meta.url)), c = JSON.parse(raw);
  const plan = { version:'synthetic-feature-stream-1',identity:'synthetic_declared',run_id:'synthetic_run',input_identity:'synthetic_golden_v1',namespace:'synthetic_golden',topic:'synthetic_golden.synthetic_run',window_seconds:3600,coverage_start:c.coverage_start,queries:c.snapshots.map(({expected,...q})=>q),limits:{records:32,revisions:32,snapshots:8,capture_bytes:32768,state_bytes:1048576} };
  const deliveries = c.events.map((event,offset)=>({identity:'synthetic_declared',topic:plan.topic,partition:0,offset,event}));
  const capture = deliveries.map((d,i)=>`R\t0\t${i}\t${Buffer.from(encode(d)).toString('base64')}\n`).join('')+'E\t18\t18\n';
  let worker = openFeatureStreamConsumer(join(output,'consumer'),plan);
  for (const d of deliveries.slice(0,9)) worker.consume(d);
  const prefix = worker.receipt(); worker.close(); worker = openFeatureStreamConsumer(join(output,'consumer'),plan);
  for (const d of deliveries) worker.consume(d);
  const snapshots = plan.queries.map(q=>worker.materialize(q.id)), committed = worker.receipt(); worker.close();
  const receipt = {version:1,production_ready:false,java_version:'21.0.10',kafka_version:'4.1.2',deliveries:18,captures:54,capture_bytes:Buffer.byteLength(capture)*3,input_hash:hash(raw),capture_hash:hash(capture),snapshots_hash:hash(encode(snapshots)),prefix,committed,partition:0,end_offset:18,owned_processes:0,peak_storage_bytes:100000,elapsed_ms:100};
  for (const [name,value] of Object.entries({'capture-initial.txt':capture,'capture-restart.txt':capture,'snapshots.json':encode(snapshots),'pipeline-receipt.json':encode(receipt)})) await writeFile(join(output,name),value,{mode:0o600,flag:'wx'});
  return receipt;
}
test('unmodified import and invalid CLI are inert and redacted in both working directories', () => {
  for (const cwd of [ROOT,join(ROOT,'apps/risk-workers')]) {
    const imported = spawnSync(process.execPath,['--input-type=module','-e',`await import(${JSON.stringify(SCRIPT.href)});`],{cwd,encoding:'utf8',timeout:5000});
    assert.equal(imported.status,0); assert.equal(imported.stdout,''); assert.equal(imported.stderr,'');
    for (const args of [[],['--fake'],['--output','private-secret'],['--receipt','private-secret']]) {
      const p = spawnSync(process.execPath,[fileURLToPath(SCRIPT),...args],{cwd,encoding:'utf8',timeout:5000});
      assert.equal(p.status,1); assert.equal(p.stdout,''); assert.equal(p.stderr,'FEATURE_ACCEPTANCE_FAILED\n');
    }
  }
});
test('native failure is redacted, never publishes; injection rejected',async t=>{
  const dir = await space(t); verifies=0;
  await assert.rejects(unit.runFeatureStreamAcceptance({output:join(dir,'failure')}),invalid);
  assert.equal(verifies,1);
  await assert.rejects(lstat(join(dir,'failure/acceptance.json')), {code:'ENOENT'});
  await assert.rejects(unit.runFeatureStreamAcceptance({output:join(dir,'inject')},{}),invalid);
  const setup = `import {registerHooks} from 'node:module'; registerHooks({load(url,context,next){const result=next(url,context); if(url===${JSON.stringify(SCRIPT.href)}) return {...result,source:String(result.source).replace(/^import \\{ verifyRuntime.*$/m,'const verifyRuntime=async()=>{throw Error("private-native-secret")}; const ownedProcessHandles=()=>[];')}; return result;}});`;
  const p=spawnSync(process.execPath,['--import','data:text/javascript,'+encodeURIComponent(setup),fileURLToPath(SCRIPT),'--output',join(dir,'cli-failure')],{cwd:ROOT,encoding:'utf8',timeout:5000});
  assert.equal(p.status,1); assert.equal(p.stdout,''); assert.equal(p.stderr,'FEATURE_ACCEPTANCE_FAILED\n');
  await assert.rejects(lstat(join(dir,'cli-failure/acceptance.json')),{code:'ENOENT'});
});
test('independent evidence rejects forged receipts, arithmetic, offsets and checkpoint hashes',async t=>{
  const dir = await space(t), output=join(dir,'pipeline'), receipt=await specimen(output);
  assert.equal((await unit.verifyEvidence(output,receipt)).deliveries,18);
  for (const field of ['deliveries','captures','end_offset','input_hash','capture_hash','snapshots_hash','owned_processes']) {
    const forged={...receipt,[field]:typeof receipt[field]==='number'?999:'00000000'};
    await writeFile(join(output,'pipeline-receipt.json'),encode(forged));
    await assert.rejects(unit.verifyEvidence(output,forged));
  }
  await writeFile(join(output,'pipeline-receipt.json'),encode(receipt));
  for (const forged of [
    {...receipt,prefix:{...receipt.prefix,next_offset:10}},
    {...receipt,committed:{...receipt.committed,state_hash:receipt.prefix.state_hash}},
    {...receipt,success:true},
    {...receipt,elapsed_ms:180001},
    {...receipt,peak_storage_bytes:2*1024**3+1},
  ]) {
    await writeFile(join(output,'pipeline-receipt.json'),encode(forged));
    await assert.rejects(unit.verifyEvidence(output,forged));
  }
  await writeFile(join(output,'pipeline-receipt.json'),encode(receipt));
  const checkpointPath=join(output,'consumer/checkpoint.json'), checkpoint=await readFile(checkpointPath);
  const changed=JSON.parse(checkpoint); changed.extra_success=true;
  await writeFile(checkpointPath,encode(changed));
  const forged={...receipt,committed:{...receipt.committed,checkpoint_hash:hash(encode(changed))}};
  await writeFile(join(output,'pipeline-receipt.json'),encode(forged));
  await assert.rejects(unit.verifyEvidence(output,forged));
  await writeFile(checkpointPath,checkpoint); await writeFile(join(output,'pipeline-receipt.json'),encode(receipt));
  const snapshots=JSON.parse(await readFile(join(output,'snapshots.json'))); snapshots[0].amount='14.12';
  await writeFile(join(output,'snapshots.json'),encode(snapshots));
  await assert.rejects(unit.verifyEvidence(output,receipt));
});
test('publication is private, atomic, exclusive and preserves existing evidence',async t=>{
  const dir=await space(t);
  await unit.publish(dir,{production_ready:false,proof:{count:6}});
  const original=await readFile(join(dir,'acceptance.json'));
  assert.equal((await lstat(join(dir,'acceptance.json'))).mode & 0o777,0o600);
  await assert.rejects(unit.publish(dir,{forged:true}),{code:'EEXIST'});
  assert.deepEqual(await readFile(join(dir,'acceptance.json')),original);
  assert.deepEqual(await readdir(dir),['acceptance.json']);
  const concurrent=join(dir,'concurrent'); await mkdir(concurrent,{mode:0o700});
  const candidates=[{proof:{count:6}},{proof:{count:7}}];
  const results=await Promise.allSettled(candidates.map(value=>unit.publish(concurrent,value)));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const winner=results.findIndex(r=>r.status==='fulfilled');
  assert.deepEqual(JSON.parse(await readFile(join(concurrent,'acceptance.json'))),candidates[winner]);
  assert.deepEqual(await readdir(concurrent),['acceptance.json']);
});
test('substituted full lifecycle checks provenance and empty owned handles; never native proof',async t=>{
  const dir=await space(t); verifies=0;
  runner=async ({output})=>specimen(output);
  const result=await unit.runFeatureStreamAcceptance({output:join(dir,'success')});
  assert.equal(result.production_ready,false); assert.equal(verifies,2);
  assert.ok(result.source_hashes['apps/risk-workers/dist/feature-stream-consumer.js']);
  runner=async ({output})=>{const receipt=await specimen(output); handles=[{}]; return receipt;};
  try { await assert.rejects(unit.runFeatureStreamAcceptance({output:join(dir,'owned')}),invalid); }
  finally {handles=[];}
  await assert.rejects(lstat(join(dir,'owned/acceptance.json')),{code:'ENOENT'});
  runner=async ({output})=>specimen(output); provenanceMismatch=true;
  try { await assert.rejects(unit.runFeatureStreamAcceptance({output:join(dir,'mismatch')}),invalid); }
  finally { provenanceMismatch=false; }
  await assert.rejects(lstat(join(dir,'mismatch/acceptance.json')),{code:'ENOENT'});
  // Observe current hashes without changing repository source.
  const hashes=await unit.provenance(); assert.match(hashes['apps/risk-workers/scripts/feature-stream-acceptance.mjs'],/^[a-f0-9]{8}( [a-f0-9]{8}){7}$/);
});
