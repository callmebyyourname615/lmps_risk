import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, chmodSync, rmSync, readFileSync, writeFileSync, readdirSync, lstatSync, renameSync, symlinkSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArguments, runP05FeatureRiskAcceptance } from '../scripts/p05-feature-risk-acceptance.mjs';
const root = fileURLToPath(new URL('../../../',import.meta.url));
const script = join(root,'apps/risk-workers/scripts/p05-feature-risk-acceptance.mjs');
const child = args => execFileSync(process.execPath,args,{cwd:root,timeout:180000,maxBuffer:65536,encoding:'utf8'});
test('strict inert entrypoint and no caller success/runner/accessor authority', async () => {
 assert.equal(child(['--input-type=module','-e',`await import(${JSON.stringify(new URL('../scripts/p05-feature-risk-acceptance.mjs',import.meta.url).href)})`]),'');
 for (const args of [[],['--help'],['--output','relative'],['--output',root+'/elsewhere'],['--verify','x'],['--output',root+'/.local/a','--success']])
  assert.throws(() => parseArguments(args));
 await assert.rejects(runP05FeatureRiskAcceptance({output:root+'/.local/unused',success:true}));
 let invoked = false;
 await assert.rejects(runP05FeatureRiskAcceptance({get output(){invoked=true;return 'bad';}})); assert.equal(invoked,false);
});
test('actual final CLI, read-only fresh verification, no overwrite, missing/tampered evidence and closed stores', t => {
 const parent = mkdtempSync(join(root,'.local/p05-test-')); chmodSync(parent,0o700);
 t.after(() => rmSync(parent,{recursive:true,force:true}));
 const output = join(parent,'evidence');
 assert.match(child([script,'--output',output]),/production_ready=false/);
 const snapshot = () => {
  const rows = {};
  function walk(p) { for (const n of readdirSync(p)) { const f=join(p,n),s=lstatSync(f); if(s.isDirectory())walk(f); else {
   assert.equal(s.mode & 0o777,0o600); assert.doesNotMatch(n,/lock|stage/); rows[f]={bytes:readFileSync(f).toString('hex'),mtime:s.mtimeMs,ino:s.ino};
  } } } walk(output); return rows;
 };
 const before = snapshot();
 assert.match(child([script,'--verify',output]),/production_ready=false/); assert.deepEqual(snapshot(),before);
 const receipt = JSON.parse(readFileSync(join(output,'acceptance.json')));
 assert.equal(receipt.production_ready,false); assert.equal(receipt.owned_handles,0); assert.equal(receipt.bindings.length,4);
 assert.ok(Object.keys(receipt.source_hashes).some(p => p.endsWith('/dist/feature-risk.js')));
 const fail = args => { const p=spawnSync(process.execPath,[script,...args],{cwd:root,timeout:180000,maxBuffer:65536,encoding:'utf8'});
  assert.equal(p.error,undefined); assert.equal(p.status,1); assert.match(p.stderr,/P05_FEATURE_RISK_ACCEPTANCE_FAILED/); assert.equal(p.stdout,''); };
 fail(['--output',output]); assert.deepEqual(snapshot(),before);
 for (const name of ['case-0/result.json','case-0/store/publication.json','acceptance.json']) {
  const p=join(output,name),bytes=readFileSync(p); writeFileSync(p,'{}'); fail(['--verify',output]); writeFileSync(p,bytes);
  renameSync(p,p+'.missing'); fail(['--verify',output]); renameSync(p+'.missing',p);
 }
 const p=join(output,'case-0/result.json'); renameSync(p,p+'.saved'); symlinkSync(p+'.saved',p);
 fail(['--verify',output]); unlinkSync(p); renameSync(p+'.saved',p);
 chmodSync(p,0o644); fail(['--verify',output]); chmodSync(p,0o600);
 assert.match(child([script,'--verify',output]),/production_ready=false/);
});
