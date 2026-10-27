import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, chmodSync, rmSync, cpSync, symlinkSync, readdirSync, existsSync, statSync, linkSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { parseArguments, runFeatureServingAcceptance, verifyFeatureServingAcceptance } from '../scripts/feature-serving-acceptance.mjs';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const script = join(root, 'apps/risk-workers/scripts/feature-serving-acceptance.mjs');
const encode = v => JSON.stringify(v, (_k,x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0)) : x);
const hash = v => createHash('sha256').update(v).digest('hex').match(/.{8}/g).join(' ');
const failed = e => e.code === 'FEATURE_SERVING_ACCEPTANCE_FAILED' && e.message === 'FEATURE_SERVING_ACCEPTANCE_FAILED';
function scratch(t) { mkdirSync(join(root,'.local'),{recursive:true,mode:0o700}); const p = mkdtempSync(join(root,'.local/us705-test-')); chmodSync(p,0o700); t.after(() => rmSync(p,{recursive:true,force:true})); return p; }
function cli(path, args, cwd = join(root,'packages/risk')) { return spawnSync(process.execPath,[path,...args],{cwd,encoding:'utf8',timeout:180000,maxBuffer:4096}); }
function clone(t) {
  const p = scratch(t);
  for (const pkg of ['packages/contracts','packages/risk','apps/risk-workers']) {
    for (const part of ['package.json','src','dist']) cpSync(join(root,pkg,part),join(p,pkg,part),{recursive:true});
    mkdirSync(join(p,pkg,'node_modules/@lmps'),{recursive:true});
    for (const name of ['contracts','risk']) symlinkSync(join(p,'packages',name),join(p,pkg,'node_modules/@lmps',name));
  }
  for (const path of ['apps/risk-workers/scripts/feature-serving-acceptance.mjs','packages/risk/test/fixtures/feature-streams/golden.json','packages/risk/fixtures/request.mjs']) cpSync(join(root,path),join(p,path),{recursive:true});
  for (const name of ['ajv','ajv-formats']) symlinkSync(join(root,'packages/contracts/node_modules',name),join(p,'packages/contracts/node_modules',name));
  cpSync(join(root,'packages/contracts/schemas'),join(p,'packages/contracts/schemas'),{recursive:true});
  mkdirSync(join(p,'.local'),{mode:0o700});
  return { p, script:join(p,'apps/risk-workers/scripts/feature-serving-acceptance.mjs'), output:join(p,'.local/trial') };
}

test('import is inert even without compiled implementations; invalid CLI creates nothing', t => {
  const p = scratch(t), copy = join(p,'inert.mjs'); cpSync(script,copy);
  const imported = spawnSync(process.execPath,['--input-type=module','-e',`await import(${JSON.stringify(new URL('file://' + copy).href)})`],{cwd:p,encoding:'utf8'});
  assert.equal(imported.status,0); assert.equal(imported.stdout,''); assert.equal(imported.stderr,'');
  assert.deepEqual(readdirSync(p),['inert.mjs']);
  const output = join(p,'absent');
  for (const args of [[],['--fake'],['--output',output,'--extra'],['--output','relative'],['--output',join(root,'outside')],['--output',output+'/../bad'],['--output',output+' space']]) {
    const r = cli(script,args); assert.equal(r.status,1); assert.equal(r.stderr,'FEATURE_SERVING_ACCEPTANCE_FAILED\n'); assert.equal(r.stdout,''); assert.equal(existsSync(output),false);
  }
  assert.throws(() => parseArguments(['--output',output,'--output',output]),failed);
});

test('strict API/unsafe and existing destinations fail before mutation', async t => {
  const p = scratch(t), output = join(p,'trial');
  let called = false;
  await assert.rejects(runFeatureServingAcceptance({get output() { called=true; return output; }}),failed); assert.equal(called,false);
  await assert.rejects(runFeatureServingAcceptance({output,runner:()=>{}}),failed);
  mkdirSync(output,{mode:0o700}); writeFileSync(join(output,'sentinel'),'retain',{mode:0o600});
  await assert.rejects(runFeatureServingAcceptance({output}),failed); assert.equal(readFileSync(join(output,'sentinel'),'utf8'),'retain');
  const linked = join(p,'linked'); symlinkSync(output,linked);
  await assert.rejects(runFeatureServingAcceptance({output:join(linked,'new')}),failed); assert.equal(existsSync(join(output,'new')),false);
  chmodSync(output,0o777); await assert.rejects(runFeatureServingAcceptance({output:join(output,'new')}),failed); chmodSync(output,0o700);
  assert.equal(existsSync(join(output,'new')),false);
});

test('real default lifecycle and persisted proof, cwd independence, immutable exclusive acceptance', async t => {
  const p = scratch(t), output = join(p,'trial');
  const r = cli(script,['--output',output]); assert.equal(r.status,0,r.stderr); assert.equal(r.stdout,'FEATURE_SERVING_ACCEPTANCE_RECORDED\n');
  const bytes = readFileSync(join(output,'acceptance.json')), a = await verifyFeatureServingAcceptance(output);
  assert.equal(a.production_ready,false); assert.equal(a.mode,'local_synthetic'); assert.equal(a.proof.deliveries,18); assert.equal(a.proof.snapshots,6); assert.equal(a.proof.next_offset,18); assert.equal(a.proof.generation,2); assert.equal(a.proof.rebuild_generation,1);
  assert.ok(a.evidence_bytes>0 && a.evidence_bytes<=16*1024**2); assert.ok(a.elapsed_ms<=180000); assert.equal(a.closed_owned_handles,0);
  for (const name of ['consumer','store','rebuilt']) { assert.deepEqual(readdirSync(join(output,name)).sort(),name==='consumer'?['checkpoint.json','owner.json']:['owner.json','publication.json']); assert.equal(statSync(join(output,name)).mode&0o777,0o700); }
  assert.equal(statSync(join(output,'acceptance.json')).mode&0o777,0o600);
  const inode = statSync(join(output,'acceptance.json')).ino;
  assert.equal(cli(script,['--output',output],root).status,1); await assert.rejects(runFeatureServingAcceptance({output}),failed);
  assert.deepEqual(readFileSync(join(output,'acceptance.json')),bytes); assert.equal(statSync(join(output,'acceptance.json')).ino,inode);
  assert.equal(a.source_hashes['packages/contracts/src/feature-stream.ts'],hash(readFileSync(join(root,'packages/contracts/src/feature-stream.ts'))));
  assert.equal(a.source_hashes['apps/risk-workers/dist/feature-serving-adapter.js'],hash(readFileSync(join(root,'apps/risk-workers/dist/feature-serving-adapter.js'))));
});

test('changed/forged persisted evidence cannot verify, including rehashed self-reported proof', async t => {
  const p = scratch(t), output=join(p,'trial'), options=Object.freeze({output}); await runFeatureServingAcceptance(options); assert.deepEqual(options,{output});
  const receiptFile=join(output,'acceptance.json'), original=readFileSync(receiptFile), checkpoint=join(output,'consumer/checkpoint.json'), cpBytes=readFileSync(checkpoint);
  for (const elapsed_ms of ['1', 1.5, -1, 180001, null]) {
    const forged = { ...JSON.parse(original), elapsed_ms };
    writeFileSync(receiptFile, encode(forged));
    await assert.rejects(verifyFeatureServingAcceptance(output), failed);
  }
  writeFileSync(receiptFile, original);
  const a=JSON.parse(original); a.source_hashes['apps/risk-workers/dist/feature-serving-adapter.js']='forged'; writeFileSync(receiptFile,encode(a)); await assert.rejects(verifyFeatureServingAcceptance(output),failed); writeFileSync(receiptFile,original);
  const cp=JSON.parse(cpBytes); cp.state.snapshots[0].amount='0.00'; cp.state_hash=hash(encode(cp.state)); writeFileSync(checkpoint,encode(cp));
  const forged=JSON.parse(original); forged.evidence_hashes['consumer/checkpoint.json']=hash(readFileSync(checkpoint)); forged.proof.checkpoint_hash=forged.evidence_hashes['consumer/checkpoint.json']; forged.proof.semantic_hash=cp.state_hash;
  writeFileSync(receiptFile,encode(forged)); await assert.rejects(verifyFeatureServingAcceptance(output),failed);
  writeFileSync(checkpoint,cpBytes); writeFileSync(receiptFile,original);
  const file=join(output,'store/publication.json'), originalStore=readFileSync(file), env=JSON.parse(originalStore); env.publication.generation=3; writeFileSync(file,encode(env)); await assert.rejects(verifyFeatureServingAcceptance(output),failed); writeFileSync(file,originalStore);
  linkSync(checkpoint,join(p,'hard')); await assert.rejects(verifyFeatureServingAcceptance(output),failed); unlinkSync(join(p,'hard'));
  chmodSync(checkpoint,0o644); await assert.rejects(verifyFeatureServingAcceptance(output),failed); chmodSync(checkpoint,0o600);
  writeFileSync(join(output,'store/writer.lock'),'ambiguous',{mode:0o600}); await assert.rejects(verifyFeatureServingAcceptance(output),failed);
});

test('real compiled adapter failure cannot publish acceptance; errors contain no payload', t => {
  const x=clone(t), file=join(x.p,'apps/risk-workers/dist/feature-serving-adapter.js');
  writeFileSync(file,readFileSync(file,'utf8').replace('export function openFeatureServingAdapter(', 'export function originalAdapter(')+'\nexport function openFeatureServingAdapter() { throw Error("withheld payload"); }\n');
  const r=cli(x.script,['--output',x.output]); assert.equal(r.status,1); assert.equal(r.stderr,'FEATURE_SERVING_ACCEPTANCE_FAILED\n'); assert.equal(r.stdout,''); assert.equal(existsSync(join(x.output,'acceptance.json')),false);
  assert.ok(existsSync(x.output),'actual adapter open must have been attempted');
});

test('source changes during actual compiled import are detected before acceptance', t => {
  const x=clone(t), file=join(x.p,'apps/risk-workers/dist/feature-serving-adapter.js'), source=join(x.p,'apps/risk-workers/src/feature-serving-adapter.ts');
  writeFileSync(file,readFileSync(file,'utf8')+`\nimport { appendFileSync as alter } from 'node:fs'; alter(${JSON.stringify(source)},'\\n');\n`);
  const r=cli(x.script,['--output',x.output]); assert.equal(r.status,1); assert.equal(r.stderr,'FEATURE_SERVING_ACCEPTANCE_FAILED\n'); assert.equal(existsSync(join(x.output,'acceptance.json')),false);
  assert.ok(existsSync(join(x.output,'rebuilt/publication.json')),'actual lifecycle must precede provenance mismatch refusal');
});

test('changed default serving values and changed reference cannot yield acceptance', t => {
  for (const which of ['serving','malformed','reference']) {
    const x=clone(t), file=join(x.p,'packages/risk/dist',which!=='reference'?'feature-serving.js':'index.js');
    let text=readFileSync(file,'utf8');
    if(which==='serving') { assert.ok(text.includes('count: snapshot.count')); text=text.replace('count: snapshot.count','count: "999"'); }
    else if(which==='malformed') { assert.ok(text.includes("status: 'available'")); text=text.replace("status: 'available'", "status: 'available', unexpected: true"); }
    else { assert.ok(text.includes('export function evaluateTransactionRisk(')); text=text.replace('export function evaluateTransactionRisk(','export function originalReference(')+'\nexport function evaluateTransactionRisk() { return { findings: [] }; }\n'; }
    writeFileSync(file,text); const r=cli(x.script,['--output',x.output]); assert.equal(r.status,1); assert.equal(r.stderr,'FEATURE_SERVING_ACCEPTANCE_FAILED\n'); assert.equal(existsSync(join(x.output,'acceptance.json')),false);
    if(which!=='reference') assert.ok(existsSync(join(x.output,'consumer/checkpoint.json')));
  }
});

test('compiled currency validation bypass cannot yield acceptance', t => {
  const x = clone(t), file = join(x.p, 'packages/contracts/dist/feature-serving.js');
  const text = readFileSync(file, 'utf8');
  assert.ok(text.includes('check(v.currency === v.query.currency);'));
  writeFileSync(file, text.replace('check(v.currency === v.query.currency);', 'check(true);'));
  const r = cli(x.script, ['--output', x.output]);
  assert.equal(r.status, 1); assert.equal(r.stderr, 'FEATURE_SERVING_ACCEPTANCE_FAILED\n');
  assert.equal(existsSync(join(x.output, 'acceptance.json')), false);
  assert.ok(existsSync(join(x.output, 'consumer/checkpoint.json')));
});

test('golden byte ceiling exact/one-over and changed fixed expectations fail closed', t => {
  const x=clone(t), file=join(x.p,'packages/risk/test/fixtures/feature-streams/golden.json'), original=readFileSync(file);
  writeFileSync(file,Buffer.concat([original,Buffer.alloc(32768-original.length,0x20)]));
  assert.equal(statSync(file).size,32768);
  const r=cli(x.script,['--output',x.output]); assert.equal(r.status,0,r.stderr);
  writeFileSync(file,Buffer.concat([readFileSync(file),Buffer.from(' ')]));
  const over=join(x.p,'.local/one-over'); assert.equal(cli(x.script,['--output',over]).status,1); assert.equal(existsSync(over),false);
  const g=JSON.parse(original); g.snapshots[0].expected.amount='999.00'; writeFileSync(file,JSON.stringify(g));
  const changed=join(x.p,'.local/changed'); assert.equal(cli(x.script,['--output',changed]).status,1); assert.equal(existsSync(changed),false);
});
