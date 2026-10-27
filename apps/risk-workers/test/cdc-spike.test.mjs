import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSpike, parseArgs, validateOptions, decodeCapture, footprint } from '../scripts/cdc-spike.mjs';
import { LIMITS } from '../scripts/cdc-oracle.mjs';

// Deliberately distinct fixture literals; no native tools/ports/temp directories.
function capture(count) {
  const rows = [
    { id: 1, revision: 1, amount: '9007199254740993.1200', currency: 'XTS' },
    { id: 2, revision: 1, amount: '0.0100', currency: 'XTS' },
    { id: 3, revision: 1, amount: '12.3400', currency: 'XTS' },
    { id: 1, revision: 2, amount: '9007199254740993.1201', currency: 'XTS' },
    { id: 3, revision: 2, amount: '12.3401', currency: 'XTS' },
    { id: 4, revision: 1, amount: '1.0000', currency: 'XTS' }
  ];
  const events = [['r', null, rows[0]], ['r', null, rows[1]], ['c', null, rows[2]], ['u', rows[0], rows[3]], ['d', rows[1], null], ['t', rows[1], null], ['u', rows[2], rows[4]], ['c', null, rows[5]]];
  return events.slice(0, count).map(([op, before, after], offset) => {
    const key = { id: (after ?? before).id };
    const value = op === 't' ? null : { op, before, after, source: { connector: 'mariadb', name: 'lmps_cdc', db: 'lmps_cdc_invented', table: 'specimens', snapshot: offset === 0 ? 'true' : offset === 1 ? 'last' : 'false', file: 'local-bin.000001', pos: 100 + offset, row: 0 } };
    return `Partition:0\tOffset:${offset}\t${JSON.stringify(key)}\t${JSON.stringify(value)}\n`;
  }).join('');
}
function fake(overrides = {}) {
  const calls = [], writes = new Map(); let reads = 0;
  const runtime = { base: '/private/tmp/lmps-cdc-unit', schemaHistoryTopic: 'history',
    startKafka: async () => { calls.push('broker-start'); }, stopConnect: async () => { calls.push('connect-stop'); }, stopKafka: async () => { calls.push('broker-stop'); },
    startConnect: async settings => { calls.push(settings); },
    cli: async (tool, opts) => { calls.push(tool); assert.ok(opts.maxMessages === undefined || opts.maxMessages === 2000); return tool === 'consume' ? capture([2, 6, 8, 8][reads++]) : ''; },
    stop: async () => { calls.push('runtime-stop'); }, dispose: async () => { calls.push('dispose'); }
  };
  const settings = { identity: 'stable' };
  const fixture = { initialize: async () => { calls.push('init'); }, stream: async () => { calls.push('stream'); }, paused: async () => { calls.push('paused'); }, settings: () => settings, stop: async () => { calls.push('fixture-stop'); } };
  const deps = { output: async () => '/private/unit', statfs: async () => ({ bavail: LIMITS.free, bsize: 1 }), verify: async () => ({ java: '/pinned/java' }), runtime: async () => runtime, reader: async () => async () => capture([2, 6, 8, 8][reads++]), fixture: async () => fixture, footprint: async () => 0, handles: () => [], write: async (path, value) => { writes.set(path, JSON.parse(value)); }, now: () => 1000, mkdtemp: async () => '/private/tmp/lmps-cdc-fixture-unit', chmod: async () => {}, rm: async () => { calls.push('remove-fixture'); }, ...overrides };
  return { deps, runtime, fixture, calls, writes, settings };
}
test('CLI is finite and rejects unknown options and paths before native access', async () => {
  assert.deepEqual(parseArgs(['run']), {});
  for (const args of [[], ['status'], ['run', '--host', 'external'], ['run', '--output'], ['run', '--output', '/tmp/other'], ['run', '--output', '.local/../other'], ['run', '--output', '.local/x\nsecret']]) assert.throws(() => parseArgs(args));
  assert.throws(() => validateOptions({ source: 'anything' }));
  await assert.rejects(runSpike({ native: true }), /CLI_INPUT/);
  const entry = new URL('../scripts/cdc-spike.mjs', import.meta.url);
  const result = spawnSync(process.execPath, [fileURLToPath(entry), 'run', '--host', 'private'], { encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 1); assert.equal(result.stdout, ''); assert.equal(result.stderr.trim(), 'CDC_SPIKE_FAILED');
  const imported = spawnSync(process.execPath, ['--input-type=module', '-e', 'await import(' + JSON.stringify(entry.href) + ')'], { encoding: 'utf8', timeout: 5000 });
  assert.equal(imported.status, 0); assert.equal(imported.stdout, ''); assert.equal(imported.stderr, '');
});
test('strict transport parsing never truncates or leaks diagnostic payload', () => {
  assert.equal(decodeCapture(capture(8)).length, 8);
  for (const text of ['', capture(2).trimEnd(), 'SECRET\n', 'Partition:0\tOffset:0\t{}\tbad\n']) assert.throws(() => decodeCapture(text));
  assert.throws(() => decodeCapture('x'.repeat(LIMITS.bytes + 1)), /CAPTURE_LIMIT/);
});
test('trusted lifecycle exercises stop/mutate/restart with identical settings, replay and teardown', async () => {
  const f = fake(); const result = await runSpike({}, f.deps);
  assert.equal(result.cleanupVerified, true); assert.equal(result.receipt.restart.records, 8); assert.equal(result.receipt.replay.observations, 16);
  assert.equal(f.calls.filter(x => x === f.settings).length, 2);
  const stop = f.calls.indexOf('broker-stop'), paused = f.calls.indexOf('paused');
  assert.ok(stop < paused && paused < f.calls.lastIndexOf('broker-start'));
  assert.ok(f.calls.indexOf('runtime-stop') < f.calls.indexOf('fixture-stop'));
  assert.ok(f.calls.indexOf('fixture-stop') < f.calls.indexOf('dispose'));
  assert.ok(f.writes.has('/private/unit/receipt.json')); assert.ok(!f.writes.has('/private/unit/acceptance.json'));
  assert.ok(!JSON.stringify(result.receipt).includes('amount'));
});
test('native unavailable, insufficient disk and invalid observations cannot publish success', async () => {
  const low = fake({ statfs: async () => ({ bavail: 0, bsize: 1 }) });
  await assert.rejects(runSpike({}, low.deps), /FREE_SPACE/); assert.equal(low.writes.size, 0);
  const unavailable = fake({ verify: async () => { throw Error('SECRET'); } });
  await assert.rejects(runSpike({}, unavailable.deps), /EXPERIMENT_FAILED/);
  assert.equal(unavailable.writes.get('/private/unit/failure.json').code, 'EXPERIMENT_FAILED');
  const bad = fake({ reader: async () => async () => capture(1) });
  await assert.rejects(runSpike({}, bad.deps), /EXPERIMENT_FAILED/);
  assert.ok(bad.calls.includes('fixture-stop')); assert.ok(!bad.calls.includes('dispose'));
  assert.ok(!bad.writes.has('/private/unit/receipt.json'));
});
test('shutdown failure preserves owned state and fixed-code private evidence', async () => {
  const f = fake(); f.runtime.stop = async () => { throw Error('SECRET'); };
  await assert.rejects(runSpike({}, f.deps), /CLEANUP_UNPROVEN/);
  assert.ok(f.calls.includes('fixture-stop')); assert.ok(!f.calls.includes('dispose'));
  assert.deepEqual(f.writes.get('/private/unit/failure.json'), { format: 1, code: 'CLEANUP_UNPROVEN', cleanupVerified: false });
  const live = fake({ handles: () => [{}] });
  await assert.rejects(runSpike({}, live.deps), /CLEANUP_UNPROVEN/);
});
test('changed durable prefix, replay data and extra records are rejected', async () => {
  for (const kind of ['prefix', 'replay', 'extra']) {
    let reads = 0;
    const f = fake({ reader: async () => async () => {
      const index = reads++, count = [2, 6, 8, 8][index];
      let text = capture(count);
      if (kind === 'prefix' && index === 2 || kind === 'replay' && index === 3) {
        // Semantically valid timestamps still change durable record content.
        text = text.replace('"op":"r"', '"ts_ms":123,"op":"r"');
      }
      if (kind === 'extra' && index === 2) text += capture(1).replace('Offset:0', 'Offset:8');
      return text;
    } });
    await assert.rejects(runSpike({}, f.deps), /EXPERIMENT_FAILED/);
    assert.ok(!f.writes.has('/private/unit/receipt.json')); assert.ok(f.calls.includes('fixture-stop'));
  }
});
test('resource/deadline failures stop and preserve evidence without retry', async () => {
  const huge = fake({ footprint: async () => LIMITS.storage + 1 });
  await assert.rejects(runSpike({}, huge.deps), /STORAGE_LIMIT/);
  let clock = 0; const slow = fake({ now: () => (clock += 160000) });
  await assert.rejects(runSpike({}, slow.deps), /TRIAL_LIMIT/);
  assert.ok(!slow.writes.has('/private/unit/receipt.json'));
});
test('workspace-only storage audit rejects symlinks and counts actual bytes', async () => {
  const base = await mkdtemp(join(process.cwd(), '.cdc-spike-unit-'));
  try {
    await mkdir(join(base, 'owned'), { mode: 0o700 }); await writeFile(join(base, 'owned/data'), 'invented', { mode: 0o600 });
    assert.ok(await footprint(base) >= 8);
    await symlink('owned/data', join(base, 'link')); await assert.rejects(footprint(base), /OWNERSHIP/);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('live storage audit tolerates only vanished descendants at each filesystem step', async () => {
  const fs = await import('node:fs/promises');
  const base = await fs.mkdtemp(join(process.cwd(), '.cdc-race-unit-'));
  try {
    for (const operation of ['lstat', 'chmod', 'readdir']) {
      const child = join(base, 'transient'); await fs.mkdir(child);
      const io = { lstat: fs.lstat, chmod: fs.chmod, readdir: fs.readdir };
      io[operation] = async (path, ...args) => {
        if (path === child) { await fs.rm(child, { recursive: true }); }
        return fs[operation](path, ...args);
      };
      await footprint(base, io);
    }
    await assert.rejects(footprint(base + '-missing'), { code: 'ENOENT' });
    // Missing root and all non-ENOENT errors fail at every filesystem step.
    for (const operation of ['lstat', 'chmod', 'readdir']) {
      for (const code of ['ENOENT', 'EACCES', 'EIO']) {
        const io = { lstat: fs.lstat, chmod: fs.chmod, readdir: fs.readdir };
        io[operation] = async (path, ...args) => {
          if (path === base) throw Object.assign(new Error('root failure'), { code });
          return fs[operation](path, ...args);
        };
        await assert.rejects(footprint(base, io), { code });
      }
    }
    await fs.mkdir(join(base, 'transient'));
    for (const operation of ['lstat', 'chmod', 'readdir']) {
      for (const code of ['EACCES', 'EIO']) {
        const io = { lstat: fs.lstat, chmod: fs.chmod, readdir: fs.readdir };
        io[operation] = async (path, ...args) => {
          if (path !== base) throw Object.assign(new Error('descendant failure'), { code });
          return fs[operation](path, ...args);
        };
        await assert.rejects(footprint(base, io), { code });
      }
    }
  } finally { await fs.rm(base, { recursive: true, force: true }); }
});
