import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, chmod, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { QA_SAMPLING_BOUNDARY as boundary, QA_SAMPLING_VERSION as version, isQaSamplingResult, MAX_QA_POOL_BYTES } from '@lmps/contracts/qa-sampling';
import { sampleQa } from '../dist/qa-sampling.js';

const root = resolve(import.meta.dirname, '../../..');
const time = '2026-10-25T00:00:00.000Z';
function inputs() {
  return [
    { ...boundary, workspace_id: 'synthetic_workspace', client_id: 'synthetic_client' },
    { ...boundary, contract_version: version, pool_id: 'synthetic_pool', row_count: 4,
      rows: Array.from({ length: 4 }, (_, i) => ({ fixture_id: `synthetic_row_${i}`,
        stratum_id: i < 2 ? 'synthetic_alert' : 'synthetic_non_alert', alert_status: i < 2 ? 'alert' : 'non_alert',
        evidence: [{ evidence_id: `synthetic_e_${i}`, available_at: i === 3 ? '2026-10-25T00:00:00.001Z' : time }] })) },
    { ...boundary, contract_version: version, policy_id: 'synthetic_policy', policy_version: 'synthetic_v1', seed: 'synthetic_seed', as_of: time,
      strata: [{ stratum_id: 'synthetic_alert', alert_status: 'alert', requested_count: 1 },
        { stratum_id: 'synthetic_non_alert', alert_status: 'non_alert', requested_count: 2 },
        { stratum_id: 'synthetic_missing', alert_status: 'alert', requested_count: 1 }] },
  ];
}
// Regression tripwire for network/listener and external-process effects in the CLI.
// This does not replace the independent host source/security guards.
const guard = 'data:text/javascript,' + encodeURIComponent(`
  import net from 'node:net'; import http from 'node:http'; import https from 'node:https';
  import dgram from 'node:dgram'; import cp from 'node:child_process';
  import { syncBuiltinESMExports } from 'node:module';
  const deny = () => { throw new Error('acceptance effect denied'); };
  net.Socket.prototype.connect = deny; net.Server.prototype.listen = deny;
  http.request = http.get = https.request = https.get = deny;
  dgram.createSocket = deny; globalThis.fetch = deny;
  for (const key of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork']) cp[key] = deny;
  syncBuiltinESMExports();
`);
async function setup(t) {
  const dir = await mkdtemp(join(root, '.qa-acceptance-'));
  await chmod(dir, 0o700);
  t.after(() => rm(dir, { recursive: true, force: true }));
  const args = ['caller', 'pool', 'policy'].map(n => join(dir, n + '.json'));
  args.push(join(dir, 'reports'));
  const save = async values => { for (let i = 0; i < 3; i++) await writeFile(args[i], JSON.stringify(values[i]), { mode: 0o600 }); };
  const run = () => spawnSync(process.execPath, ['--import', guard, join(root, 'apps/risk-workers/scripts/qa-sampling.mjs'), ...args], { cwd: dir, encoding: 'utf8', timeout: 20000 });
  return { dir, args, save, run };
}
function failed(r) {
  assert.equal(r.status, 1); assert.equal(r.stdout, ''); assert.equal(r.stderr, '{"status":"failed"}\n');
}
async function reports(f) {
  const base = join(f.args[3], 'v1');
  return Promise.all((await readdir(base)).map(async id => {
    const path = join(base, id, 'report.json'); return { path, bytes: await readFile(path) };
  }));
}

test('contracts through guarded private CLI preserve strata, fractions, retries and caller isolation', async t => {
  const f = await setup(t), values = inputs(), before = structuredClone(values);
  const expected = sampleQa(...values);
  assert.deepEqual(values, before);
  await f.save(values);
  const first = f.run();
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.stdout, '{"status":"reported","row_count":4,"selected_count":2}\n');
  assert.equal(first.stderr, '');
  const [saved] = await reports(f), result = JSON.parse(saved.bytes);
  assert.equal(isQaSamplingResult(result), true); assert.deepEqual(result, expected);
  assert.deepEqual(result.strata.map(s => [s.status, s.fraction, s.excluded_future_evidence_count]), [
    ['satisfied', { numerator: 1, denominator: 2 }, 0],
    ['missing', { numerator: 0, denominator: 0 }, 0],
    ['insufficient', { numerator: 1, denominator: 2 }, 1],
  ]);
  assert.equal(result.population_claims, false); assert.equal(result.production_ready, false);
  const forbidden = /^(label|labels|negative|outcome|sample_weight|training_eligible|training|accuracy|representative_population)$/;
  function noClaims(v) { if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { assert.equal(forbidden.test(k), false, k); noClaims(x); } }
  noClaims(result);
  values[1].rows.reverse(); values[2].strata.reverse();
  await f.save(values);
  assert.equal(f.run().stdout, '{"status":"acknowledged","row_count":4,"selected_count":2}\n');
  assert.deepEqual((await reports(f))[0].bytes, saved.bytes);
  values[2].seed = 'synthetic_changed'; await f.save(values); failed(f.run());
  assert.deepEqual((await reports(f))[0].bytes, saved.bytes);
  values[0].client_id = 'synthetic_other'; await f.save(values);
  assert.equal(f.run().status, 0); assert.equal((await reports(f)).length, 2);
  const other = (await reports(f)).map(r => JSON.parse(r.bytes)).find(r => r.caller.client_id === 'synthetic_other');
  assert.deepEqual(other, sampleQa(...values));
  assert.deepEqual((await readdir(f.dir)).sort(), ['caller.json', 'policy.json', 'pool.json', 'reports']);
});

test('invalid caller/time/duplicate/caps and unavailable files fail without publication', async t => {
  const f = await setup(t);
  for (const mutate of [
    v => { v[0].client_id = 'real_client'; },
    v => { v[0].training_eligible = true; },
    v => { v[2].as_of = '2026-02-30T00:00:00.000Z'; },
    v => { v[1].rows[1].fixture_id = v[1].rows[0].fixture_id; },
    v => { v[1].rows[0].alert_status = 'non_alert'; },
    v => { v[2].strata[0].requested_count = 1001; },
    v => { v[1].rows = Array.from({ length: 10001 }, (_, i) => ({ ...v[1].rows[0], fixture_id: `synthetic_${i}` })); v[1].row_count = 10001; },
  ]) {
    const v = inputs(); mutate(v); await f.save(v); failed(f.run());
    await assert.rejects(readdir(f.args[3]), { code: 'ENOENT' });
  }
  await f.save(inputs());
  await writeFile(f.args[1], Buffer.alloc(MAX_QA_POOL_BYTES + 1, 32)); failed(f.run());
  await f.save(inputs()); await rm(f.args[1]); failed(f.run());
  await assert.rejects(readdir(f.args[3]), { code: 'ENOENT' });
});

test('exact 10000-row / 1000-selection caps and all-future evidence remain explicit end to end', async t => {
  const f = await setup(t), v = inputs();
  v[1].rows = Array.from({ length: 10000 }, (_, i) => ({ ...v[1].rows[0], fixture_id: `synthetic_${i}` }));
  v[1].row_count = 10000;
  v[2].strata = [{ ...v[2].strata[0], requested_count: 1000 }];
  await f.save(v); assert.equal(f.run().status, 0);
  const result = JSON.parse((await reports(f))[0].bytes);
  assert.equal(result.selected_count, 1000);
  assert.equal(new Set(result.strata[0].selected.map(r => r.fixture_id)).size, 1000);
  assert.deepEqual(result.strata[0].fraction, { numerator: 1000, denominator: 10000 });
  const future = inputs(); future[1].pool_id = 'synthetic_future';
  future[2].as_of = '2026-10-24T00:00:00.000Z';
  await f.save(future); assert.equal(f.run().status, 0);
  const unavailable = (await reports(f)).map(r => JSON.parse(r.bytes)).find(r => r.pool_id === 'synthetic_future');
  assert.equal(unavailable.selected_count, 0);
  assert.equal(unavailable.strata.reduce((n, s) => n + s.excluded_future_evidence_count, 0), 4);
});
