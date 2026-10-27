import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, readFile, writeFile, chmod, symlink } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { runFeatureStreamSpike, parseArguments, validateCapture, executeHelper, ownedFeatureProcessHandles } from '../scripts/feature-stream-spike.mjs';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SCRIPT = fileURLToPath(new URL('../scripts/feature-stream-spike.mjs', import.meta.url));
const invalid = e => e.code === 'FEATURE_SPIKE_FAILED';
const capture = values => values.map((v, i) => `R\t0\t${i}\t${Buffer.from(v).toString('base64')}\n`).join('') + `E\t${values.length}\t${values.length}\n`;
async function space(t) {
  await mkdir(join(ROOT, '.local'), { recursive: true, mode: 0o700 });
  const dir = await mkdtemp(join(ROOT, '.local/feature-unit-')); await chmod(dir, 0o700);
  t.after(() => rm(dir, { recursive: true, force: true })); return dir;
}
test('import and invalid CLI are inert, cwd independent and redact arguments', () => {
  const imported = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(SCRIPT).href)});`], { cwd: ROOT, encoding: 'utf8', timeout: 3000 });
  assert.equal(imported.status, 0); assert.equal(imported.stdout + imported.stderr, '');
  // Preserve traversal bytes: join() would normalize this into a valid destination.
  for (const args of [[], ['--help'], ['--output', 'private_payload'], ['--output', join(ROOT, '.local/new'), '--fake'], ['--output', `${ROOT}.local/a/../b`]]) {
    assert.throws(() => parseArguments(args), invalid);
    const result = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: fileURLToPath(new URL('../', import.meta.url)), encoding: 'utf8', timeout: 3000 });
    assert.equal(result.status, 1); assert.equal(result.stdout, ''); assert.equal(result.stderr, 'FEATURE_SPIKE_FAILED\n');
  }
  assert.equal(ownedFeatureProcessHandles().length, 0);
});
test('strict one-shape output paths and no lifecycle work on invalid arguments or destinations', async t => {
  let calls = 0; const seams = { verify: () => { calls++; throw Error('private_payload'); }, create: () => { calls++; }, handles: () => [] };
  for (const p of [ROOT, join(ROOT, '.local'), '/private/tmp/new', join(ROOT, '.local/new') + '/', join(ROOT, '.local/x\\y')]) {
    assert.throws(() => parseArguments(['--output', p]), invalid);
    await assert.rejects(runFeatureStreamSpike({ output: p }, seams), invalid);
  }
  const dir = await space(t);
  await assert.rejects(runFeatureStreamSpike({ output: dir }, seams), invalid);
  await symlink(dir, join(dir, 'link'));
  await assert.rejects(runFeatureStreamSpike({ output: join(dir, 'link/new') }, seams), invalid);
  await assert.rejects(runFeatureStreamSpike({ output: join(dir, 'new'), fake: true }, seams), invalid);
  assert.equal(calls, 0);
});
test('capture validates exact values, contiguous offsets and quiet end position; never truncates', () => {
  const values = ['{"a":1}', '{"a":2}'], good = capture(values);
  assert.deepEqual(validateCapture(good, values), [{ a: 1 }, { a: 2 }]);
  for (const bad of [good.replace('R\t0\t1', 'R\t0\t2'), good.replace('R\t0\t0', 'R\t1\t0'), good.replace('E\t2\t2', 'E\t3\t3'),
    good.replace('E\t2\t2', 'E\t2\t1'), good.replace('E\t2\t2\n', ''), capture([...values, '{"extra":true}']), capture([...values].reverse()),
    good + 'R\t0\t2\te30=\n', 'x'.repeat(2097153)]) assert.throws(() => validateCapture(bad, values), invalid);
  assert.throws(() => validateCapture(capture(Array(33).fill('{}')), Array(33).fill('{}')), invalid);
});
function fakeChild(action) {
  const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.kill = signal => { child.signals.push(signal); queueMicrotask(() => child.emit('close', null)); return true; }; child.signals = [];
  setImmediate(() => action(child)); return child;
}
test('native command seams bound output/deadline and await close on failures without diagnostics', async () => {
  await assert.rejects(executeHelper({ java: '/unused', kafka: '/unused' }, [], ROOT, 20, () => { throw Error('private_payload'); }), invalid);
  for (const mode of ['failure', 'overflow', 'timeout', 'error', 'ok']) {
    let child;
    const spawner = (binary, args, options) => {
      assert.equal(options.shell, false); assert.equal(args.includes('-Xmx128m'), true); assert.equal(options.env.JAVA_TOOL_OPTIONS, undefined);
      return child = fakeChild(c => {
        if (mode === 'failure') { c.stderr.write('private_payload'); c.emit('close', 1); }
        if (mode === 'overflow') c.stdout.write(Buffer.alloc(2097153));
        if (mode === 'error') { c.emit('error', Error('private_payload')); c.emit('close', -1); }
        if (mode === 'ok') { c.stdout.write('bounded'); c.emit('close', 0); }
      });
    };
    const operation = executeHelper({ java: '/unused', kafka: '/unused' }, ['fixed.java'], ROOT, mode === 'timeout' ? 20 : 1000, spawner);
    if (mode === 'ok') assert.equal(await operation, 'bounded'); else await assert.rejects(operation, invalid);
    if (['overflow', 'timeout'].includes(mode)) assert.deepEqual(child.signals, ['SIGTERM']);
    assert.equal(ownedFeatureProcessHandles().length, 0);
  }
});
test('insufficient startup resources never create evidence or invoke native lifecycle', async t => {
  const dir = await space(t), output = join(dir, 'new'); let called = false;
  await assert.rejects(runFeatureStreamSpike({ output }, { free: async () => { throw Error('private_payload'); }, verify: async () => { called = true; }, handles: () => [] }), invalid);
  assert.equal(called, false); await assert.rejects(readFile(join(output, 'failure.json')), { code: 'ENOENT' });
});
test('concurrent runner refuses ownership without disturbing the first invocation', async t => {
  const dir = await space(t); let entered, release;
  const enteredPromise = new Promise(r => { entered = r; });
  const gate = new Promise(r => { release = r; });
  const first = runFeatureStreamSpike({ output: join(dir, 'first') }, { free: async () => { entered(); await gate; throw Error('unit stop'); }, handles: () => [] });
  await enteredPromise;
  await assert.rejects(runFeatureStreamSpike({ output: join(dir, 'second') }, { handles: () => [] }), invalid);
  release(); await assert.rejects(first, invalid);
});
// Trusted transport substitutes only: these receipts are unit proof, never native evidence.
async function trial(t, mutate = () => {}) {
  const dir = await space(t), output = join(dir, 'run'), scratch = join(dir, 'scratch'); await mkdir(scratch, { mode: 0o700 });
  let values, starts = 0, stops = 0, reads = 0, writes = 0;
  const seams = {
    free: async () => {}, verify: async () => ({ java: '/unused', kafka: '/unused' }), scratch: async () => scratch,
    create: async () => ({ base: scratch, brokerPort: 12345, startKafka: async () => { starts++; }, stopKafka: async () => { stops++; }, stop: async () => { stops++; }, cli: async (tool, args) => { assert.equal(tool, 'createTopic'); assert.equal(args.topic, 'synthetic_golden.synthetic_run'); } }),
    execute: async (_r, args) => {
      if (!values) values = (await readFile(join(scratch, 'values'), 'utf8')).trim().split('\n').map(s => Buffer.from(s, 'base64').toString());
      if (args[1] === 'send') return values.map((_, i) => `S\t0\t${i}\n`).join('');
      reads++; return capture(values);
    },
    writeFile: async (...args) => { writes++; return writeFile(...args); }, handles: () => []
  };
  mutate(seams);
  return { output, run: () => runFeatureStreamSpike({ output }, seams), stats: () => ({ starts, stops, reads, writes }) };
}
test('actual compiled consumer prefix/reopen/replay and every independent golden/reference assertion', async t => {
  const x = await trial(t), receipt = await x.run();
  assert.equal(receipt.production_ready, false); assert.equal(receipt.snapshots_hash.split(' ').length, 8);
  assert.equal(receipt.prefix.next_offset, Math.floor(receipt.deliveries / 2)); assert.equal(receipt.committed.next_offset, receipt.deliveries);
  assert.equal(receipt.committed.snapshots, 6); assert.equal(receipt.owned_processes, 0);
  assert.equal(x.stats().starts, 3); assert.equal(x.stats().reads, 3); assert.ok(x.stats().stops >= 3);
  assert.deepEqual(JSON.parse(await readFile(join(x.output, 'pipeline-receipt.json'))), receipt);
});
test('native/lifecycle failure, capture conflicts and bound failures retain fixed evidence and clean children', async t => {
  for (const point of ['start', 'execute', 'extra', 'conflict', 'audit', 'verify']) {
    const x = await trial(t, seams => {
      if (point === 'start') { const create = seams.create; seams.create = async () => ({ ...await create(), startKafka: async () => { throw Error('private_payload'); } }); }
      if (point === 'verify') seams.verify = async () => { throw Error('private_payload'); };
      if (point === 'audit') seams.audit = async () => { throw Error('private_payload'); };
      if (['execute', 'extra', 'conflict'].includes(point)) { const execute = seams.execute; seams.execute = async (...args) => {
        if (point === 'execute') throw Error('private_payload');
        const text = await execute(...args);
        if (args[1][1] !== 'read') return text;
        return point === 'extra' ? text.replace(/^E\t/m, 'R\t0\t999\te30=\nE\t') : text.replace('R\t0\t0', 'R\t0\t9');
      }; }
    });
    await assert.rejects(x.run(), invalid);
    const evidence = await readFile(join(x.output, 'failure.json'), 'utf8'); assert.equal(evidence.includes('private_payload'), false);
    assert.equal(JSON.parse(evidence).code, 'FEATURE_SPIKE_FAILED');
    if (point !== 'verify') assert.ok(x.stats().stops >= 1);
    await assert.rejects(readFile(join(x.output, 'pipeline-receipt.json')), { code: 'ENOENT' });
  }
});
test('independent expectations reject broken arithmetic; failed teardown retains fixed failure evidence', async t => {
  const arithmetic = await trial(t, seams => {
    seams.open = async (p, plan) => {
      const { openFeatureStreamConsumer } = await import('../dist/feature-stream-consumer.js');
      const worker = openFeatureStreamConsumer(p, plan);
      return { ...worker, materialize: id => ({ ...worker.materialize(id), amount: '0.00' }) };
    };
  });
  await assert.rejects(arithmetic.run(), invalid);
  await assert.rejects(readFile(join(arithmetic.output, 'pipeline-receipt.json')), { code: 'ENOENT' });
  const cleanup = await trial(t, seams => {
    const create = seams.create;
    seams.create = async () => ({ ...await create(), stop: async () => { throw Error('private_payload'); } });
  });
  await assert.rejects(cleanup.run(), invalid);
  assert.equal(JSON.parse(await readFile(join(cleanup.output, 'cleanup-failure.json'))).code, 'FEATURE_SPIKE_FAILED');
});
