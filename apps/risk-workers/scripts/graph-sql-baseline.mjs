import { constants } from 'node:fs';
import { lstat, readFile, mkdir, open, readdir, rm, realpath, statfs } from 'node:fs/promises';
import { resolve, dirname, join, parse } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { createConnection } from 'node:net';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const limit = 16777216;
function check(value) { if (!value) throw new Error('GRAPH_SQL_INVALID'); }
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function parseArguments(args) {
  check(Array.isArray(args) && args.length === 2 && args[0] === '--output' && typeof args[1] === 'string');
  const output = args[1];
  check(output === resolve(output) && output.startsWith(join(root, '.local') + '/') && !output.includes('\0'));
  check(!output.startsWith(join(root, '.local/postgres')));
  return output;
}
async function ancestors(path) {
  let current = parse(path).root;
  for (const part of path.slice(current.length).split('/').filter(Boolean)) {
    current = join(current, part);
    const s = await lstat(current);
    check(s.isDirectory() && !s.isSymbolicLink());
  }
  const s = await lstat(path);
  check(s.uid === process.getuid() && !(s.mode & 0o022));
}
async function exclusive(path, bytes) {
  check(Buffer.byteLength(bytes) <= limit);
  const f = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o400);
  try { await f.writeFile(bytes); await f.sync(); } finally { await f.close(); }
}
async function boundedRead(path, max = 2097152) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    check(stat.isFile() && stat.size <= max);
    const bytes = Buffer.alloc(max + 1);
    let size = 0;
    while (size < bytes.length) {
      const read = await file.read(bytes,size,bytes.length-size,size);
      if (!read.bytesRead) break;
      size += read.bytesRead;
    }
    check(size <= max && size === stat.size);
    return bytes.subarray(0,size);
  } finally { await file.close(); }
}
export function encodeGraphSqlEvidence(report) {
  check(report && report.scope === 'local_synthetic' && report.production_ready === false && report.cleanup === 'confirmed');
  check(Number.isFinite(report.elapsed_ms) && report.elapsed_ms >= 0 && report.elapsed_ms <= 180000);
  const bytes = JSON.stringify(report);
  check(Buffer.byteLength(bytes) <= limit);
  return bytes;
}
async function footprint(path) {
  let bytes = 0;
  for (const name of await readdir(path)) {
    const p = join(path, name), s = await lstat(p);
    check(!s.isSymbolicLink());
    bytes += s.isDirectory() ? await footprint(p) : s.size;
    check(bytes <= 2147483648);
  }
  return bytes;
}
async function listener(port) {
  return new Promise(accept => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.setTimeout(1000);
    socket.once('connect', () => { socket.destroy(); accept(true); });
    socket.once('error', () => { socket.destroy(); accept(false); });
    socket.once('timeout', () => { socket.destroy(); accept(true); });
  });
}
async function provenance() {
  const paths = ['src/graph-sql.ts','dist/graph-sql.js','src/graph-benchmark-contract.ts','dist/graph-benchmark-contract.js','fixtures/graph-benchmark.json','scripts/graph-sql-baseline.mjs'];
  const result = {};
  for (const path of paths) result[path] = hash(await boundedRead(new URL('../' + path, import.meta.url)));
  for (const path of ['packages/database/scripts/local.mjs','infrastructure/postgres/major-version','infrastructure/postgres/postgresql.conf']) result[path] = hash(await boundedRead(join(root,path)));
  return result;
}

// Discovery invokes the existing pinned binary/version helper in its own owned
// process group. A hung discovery cannot consume the lifecycle teardown reserve.
async function discoverRuntime() {
  const { spawn } = await import('node:child_process');
  const url = new URL('../../../packages/database/scripts/local.mjs', import.meta.url).href;
  const child = spawn(process.execPath, ['--input-type=module', '-e', `const m=await import(${JSON.stringify(url)});m.localMode();process.stdout.write(JSON.stringify(m.binaryDirectory()))`], { detached:true, stdio:['ignore','pipe','pipe'] });
  let text = '', bytes = 0, bad = false;
  const kill = () => { bad = true; try { process.kill(-child.pid, 'SIGKILL'); } catch (e) { if (e.code !== 'ESRCH') bad = true; } };
  child.stdout.on('data', b => { bytes += b.length; if (bytes > 65536) kill(); else text += b; });
  child.stderr.on('data', b => { bytes += b.length; if (bytes > 65536) kill(); });
  const timer = setTimeout(kill, 10000);
  try {
    const code = await new Promise((accept,reject) => { child.once('error',reject); child.once('close',accept); });
    check(!bad && code === 0);
    const result = JSON.parse(text);
    check(result.directory === resolve(result.directory) && /^\d+\.\d+$/.test(result.version));
    return result;
  } finally { clearTimeout(timer); if (child.exitCode === null && child.signalCode === null) kill(); }
}

async function waitClosed(child, milliseconds) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  let timer;
  try { await Promise.race([new Promise(accept => child.once('close',accept)), new Promise((_,reject) => { timer = setTimeout(() => reject(new Error('GRAPH_SQL_INVALID')), milliseconds); })]); }
  finally { clearTimeout(timer); }
}

async function initializeOwned(binaries, scratch, password, signal) {
  const { spawn } = await import('node:child_process');
  // initdb can spawn a bootstrap postgres process. The fresh detached group
  // belongs solely to this invocation, so timeout also reaps those descendants.
  const child = spawn(join(binaries.directory,'initdb'), ['-D',join(scratch,'data'),'-U','lmps_bootstrap','--pwfile',password,'--auth-host=scram-sha-256','--auth-local=reject','--encoding=UTF8','--locale=C','--no-instructions'], { detached:true,stdio:['ignore','pipe','pipe'] });
  let bad = false, bytes = 0;
  const kill = () => {
    bad = true;
    try { process.kill(-child.pid,'SIGKILL'); } catch (e) { check(e.code === 'ESRCH'); }
  };
  const bounded = b => { bytes += b.length; if (bytes > 1048576) kill(); };
  child.stdout.on('data',bounded); child.stderr.on('data',bounded);
  signal.addEventListener('abort',kill,{once:true});
  const timer = setTimeout(kill,20000);
  try {
    if (signal.aborted) kill();
    const code = await new Promise((accept,reject) => { child.once('error',reject); child.once('close',accept); });
    check(!bad && code === 0);
  } finally {
    clearTimeout(timer); signal.removeEventListener('abort',kill);
    if (child.exitCode === null && child.signalCode === null) kill();
  }
}

/** No runner/result/runtime override. This entry point always uses installed PostgreSQL. */
export async function runGraphSqlBaseline(output) {
  parseArguments(['--output', output]);
  await ancestors(dirname(output));
  try { await lstat(output); throw new Error('GRAPH_SQL_INVALID'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  // Reject environment connection/executable overrides; helper discovery uses pinned pg_config.
  check(!Object.keys(process.env).some(k => k.startsWith('PG') || k === 'LMPS_PG_BIN' || k.includes('POSTGRES_DSN')));
  const raw = await boundedRead(new URL('../fixtures/graph-benchmark.json', import.meta.url));
  check(raw.length <= 2097152);
  const fixture = JSON.parse(raw);
  const { graphSqlPlan, graphSqlProfiles } = await import('../dist/graph-sql.js');
  const { graphSemanticsIdentity } = await import('../dist/graph-benchmark-contract.js');
  check(fixture.version === 'local_synthetic_graph_fixture_v1' && fixture.cases.length <= 32);
  const inputs = [...fixture.cases.map(c => ({name:c.name,corpus:c.corpus})), ...graphSqlProfiles(fixture.cases[0].corpus).map((corpus,i) => ({name:['burst','skew','dense'][i],corpus}))];
  const plans = inputs.map(c => ({ ...c, plan: graphSqlPlan(c.corpus) }));
  const before = await provenance();
  const disk = await statfs(dirname(output));
  check(disk.bavail * disk.bsize >= 3221225472);
  await mkdir(output, { mode: 0o700 });
  const scratch = join(output, 'cluster');
  const started = performance.now();
  let state, client, server, runtime, expired = false, cleaned = false, observations = [], setup_ms;
  // Dynamic native import follows all corpus, CLI, destination and byte validation.
  runtime = await import('../../../packages/database/scripts/local.mjs');
  runtime.localMode();
  const abort = new AbortController();
  const interrupt = () => { expired = true; abort.abort(); if (client) void client.end().catch(() => {}); server?.kill('SIGTERM'); };
  const timer = setTimeout(interrupt, 145000);
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  const deadline = () => check(!expired && performance.now() - started < 150000);
  let monitor, monitoring = Promise.resolve();
  try {
    const binaries = await discoverRuntime();
    deadline();
    const port = await runtime.availablePort();
    check(!await listener(port));
    await mkdir(scratch, { mode:0o700 });
    const major = (await readFile(join(root,'infrastructure/postgres/major-version'),'utf8')).trim();
    check(binaries.version.startsWith(major + '.'));
    state = { format:1, base:await realpath(scratch), major, binaryDirectory:binaries.directory, serverVersion:binaries.version, port, passwords:{bootstrap:randomBytes(24).toString('base64url')} };
    await exclusive(join(scratch,'state.json'),JSON.stringify(state));
    const password = join(scratch,'init-password');
    await exclusive(password,state.passwords.bootstrap);
    const { spawn } = await import('node:child_process');
    try {
      await initializeOwned(binaries,scratch,password,abort.signal);
    } finally { await rm(password,{force:true}); }
    deadline();
    check((await runtime.loadState(scratch)).base === scratch);
    check(state.base === await realpath(scratch) && state.port === port && !runtime.running(state));
    const configuration = await readFile(join(root,'infrastructure/postgres/postgresql.conf'),'utf8');
    const config = await open(join(scratch,'data/postgresql.conf'),constants.O_WRONLY|constants.O_TRUNC|constants.O_NOFOLLOW);
    try { await config.writeFile(configuration + "\nmax_wal_size='64MB'\nmin_wal_size='32MB'\ntemp_file_limit='64MB'\n"); } finally { await config.close(); }
    // Foreground PostgreSQL remains a live child handle; no persisted PID or
    // configured service is ever signalled, and no application schema is created.
    server = spawn(join(binaries.directory,'postgres'),['-D',join(scratch,'data'),'-p',String(port)],{stdio:['ignore','pipe','pipe']});
    let logBytes = 0;
    const boundedLog = b => { logBytes += b.length; if (logBytes > 1048576) interrupt(); };
    server.stdout.on('data',boundedLog); server.stderr.on('data',boundedLog);
    let startError;
    server.once('error', e => { startError = e; });
    for (let attempts=0; !client && attempts<30; attempts++) {
      deadline(); check(!startError && server.exitCode === null && server.signalCode === null);
      try { client = await runtime.identify(state); } catch { await new Promise(accept => setTimeout(accept,100)); }
    }
    check(client);
    let checking = false;
    monitor = setInterval(() => {
      if (checking) return;
      checking = true;
      monitoring = footprint(scratch).catch(interrupt).finally(() => { checking = false; });
    },500);
    const identity = (await client.query("SELECT current_setting('data_directory') directory,current_setting('port') port,current_setting('listen_addresses') listen,current_user owner")).rows[0];
    check(identity.directory === join(state.base, 'data') && Number(identity.port) === port && identity.listen === '127.0.0.1' && identity.owner === 'lmps_bootstrap');
    await client.query("SET statement_timeout='3s'; SET lock_timeout='1s'; SET temp_file_limit='64MB'; SET work_mem='4MB'; SET timezone='UTC'");
    setup_ms = performance.now() - started;
    for (const { name, corpus, plan } of plans) {
      deadline();
      const setupStart = performance.now();
      await client.query(plan.setup);
      await client.query(plan.load.text, [...plan.load.values]);
      const fixture_setup_ms = performance.now() - setupStart;
      const queries = [];
      for (let i = 0; i < plan.queries.length; i++) {
        deadline();
        const p = plan.queries[i], q = corpus.queries[i], start = performance.now();
        const result = await client.query(p.text, [...p.values]);
        const query_ms = performance.now() - start;
        check(Buffer.byteLength(JSON.stringify(result.rows)) <= limit);
        const explain = await client.query('EXPLAIN (ANALYZE, FORMAT JSON, TIMING TRUE) ' + p.text, [...p.values]);
        queries.push({ id: p.id, profile: 'no_index', query_ms, timing_scope:'client_round_trip', repetitions:{observation:1,explain_analyze:1}, explain: explain.rows,
          selected_rows:Number(result.rows[0].selected_rows),loaded_rows:Number(result.rows[0].loaded_rows),
          observation: { ...result.rows[0].observation, corpus_sha256: plan.corpus_sha256, query_sha256: p.query_sha256, semantics_sha256: graphSemanticsIdentity(), currency: q.currency, namespace: q.namespace, source_prefix: q.source_prefix, coverage: q.coverage } });
      }
      observations.push({ name, fixture_setup_ms, queries });
      check(Buffer.byteLength(JSON.stringify(observations)) <= limit - 65536);
      await client.query('DROP TABLE graph_raw');
      await footprint(scratch);
    }
    deadline();
  } finally {
    clearTimeout(timer);
    clearInterval(monitor);
    await monitoring;
    let failure = false;
    try { await client?.end(); } catch { failure = true; }
    try {
      if (server) {
        server.kill('SIGTERM');
        try { await waitClosed(server,15000); } catch { server.kill('SIGKILL'); await waitClosed(server,2000); failure = true; }
        check(!runtime.running(state) && !await listener(state.port));
        try { await lstat(join(scratch, 'data/postmaster.pid')); failure = true; } catch (e) { if (e.code !== 'ENOENT') failure = true; }
      }
      check(!failure);
      await rm(scratch, { recursive: true, force:true });
      cleaned = true;
    } catch { failure = true; }
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
    check(!failure && cleaned && performance.now() - started <= 180000);
  }
  check(!expired && JSON.stringify(before) === JSON.stringify(await provenance()));
  const report = { version: 1, scope: 'local_synthetic', production_ready: false, profile: 'no_index', source_hashes: before,
    fixture_sha256: hash(raw), runtime: { node: process.version, postgres: state.serverVersion }, setup_ms, setup_scope:'binary_discovery_cluster_initialization_and_connection; temporary_table_load_reported_per_fixture', timing_unit:'milliseconds',
    elapsed_ms: performance.now() - started, cleanup: 'confirmed', observations };
  await exclusive(join(output, 'sql.json'), encodeGraphSqlEvidence(report));
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await runGraphSqlBaseline(parseArguments(process.argv.slice(2))); }
  catch { console.error('GRAPH_SQL_UNAVAILABLE'); process.exitCode = 1; }
}
