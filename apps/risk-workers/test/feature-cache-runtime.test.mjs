import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile, mkdir, rm, chmod, symlink, lstat, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createRuntime, configuration, encodeRequest, parseReply, parseCli, validateDestination, validatePort, validateProvenance, ownedProcessHandles, testChild, testTransport } from '../scripts/feature-cache-runtime.mjs';

const root = resolve(import.meta.dirname, '../../..');
const script = join(root, 'apps/risk-workers/scripts/feature-cache-runtime.mjs');
const pins = JSON.parse(await readFile(join(root, 'apps/risk-workers/fixtures/feature-cache-runtime.json'), 'utf8'));
const observed = { path: pins.binary, version: 'Redis server v=8.10.1 sha=00000000:0 malloc=libc bits=64', sha256: pins.sha256.replaceAll(' ', '') };
const destination = () => '.local/redis-unit-' + randomBytes(8).toString('hex');
function fixture(options = {}) {
  const calls = [], signals = [];
  const adapter = {
    verify: async () => ({ binary: pins.binary, sha256: observed.sha256, version: pins.version }),
    port: async () => 25001, startupMs: 35,
    exchange: async () => 'PONG',
    spawn(binary, args, settings) {
      const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
      child.kill = signal => { signals.push(signal); queueMicrotask(() => child.emit('close', 0)); return true; };
      calls.push({ binary, args, settings, child }); return child;
    }, ...options
  };
  return { adapter, calls, signals };
}
test('import and strict invalid CLI are inert subprocesses', () => {
  const imported = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(script)});`], { cwd: root, timeout: 2000, encoding: 'utf8' });
  assert.equal(imported.status, 0); assert.equal(imported.stdout, ''); assert.equal(imported.stderr, '');
  for (const args of [[], ['--help'], ['--output', '../bad'], ['--output', '.local/x', '--runner', 'fake'], ['--output=.local/x']]) {
    assert.throws(() => parseCli(args));
    const result = spawnSync(process.execPath, [script, ...args], { cwd: root, timeout: 2000, encoding: 'utf8' });
    assert.equal(result.status, 1); assert.equal(result.stdout, ''); assert.match(result.stderr, /no acceptance published/);
  }
});
test('exact installed host provenance, version and destination restrictions', () => {
  assert.equal(validateProvenance(pins, observed), true);
  assert.throws(() => validateProvenance({ ...pins, source_binary: '/usr/bin/redis-server' }, observed));
  for (const change of [{ path: '/usr/bin/redis-server' }, { sha256: '0'.repeat(64) }, { version: 'Redis server v=8.10.10' }, { version: 'Redis server v=7.0.0' }]) assert.throws(() => validateProvenance(pins, { ...observed, ...change }));
  assert.throws(() => validateProvenance({ ...pins, sha256: '0'.repeat(64) }, observed));
  for (const path of ['/tmp/x', '.local/../x', '.local/a/b', '.local/a\n', '.local/a"', '.local/a\\b', null]) assert.throws(() => validateDestination(path));
  for (const p of [0, 1023, 65536, 1.5, '25000', NaN]) assert.throws(() => validatePort(p));
});
test('finite configuration disables persistence, remote bind and destructive commands', () => {
  const config = configuration(25001, 'a'.repeat(64));
  for (const required of ['bind 127.0.0.1\n', 'protected-mode yes', 'maxmemory 16777216', 'maxclients 8', 'maxmemory-policy noeviction', 'save ""', 'appendonly no', 'unixsocket redis.sock', 'client-query-buffer-limit 2097152', 'client-output-buffer-limit normal 2097152 1048576 1', 'rename-command CONFIG ""', 'rename-command FLUSHALL ""']) assert.ok(config.includes(required));
  assert.ok(!config.includes('0.0.0.0')); assert.throws(() => configuration(25001, 'secret\nCONFIG'));
});
test('bounded RESP requests, incremental replies, arrays, errors and depth', () => {
  assert.equal(encodeRequest(['SET', 'key', 'é']).toString(), '*3\r\n$3\r\nSET\r\n$3\r\nkey\r\n$2\r\né\r\n');
  for (const args of [[], ['x'.repeat(2097153)], Array(4097).fill('x'), ['SET', 1]]) assert.throws(() => encodeRequest(args));
  assert.equal(parseReply(Buffer.from('$5\r\nab')), null);
  assert.deepEqual(parseReply(Buffer.from('*3\r\n:0\r\n$-1\r\n+OK\r\n')).value, [0, null, 'OK']);
  for (const reply of ['-ERR private payload\r\n', '$2097153\r\n', '*4097\r\n', ':9007199254740992\r\n', '+OK\r\nextra', '$1\r\nx!!', '*1\r\n'.repeat(18) + '+OK\r\n']) assert.throws(() => parseReply(Buffer.from(reply)), /unavailable/);
  assert.throws(() => parseReply(Buffer.alloc(2097153)));
});
test('owned lifecycle, private files, count/hash-only unit receipt, idempotent stop', async () => {
  const f = fixture(); const output = destination(); const runtime = await createRuntime({ output }, f.adapter);
  try {
    assert.equal(runtime.ready(), true); assert.equal(runtime.status().port, 25001);
    assert.equal(await runtime.request(['PING']), 'PONG');
    assert.equal((await lstat(join(root, output))).mode & 0o777, 0o700);
    assert.equal((await lstat(join(root, output, 'redis.conf'))).mode & 0o777, 0o600);
    const call = f.calls[0]; assert.equal(call.binary, pins.binary); assert.deepEqual(call.args, ['redis.conf']);
    assert.equal(call.settings.shell, false); assert.deepEqual(Object.keys(call.settings.env).sort(), ['LANG', 'LC_ALL', 'PATH']);
    assert.equal(ownedProcessHandles().length, 1);
    for (const args of [['FLUSHALL'], ['CONFIG', 'GET', '*'], ['AUTH', 'anything'], ['GET', 'x'.repeat(2097153)]]) await assert.rejects(runtime.request(args));
    const receipt = runtime.receipt(); assert.equal(receipt.unit_only, true); assert.equal(receipt.native_acceptance, false); assert.equal(receipt.production_ready, false);
    assert.ok(!JSON.stringify(receipt).includes(output)); assert.equal(receipt.cleanup_verified, false);
  } finally { await runtime.stop(); }
  await runtime.stop(); assert.equal(runtime.ready(), false); assert.equal(runtime.receipt().cleanup_verified, true);
  assert.equal(ownedProcessHandles().length, 0); assert.deepEqual(f.signals, ['SIGTERM']);
  await assert.rejects(lstat(join(root, output))); await assert.rejects(runtime.request(['PING']));
});
test('owned socket resolves correctly from a nested package working directory', async () => {
  const original = process.cwd(), output = destination(); let runtime;
  try {
    process.chdir(join(root, 'apps/risk-workers'));
    const f = fixture({ exchange: async path => { assert.equal(resolve(path), join(root, output, 'redis.sock')); return 'PONG'; } });
    runtime = await createRuntime({ output }, f.adapter);
    assert.equal(runtime.ready(), true); assert.equal(await runtime.request(['PING']), 'PONG');
  } finally { await runtime?.stop(); process.chdir(original); }
});
test('missing/wrong binary fails before destination creation or spawn; unknown options inert', async () => {
  for (const verify of [async () => { throw Error('private'); }, async () => ({ binary: pins.binary, sha256: 'bad', version: pins.version })]) {
    const output = destination(), f = fixture({ verify });
    await assert.rejects(createRuntime({ output }, f.adapter), /unavailable/); assert.equal(f.calls.length, 0); await assert.rejects(lstat(join(root, output)));
  }
  await assert.rejects(createRuntime({ output: destination(), mode: 'real' }));
});
test('existing destinations, links, mode and invalid port fail closed without touching foreign state', async () => {
  const output = destination(), path = join(root, output), link = destination();
  await mkdir(path, { mode: 0o700 }); await writeFile(join(path, 'foreign'), 'invented', { mode: 0o600 });
  try {
    const f = fixture(); await assert.rejects(createRuntime({ output }, f.adapter)); assert.equal(f.calls.length, 0);
    assert.equal(await readFile(join(path, 'foreign'), 'utf8'), 'invented');
    await symlink(path, join(root, link)); await assert.rejects(createRuntime({ output: link }, f.adapter));
    await chmod(path, 0o777); await assert.rejects(createRuntime({ output }, f.adapter));
    assert.equal(await readFile(join(path, 'foreign'), 'utf8'), 'invented');
  } finally { await rm(join(root, link), { force: true }); await rm(path, { recursive: true }); }
  const badOutput = destination(), f = fixture({ port: async () => 0 });
  await assert.rejects(createRuntime({ output: badOutput }, f.adapter)); assert.equal(f.calls.length, 0); await assert.rejects(lstat(join(root, badOutput)));
});
test('readiness failure and timeout tear down exactly owned child', async () => {
  for (const exchange of [async () => 'WRONG', async () => { throw Error('SECRET'); }, () => new Promise(() => {})]) {
    const output = destination(), f = fixture({ exchange });
    await assert.rejects(createRuntime({ output }, f.adapter), /unavailable/);
    assert.deepEqual(f.signals, ['SIGTERM']); assert.equal(ownedProcessHandles().length, 0); await assert.rejects(lstat(join(root, output)));
  }
});
test('transport outage and unexpected child close cannot report success', async () => {
  let count = 0; const f = fixture({ exchange: async () => { if (count++ === 0) return 'PONG'; throw Error('SECRET'); } });
  const runtime = await createRuntime({ output: destination() }, f.adapter);
  await assert.rejects(runtime.request(['GET', 'invented']), /unavailable/);
  assert.equal(runtime.receipt().state, 'unavailable'); assert.equal(runtime.receipt().cleanup_verified, true);
  const g = fixture(), second = await createRuntime({ output: destination() }, g.adapter);
  g.calls[0].child.emit('close', 1); assert.equal(second.status().state, 'unavailable');
  await second.stop(); assert.equal(second.receipt().state, 'unavailable');
});
test('changed directory ownership retains uncertain scratch, child still stopped', async () => {
  const output = destination(), path = join(root, output), f = fixture(); const runtime = await createRuntime({ output }, f.adapter);
  await chmod(path, 0o755);
  await assert.rejects(runtime.stop()); assert.equal(runtime.receipt().state, 'unavailable'); assert.equal(runtime.receipt().cleanup_verified, false); assert.equal(ownedProcessHandles().length, 0);
  await chmod(path, 0o700); await rm(path, { recursive: true });
});
test('actual transport logic authenticates same socket, bounds bytes and destroys on failure/deadline', async () => {
  function socketFixture(mode) {
    let socket; const writes = [];
    const connector = settings => {
      assert.equal(settings.path, 'unit-only.sock'); socket = new EventEmitter(); socket.destroyed = false;
      socket.destroy = () => { socket.destroyed = true; queueMicrotask(() => socket.emit('close')); };
      socket.write = b => {
        writes.push(b.toString());
        queueMicrotask(() => {
          if (mode === 'timeout') return;
          if (writes.length === 1) socket.emit('data', Buffer.from(mode === 'auth-error' ? '-ERR SECRET\r\n' : '+OK\r\n'));
          else if (mode === 'oversize') socket.emit('data', Buffer.alloc(2097153));
          else if (mode === 'error') socket.emit('error', Error('SECRET'));
          else if (mode === 'end') socket.emit('end');
          else { socket.emit('data', Buffer.from('$4\r\nPO')); socket.emit('data', Buffer.from('NG\r\n')); }
        }); return true;
      };
      queueMicrotask(() => socket.emit('connect')); return socket;
    };
    return { connector, writes, get socket() { return socket; } };
  }
  const f = socketFixture('ok'); assert.equal(await testTransport(f.connector, ['PING']), 'PONG');
  assert.equal(f.writes.length, 2); assert.match(f.writes[0], /AUTH/); assert.match(f.writes[1], /PING/); assert.equal(f.socket.destroyed, true);
  for (const mode of ['timeout', 'auth-error', 'oversize', 'error', 'end']) {
    const g = socketFixture(mode); await assert.rejects(testTransport(g.connector, ['PING']), /unavailable/);
    assert.equal(g.socket.destroyed, true);
  }
});
test('bounded child output, spawn failure and command timeout use tracked handles', async () => {
  for (const mode of ['timeout', 'error', 'output']) {
    const f = fixture();
    const spawner = (...args) => {
      const c = f.adapter.spawn(...args);
      if (mode === 'error') queueMicrotask(() => { c.emit('error', Error('SECRET')); c.emit('close', 1); });
      if (mode === 'output') queueMicrotask(() => c.stdout.write(Buffer.alloc(65537)));
      return c;
    };
    await assert.rejects(testChild(spawner, 5), /unavailable/); assert.equal(ownedProcessHandles().length, 0);
    if (mode !== 'error') assert.deepEqual(f.signals, ['SIGTERM']);
  }
});
test('parent termination signal stops owned child and cannot produce success', async () => {
  const before = process.listenerCount('SIGTERM'), f = fixture();
  const runtime = await createRuntime({ output: destination() }, f.adapter);
  assert.equal(process.listenerCount('SIGTERM'), before + 1);
  process.emit('SIGTERM'); await runtime.stop();
  assert.equal(runtime.receipt().state, 'unavailable'); assert.equal(runtime.receipt().cleanup_verified, true);
  assert.equal(process.listenerCount('SIGTERM'), before); assert.equal(ownedProcessHandles().length, 0);
});
