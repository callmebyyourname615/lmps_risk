import assert from 'node:assert/strict';
import {test} from 'node:test';
import {evaluateSourceReadiness as evaluate,pendingSourceReadiness as pending} from './source-readiness.mjs';
import {mkdtemp,writeFile,symlink,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
test('missing owner inputs block connection and shadow; even complete declarations require independent review',()=>{
  const input=pending();assert.equal(evaluate(input).pending.length,9);
  for(const gate of Object.values(input.gates))Object.assign(gate,{status:'attested',owner_ref:'synthetic_owner',evidence_sha256:'a'.repeat(64)});
  const result=evaluate(input);assert.equal(result.status,'owner_review_required');assert.equal(result.connection_authorized,false);assert.equal(result.shadow_authorized,false);assert.equal(result.production_ready,false);
});
test('missing evidence, extra inputs and getters cannot claim readiness or expose values',()=>{
  const input=pending();input.gates.release.status='attested';assert.throws(()=>evaluate(input),/SOURCE_READINESS_INVALID/);
  const extra=pending();extra.credentials='synthetic_canary';assert.throws(()=>evaluate(extra),/SOURCE_READINESS_INVALID/);
  let called=false;const getter=pending();Object.defineProperty(getter,'gates',{enumerable:true,get(){called=true;return {};}});assert.throws(()=>evaluate(getter));assert.equal(called,false);
});
test('CLI reads private bounded inputs and rejects links/public files with fixed diagnostics',async()=>{
  const directory=await mkdtemp('/tmp/lmps-readiness-');
  try{
    const input=join(directory,'input.json'),link=join(directory,'link.json');
    const run=path=>spawnSync(process.execPath,['tools/source-readiness.mjs','--input',path],{encoding:'utf8'});
    await writeFile(input,JSON.stringify(pending()),{mode:0o600});assert.equal(JSON.parse(run(input).stdout).connection_authorized,false);
    await symlink(input,link);assert.equal(run(link).status,1);assert.equal(run(link).stderr.trim(),'SOURCE_READINESS_INVALID');
    const publicFile=join(directory,'public.json');await writeFile(publicFile,JSON.stringify(pending()),{mode:0o644});assert.equal(run(publicFile).status,1);
  }finally{await rm(directory,{recursive:true,force:true});}
});
