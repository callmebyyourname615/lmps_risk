/** Installed Redis fixture; import and invalid CLI are inert.
 * Host: createRuntime({output: '.local/new-name'}) -> ready(), status(),
 * request(string[]), stop(), receipt(). stop is idempotent and removes only the
 * exclusively created private directory after ChildProcess close. No PID lookup.
 * CLI: node .../feature-cache-runtime.mjs --output .local/new-name
 * performs bounded readiness/PING/stop and emits only its compact receipt.
 * The parent alone runs native trials. Unit seams never prove native acceptance.
 * Fixed profile: 16MiB Redis maxmemory/noeviction, 8 clients, 2MiB request/reply,
 * 64KiB process output, 1s requests, 5s readiness, 150s lifetime, 2x2s teardown.
 * No persistence/disk-writing commands; private scratch cap 2GiB, receipt <16KiB.
 * Authentication secret is ephemeral, never retained in receipts or logs.
 */
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readFile, mkdir, writeFile, rm, realpath, readdir } from 'node:fs/promises';
import { dirname, resolve, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, connect } from 'node:net';
import { userInfo } from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const pinURL = new URL('../fixtures/feature-cache-runtime.json', import.meta.url);
const sourceBinary = '/opt/homebrew/Cellar/redis/8.10.1/bin/redis-server';
const binary = join(userInfo().homedir, '.cache/lmps-redis-fixture/8.10.1/redis-server');
const digest = '48a07c38 92d5982a 1af6c3fb b9db896b 50e7aa56 4b1d4e6a bcb12fcb 6b6b6e0d'.replaceAll(' ', '');
const L = Object.freeze({ requestBytes: 2097152, replyBytes: 2097152, outputBytes: 65536, commandMs: 1000, startupMs: 5000, lifetimeMs: 150000, stopMs: 2000 });
const fail = () => new Error('Installed fixture unavailable; verification or ownership failed.');
const live = new Set();
export function ownedProcessHandles() { return Object.freeze([...live].map(h => h.child)); }
function exact(o, names) { if (!o || typeof o !== 'object' || Array.isArray(o) || Object.keys(o).some(k => !names.includes(k))) throw fail(); }
export function validateDestination(output) {
  if (typeof output !== 'string' || !/^\.local\/[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(output)) throw fail();
  return resolve(root, output);
}
export function validatePort(port) { if (!Number.isInteger(port) || port < 1024 || port > 65535) throw fail(); return port; }
async function checked(path, directory, privateMode = false) {
  const s = await lstat(path);
  if (s.isSymbolicLink() || (directory ? !s.isDirectory() : !s.isFile()) || ![0, process.getuid()].includes(s.uid) || s.mode & (privateMode ? 0o077 : 0o022)) throw fail();
  if (privateMode && s.uid !== process.getuid()) throw fail();
  return s;
}
async function ancestors(path) {
  let p = '/';
  for (const part of path.split('/').filter(Boolean)) { p = join(p, part); await checked(p, true); }
}
async function within(promise, ms) {
  let t; try { return await Promise.race([promise, new Promise((_, reject) => { t = setTimeout(() => reject(fail()), ms); })]); }
  finally { clearTimeout(t); }
}
function launch(spawner, args, cwd) {
  let child; const old = process.umask(0o077);
  try { child = spawner(binary, args, { cwd, env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' }, shell: false, stdio: ['ignore', 'pipe', 'pipe'] }); }
  finally { process.umask(old); }
  const h = { child, ended: false, bad: false, bytes: 0, text: '' }; live.add(h);
  h.done = new Promise(r => {
    child.once('error', () => { h.bad = true; });
    child.once('close', code => { h.ended = true; h.code = code; live.delete(h); r(); });
  });
  for (const stream of [child.stdout, child.stderr]) stream?.on('data', b => {
    h.bytes += b.length;
    if (h.bytes > L.outputBytes) { h.bad = true; stopHandle(h).catch(() => {}); }
    else if (args[0] === '--version') h.text += b.toString();
  });
  return h;
}
async function stopHandle(h) {
  if (h.ended) return;
  if (!h.stopping) h.stopping = (async () => {
    h.child.kill('SIGTERM');
    try { await within(h.done, L.stopMs); }
    catch { h.child.kill('SIGKILL'); await within(h.done, L.stopMs); }
  })();
  return h.stopping;
}
/** Explicit unit seam, never accepted by default CLI. */
export async function testChild(spawner, timeoutMs = 10) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 1000) throw fail();
  const h = launch(spawner, ['--version'], root);
  try { await within(h.done, timeoutMs); if (h.bad || h.code !== 0) throw fail(); return h.text; }
  finally { await stopHandle(h); }
}
export function validateProvenance(pin, observed) {
  if (pin.binary !== binary || pin.source_binary !== sourceBinary || pin.version !== '8.10.1' || pin.sha256.replaceAll(' ', '') !== digest || observed.path !== binary || observed.sha256 !== digest || !/^Redis server v=8\.10\.1(?:\s|$)/.test(observed.version)) throw fail();
  return true;
}
export async function verifyRuntime() {
  try {
    if ((await checked(fileURLToPath(pinURL), false)).size > 16384) throw fail();
    const pin = JSON.parse(await readFile(pinURL, 'utf8'));
    await ancestors(dirname(binary));
    let sha256;
    // Read the installed artifact, then execute only its pinned copy under private ancestors.
    for (const path of [sourceBinary, binary]) {
      const s = await checked(path, false);
      if (!(s.mode & 0o111) || s.nlink !== 1 || s.size < 1 || s.size > 64 * 1024 ** 2 || await realpath(path) !== path) throw fail();
      const f = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const before = await f.stat(); const hash = createHash('sha256');
        for await (const chunk of f.createReadStream({ autoClose: false, start: 0, end: s.size - 1 })) hash.update(chunk);
        const after = await f.stat();
        if (before.ino !== s.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw fail();
        sha256 = hash.digest('hex');
      } finally { await f.close(); }
      if (sha256 !== digest) throw fail();
    }
    // Never execute even --version until the host-specific hash matches.
    validateProvenance(pin, { path: binary, sha256, version: 'Redis server v=8.10.1' });
    const h = launch(spawn, ['--version'], root);
    try { await within(h.done, L.commandMs); if (h.bad || h.code !== 0) throw fail(); validateProvenance(pin, { path: binary, sha256, version: h.text.trim() }); }
    finally { await stopHandle(h); }
    return Object.freeze({ binary, sha256, version: '8.10.1' });
  } catch { throw fail(); }
}
export function encodeRequest(args) {
  if (!Array.isArray(args) || !args.length || args.length > 4096 || args.some(a => typeof a !== 'string' || Buffer.byteLength(a) > L.requestBytes)) throw fail();
  if (args.reduce((n, a) => n + Buffer.byteLength(a) + 32, 32) > L.requestBytes) throw fail();
  return Buffer.from(`*${args.length}\r\n` + args.map(a => `$${Buffer.byteLength(a)}\r\n${a}\r\n`).join(''));
}
/** Bounded RESP2 parser: incomplete=null; Redis errors discard diagnostics. */
export function parseReply(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length > L.replyBytes) throw fail();
  let nodes = 0;
  function value(start, depth) {
    if (++nodes > 8192 || depth > 16) throw fail();
    const end = buffer.indexOf('\r\n', start); if (end < 0) return null;
    const kind = String.fromCharCode(buffer[start]), text = buffer.toString('utf8', start + 1, end); let at = end + 2;
    if (kind === '-') throw fail();
    if (kind === '+') return { value: text, end: at };
    if (!/^-?(0|[1-9][0-9]*)$/.test(text)) throw fail();
    const n = Number(text); if (!Number.isSafeInteger(n)) throw fail();
    if (kind === ':') return { value: n, end: at };
    if (!['$', '*'].includes(kind) || n < -1 || n > (kind === '*' ? 4096 : L.replyBytes)) throw fail();
    if (n === -1) return { value: null, end: at };
    if (kind === '$') {
      if (at + n + 2 > buffer.length) return null;
      if (buffer.toString('ascii', at + n, at + n + 2) !== '\r\n') throw fail();
      return { value: buffer.toString('utf8', at, at + n), end: at + n + 2 };
    }
    const result = [];
    for (let i = 0; i < n; i++) { const item = value(at, depth + 1); if (!item) return null; result.push(item.value); at = item.end; }
    return { value: result, end: at };
  }
  const result = value(0, 0); if (result && result.end !== buffer.length) throw fail(); return result;
}
function exchange(path, secret, args, sockets, connector = connect, timeoutMs = L.commandMs) {
  const auth = encodeRequest(['AUTH', secret]), command = encodeRequest(args);
  return new Promise((res, rej) => {
    const socket = connector({ path }); sockets.add(socket); let data = Buffer.alloc(0), settled = false, authenticated = false, total = 0;
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); socket.destroy(); error ? rej(fail()) : res(value); };
    const timer = setTimeout(() => finish(true), timeoutMs);
    socket.once('connect', () => socket.write(auth)); socket.once('error', () => finish(true)); socket.once('end', () => finish(true));
    socket.once('close', () => { sockets.delete(socket); finish(true); });
    socket.on('data', chunk => {
      try {
        total += chunk.length; if (total > L.replyBytes) throw fail();
        data = Buffer.concat([data, chunk]); const parsed = parseReply(data); if (!parsed) return;
        if (!authenticated) { if (parsed.value !== 'OK') throw fail(); authenticated = true; data = Buffer.alloc(0); socket.write(command); }
        else finish(false, parsed.value);
      } catch { finish(true); }
    });
  });
}
/** Socket double seam for protocol tests only; never a receipt or runtime. */
export async function testTransport(connector, args, timeoutMs = 10) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 1000) throw fail();
  return exchange('unit-only.sock', 'a'.repeat(64), args, new Set(), connector, timeoutMs);
}
async function allocatePort() {
  const server = createServer();
  try {
    await within(new Promise((res, rej) => { server.once('error', rej); server.listen(0, '127.0.0.1', res); }), L.commandMs);
    return validatePort(server.address().port);
  } finally { if (server.listening) await new Promise((res, rej) => server.close(e => e ? rej(e) : res())); }
}
export function configuration(port, secret) {
  validatePort(port); if (!/^[a-f0-9]{64}$/.test(secret)) throw fail();
  return [
    'bind 127.0.0.1', 'protected-mode yes', `port ${port}`, `requirepass ${secret}`,
    'unixsocket redis.sock', 'unixsocketperm 700', 'daemonize no', 'supervised no',
    'dir .', 'pidfile ""', 'save ""', 'appendonly no', 'maxmemory 16777216', 'maxmemory-policy noeviction',
    'maxclients 8', 'client-query-buffer-limit 2097152', 'proto-max-bulk-len 2097152',
    'client-output-buffer-limit normal 2097152 1048576 1', 'timeout 2', 'tcp-keepalive 1',
    'loglevel warning', 'logfile ""', 'slowlog-log-slower-than -1', 'latency-monitor-threshold 0',
    'lua-time-limit 100', 'enable-debug-command no', 'enable-module-command no',
    ...['CONFIG', 'SAVE', 'BGSAVE', 'BGREWRITEAOF', 'REPLICAOF', 'SLAVEOF', 'MIGRATE', 'MODULE', 'FLUSHALL', 'FLUSHDB', 'SHUTDOWN', 'ACL'].map(c => `rename-command ${c} ""`)
  ].join('\n') + '\n';
}
async function audit(base, identity) {
  const s = await checked(base, true, true);
  if (s.ino !== identity.ino || s.dev !== identity.dev) throw fail();
  let bytes = 0;
  for (const name of await readdir(base)) {
    if (!['redis.conf', 'redis.sock'].includes(name)) throw fail();
    const f = await lstat(join(base, name));
    if (f.isSymbolicLink() || f.nlink !== 1 || f.uid !== process.getuid() || f.mode & 0o077 || !(name === 'redis.conf' && f.isFile() || name === 'redis.sock' && f.isSocket())) throw fail();
    bytes += f.size;
  }
  if (bytes > 2 * 1024 ** 3) throw fail();
}
const defaults = { verify: verifyRuntime, spawn, port: allocatePort, exchange, startupMs: L.startupMs };
/** Explicit test-only adapter; receipts permanently unit_only=true. */
export async function createRuntime(options, unit) {
  exact(options, ['output']); const base = validateDestination(options.output);
  const d = unit ? { ...defaults, ...unit } : defaults;
  // This relative path is generated from the validated owned destination; package callers need parent segments.
  const socketPath = relative(process.cwd(), join(base, 'redis.sock'));
  if (Buffer.byteLength(socketPath) > 103 || !socketPath) throw fail();
  let h, identity, timer, monitor, failed = false, stopped = false, ready = false, requests = 0, inFlight = false;
  const sockets = new Set(); let stopping;
  const interrupted = () => { failed = true; stop().catch(() => {}); };
  const stop = () => stopping ??= (async () => {
    clearTimeout(timer); clearInterval(monitor); ready = false; for (const s of sockets) s.destroy();
    if (h && (h.ended || h.bad)) failed = true;
    if (h) await stopHandle(h);
    if (identity) { await audit(base, identity); await rm(base, { recursive: true }); }
    stopped = true;
  })().catch(() => { failed = true; throw fail(); }).finally(() => {
    process.off('SIGINT', interrupted); process.off('SIGTERM', interrupted);
  });
  try {
    const verified = await d.verify();
    if (verified.binary !== binary || verified.sha256 !== digest || verified.version !== '8.10.1') throw fail();
    await ancestors(root);
    try { await mkdir(join(root, '.local'), { mode: 0o700 }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
    await checked(join(root, '.local'), true, true);
    await mkdir(base, { mode: 0o700 }); identity = await checked(base, true, true);
    const selected = validatePort(await d.port()); const secret = randomBytes(32).toString('hex');
    const config = configuration(selected, secret);
    await writeFile(join(base, 'redis.conf'), config, { mode: 0o600, flag: 'wx' });
    // Rehash/version/provenance immediately before every actual server launch.
    if (!unit) await verifyRuntime();
    h = launch(d.spawn, ['redis.conf'], base);
    process.on('SIGINT', interrupted); process.on('SIGTERM', interrupted);
    timer = setTimeout(() => { failed = true; stop().catch(() => {}); }, L.lifetimeMs);
    monitor = setInterval(() => { audit(base, identity).catch(() => { failed = true; stop().catch(() => {}); }); }, 250);
    const deadline = Date.now() + Math.min(d.startupMs, L.startupMs);
    while (Date.now() < deadline) {
      if (h.ended || h.bad) throw fail();
      try { if (await within(d.exchange(socketPath, secret, ['PING'], sockets), Math.max(1, deadline - Date.now())) === 'PONG') { ready = true; break; } } catch { /* bounded readiness retry */ }
      await new Promise(r => setTimeout(r, 20));
    }
    if (!ready || failed || h.ended || h.bad) throw fail();
    const status = () => Object.freeze({ state: stopped ? (failed ? 'unavailable' : 'stopped') : failed || h.bad || h.ended ? 'unavailable' : ready ? 'ready' : 'starting', owned: !h.ended, port: selected, production_ready: false });
    const request = async args => {
      if (failed || stopped || h.ended || h.bad || inFlight) throw fail();
      encodeRequest(args);
      if (!['PING', 'GET', 'SET', 'DEL', 'EXISTS', 'PTTL', 'PEXPIRE', 'EVAL', 'DBSIZE', 'MGET'].includes(args[0])) throw fail();
      inFlight = true; requests++;
      try {
        await audit(base, identity);
        const result = await within(d.exchange(socketPath, secret, args, sockets), L.commandMs);
        if (failed || stopped || h.ended || h.bad) throw fail();
        return result;
      }
      catch { failed = true; await stop(); throw fail(); }
      finally { inFlight = false; }
    };
    return Object.freeze({ ready: () => status().state === 'ready', status, request, stop,
      receipt: () => Object.freeze({ format: 1, mode: 'local_synthetic', unit_only: !!unit, native_acceptance: false, production_ready: false, state: status().state, cleanup_verified: stopped && h.ended, requests, outputBytes: h.bytes, binarySha256: digest, configSha256: createHash('sha256').update(config).digest('hex') }) });
  } catch { failed = true; await stop(); throw fail(); }
}
export function parseCli(args) {
  if (!Array.isArray(args) || args.length !== 2 || args[0] !== '--output') throw fail();
  validateDestination(args[1]); return { output: args[1] };
}
export async function main(args) {
  const options = parseCli(args); let runtime;
  try {
    runtime = await createRuntime(options);
    if (!runtime.ready() || await runtime.request(['PING']) !== 'PONG') throw fail();
    await runtime.stop(); const receipt = runtime.receipt();
    if (!receipt.cleanup_verified || receipt.state !== 'stopped') throw fail();
    return receipt;
  } finally { if (runtime) await runtime.stop(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(r => { process.stdout.write(JSON.stringify(r) + '\n'); }, () => {
    process.stderr.write('Installed fixture unavailable; no acceptance published.\n'); process.exitCode = 1;
  });
}
