import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { RISK_CATALOG } from '@lmps/risk';
import { runMonthReadiness } from '../scripts/month-readiness.mjs';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../../../', import.meta.url));

test('actual private profiler binds all canonical patterns, exact retries, source bytes and withheld gates', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lmps-month-node-'));
  try {
    const { realpath } = await import('node:fs/promises');
    const path = await realpath(directory);
    await chmod(path, 0o700);
    const input = join(path, 'input.csv'), planPath = join(path, 'plan.json'), output = join(path, 'report');
    const csv = 'id,requesttime,amount,ccy,result,txtime\n1,2026-10-01 01:00:00,1200000.00,LAK,OK,2026-10-01 01:00:00\n2,2026-10-02 01:00:00,30.00,THB,PRIVATE_STATUS_CANARY,2026-10-02 01:00:00\n';
    await writeFile(input, csv, { mode: 0o600 });
    const plan = { format: 'lmps-month-profile-1', month: '2026-10', files: [{ path: input, table: 'transfer', encoding: 'csv',
      sha256: createHash('sha256').update(csv).digest('hex'), expected_rows: 2 }], amount_screens: [{ currency: 'LAK', threshold: '1000000.00' }] };
    await writeFile(planPath, JSON.stringify(plan), { mode: 0o600 });
    const result = await runMonthReadiness({ planPath, output });
    assert.equal(result.status, 'profiled');
    const reportPath = join(output, 'v1', result.analysis_id, 'report.json');
    const bytes = await readFile(reportPath), report = JSON.parse(bytes);
    assert.deepEqual(report.patterns.map(p => p.code), RISK_CATALOG.map(p => p.code));
    assert.equal(report.production_ready_patterns, 0);
    assert.equal(report.accuracy, null);
    assert.ok(report.patterns.every(p => p.readiness === 'blocked'));
    assert.equal(report.tables[0].currencies[0].amount_screens[0].counts.matched, 1);
    assert.ok(report.patterns.find(p => p.code === 'MULE_FLAGGED_NEIGHBOR').reason_codes.includes('AUTHORIZED_FLAG_REFERENCE_UNAVAILABLE'));
    assert.equal(bytes.includes(Buffer.from('PRIVATE_STATUS_CANARY')), false);
    const replay = await runMonthReadiness({ planPath, output });
    assert.equal(replay.status, 'duplicate');
    assert.deepEqual(await readFile(reportPath), bytes);
    assert.deepEqual(await readFile(input, 'utf8'), csv);
    assert.equal((await readdir(path)).some(n => n.startsWith('.month-profile-')), false);
    const cli = join(root, 'apps/risk-workers/scripts/month-readiness.mjs');
    const success = await execute(process.execPath, [cli, '--plan', planPath, '--output', output], { cwd: root });
    assert.equal(JSON.parse(success.stdout).status, 'duplicate');
    assert.equal(success.stderr, '');
    const streamed = await execute(process.execPath, [cli, '--plan', planPath, '--output', output, '--streaming'], { cwd: root });
    const streamedResult = JSON.parse(streamed.stdout);
    assert.equal(streamedResult.capacity_mode, 'streaming_single_table_v1');
    assert.equal(streamed.stderr, '');
    const streamedBytes = await readFile(join(output, 'v1', streamedResult.analysis_id, 'report.json'));
    const streamedReport = JSON.parse(streamedBytes);
    assert.deepEqual(streamedReport.tables, report.tables);
    assert.deepEqual(streamedReport.patterns, report.patterns);
    assert.equal(streamedReport.verification_passes, 2);
    assert.equal(streamedReport.accuracy, null);
    assert.equal((await runMonthReadiness({ planPath, output, streaming: true })).status, 'duplicate');
    const hourlyInput = join(path, 'hourly.csv'), hourlyPlanPath = join(path, 'hourly-plan.json');
    const hourlyCsv = csv.split('\n').slice(0, 2).join('\n') + '\n';
    await writeFile(hourlyInput, hourlyCsv, { mode: 0o600 });
    await writeFile(hourlyPlanPath, JSON.stringify({ ...plan, files: [{ ...plan.files[0], path: hourlyInput,
      sha256: createHash('sha256').update(hourlyCsv).digest('hex'), expected_rows: 1 }] }), { mode: 0o600 });
    const hourlyRun = await execute(process.execPath, [cli, '--plan', hourlyPlanPath, '--output', output, '--streaming', '--hourly'], { cwd: root });
    const hourlyResult = JSON.parse(hourlyRun.stdout);
    assert.equal(hourlyResult.capacity_mode, 'streaming_hourly_v1');
    const hourlyReport = JSON.parse(await readFile(join(output, 'v1', hourlyResult.analysis_id, 'report.json')));
    assert.equal(hourlyReport.observed_rows, 1);
    assert.equal(hourlyReport.verification_passes, 2);
    assert.equal(hourlyReport.patterns.length, 15);
    assert.equal(hourlyReport.production_ready, false);
    await assert.rejects(runMonthReadiness({ planPath: hourlyPlanPath, output, hourly: true }));
    assert.equal((await readdir(path)).some(n => n.startsWith('.month-stream-')), false);
    const denied = await execute(process.execPath, [cli, '--plan', planPath, '--output', output], {
      cwd: root, env: { ...process.env, LMPS_ENVIRONMENT: 'production' },
    }).then(() => null, error => error);
    assert.equal(denied.code, 1);
    assert.equal(denied.stderr.trim(), 'MONTH_READINESS_FAILED; private diagnostics withheld.');
    await writeFile(input, csv + '\n');
    await assert.rejects(runMonthReadiness({ planPath, output }));
    await assert.rejects(runMonthReadiness({ planPath, output, streaming: true }));
    assert.deepEqual(await readFile(reportPath), bytes);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
