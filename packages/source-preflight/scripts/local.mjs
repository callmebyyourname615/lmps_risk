import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import mariadb from 'mariadb';

export const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const LOCAL = join(ROOT, '.local/mariadb');
const spec = JSON.parse(await readFile(join(ROOT, 'infrastructure/mariadb/runtime.json'), 'utf8'));
const mapping = JSON.parse(await readFile(join(ROOT, 'docs/data-dictionary/source-mapping.json'), 'utf8'));

function execute(binary, args) {
  try { return execFileSync(binary, args, { encoding: 'utf8', stdio: 'pipe', timeout: 60000 }); }
  catch { throw new Error('Native MariaDB/OpenSSL tool failed.'); }
}

export function localMode(env = process.env) {
  if (env.NODE_ENV === 'production' || !['local', 'test'].includes(env.LMPS_ENVIRONMENT ?? 'local') || (env.LMPS_EXECUTION_MODE ?? 'test') !== 'test') throw new Error('Local synthetic MariaDB only.');
}

export function nativeDirectory() {
  const base = process.env.LMPS_MARIADB_BASE ?? join(ROOT, '.local/mariadb-runtime', spec.formula, spec.bottle_version);
  if (!isAbsolute(base)) throw new Error('LMPS_MARIADB_BASE must be absolute.');
  let binary;
  for (const folder of ['bin', 'sbin']) {
    try {
      const path = join(base, folder, 'mariadbd');
      const version = execute(path, ['--no-defaults', '--version']);
      if (!version.includes(spec.series + '.') || !version.includes('MariaDB')) throw new Error();
      binary = path;
      break;
    } catch {}
  }
  if (!binary) throw new Error('Native MariaDB 11.8 runtime required.');
  return { base, binary, installer: join(base, 'bin/mariadb-install-db') };
}

export async function availablePort() {
  const server = createServer();
  await new Promise((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', accept); });
  const port = server.address().port;
  await new Promise((accept, reject) => server.close(error => error ? reject(error) : accept()));
  return port;
}

export async function loadState(base = LOCAL) {
  const root = await realpath(base);
  const directory = await lstat(base);
  const file = await lstat(join(base, 'state.json'));
  if (!directory.isDirectory() || directory.isSymbolicLink() || (directory.mode & 0o077) || directory.uid !== process.getuid() || !file.isFile() || file.isSymbolicLink() || (file.mode & 0o077) || file.uid !== process.getuid()) throw new Error('Unsafe local MariaDB state.');
  const state = JSON.parse(await readFile(join(base, 'state.json'), 'utf8'));
  if (state.format !== 1 || state.base !== root || state.kind !== 'local_synthetic' || !Number.isInteger(state.port) || state.port < 1024 || state.port > 65535 || (await lstat(join(base, 'data'))).isSymbolicLink()) throw new Error('Unowned local MariaDB state.');
  return state;
}

export async function admin(state, initial = false) {
  const connection = await mariadb.createConnection({ socketPath: join(state.base, 'server.sock'), user: 'root', password: initial ? '' : state.adminPassword, connectTimeout: 1000, socketTimeout: 3000, multipleStatements: false, trace: false });
  try {
    const rows = await connection.query('SELECT @@datadir AS directory');
    if (await realpath(rows[0].directory) !== join(state.base, 'data')) throw new Error();
    return connection;
  } catch {
    connection.destroy();
    throw new Error('Local MariaDB identity check failed.');
  }
}

export async function running(state) {
  try { const connection = await admin(state); await connection.end(); return true; }
  catch { return false; }
}

export async function startServer(state, bootstrap = false) {
  localMode();
  if (!bootstrap && await running(state)) return;
  const arguments_ = ['--no-defaults', '--basedir=' + state.runtime.base, '--datadir=' + join(state.base, 'data'), '--socket=' + join(state.base, 'server.sock'), '--pid-file=' + join(state.base, 'server.pid'), '--log-error=' + join(state.base, 'server.log'), '--bind-address=127.0.0.1', '--port=' + state.port, '--innodb-buffer-pool-size=32M', '--max-connections=12', '--performance-schema=OFF', '--general-log=OFF', '--slow-query-log=OFF', '--skip-name-resolve', '--ssl-ca=' + join(state.base, 'ca.crt'), '--ssl-cert=' + join(state.base, 'server.crt'), '--ssl-key=' + join(state.base, 'server.key'), '--require-secure-transport=ON', '--server-id=901', '--log-bin=' + join(state.base, 'local-bin'), '--binlog-format=ROW', '--binlog-row-image=FULL', '--log-slave-updates=ON'];
  if (bootstrap) arguments_.push('--skip-networking');
  else arguments_.push('--read-only=ON');
  const child = spawn(state.runtime.binary, arguments_, { detached: true, stdio: 'ignore' });
  let failed = false;
  child.once('error', () => { failed = true; });
  child.unref();
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && !failed && child.exitCode === null) {
    try { const connection = await admin(state, bootstrap); await connection.end(); return; } catch {}
    await new Promise(accept => setTimeout(accept, 75));
  }
  if (child.exitCode === null && child.pid) child.kill('SIGTERM');
  throw new Error('Owned MariaDB startup failed; see private local log.');
}

export async function stopServer(state) {
  let connection;
  try { connection = await admin(state); }
  catch {
    try { await lstat(join(state.base, 'server.pid')); } catch (error) { if (error.code === 'ENOENT') return; }
    throw new Error('Refusing to control an unverifiable MariaDB process.');
  }
  // SHUTDOWN may emit ER_CONNECTION_KILLED after its query resolves; verify the query and PID deadline below.
  connection.on('error', () => {});
  try { await connection.query('SHUTDOWN'); } finally { connection.destroy(); }
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try { await lstat(join(state.base, 'server.pid')); }
    catch (error) { if (error.code === 'ENOENT') return; }
    await new Promise(accept => setTimeout(accept, 50));
  }
  throw new Error('Owned MariaDB shutdown deadline exceeded.');
}

function identifier(value) {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error('Invalid synthetic fixture identifier.');
  return '`' + value + '`';
}

export async function initializeServer(base, port) {
  localMode();
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid local port.');
  const runtime = nativeDirectory();
  await mkdir(dirname(base), { recursive: true, mode: 0o700 });
  await mkdir(base, { mode: 0o700 });
  const canonical = await realpath(base);
  const state = { format: 1, kind: 'local_synthetic', base: canonical, port, runtime, ready: false, adminPassword: randomBytes(24).toString('base64url'), inspectorPassword: randomBytes(24).toString('base64url') };
  await writeFile(join(base, 'state.json'), JSON.stringify(state), { mode: 0o600, flag: 'wx' });
  execute(runtime.installer, ['--no-defaults', '--basedir=' + runtime.base, '--datadir=' + join(canonical, 'data'), '--auth-root-authentication-method=normal', '--skip-test-db']);
  execute('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '30', '-keyout', join(base, 'ca.key'), '-out', join(base, 'ca.crt'), '-subj', '/CN=LMPS Local Test CA']);
  execute('openssl', ['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(base, 'server.key'), '-out', join(base, 'server.csr'), '-subj', '/CN=lmps-source-local']);
  await writeFile(join(base, 'extensions.cnf'), 'subjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\nbasicConstraints=critical,CA:FALSE\n', { mode: 0o600 });
  execute('openssl', ['x509', '-req', '-in', join(base, 'server.csr'), '-CA', join(base, 'ca.crt'), '-CAkey', join(base, 'ca.key'), '-CAcreateserial', '-days', '30', '-out', join(base, 'server.crt'), '-extfile', join(base, 'extensions.cnf')]);
  for (const file of ['ca.key', 'ca.crt', 'server.key', 'server.crt', 'server.csr']) await chmod(join(base, file), 0o600);
  await writeFile(join(base, 'server.log'), '', { mode: 0o600, flag: 'wx' });
  await startServer(state, true);
  const connection = await admin(state, true);
  try {
    await connection.query(`ALTER USER 'root'@'localhost' IDENTIFIED BY '${state.adminPassword}'`);
    for (const account of await connection.query('SELECT User, Host FROM mysql.global_priv')) {
      if (account.User !== 'root' || account.Host !== 'localhost') await connection.query('DROP USER ' + connection.escape(account.User) + '@' + connection.escape(account.Host));
    }
    await connection.query("CREATE DATABASE lmps_source_local CHARACTER SET utf8mb4 COLLATE utf8mb4_bin");
    for (const [name, table] of Object.entries(mapping.source_tables)) {
      const columns = table.column_candidates.map(column => {
        if (!['int', 'tinyint', 'varchar', 'decimal', 'datetime', 'date'].includes(column.data_type)) throw new Error('Unsupported fixture type.');
        const parameters = column.numeric_parameters;
        if (!parameters.every(value => Number.isSafeInteger(value) && value >= 0 && value <= 5000)) throw new Error('Invalid fixture type width.');
        return identifier(column.name) + ' ' + column.data_type + (parameters.length ? '(' + parameters.join(',') + ')' : '') + (column.nullable ? ' NULL' : ' NOT NULL');
      });
      columns.push('PRIMARY KEY (' + table.primary_key.map(identifier).join(',') + ')');
      for (const key of table.unique_keys) columns.push('UNIQUE (' + key.map(identifier).join(',') + ')');
      await connection.query('CREATE TABLE lmps_source_local.' + identifier(name) + ' (' + columns.join(',') + ') ENGINE=InnoDB');
    }
    await connection.query(`CREATE USER 'lmps_preflight'@'127.0.0.1' IDENTIFIED BY '${state.inspectorPassword}' REQUIRE SSL`);
    for (const table of Object.keys(mapping.source_tables)) await connection.query('GRANT SELECT ON lmps_source_local.' + identifier(table) + " TO 'lmps_preflight'@'127.0.0.1'");
    await connection.query("GRANT REPLICA MONITOR ON *.* TO 'lmps_preflight'@'127.0.0.1'");
    state.ready = true;
    await writeFile(join(base, 'state.json'), JSON.stringify(state), { mode: 0o600 });
    await writeFile(join(base, 'preflight.json'), JSON.stringify({ kind: 'local_synthetic', host: '127.0.0.1', port, database: 'lmps_source_local', user: 'lmps_preflight', password: state.inspectorPassword, caFile: join(canonical, 'ca.crt') }), { mode: 0o600, flag: 'wx' });
  } finally { await connection.end(); await stopServer(state); }
  return state;
}

async function main() {
  localMode();
  const command = process.argv[2];
  if (command === 'init') {
    try {
      await lstat(LOCAL);
      if (!(await loadState()).ready) throw new Error();
      console.info('Synthetic MariaDB already initialized; unchanged.');
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error();
      await initializeServer(LOCAL, 18504);
      console.info('Synthetic MariaDB initialized at loopback port 18504 (stopped).');
    }
    return;
  }
  const state = await loadState();
  if (!state.ready) throw new Error('Incomplete synthetic bootstrap.');
  if (command === 'start') await startServer(state);
  else if (command === 'stop') await stopServer(state);
  else if (command === 'status') console.info(await running(state) ? 'Synthetic MariaDB running.' : 'Synthetic MariaDB stopped.');
  else throw new Error('Unknown synthetic MariaDB command.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => {
  console.error('Synthetic MariaDB command failed; no credentials/underlying diagnostics are printed. Inspect the private local log.');
  process.exitCode = 1;
});
