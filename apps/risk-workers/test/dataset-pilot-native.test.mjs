import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createDatabase, datasetRowHash } from '@lmps/database';
import { ROOT, availablePort, dsn, initializeCluster, loadState, startCluster, stopCluster } from '../../../packages/database/scripts/local.mjs';
import { migrations } from '../../../packages/database/scripts/migrations.mjs';
import { verifyBackup } from '../../../packages/database/scripts/backup.mjs';
import { main, pilotReadiness } from '../scripts/dataset-pilot.mjs';
import { readOfflineDataset } from '../scripts/dataset-import.mjs';

const execute = promisify(execFile);
let scratch, state, owner, sequence = 0;
before(async () => {
  scratch = await mkdtemp('/tmp/lmps-pilot-pg-');
  await mkdir(join(scratch, 'backups'), { mode: 0o700 });
  state = await initializeCluster(join(scratch, 'pg'), await availablePort());
  await startCluster(state);
  await migrations(dsn(state, 'migration'), true);
  owner = createDatabase(dsn(state, 'migration'), 'migration');
});
beforeEach(async () => { await owner.pool.query('TRUNCATE platform.offline_dataset_rows, platform.offline_dataset_batches'); });
after(async () => {
  await owner?.close();
  if (!state && scratch) { try { state = await loadState(join(scratch, 'pg')); } catch { return; } }
  if (state) await stopCluster(state);
  if (scratch) await rm(scratch, { recursive: true, force: true });
});
async function bundle() {
  const path = join(scratch, 'source-' + ++sequence);
  await execute('uv', ['run', '--locked', '--offline', '--all-packages', 'python', '-B', '-c',
    `import importlib.util,sys; from pathlib import Path; p=Path('apps/risk-workers/test/test_dataset_pilot.py'); s=importlib.util.spec_from_file_location('fixture',p); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); m.write_bundle(Path(sys.argv[1]))`, path],
  { cwd: ROOT, timeout: 10000 });
  return path;
}
async function command(source, output, amount = '100.00') {
  const out = [], errors = [], info = console.info, error = console.error;
  console.info = value => out.push(value); console.error = value => errors.push(value);
  try {
    const code = await main(['--bundle', source, '--output', output, '--amount-gte', amount], state, join(scratch, 'backups'));
    return { code, stdout: out.join('\n'), stderr: errors.join('\n') };
  } finally { console.info = info; console.error = error; }
}
const count = async table => (await owner.pool.query(`SELECT count(*)::int AS n FROM platform.${table}`)).rows[0].n;

test('real PG import/reconcile/replay, lineage, restore-ready pre-backup, exact retry and canonical aliases', async () => {
  const source = await bundle(), output = join(scratch, 'run-' + ++sequence);
  const first = await command(source, output);
  assert.equal(first.code, 0, first.stderr);
  const result = JSON.parse(first.stdout);
  assert.equal(result.import_status, 'complete');
  assert.equal(result.reconciliation_status, 'matched');
  assert.equal(result.matched_rows, 3);
  assert.deepEqual(result.counts, { rows: 3, matched: 1, not_matched: 2, unavailable: 0 });
  assert.equal(result.ready_patterns, 0);
  assert.equal(result.catalog_patterns, 15);
  const backup = await verifyBackup(join(scratch, 'backups', result.backup_id));
  assert.equal(backup.tables['platform.offline_dataset_rows'].rows, 0);
  assert.equal(await count('offline_dataset_rows'), 3);
  assert.equal(await count('offline_dataset_batches'), 1);
  const input = JSON.parse(await readFile(join(output, 'adapted/input.json'), 'utf8'));
  const snapshot = await readOfflineDataset(input, join(output, 'adapted/transfer.csv'));
  const lineage = (await readFile(join(output, 'adapted/lineage.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  const saved = (await owner.pool.query('SELECT row_number,row_sha256,source_key,fields FROM platform.offline_dataset_rows ORDER BY row_number')).rows;
  for (const [i, row] of saved.entries()) {
    assert.equal(row.row_sha256, datasetRowHash(snapshot.rows[i]));
    assert.equal(row.row_sha256, lineage[i].staged_row_sha256);
    assert.deepEqual(row.source_key, lineage[i].source_key);
    assert.equal(Object.hasOwn(row.fields, 'fromaccount'), false);
    assert.equal(Object.hasOwn(row.fields, 'toaccount'), false);
  }
  const reportPath = join(output, 'replay/v1', result.run_id, 'replay.json');
  const reportBefore = await readFile(reportPath, 'utf8');
  const repeated = await command(source, output);
  assert.equal(repeated.code, 0, repeated.stderr);
  assert.equal(JSON.parse(repeated.stdout).publication, 'duplicate');
  assert.equal(JSON.parse(repeated.stdout).batch_ref, result.batch_ref);
  assert.equal(await count('offline_dataset_rows'), 3);
  assert.equal(await readFile(reportPath, 'utf8'), reportBefore);
  const backupsBefore = (await readdir(join(scratch, 'backups'))).length;
  const changed = await command(source, output, '101.00');
  assert.equal(changed.code, 1);
  assert.match(changed.stderr, /FAILED_POLICY/);
  assert.equal((await readdir(join(scratch, 'backups'))).length, backupsBefore);
  const aliasOutput = join(scratch, 'alias-' + ++sequence);
  const alias = await command(source, aliasOutput);
  assert.equal(alias.code, 0, alias.stderr);
  assert.equal(JSON.parse(alias.stdout).batch_ref, result.batch_ref);
  assert.equal(await count('offline_dataset_batches'), 1);
  for (const marker of ['SYNTHETIC_PRIVATE_ACCOUNT', 'SYNTHETIC_PRIVATE_QR', source, output]) {
    assert.equal((first.stdout + first.stderr + repeated.stdout + changed.stderr).includes(marker), false);
  }
  assert.equal(await count('local_alerts'), 0);
});

test('all catalog patterns retain explicit unavailable prerequisites rather than fabricated scores', () => {
  const readiness = pilotReadiness(3);
  assert.equal(readiness.patterns.length, 15);
  assert.equal(readiness.assessment_performed, false);
  assert.equal(readiness.enforcement, false);
  assert.ok(readiness.patterns.every(row => row.readiness === 'blocked' && row.reason_codes.includes('SOURCE_LIFECYCLE_UNVERIFIED')));
  assert.ok(readiness.patterns.find(row => row.code === 'MULE_FLAGGED_NEIGHBOR').reason_codes.includes('FLAGGED_ACCOUNTS_UNAVAILABLE'));
});

test('target corruption is blocked before a new replay can be published', async () => {
  const source = await bundle(), output = join(scratch, 'corrupt-' + ++sequence);
  const first = await command(source, output);
  assert.equal(first.code, 0, first.stderr);
  const result = JSON.parse(first.stdout);
  await owner.pool.query('UPDATE platform.offline_dataset_rows SET row_sha256=$1 WHERE row_number=1', ['0'.repeat(64)]);
  const repeated = await command(source, output);
  assert.equal(repeated.code, 1);
  assert.match(repeated.stderr, /FAILED_IMPORT/);
  const batch = (await owner.pool.query('SELECT status FROM platform.offline_dataset_batches WHERE batch_ref=$1', [result.batch_ref])).rows[0];
  assert.equal(batch.status, 'blocked');
  assert.equal(await count('offline_dataset_rows'), 3);
});

test('mode/threshold/source failures happen before backup or database mutation', async () => {
  const source = await bundle(), output = join(scratch, 'reject-' + ++sequence);
  const before = (await readdir(join(scratch, 'backups'))).length;
  const invalid = await command(source, output, '0.00');
  assert.equal(invalid.code, 1);
  const prior = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    assert.equal((await command(source, output)).code, 1);
  } finally { if (prior === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prior; }
  assert.equal((await readdir(join(scratch, 'backups'))).length, before);
  assert.equal(await count('offline_dataset_rows'), 0);
});
