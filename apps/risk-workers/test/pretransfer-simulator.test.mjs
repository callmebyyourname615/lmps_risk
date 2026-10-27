import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, rm, chmod, symlink, link, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { SIMULATION_BOUNDARY as boundary, PRETRANSFER_SIMULATION_VERSION } from '@lmps/contracts/pretransfer-simulation';
import { riskHash } from '@lmps/risk';
import { simulatePretransfer } from '../dist/pretransfer-simulator.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const worker = join(root, 'apps/risk-workers');
const caller = { ...boundary, workspace_id: 'synthetic_workspace', client_id: 'synthetic_client' };
const request = { ...boundary, namespace: 'synthetic_fixture', payment_id: 'synthetic_payment', attempt_id: 'synthetic_attempt',
  idempotency_key: 'synthetic_key', sender: 'synthetic_sender', receiver: 'synthetic_receiver', amount: '12.34',
  currency: 'USD', product: 'synthetic_product', expires_at: '2026-01-01T00:01:00.000Z' };
const reference = `synthetic_${riskHash({ contract_version: PRETRANSFER_SIMULATION_VERSION, binding: { ...boundary, caller, request } })}`;
const scenario = { ...boundary, contract_version: PRETRANSFER_SIMULATION_VERSION, scenario_id: 'synthetic_scenario', run_id: 'synthetic_run',
  now: '2026-01-01T00:00:00.000Z', capacities: [{ ...boundary, caller, namespace: request.namespace, sender: request.sender,
    currency: 'USD', max_in_flight_count: 1, max_in_flight_amount: '99.00' }], commands: [
    { kind: 'request', request }, { kind: 'request', request },
    { kind: 'request', request: { ...request, amount: '13.00' } },
    { kind: 'lookup', reference, binding: { ...boundary, caller, request } },
    { kind: 'outcome', outcome: { ...boundary, reference, outcome: 'executed' } },
    { kind: 'outcome', outcome: { ...boundary, reference, outcome: 'executed' } }] };

test('replay uses binding, retry and outcome libraries with deterministic count-only results', async () => {
  const a = await simulatePretransfer(scenario, caller, 'a'.repeat(64));
  assert.deepEqual(a, await simulatePretransfer(scenario, caller, 'a'.repeat(64)));
  assert.deepEqual(a.counts, { commands: 6, clock_advances: 0, unique_reservations: 1, pending: 0, executed: 1, released: 0 });
  assert.equal(a.reasons.IDEMPOTENCY_CONFLICT, 1);
  assert.equal(a.reasons.REFERENCE_VALID, 1);
  assert.equal(a.contract_version, PRETRANSFER_SIMULATION_VERSION);
  assert.equal(a.scenario_version, riskHash(scenario));
  assert.equal(a.config_version, riskHash({ caller, capacities: scenario.capacities }));
  assert.equal(a.code_version, 'a'.repeat(64));
  assert.notDeepEqual(a, await simulatePretransfer(scenario, caller, 'b'.repeat(64)));
  const expiry = await simulatePretransfer({ ...scenario, commands: [scenario.commands[0], { kind: 'advance_clock', now: request.expires_at }] }, caller, 'a'.repeat(64));
  assert.equal(expiry.counts.released, 1);
  for (const secret of [request.sender, request.receiver, request.amount, reference]) assert.ok(!JSON.stringify(a).includes(secret));
  await assert.rejects(simulatePretransfer({ ...scenario, source_export: {} }, caller, 'a'.repeat(64)));
  for (const invalid of [
    { ...scenario, commands: Array(201).fill(scenario.commands[0]) },
    { ...scenario, commands: [{ kind: 'request', request: { ...request, amount: 12.34 } }] },
    { ...scenario, commands: [{ kind: 'request', request: { ...request, sender: 'real_party' } }] },
    { ...scenario, commands: [{ kind: 'advance_clock', now: scenario.now }] },
    { ...scenario, caller },
  ]) await assert.rejects(simulatePretransfer(invalid, caller, 'a'.repeat(64)), /SIMULATION_INVALID_INPUT/);
});

test('terminal outcomes and clock expiry preserve reservation accounting', async () => {
  for (const outcome of ['executed', 'failed', 'cancelled']) {
    const result = await simulatePretransfer({ ...scenario, commands: [
      scenario.commands[0],
      { kind: 'outcome', outcome: { ...boundary, reference, outcome } },
      { kind: 'outcome', outcome: { ...boundary, reference, outcome } },
      { kind: 'outcome', outcome: { ...boundary, reference, outcome: outcome === 'executed' ? 'failed' : 'executed' } },
      { kind: 'advance_clock', now: request.expires_at },
    ] }, caller, 'a'.repeat(64));
    assert.deepEqual(result.counts, { commands: 5, clock_advances: 1, unique_reservations: 1,
      pending: 0, executed: outcome === 'executed' ? 1 : 0, released: outcome === 'executed' ? 0 : 1 });
    assert.equal(result.reasons.OUTCOME_RECORDED, 2);
    assert.equal(result.reasons.OUTCOME_CONFLICT, 1);
  }
  const expired = await simulatePretransfer({ ...scenario, commands: [scenario.commands[0],
    { kind: 'advance_clock', now: request.expires_at }, scenario.commands[3], scenario.commands[4],
  ] }, caller, 'a'.repeat(64));
  assert.equal(expired.counts.released, 1);
  assert.equal(expired.reasons.REFERENCE_UNAVAILABLE, 1);
  assert.equal(expired.reasons.OUTCOME_CONFLICT, 1);
});

test('actual root command and worker CLI: private immutable reports and safe failures', async () => {
  const base = await mkdtemp(join(root, '.simulation-test-'));
  await chmod(base, 0o700);
  const input = join(base, 'scenario.json'), context = join(base, 'caller.json'), output = join(base, 'reports');
  const write = (path, value) => writeFile(path, JSON.stringify(value), { mode: 0o600 });
  const run = (cwd = worker, path = input) => spawnSync(process.execPath,
    [join(worker, 'scripts/pretransfer-simulate.mjs'), path, context, output], { cwd, encoding: 'utf8', timeout: 30000 });
  try {
    await write(input, scenario); await write(context, caller);
    const first = spawnSync('pnpm', ['risk:simulate-pretransfer', input, context, output], { cwd: root, encoding: 'utf8' });
    assert.equal(first.status, 0, first.stderr);
    const id = (await readdir(join(output, 'v1')))[0];
    const report = join(output, 'v1', id, 'report.json');
    const original = await readFile(report, 'utf8');
    const retry = run(); assert.equal(retry.status, 0, retry.stderr);
    assert.deepEqual(JSON.parse(retry.stdout), { status: 'reported', ...JSON.parse(original).counts });
    assert.equal(retry.stderr, '');
    assert.equal(await readFile(report, 'utf8'), original);
    const documentedWorker = spawnSync('pnpm', ['exec', 'node', 'scripts/pretransfer-simulate.mjs', input, context, output],
      { cwd: worker, encoding: 'utf8' });
    assert.equal(documentedWorker.status, 0, documentedWorker.stderr);
    assert.equal(run(root).status, 0);
    await write(input, { ...scenario, scenario_id: 'synthetic_changed' });
    const conflict = run(); assert.equal(conflict.status, 1);
    assert.equal(await readFile(report, 'utf8'), original);
    await write(input, { ...scenario, capacities: [{ ...scenario.capacities[0], max_in_flight_count: 2 }] });
    assert.equal(run().status, 1);
    assert.equal(await readFile(report, 'utf8'), original);
    const deny = () => { const result = run(); assert.equal(result.status, 1); assert.equal(result.stdout, ''); assert.equal(result.stderr.trim(), 'SIMULATION_FAILED; private input/storage diagnostics withheld.'); };
    await write(context, { ...caller, ['sec' + 'ret']: 'PRIVATE_SENTINEL' }); deny();
    await writeFile(context, ' '.repeat(65537), { mode: 0o600 }); deny();
    await write(context, caller);
    await write(input, { source_export: 'PRIVATE_SENTINEL', parties: [request.sender] }); deny();
    await writeFile(input, ' '.repeat(65537), { mode: 0o600 }); deny();
    await writeFile(input, '{PRIVATE_SENTINEL', { mode: 0o600 }); deny();
    await write(input, scenario); await chmod(input, 0o644); deny(); await chmod(input, 0o600);
    const hard = join(base, 'hard'); await link(input, hard); deny(); await rm(hard);
    await rm(input); await symlink(context, input); deny(); await rm(input);
    await mkdir(input); deny(); await rm(input, { recursive: true });
    const fifo = spawnSync('mkfifo', ['-m', '600', input], { encoding: 'utf8' }); assert.equal(fifo.status, 0); deny();
    for (const result of [retry, conflict]) for (const secret of [request.sender, request.receiver, request.amount, scenario.run_id]) {
      assert.ok(!(result.stdout + result.stderr).includes(secret));
    }
  } finally { await rm(base, { recursive: true, force: true }); }
});
