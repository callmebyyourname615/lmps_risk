import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, chmod, symlink, rm, readFile, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { parseArguments, runGraphAcceptance, verifyGraphAcceptance } from '../scripts/p05-graph-acceptance.mjs';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const script=fileURLToPath(new URL('../scripts/p05-graph-acceptance.mjs',import.meta.url));
test('inert import and strict closed CLI reject arbitrary success/runner inputs',async()=>{
  const p=spawnSync(process.execPath,['--input-type=module','-e',`await import(${JSON.stringify(new URL('../scripts/p05-graph-acceptance.mjs',import.meta.url).href)})`],{encoding:'utf8',timeout:5000,maxBuffer:4096});
  assert.equal(p.status,0); assert.equal(p.stdout+p.stderr,'');
  for(const args of [[],['--verify','/tmp/x'],['--output',join(root,'.local/postgres-x')],['--output',join(root,'.local/x'),'--success','true'],['--runner','fake']]) assert.throws(()=>parseArguments(args));
  await assert.rejects(runGraphAcceptance(join(root,'.local/unused'),{success:true}));
  await assert.rejects(verifyGraphAcceptance(join(root,'.local/unused'),{}));
  const bad=spawnSync(process.execPath,[script,'--success','true'],{encoding:'utf8',timeout:5000,maxBuffer:4096});
  assert.equal(bad.status,1); assert.equal(bad.stderr.trim(),'GRAPH_ACCEPTANCE_UNAVAILABLE'); assert.equal(bad.stdout,'');
});
test('read-only verifier refuses missing/forged evidence, writable files and symlinks without altering artifacts',async()=>{
  await mkdir(join(root,'.local'),{recursive:true,mode:0o700});
  const p=await mkdtemp(join(root,'.local/graph-final-test-'));
  try {
    await assert.rejects(runGraphAcceptance(p));
    await assert.rejects(verifyGraphAcceptance(p));
    const file=join(p,'acceptance.json'); await writeFile(file,JSON.stringify({status:'matched',cleanup:'confirmed',production_ready:false}),{mode:0o400});
    const before=await readFile(file),s=await stat(file);
    await assert.rejects(verifyGraphAcceptance(p));
    assert.deepEqual(await readFile(file),before); const after=await stat(file); assert.equal(after.ino,s.ino); assert.equal(after.mtimeMs,s.mtimeMs);
    await chmod(file,0o600); await assert.rejects(verifyGraphAcceptance(p));
    await symlink(p,join(p,'link')); await assert.rejects(verifyGraphAcceptance(join(p,'link')));
  } finally { await rm(p,{recursive:true,force:true}); }
});
test('parent-host native final CLI then separate fresh read-only verification',{skip:process.env.LMPS_GRAPH_PARENT_NATIVE!=='1',timeout:240000},()=>{
  const output=join(root,'.local',`graph-final-${process.pid}-${Date.now()}`);
  for(const mode of ['--output','--verify']) {
    const p=spawnSync(process.execPath,[script,mode,output],{encoding:'utf8',timeout:190000,maxBuffer:65536});
    assert.ifError(p.error); assert.equal(p.status,0,p.stderr); assert.equal(p.stdout+p.stderr,'');
  }
});
