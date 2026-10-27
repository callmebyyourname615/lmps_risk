/** Host-only synthetic CDC runtime. Import starts no processes and binds no ports.
 * verifyRuntime(): read-only verification of account-home cache and pinned Java.
 * createRuntime(): fresh private state; startKafka/stopKafka preserve formatted logs.
 * startConnect(properties)/stopConnect/restartConnect preserve offsets and history.
 * cli('createTopic'|'consume', {topic,maxMessages?}) returns bounded private text.
 * stop() retains state; dispose() removes state only after verified child shutdown.
 * handles exposes read-only snapshots of ChildProcess ownership. No persisted PID is ever trusted.
 * ownedProcessHandles() includes live short-lived commands and failed cleanup,
 * so a host acceptance caller can independently check that ownership is empty.
 * The second argument is a trusted test adapter, never caller/environment config.
 */
import { userInfo } from 'node:os';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { open, readFile, lstat, readdir, mkdtemp, mkdir, chmod, writeFile, rm } from 'node:fs/promises';
import { join, isAbsolute, dirname, basename } from 'node:path';
import { createServer, connect } from 'node:net';
import { get } from 'node:http';

const encodedPins = JSON.parse(await readFile(new URL('./cdc-runtime-pins.json', import.meta.url), 'utf8'));
function checksumText(value, length) {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}(?: [a-f0-9]{8})+$/.test(value)) throw new Error('Invalid public runtime checksum encoding.');
  const result = value.replaceAll(' ', '');
  if (result.length !== length) throw new Error('Invalid public runtime checksum length.');
  return result;
}
const pins = { ...encodedPins, inventorySha256: checksumText(encodedPins.inventorySha256, 64), artifacts: encodedPins.artifacts.map(artifact => ({ ...artifact, sha512: checksumText(artifact.sha512, 128) })) };
const failure = () => new Error('CDC runtime verification or lifecycle failed; private state retained.');
const liveHandles = new Set();
/** Actual children spawned by this module only, including commands in flight.
 * Entries remain until close proves shutdown, even after a public error. */
export function ownedProcessHandles() { return Object.freeze([...liveHandles].map(handle => handle.child)); }
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function keys(object, allowed) {
  if (!object || typeof object !== 'object' || Array.isArray(object) || Object.keys(object).some(k => !allowed.includes(k))) throw failure();
}
export function safeRelative(value) {
  if (typeof value !== 'string' || !value || isAbsolute(value) || /[\\\x00-\x1f]/.test(value) || value.split('/').some(p => !p || p === '.' || p === '..')) throw failure();
  return value;
}
export function validPort(value) {
  if (!Number.isInteger(value) || value < 1024 || value > 65535) throw failure();
  return value;
}
async function checked(path, directory, system = false) {
  const stat = await lstat(path);
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile()) || !(stat.uid === process.getuid() || system && stat.uid === 0) || stat.mode & 0o022) throw failure();
  return stat;
}
async function checkedPath(base, relative, system = false) {
  let path = base; await checked(base, true, system);
  const parts = safeRelative(relative).split('/');
  for (let i = 0; i < parts.length; i++) { path = join(path, parts[i]); await checked(path, i < parts.length - 1, system); }
  return path;
}
/** Read-only owned regular-file validation, including each relative ancestor. */
export async function verifyOwnedFile(base, relative) {
  try { return await checkedPath(base, relative); } catch { throw failure(); }
}
async function hash(path, algorithm) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await file.stat();
    if (!before.isFile() || before.uid !== process.getuid() || before.mode & 0o022 || before.size > 200 * 1024 ** 2) throw failure();
    const digest = createHash(algorithm);
    if (before.size) for await (const chunk of file.createReadStream({ autoClose: false, start: 0, end: before.size - 1 })) digest.update(chunk);
    const after = await file.stat();
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw failure();
    return digest.digest('hex');
  } finally { await file.close(); }
}
/** Read-only integrity helper. Execution discovery always supplies the fixed pins;
 * this helper also permits workspace-only corruption tests without host reads. */
export async function verifyInventoryFile(base, relative, digest) {
  try {
    if (typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest)) throw failure();
    const path = await checkedPath(base, relative);
    if (await hash(path, 'sha256') !== digest) throw failure();
    return path;
  } catch { throw failure(); }
}
/** Inventory supports sha256sum lines or JSON files:[{path,sha256}]. Its exact
 * bytes must match the host pin before any record is interpreted. */
export function parseInventory(text, count = pins.inventoryFiles) {
  let entries;
  try {
    const parsed = JSON.parse(text); const files = Array.isArray(parsed) ? parsed : parsed.files;
    entries = files.map(file => [file.path ?? file.relativePath, file.sha256]);
  } catch {
    entries = text.trim().split('\n').map(line => {
      const match = /^([a-f0-9]{64}) [ *](.+)$/.exec(line);
      if (!match) throw failure(); return [match[2], match[1]];
    });
  }
  if (entries.length !== count || new Set(entries.map(e => e[0])).size !== count) throw failure();
  for (const [path, digest] of entries) { safeRelative(path); if (!/^[a-f0-9]{64}$/.test(digest)) throw failure(); }
  return entries;
}
export function childEnvironment(_runtime, heap = 128) {
  if (![128, 512].includes(heap)) throw failure();
  return { JAVA_HOME: pins.javaHome, PATH: pins.javaHome + '/bin:/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' };
}
// Direct Java avoids shell wrappers and descendants; JVM options are fixed here.
function launch(spawner, runtime, kind, args, cwd) {
  const heap = ['broker', 'connect'].includes(kind) ? 512 : 128;
  // spawn is synchronous: restore the parent's mask before yielding. JVM-created
  // broker/offset files inherit 0600 and directories inherit 0700 from birth.
  const previousMask = process.umask(0o077); let child;
  try {
    child = spawner(runtime.java, ['-Xms32m', `-Xmx${heap}m`, '-XX:+ExitOnOutOfMemoryError', ...args], {
      cwd, env: childEnvironment(runtime, heap), shell: false, stdio: ['ignore', 'pipe', 'pipe']
    });
  } finally { process.umask(previousMask); }
  const h = { child, ended: false, error: false, bytes: 0, output: '', stdout: '' };
  liveHandles.add(h);
  h.done = new Promise(resolve => {
    child.once('error', () => { h.error = true; /* close proves shutdown */ });
    child.once('close', code => { h.code = code; h.ended = true; resolve(); });
  });
  h.done.then(() => liveHandles.delete(h));
  for (const stream of [child.stdout, child.stderr]) stream?.on('data', chunk => {
    h.bytes += chunk.length;
    if (h.bytes > 2 * 1024 * 1024) {
      if (!h.error) {
        h.error = true;
        // Drain without retaining payload and escalate even after readiness.
        h.cleanup = stopHandle(h).catch(() => { h.cleanupFailed = true; });
      }
    }
    else { h.output += chunk.toString(); if (stream === child.stdout) h.stdout += chunk.toString(); }
  });
  return h;
}
async function bounded(promise, ms) {
  let timer;
  try { return await Promise.race([promise.then(() => true), new Promise(r => { timer = setTimeout(() => r(false), ms); })]); }
  finally { clearTimeout(timer); }
}
async function stopHandle(h, timeout = 2000) {
  if (!h || h.ended) return;
  if (!h.stopping) h.stopping = (async () => {
    h.child.kill('SIGTERM');
    if (!await bounded(h.done, timeout)) { h.child.kill('SIGKILL'); if (!await bounded(h.done, timeout)) throw failure(); }
  })();
  return h.stopping;
}
async function command(spawner, runtime, args, timeout, cwd, stdoutOnly = false) {
  const h = launch(spawner, runtime, 'cli', args, cwd);
  if (!await bounded(h.done, timeout)) { await stopHandle(h); throw failure(); }
  if (h.error || h.code !== 0) throw failure();
  return stdoutOnly ? h.stdout : h.output;
}
/** Trusted test seam for command deadline/cleanup checks; no shell is involved. */
export async function testCommand(spawner, runtime, timeout) {
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 15000) throw failure();
  return command(spawner, runtime, ['-version'], timeout);
}
export async function auditState(base, filesystem = { lstat, chmod, readdir }) {
  let bytes = 0;
  async function walk(path) {
    try {
    const stat = await filesystem.lstat(path);
    if (stat.isSymbolicLink() || stat.uid !== process.getuid() || (!stat.isDirectory() && !stat.isFile())) throw failure();
    await filesystem.chmod(path, stat.isDirectory() ? 0o700 : 0o600);
    if (stat.isDirectory()) for (const name of await filesystem.readdir(path)) await walk(join(path, name));
    else bytes += stat.size;
    if (bytes > 2 * 1024 ** 3) throw failure();
    } catch (error) {
      if (path === base || error.code !== 'ENOENT') throw error;
    }
  }
  await walk(base);
}
/** Resolves independently of HOME. No download, environment code, or cache writes. */
export async function verifyRuntime() {
  try {
    const base = join(userInfo().homedir, pins.cacheRelative);
    let ancestor = '/';
    for (const part of base.split('/').filter(Boolean)) { ancestor = join(ancestor, part); await checked(ancestor, true, true); }
    const names = await readdir(base);
    // Archive filenames were not part of the host facts. Discover only bounded
    // owned root/archives files; the pinned length and SHA512 establish identity.
    const archiveCandidates = [];
    for (const folder of ['', 'archives']) {
      const directory = folder ? join(base, folder) : base;
      if (folder && !names.includes(folder)) continue;
      await checked(directory, true);
      for (const name of await readdir(directory)) {
        const path = join(directory, name), stat = await lstat(path);
        if (stat.isSymbolicLink()) throw failure();
        if (stat.isFile()) { await checked(path, false); archiveCandidates.push({ path, size: stat.size }); }
      }
    }
    for (const artifact of pins.artifacts) {
      let found = false;
      for (const candidate of archiveCandidates.filter(c => c.size === artifact.bytes)) if (await hash(candidate.path, 'sha512') === artifact.sha512) found = true;
      if (!found) throw failure();
    }
    let inventory;
    for (const name of names.filter(name => /inventory|sha256/i.test(name))) {
      const path = await checkedPath(base, name);
      if ((await lstat(path)).size <= 1024 * 1024 && await hash(path, 'sha256') === pins.inventorySha256) inventory = await readFile(path, 'utf8');
    }
    if (!inventory) throw failure();
    const verified = new Set();
    for (const [relative, digest] of parseInventory(inventory)) {
      const path = await verifyInventoryFile(base, relative, digest);
      verified.add(path);
    }
    const kafka = join(base, pins.kafkaRelative), plugin = join(base, pins.pluginRelative);
    // Every executable classpath byte must be inventoried; no extra plugin jars.
    async function walk(folder) {
      await checked(folder, true);
      for (const name of await readdir(folder)) {
        const path = join(folder, name), stat = await lstat(path);
        if (stat.isSymbolicLink()) throw failure();
        if (stat.isDirectory()) await walk(path);
        else if (!stat.isFile() || !verified.has(path)) throw failure();
      }
    }
    await walk(join(kafka, 'libs')); await walk(plugin);
    // Connect scans child directories as complete plugin dependency bundles.
    // Reject sibling bundles before exposing the containing directory.
    const siblings = await readdir(dirname(plugin));
    if (siblings.length !== 1 || siblings[0] !== basename(plugin)) throw failure();
    // Temurin's supplied bundle is a root-owned system path, not a cache override.
    ancestor = '/'; for (const part of pins.javaHome.split('/').filter(Boolean)) { ancestor = join(ancestor, part); await checked(ancestor, true, true); }
    const java = await checkedPath(pins.javaHome, 'bin/java', true);
    const release = await readFile(await checkedPath(pins.javaHome, 'release', true), 'utf8');
    if (!/^JAVA_VERSION="21\.0\.10"\r?$/m.test(release) || !/^IMPLEMENTOR="Eclipse Adoptium"\r?$/m.test(release) || !((await lstat(java)).mode & 0o111)) throw failure();
    const runtime = Object.freeze({ java, kafka, plugin });
    const version = await command(spawn, runtime, ['-version'], 5000);
    if (!/version "21\.0\.10"/.test(version) || !version.includes('Temurin')) throw failure();
    return runtime;
  } catch { throw failure(); }
}
async function availablePort() {
  const server = createServer();
  await new Promise((ok, no) => { server.once('error', no); server.listen(0, '127.0.0.1', ok); });
  const port = server.address().port;
  await new Promise((ok, no) => server.close(error => error ? no(error) : ok())); return validPort(port);
}
async function assertFree(port) {
  const server = createServer();
  await new Promise((ok, no) => { server.once('error', no); server.listen(validPort(port), '127.0.0.1', ok); });
  await new Promise((ok, no) => server.close(error => error ? no(error) : ok()));
}
async function ready(port, rest) {
  return new Promise(resolve => {
    if (rest) {
      const req = get(`http://127.0.0.1:${port}/connectors`, response => { response.resume(); resolve(response.statusCode === 200); });
      req.setTimeout(300, () => req.destroy()); req.on('error', () => resolve(false));
    } else {
      const socket = connect({ host: '127.0.0.1', port }); socket.setTimeout(300);
      socket.once('connect', () => { socket.destroy(); resolve(true); });
      socket.once('timeout', () => { socket.destroy(); resolve(false); }); socket.once('error', () => resolve(false));
    }
  });
}
function properties(values) {
  return Object.entries(values).map(([key, value]) => {
    if (!['string', 'number'].includes(typeof value) || String(value).length > 4096 || /[\x00-\x1f\x7f]/.test(String(value))) throw failure();
    return key + '=' + String(value).replace(/\\/g, '\\\\').replace(/([:=#! ])/g, '\\$1');
  }).join('\n') + '\n';
}
const connectorKeys = ['name', 'connector.class', 'database.hostname', 'database.port', 'database.user', 'database.password', 'database.server.id', 'database.include.list', 'table.include.list', 'column.include.list', 'topic.prefix', 'snapshot.mode', 'decimal.handling.mode', 'tombstones.on.delete', 'database.ssl.mode', 'database.ssl.truststore', 'database.ssl.truststore.password', 'max.batch.size', 'max.queue.size', 'poll.interval.ms', 'include.schema.changes'];

/** options has no supported overrides. Tests inject trusted adapters explicitly.
 * No output path or existing state directory is accepted from callers.
 * The returned base can hold a private fixture truststore for Connect. */
export async function createRuntime(options = {}, dependencies = {}) {
  try { return await createOwnedRuntime(options, dependencies); } catch { throw failure(); }
}
async function createOwnedRuntime(options, dependencies) {
  keys(options, []);
  const io = { verify: verifyRuntime, spawn, port: availablePort, free: assertFree, ready, mkdtemp, mkdir, chmod, writeFile, rm, audit: auditState, startupMs: 20000, ...dependencies };
  if (!Number.isInteger(io.startupMs) || io.startupMs < 1 || io.startupMs > 20000) throw failure();
  const runtime = await io.verify();
  const base = await io.mkdtemp('/private/tmp/lmps-cdc-'); await io.chmod(base, 0o700);
  const ports = [];
  try {
    while (ports.length < 3) { const p = validPort(await io.port()); if (ports.includes(p)) throw failure(); ports.push(p); }
  } catch { await io.rm(base, { recursive: true }); throw failure(); }
  const [brokerPort, controllerPort, restPort] = ports;
  const clusterId = randomBytes(16).toString('base64url');
  const schemaHistoryTopic = 'lmps-history-' + randomBytes(8).toString('hex');
  const brokerConfig = join(base, 'broker.properties'), workerConfig = join(base, 'worker.properties'), connectorConfig = join(base, 'connector.properties');
  const offsetFile = join(base, 'offsets');
  const write = (path, values) => io.writeFile(path, properties(values), { mode: 0o600, flag: 'wx' });
  await io.mkdir(join(base, 'logs'), { mode: 0o700 });
  await write(brokerConfig, {
    'process.roles': 'broker,controller', 'node.id': 1, 'controller.quorum.voters': `1@127.0.0.1:${controllerPort}`,
    'listeners': `PLAINTEXT://127.0.0.1:${brokerPort},CONTROLLER://127.0.0.1:${controllerPort}`,
    'advertised.listeners': `PLAINTEXT://127.0.0.1:${brokerPort}`, 'controller.listener.names': 'CONTROLLER',
    'listener.security.protocol.map': 'CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT', 'inter.broker.listener.name': 'PLAINTEXT',
    'log.dirs': join(base, 'logs'), 'num.partitions': 1, 'default.replication.factor': 1,
    'offsets.topic.replication.factor': 1, 'offsets.topic.num.partitions': 1,
    'transaction.state.log.replication.factor': 1, 'transaction.state.log.num.partitions': 1, 'transaction.state.log.min.isr': 1,
    'log.retention.bytes': 33554432, 'log.segment.bytes': 8388608, 'log.retention.check.interval.ms': 1000,
    'auto.create.topics.enable': 'false', 'num.network.threads': 2, 'num.io.threads': 2
  });
  await write(workerConfig, {
    'bootstrap.servers': `127.0.0.1:${brokerPort}`, 'listeners': `http://127.0.0.1:${restPort}`,
    'rest.advertised.host.name': '127.0.0.1', 'rest.advertised.port': restPort,
    'key.converter': 'org.apache.kafka.connect.json.JsonConverter', 'value.converter': 'org.apache.kafka.connect.json.JsonConverter',
    'key.converter.schemas.enable': 'false', 'value.converter.schemas.enable': 'false',
    'offset.storage.file.filename': offsetFile, 'offset.flush.interval.ms': 1000, 'plugin.path': dirname(runtime.plugin)
  });
  const handles = { broker: null, connect: null }; let formatted = false, saved, disposed = false;
  const classArgs = (name, args) => ['-cp', join(runtime.kafka, 'libs', '*'), name, ...args];
  // A single operation at a time prevents stop/start/config replacement races.
  let busy = false;
  async function exclusive(operation) { if (busy || disposed) throw failure(); busy = true; try { return await operation(); } catch { throw failure(); } finally { busy = false; } }
  async function start(kind, args, port) {
    if (handles[kind] && !handles[kind].ended) throw failure();
    await io.audit(base);
    await io.free(port); if (kind === 'broker') await io.free(controllerPort);
    const h = handles[kind] = launch(io.spawn, runtime, kind, args, base);
    let auditing = false;
    const monitor = setInterval(async () => {
      if (auditing) return; auditing = true;
      try { await io.audit(base); if (h.error) throw failure(); }
      catch { h.error = true; try { await stopHandle(h); } catch { /* handles retains unresolved ownership */ } }
      finally { auditing = false; }
    }, 250);
    monitor.unref(); h.done.then(() => clearInterval(monitor));
    try {
      const deadline = Date.now() + io.startupMs;
      while (Date.now() < deadline && !h.ended && !h.error) {
        let isReady = false;
        const completed = await bounded(Promise.resolve().then(() => io.ready(port, kind === 'connect')).then(value => { isReady = value === true; }), Math.min(500, deadline - Date.now()));
        if (completed && isReady && !h.ended && !h.error) return h.child;
        await sleep(50);
      }
      throw failure();
    } catch { await stopHandle(h); throw failure(); }
  }
  async function startConnector(settings) {
    if (!handles.broker || handles.broker.ended || handles.broker.error || handles.connect && !handles.connect.ended) throw failure();
    keys(settings, connectorKeys);
    // Preserve one connector identity and durable offset namespace per runtime.
    if (saved && (Object.keys(settings).length !== Object.keys(saved).length || Object.keys(saved).some(key => settings[key] !== saved[key]))) throw failure();
    for (const field of ['database.user', 'database.password']) if (typeof settings[field] !== 'string' || !settings[field]) throw failure();
    if (settings['connector.class'] !== 'io.debezium.connector.mariadb.MariaDbConnector' || settings['database.hostname'] !== '127.0.0.1' || settings['decimal.handling.mode'] !== 'string' || settings['database.ssl.mode'] !== 'verify-full') throw failure();
    if (!/^[1-9][0-9]{3,4}$/.test(String(settings['database.port']))) throw failure();
    validPort(Number(settings['database.port']));
    for (const field of ['name', 'database.include.list', 'table.include.list', 'column.include.list', 'topic.prefix']) if (typeof settings[field] !== 'string' || !settings[field]) throw failure();
    for (const field of ['name', 'topic.prefix', 'database.include.list']) if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(settings[field])) throw failure();
    for (const field of ['table.include.list', 'column.include.list']) if (!/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*){1,2}(,[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*){1,2})*$/.test(settings[field]) || settings[field].length > 1024) throw failure();
    if (settings['snapshot.mode'] !== undefined && settings['snapshot.mode'] !== 'initial') throw failure();
    for (const [field, limit] of [['max.batch.size', 2000], ['max.queue.size', 4000], ['poll.interval.ms', 1000], ['database.server.id', 2147483647]]) {
      if (settings[field] !== undefined && (!/^[1-9][0-9]*$/.test(String(settings[field])) || Number(settings[field]) > limit)) throw failure();
    }
    for (const field of ['include.schema.changes', 'tombstones.on.delete']) if (settings[field] !== undefined && !['true', 'false'].includes(String(settings[field]))) throw failure();
    if (settings['database.ssl.truststore'] && settings['database.ssl.truststore'] !== join(base, 'source.truststore')) throw failure();
    const text = properties({ 'max.batch.size': 256, 'max.queue.size': 1024, 'poll.interval.ms': 100, 'snapshot.mode': 'initial', ...settings,
      'table.include.list': settings['table.include.list'].replaceAll('.', '\\.'),
      'column.include.list': settings['column.include.list'].replaceAll('.', '\\.'),
      'tasks.max': 1, 'schema.history.internal.kafka.bootstrap.servers': `127.0.0.1:${brokerPort}`, 'schema.history.internal.kafka.topic': schemaHistoryTopic });
    await io.audit(base);
    if (saved) await io.rm(connectorConfig);
    await io.writeFile(connectorConfig, text, { mode: 0o600, flag: 'wx' }); saved = { ...settings };
    return start('connect', classArgs('org.apache.kafka.connect.cli.ConnectStandalone', [workerConfig, connectorConfig]), restPort);
  }
  async function stopAll() {
    // Flush standalone offsets before stopping Kafka; still attempt the broker
    // if Connect shutdown cannot be proven.
    let failed = false;
    try { await stopHandle(handles.connect); } catch { failed = true; }
    try { await stopHandle(handles.broker); } catch { failed = true; }
    if (failed) throw failure();
  }
  const api = {
    base, brokerPort, controllerPort, restPort, offsetFile, schemaHistoryTopic,
    get handles() { return Object.freeze({ broker: handles.broker?.child ?? null, connect: handles.connect?.child ?? null }); },
    startKafka: () => exclusive(async () => {
      if (handles.broker && !handles.broker.ended) throw failure();
      await io.verify();
      await io.audit(base);
      if (!formatted) { await command(io.spawn, runtime, classArgs('kafka.tools.StorageTool', ['format', '--cluster-id', clusterId, '--config', brokerConfig]), 10000, base); formatted = true; }
      return start('broker', classArgs('kafka.Kafka', [brokerConfig]), brokerPort);
    }),
    stopKafka: () => exclusive(stopAll),
    startConnect: settings => exclusive(async () => { await io.verify(); return startConnector(settings); }),
    stopConnect: () => exclusive(() => stopHandle(handles.connect)),
    restartConnect: () => exclusive(async () => { if (!saved) throw failure(); await stopHandle(handles.connect); await io.verify(); return startConnector(saved); }),
    cli: (tool, settings = {}) => exclusive(async () => {
      if (!handles.broker || handles.broker.ended) throw failure();
      keys(settings, ['topic', 'maxMessages']);
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,120}$/.test(settings.topic ?? '')) throw failure();
      const args = ['--bootstrap-server', `127.0.0.1:${brokerPort}`]; let name;
      if (tool === 'createTopic') {
        if (settings.maxMessages !== undefined) throw failure();
        name = 'org.apache.kafka.tools.TopicCommand'; args.push('--create', '--topic', settings.topic, '--partitions', '1', '--replication-factor', '1');
      } else if (tool === 'consume') {
        if (!Number.isInteger(settings.maxMessages) || settings.maxMessages < 1 || settings.maxMessages > 2000) throw failure();
        name = 'org.apache.kafka.tools.consumer.ConsoleConsumer';
        args.push('--topic', settings.topic, '--from-beginning', '--max-messages', String(settings.maxMessages), '--timeout-ms', '10000', '--property', 'print.key=true', '--property', 'print.offset=true', '--property', 'print.partition=true');
      } else throw failure();
      await io.verify(); await io.audit(base);
      return command(io.spawn, runtime, classArgs(name, args), 15000, base, true);
    }),
    stop: () => api.stopKafka(),
    dispose: () => exclusive(async () => { await stopAll(); await io.audit(base); await io.rm(base, { recursive: true }); disposed = true; })
  };
  return api;
}
