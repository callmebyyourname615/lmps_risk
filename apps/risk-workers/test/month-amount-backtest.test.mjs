import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, realpath, chmod, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runMonthReadiness } from '../scripts/month-readiness.mjs';
import { runAmountBacktest } from '../scripts/month-amount-backtest.mjs';

const execute = promisify(execFile);
const columns = 'id requesttime txtime reference frommember tomember totype amount ccy result responsetime txtype originalreference shouldrevert isreconciled issettled settletime qrtype fromchannel fromaccount toaccount fee'.split(' ');
const encode = v => v === null ? '\\N' : String(v).replaceAll('\\', '\\\\').replaceAll('\t', '\\t').replaceAll('\n', '\\n').replaceAll('\r', '\\r').replaceAll('\0', '\\0');

test('real TS/Python backtest agrees at monetary boundaries, keeps OK/refund/DRS separate and replays private traces', async () => {
  const path = await realpath(await mkdtemp(join(tmpdir(), 'lmps-amount-test-')));
  try {
    await chmod(path, 0o700);
    const input = join(path, 'source.tsv.gz'), planPath = join(path, 'plan.json'), output = join(path, 'backtest');
    const amounts = ['19999999.99', '20000000.00', '50000000.00', '100000000.00', '180000000.00', '200000000.00', '200000000.01', '300000000.00'];
    const rows = amounts.map((amount, i) => ({
      ...Object.fromEntries(columns.map(c => [c, null])), id: String(i + 1), requesttime: '2026-10-01 00:00:00', txtime: '2026-10-01 00:00:01',
      reference: 'PRIVATE_REFERENCE_NEW', originalreference: 'PRIVATE_REFERENCE_OLD', frommember: 'SYN_A', tomember: 'SYN_B', totype: 'SYN_TYPE',
      amount, ccy: i === 7 ? 'THB' : 'LAK', result: i === 2 ? 'SYN_ERROR' : i === 3 ? null : 'OK',
      shouldrevert: i === 0 ? '0' : '1', isreconciled: '0', issettled: '0', fromaccount: 'PRIVATE_MASK_FROM', toaccount: 'PRIVATE_MASK_TO',
    }));
    const source = gzipSync(columns.join('\t') + '\n' + rows.map(r => columns.map(c => encode(r[c])).join('\t') + '\n').join(''));
    await writeFile(input, source, { mode: 0o600 });
    const plan = { format: 'lmps-month-profile-1', month: '2026-10', amount_screens: [],
      files: [{ path: input, table: 'transfer', encoding: 'export_tsv_gzip', sha256: createHash('sha256').update(source).digest('hex'), expected_rows: rows.length }] };
    await writeFile(planPath, JSON.stringify(plan), { mode: 0o600 });
    const profiled = await runMonthReadiness({ planPath, output: join(path, 'profile') });
    const profilePath = join(path, 'profile/v1', profiled.analysis_id, 'report.json');
    const result = await runAmountBacktest({ planPath, profilePath, output });
    assert.equal(result.status, 'backtested');
    const directory = join(output, 'v1', result.analysis_id);
    const reportBytes = await readFile(join(directory, 'report.json')), traceBytes = await readFile(join(directory, 'traces.json'));
    const report = JSON.parse(reportBytes);
    assert.equal(report.observed_rows, 8);
    assert.equal(report.bands.near_cap.rows, 2);
    assert.equal(report.bands.above_cap.rows, 1);
    assert.equal(report.bands.currency_out_of_scope.rows, 1);
    assert.equal(report.bands.near_cap.success_refund_joint['succeeded:required'], 2);
    assert.equal(report.thresholds['20000000.00'].within_cap_gte, 5);
    assert.equal(report.thresholds['20000000.00'].all_recorded_gte, 6);
    assert.equal(report.thresholds['180000000.00'].within_cap_gte, 2);
    assert.equal(report.trace_verification.status, 'passed');
    assert.equal(report.trace_verification.rows, JSON.parse(traceBytes).length);
    assert.ok(report.parity_cases >= 54);
    assert.ok(report.core_pattern_results.every(p => p.matched_count === null));
    for (const marker of ['PRIVATE_REFERENCE', 'PRIVATE_MASK_FROM', 'PRIVATE_MASK_TO', 'SYN_ERROR', input]) {
      assert.equal(reportBytes.includes(Buffer.from(marker)), false);
      assert.equal(traceBytes.includes(Buffer.from(marker)), false);
    }
    assert.equal((await runAmountBacktest({ planPath, profilePath, output })).status, 'duplicate');
    assert.deepEqual(await readFile(join(directory, 'report.json')), reportBytes);
    const cli = new URL('../scripts/month-amount-backtest.mjs', import.meta.url).pathname;
    const cliResult = await execute(process.execPath, [cli, '--plan', planPath, '--profile', profilePath, '--output', output]);
    assert.equal(JSON.parse(cliResult.stdout).status, 'duplicate');
    assert.equal(cliResult.stderr, '');
    const denied = await execute(process.execPath, [cli, '--plan', planPath, '--profile', profilePath, '--output', output], {
      env: { ...process.env, LMPS_ENVIRONMENT: 'production' },
    }).then(() => null, e => e);
    assert.equal(denied.stderr.trim(), 'AMOUNT_BACKTEST_FAILED; private diagnostics withheld.');
    await assert.rejects(runAmountBacktest({ planPath, profilePath, output: input }));
    await writeFile(input, Buffer.concat([source, Buffer.from('CHANGED')]));
    await assert.rejects(runAmountBacktest({ planPath, profilePath, output }));
    assert.deepEqual(await readFile(join(directory, 'report.json')), reportBytes);
    assert.ok(!(await readdir(path)).some(n => n.startsWith('.amount-backtest-')));
  } finally { await rm(path, { recursive: true, force: true }); }
});
