import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createDatabase, createTransactionRevisions } from '../dist/index.js';
import { availablePort, dsn, initializeCluster, startCluster, stopCluster } from '../scripts/local.mjs';
import { createBackup, forkBackup, verifyBackup } from '../scripts/backup.mjs';
import { migrations } from '../scripts/migrations.mjs';
import { revision } from './fixtures/transaction-revision.mjs';

test('verified database fork has new credentials, independent writes and refuses reseeding an existing cluster', async () => {
  const temporary = await mkdtemp('/tmp/lmps-intake-isolation-');
  let source, target, writer, forkWriter, sourceRead, forkRead;
  try {
    source = await initializeCluster(join(temporary,'source'),await availablePort()); await startCluster(source);
    await migrations(dsn(source,'migration'),true);
    writer = createTransactionRevisions(dsn(source,'intake')); await writer.append(revision());
    const backup = await createBackup(source,join(temporary,'backups'));
    const result = await forkBackup(backup.directory,join(temporary,'target'),await availablePort()); target=result.state;
    assert.equal(result.tables,38); assert.notEqual(source.port,target.port);
    const verified=await verifyBackup(backup.directory);
    for(const table of ['core_identity_keys','core_identity_mappings','core_detection_checkpoints'])
      assert.ok(Object.hasOwn(verified.tables,'platform.'+table));
    assert.notEqual(source.passwords.intake,target.passwords.intake);
    sourceRead=createDatabase(dsn(source)); forkRead=createDatabase(dsn(target));
    const count=async db=>(await db.pool.query('SELECT count(*)::int AS n FROM platform.local_transaction_revisions')).rows[0].n;
    assert.equal(await count(sourceRead),1);assert.equal(await count(forkRead),1);
    forkWriter=createTransactionRevisions(dsn(target,'intake'));await forkWriter.append(revision(1));
    assert.equal(await count(forkRead),2);assert.equal(await count(sourceRead),1);
    await assert.rejects(forkBackup(backup.directory,target.base,target.port));
    assert.equal(await count(forkRead),2);
    const after=await createBackup(source,join(temporary,'backups'));
    assert.deepEqual((await verifyBackup(after.directory)).tables,(await verifyBackup(backup.directory)).tables);
  } finally {
    for(const service of [writer,forkWriter,sourceRead,forkRead]) await service?.close();
    if(target)await stopCluster(target);if(source)await stopCluster(source);
    await rm(temporary,{recursive:true,force:true});
  }
});
