import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, chmod, link, symlink, mkdir, readdir, rm } from 'node:fs/promises';
import { spawnSync, spawn } from 'node:child_process';
import { resolve, join } from 'node:path';
import { QA_SAMPLING_BOUNDARY as boundary, QA_SAMPLING_VERSION as version, MAX_QA_POOL_BYTES } from '@lmps/contracts/qa-sampling';

const root = resolve(import.meta.dirname, '../../..');
const cli = join(root, 'apps/risk-workers/scripts/qa-sampling.mjs');
const failure = '{"status":"failed"}\n';
async function fixture(t) {
  const dir = await mkdtemp(join(root, '.qa-cli-test-'));
  await chmod(dir, 0o700);
  t.after(() => rm(dir, { recursive: true, force: true }));
  const caller = { ...boundary, workspace_id: 'synthetic_private_workspace', client_id: 'synthetic_private_client' };
  const pool = { ...boundary, contract_version: version, pool_id: 'synthetic_private_pool', row_count: 1,
    rows: [{ fixture_id: 'synthetic_secret_row', stratum_id: 'synthetic_stratum', alert_status: 'non_alert',
      evidence: [{ evidence_id: 'synthetic_evidence', available_at: '2026-01-01T00:00:00.000Z' }] }] };
  const policy = { ...boundary, contract_version: version, policy_id: 'synthetic_private_policy', policy_version: 'synthetic_v1',
    seed: 'synthetic_seed', as_of: '2026-01-02T00:00:00.000Z', strata: [{ stratum_id: 'synthetic_stratum', alert_status: 'non_alert', requested_count: 1 }] };
  const args = ['caller', 'pool', 'policy'].map(name => join(dir, name + '.json'));
  for (const [i, value] of [caller, pool, policy].entries()) await writeFile(args[i], JSON.stringify(value), { mode: 0o600 });
  args.push(join(dir, 'reports'));
  return { dir, args, policy };
}
const run = args => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', timeout: 20000 });
function failed(result) { assert.equal(result.status, 1); assert.equal(result.stdout, ''); assert.equal(result.stderr, failure); }
async function reportPath(args) { const versions = join(args[3], 'v1'); return join(versions, (await readdir(versions))[0], 'report.json'); }

test('actual worker and root CLI publish, acknowledge retry and reject changed run', async t => {
  const f = await fixture(t);
  const first = run(f.args);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.stdout, '{"status":"reported","row_count":1,"selected_count":1}\n');
  const path = await reportPath(f.args), original = await readFile(path);
  const retry = spawnSync('pnpm', ['risk:sample-qa', ...f.args], { cwd: root, encoding: 'utf8', timeout: 120000 });
  assert.equal(retry.status, 0, retry.stderr);
  assert.match(retry.stdout, /\{"status":"acknowledged","row_count":1,"selected_count":1\}/);
  assert.ok(!retry.stdout.includes('synthetic_'));
  f.policy.seed = 'synthetic_changed';
  await writeFile(f.args[2], JSON.stringify(f.policy));
  failed(run(f.args));
  assert.deepEqual(await readFile(path), original);
});

test('private input rejection is count/status only', async t => {
  const f = await fixture(t), path = f.args[0], original = await readFile(path);
  failed(run([]));
  await chmod(path, 0o644); failed(run(f.args)); await chmod(path, 0o600);
  await link(path, join(f.dir, 'hard')); failed(run(f.args)); await rm(join(f.dir, 'hard'));
  await rm(path); await symlink(f.args[1], path); failed(run(f.args)); await rm(path);
  await writeFile(path, Buffer.from([0xff]), { mode: 0o600 }); failed(run(f.args));
  await writeFile(path, Buffer.alloc(MAX_QA_POOL_BYTES + 1, 32)); failed(run(f.args));
  await rm(path);
  const fifo = spawnSync('mkfifo', ['-m', '600', path]); assert.equal(fifo.status, 0);
  failed(run(f.args)); await rm(path);
  await writeFile(path, original, { mode: 0o600 });
  await chmod(f.dir, 0o755); failed(run(f.args)); await chmod(f.dir, 0o700);
});

test('partial and concurrent publication never replace existing data', async t => {
  const f = await fixture(t);
  const concurrent = () => new Promise(resolveResult => {
    const child = spawn(process.execPath, [cli, ...f.args], { cwd: root });
    let stdout = '', stderr = '';
    child.stdout.on('data', b => stdout += b); child.stderr.on('data', b => stderr += b);
    child.on('close', status => resolveResult({ status, stdout, stderr }));
  });
  const results = await Promise.all([concurrent(), concurrent()]);
  assert.equal(results.filter(r => r.stdout.includes('"reported"')).length, 1);
  for (const r of results) if (r.status !== 0) failed(r);
  const path = await reportPath(f.args), original = await readFile(path);
  assert.equal(run(f.args).status, 0);
  assert.deepEqual(await readFile(path), original);
  await rm(path);
  await writeFile(join(resolve(path, '..'), 'pending-report.json'), 'unrelated', { mode: 0o600 });
  failed(run(f.args));
  assert.equal(await readFile(join(resolve(path, '..'), 'pending-report.json'), 'utf8'), 'unrelated');
  await assert.rejects(readFile(path));
  await mkdir(path, { mode: 0o700 }); failed(run(f.args));
});
