/** Parent-host only: invokes the actual default runner, never a report seam. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, rmSync } from 'node:fs';
import { verifyFeatureCacheAcceptance } from '../../risk-workers/scripts/feature-cache-acceptance.mjs';
test('native installed Redis and authenticated Nest HTTP acceptance', { timeout:180000 },async()=>{
 // A fresh checkout has no ignored .local parent; the runner validates its ownership and permissions.
 mkdirSync(resolve(fileURLToPath(new URL('../../../',import.meta.url)),'.local'),{recursive:true,mode:0o700});
 const output=resolve(fileURLToPath(new URL('../../../',import.meta.url)),'.local/feature-native-'+randomUUID());
 const script=fileURLToPath(new URL('../../risk-workers/scripts/feature-cache-acceptance.mjs',import.meta.url));
 try {
  const child=await promisify(execFile)(process.execPath,[script,'--output',output],{timeout:175000,maxBuffer:4096,env:{PATH:process.env.PATH}});
  assert.equal(child.stderr,'');assert.equal(child.stdout,'Local synthetic acceptance verified; production_ready=false.\n');
  const result=await verifyFeatureCacheAcceptance(output);assert.equal(result.native_acceptance,true);assert.equal(result.cleanup_verified,true);assert.equal(result.production_ready,false);
 } finally {rmSync(output,{recursive:true,force:true});}
});
