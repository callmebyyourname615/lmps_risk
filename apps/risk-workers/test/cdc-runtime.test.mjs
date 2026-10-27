import { createHash, randomBytes } from 'node:crypto';
const sensitiveField = ['database', 'password'].join('.');
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, writeFile, symlink, chmod, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { auditState, createRuntime, childEnvironment, safeRelative, validPort, parseInventory, testCommand, verifyOwnedFile, verifyInventoryFile, ownedProcessHandles } from '../scripts/cdc-runtime.mjs';

const runtime = { java: '/pinned/bin/java', kafka: '/pinned/kafka', plugin: '/pinned/plugin' };
function fixture({ startupMs = 100, ready = async () => true, failed = false } = {}) {
  const calls = [], files = new Map(); let nextPort = 21000;
  function spawner(binary, args, options) {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.signals = []; child.kill = signal => { child.signals.push(signal); queueMicrotask(() => child.emit('close', 0)); return true; };
    calls.push({ binary, args, options, child });
    if (args.includes('kafka.tools.StorageTool') || args.includes('org.apache.kafka.tools.TopicCommand')) queueMicrotask(() => child.emit('close', 0));
    else if (failed) queueMicrotask(() => { child.emit('error', new Error('SECRET diagnostic')); child.emit('close', -1); });
    return child;
  }
  const adapter = {
    verify: async () => runtime, spawn: spawner, port: async () => nextPort++, free: async () => {}, ready, startupMs,
    mkdtemp: async prefix => { assert.equal(prefix, '/private/tmp/lmps-cdc-'); return '/private/tmp/lmps-cdc-owned'; },
    chmod: async (_path, mode) => assert.equal(mode, 0o700), mkdir: async () => {}, audit: async () => {},
    writeFile: async (path, text, options) => { assert.equal(options.mode, 0o600); assert.equal(options.flag, 'wx'); assert.ok(!files.has(path)); files.set(path, text); },
    rm: async path => files.delete(path)
  };
  return { adapter, calls, files };
}
const settings = {
  name: 'invented', 'connector.class': 'io.debezium.connector.mariadb.MariaDbConnector',
  'database.hostname': '127.0.0.1', 'database.port': 22000, 'database.user': 'fixture', [sensitiveField]: randomBytes(16).toString('hex'),
  'database.include.list': 'invented', 'table.include.list': 'invented.rows', 'column.include.list': 'invented.rows.id',
  'topic.prefix': 'invented', 'decimal.handling.mode': 'string', 'database.ssl.mode': 'verify-full'
};

test('reject traversal, malformed ports, ambiguous inventories', () => {
  for (const path of ['../x', '/x', 'a//b', 'a/./b', 'a\\b', 'a\n']) assert.throws(() => safeRelative(path));
  for (const port of ['1234', 0, 1023, 65536, 1.5, NaN]) assert.throws(() => validPort(port));
  const digest = 'a'.repeat(64);
  assert.deepEqual(parseInventory(`${digest}  kafka/file`, 1), [['kafka/file', digest]]);
  assert.throws(() => parseInventory(`${digest}  ../file`, 1));
  assert.throws(() => parseInventory(`${digest}  x\n${digest}  x`, 2));
  assert.throws(() => parseInventory('untrusted', 1));
});
test('minimal environment excludes inherited JVM, credentials, HOME and JMX', () => {
  const env = childEnvironment(runtime);
  assert.deepEqual(Object.keys(env).sort(), ['JAVA_HOME', 'LANG', 'LC_ALL', 'PATH']);
  assert.equal(env.JAVA_HOME, '/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home');
  assert.throws(() => childEnvironment(runtime, 1024));
});
test('real file validation rejects symlinks, parent symlinks and writable files', async () => {
  // Workspace-only fixture: no /tmp, native process or network permission needed.
  const base = await mkdtemp(join(process.cwd(), '.cdc-runtime-unit-'));
  try {
    await chmod(base, 0o700); await mkdir(join(base, 'owned'), { mode: 0o700 });
    await writeFile(join(base, 'owned', 'file'), 'invented', { mode: 0o600 });
    assert.equal(await verifyOwnedFile(base, 'owned/file'), join(base, 'owned/file'));
    const digest = createHash('sha256').update('invented').digest('hex');
    assert.equal(await verifyInventoryFile(base, 'owned/file', digest), join(base, 'owned/file'));
    await writeFile(join(base, 'owned', 'file'), 'tampered');
    await assert.rejects(verifyInventoryFile(base, 'owned/file', digest));
    await assert.rejects(verifyInventoryFile(base, 'missing', digest));
    await assert.rejects(verifyInventoryFile(base, 'owned/file', 'unknown'));
    await symlink('owned/file', join(base, 'link'));
    await symlink('owned', join(base, 'directory-link'));
    await assert.rejects(verifyOwnedFile(base, 'link'));
    await assert.rejects(verifyOwnedFile(base, 'directory-link/file'));
    await chmod(join(base, 'owned', 'file'), 0o666);
    await assert.rejects(verifyOwnedFile(base, 'owned/file'));
    await assert.rejects(verifyOwnedFile(base, '../outside'));
  } finally { await rm(base, { recursive: true, force: true }); }
});
test('configuration is private, loopback and bounded; restart preserves state and formats once', async () => {
  const f = fixture(); const api = await createRuntime({}, f.adapter);
  await api.startKafka(); await api.startConnect(settings);
  assert.ok(ownedProcessHandles().includes(api.handles.broker));
  assert.ok(ownedProcessHandles().includes(api.handles.connect));
  f.files.set(api.offsetFile, 'durable-offset');
  const history = api.schemaHistoryTopic;
  await api.restartConnect(); await api.stopKafka(); await api.startKafka(); await api.startConnect(settings);
  assert.equal(f.files.get(api.offsetFile), 'durable-offset'); assert.equal(api.schemaHistoryTopic, history);
  assert.equal(f.calls.filter(c => c.args.includes('kafka.tools.StorageTool')).length, 1);
  assert.equal(new Set([api.brokerPort, api.controllerPort, api.restPort]).size, 3);
  const broker = f.files.get(api.base + '/broker.properties');
  assert.match(broker, /127\.0\.0\.1/); assert.match(broker, /num.partitions=1/); assert.match(broker, /log.retention.bytes=33554432/);
  const worker = f.files.get(api.base + '/worker.properties');
  assert.ok(worker.includes(api.offsetFile)); assert.match(worker, /JsonConverter/);
  for (const call of f.calls) {
    assert.equal(call.binary, runtime.java); assert.equal(call.options.shell, false);
    assert.ok(!call.args.join(' ').includes(settings[sensitiveField]));
    assert.ok(call.args.includes('-Xmx128m') || call.args.includes('-Xmx512m'));
  }
  await api.dispose();
  assert.equal(ownedProcessHandles().length, 0);
  assert.ok(f.calls.filter(c => c.args.includes('kafka.Kafka')).every(c => c.child.signals.includes('SIGTERM')));
});
test('unknown options/tools/settings and unsafe connector inputs fail before execution', async () => {
  await assert.rejects(createRuntime({ base: '/arbitrary' }));
  const f = fixture(); const api = await createRuntime({}, f.adapter); await api.startKafka();
  for (const change of [{ arbitrary: 'x' }, { 'database.hostname': 'external' }, { 'database.port': '0x55f0' }, { 'database.ssl.mode': 'disabled' }, { [sensitiveField]: 'x\nkey=value' }, { [sensitiveField]: 'x'.repeat(4097) }, { 'database.ssl.truststore': '/arbitrary' }]) {
    await assert.rejects(api.startConnect({ ...settings, ...change }));
  }
  await assert.rejects(api.cli('shell', { topic: 'invented' }));
  await assert.rejects(api.cli('consume', { topic: '--bad', maxMessages: 1 }));
  await assert.rejects(api.cli('consume', { topic: 'invented', maxMessages: 2001 }));
  await assert.rejects(api.cli('createTopic', { topic: 'invented', args: ['anything'] }));
  await api.cli('createTopic', { topic: 'invented' }); await api.dispose();
});
test('failed startup is sanitized and terminates the exact owned child', async () => {
  const f = fixture({ ready: async () => false, startupMs: 1 }); const api = await createRuntime({}, f.adapter);
  await assert.rejects(api.startKafka(), /CDC runtime/);
  assert.deepEqual(f.calls.at(-1).child.signals, ['SIGTERM']); await api.dispose();
  const g = fixture({ failed: true, ready: async () => false }); const other = await createRuntime({}, g.adapter);
  await assert.rejects(other.startKafka(), error => !error.message.includes('SECRET')); await other.dispose();
});
test('short-lived command deadline kills its child and never returns partial success', async () => {
  const f = fixture(); await assert.rejects(testCommand(f.adapter.spawn, runtime, 5), /CDC runtime/);
  assert.deepEqual(f.calls[0].child.signals, ['SIGTERM']);
  await assert.rejects(testCommand(f.adapter.spawn, runtime, Infinity));
});
test('tampered or missing runtime fails before allocating state', async () => {
  let allocated = false;
  await assert.rejects(createRuntime({}, { verify: async () => { throw new Error('runtime unavailable'); }, mkdtemp: async () => { allocated = true; } }));
  assert.equal(allocated, false);
});
test('occupied ports and unsafe state fail before spawning a broker', async () => {
  for (const boundary of ['free', 'audit']) {
    const f = fixture(); f.adapter[boundary] = async () => { throw new Error('unsafe'); };
    const api = await createRuntime({}, f.adapter);
    await assert.rejects(api.startKafka(), /CDC runtime/);
    assert.ok(!f.calls.some(c => c.args.includes('kafka.Kafka')));
    f.adapter.audit = async () => {};
    // Failed state is retained rather than removed through an unsafe path.
  }
});
test('output overflow terminates the owned command and rejects sanitized', async () => {
  const f = fixture();
  const spawner = (...args) => {
    const child = f.adapter.spawn(...args);
    queueMicrotask(() => child.stderr.write(Buffer.alloc(2 * 1024 * 1024 + 1, 65)));
    return child;
  };
  await assert.rejects(testCommand(spawner, runtime, 100), /CDC runtime/);
  assert.deepEqual(f.calls[0].child.signals, ['SIGTERM']);
});
test('stop escalates only its own child when SIGTERM is ignored', async () => {
  const f = fixture();
  const spawner = (...args) => {
    const child = f.adapter.spawn(...args);
    child.kill = signal => { child.signals.push(signal); if (signal === 'SIGKILL') queueMicrotask(() => child.emit('close', null)); return true; };
    return child;
  };
  await assert.rejects(testCommand(spawner, runtime, 1), /CDC runtime/);
  assert.deepEqual(f.calls[0].child.signals, ['SIGTERM', 'SIGKILL']);
});

test('a stalled readiness adapter cannot evade the startup deadline', async () => {
  const f = fixture({ ready: () => new Promise(() => {}), startupMs: 10 });
  const api = await createRuntime({}, f.adapter);
  const before = Date.now();
  await assert.rejects(api.startKafka(), /CDC runtime/);
  assert.ok(Date.now() - before < 1000);
  assert.deepEqual(f.calls.at(-1).child.signals, ['SIGTERM']);
  await api.dispose();
});

test('connector identity and offsets cannot be silently replaced after stop', async () => {
  const f = fixture(); const api = await createRuntime({}, f.adapter);
  await api.startKafka(); await api.startConnect(settings); await api.stopConnect();
  const config = f.files.get(api.base + '/connector.properties');
  await assert.rejects(api.startConnect({ ...settings, name: 'different' }));
  assert.equal(f.files.get(api.base + '/connector.properties'), config);
  await api.restartConnect(); await api.dispose();
});

test('setup errors are sanitized; unsafe state prevents even storage formatting', async () => {
  await assert.rejects(createRuntime({}, { verify: async () => { throw new Error('SECRET'); } }), error => !error.message.includes('SECRET'));
  const f = fixture(); f.adapter.audit = async () => { throw new Error('SECRET'); };
  const api = await createRuntime({}, f.adapter);
  await assert.rejects(api.startKafka(), /CDC runtime/);
  assert.equal(f.calls.length, 0);
});

test('process error alone never counts as verified shutdown', async () => {
  const f = fixture();
  const spawner = (...args) => {
    const child = f.adapter.spawn(...args);
    queueMicrotask(() => child.emit('error', new Error('SECRET')));
    return child;
  };
  await assert.rejects(testCommand(spawner, runtime, 5), /CDC runtime/);
  assert.deepEqual(f.calls[0].child.signals, ['SIGTERM']);
});

test('control characters and empty credentials fail before Connect execution', async () => {
  const f = fixture(); const api = await createRuntime({}, f.adapter); await api.startKafka();
  for (const value of ['', 'bad\tvalue', 'bad\fvalue', 'bad\x7fvalue']) {
    await assert.rejects(api.startConnect({ ...settings, [sensitiveField]: value }));
  }
  assert.ok(!f.calls.some(call => call.args.includes('org.apache.kafka.connect.cli.ConnectStandalone')));
  await api.dispose();
});

test('overflow after service readiness escalates and remains visible until close', async () => {
  const f = fixture(); const original = f.adapter.spawn;
  f.adapter.spawn = (...args) => {
    const child = original(...args);
    if (args[1].includes('kafka.Kafka')) child.kill = signal => {
      child.signals.push(signal);
      if (signal === 'SIGKILL') queueMicrotask(() => child.emit('close', null));
      return true;
    };
    return child;
  };
  const api = await createRuntime({}, f.adapter); const child = await api.startKafka();
  child.stderr.write(Buffer.alloc(2 * 1024 * 1024 + 1));
  assert.ok(ownedProcessHandles().includes(child));
  await api.stop();
  assert.deepEqual(child.signals, ['SIGTERM', 'SIGKILL']);
  assert.ok(!ownedProcessHandles().includes(child));
  await api.dispose();
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
      await auditState(base, io);
    }
    await assert.rejects(auditState(base + '-missing'), { code: 'ENOENT' });
    // Missing root and all non-ENOENT errors fail at every filesystem step.
    for (const operation of ['lstat', 'chmod', 'readdir']) {
      for (const code of ['ENOENT', 'EACCES', 'EIO']) {
        const io = { lstat: fs.lstat, chmod: fs.chmod, readdir: fs.readdir };
        io[operation] = async (path, ...args) => {
          if (path === base) throw Object.assign(new Error('root failure'), { code });
          return fs[operation](path, ...args);
        };
        await assert.rejects(auditState(base, io), { code });
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
        await assert.rejects(auditState(base, io), { code });
      }
    }
  } finally { await fs.rm(base, { recursive: true, force: true }); }
});

test('Connect scans the complete verified dependency bundle from its parent', async () => {
  const f = fixture(); const r = await createRuntime({}, f.adapter);
  try {
    const worker = f.files.get(join(r.base, 'worker.properties'));
    assert.match(worker, /^plugin\.path=\/pinned$/m);
  } finally { await r.dispose(); }
});
