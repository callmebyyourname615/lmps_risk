import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, realpath, unlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

export const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const LOCAL = join(ROOT, '.local/postgres');
const configuration = await readFile(join(ROOT, 'infrastructure/postgres/postgresql.conf'), 'utf8');
const major = (await readFile(join(ROOT, 'infrastructure/postgres/major-version'), 'utf8')).trim();

function execute(binary, args) {
  try {
    return execFileSync(binary, args, { encoding: 'utf8', stdio: 'pipe', timeout: 60000 });
  } catch {
    throw new Error('Local PostgreSQL tool failed; inspect the private cluster log.');
  }
}

export function localMode(env = process.env) {
  if (env.NODE_ENV === 'production' || !['local', 'test'].includes(env.LMPS_ENVIRONMENT ?? 'local')
    || (env.LMPS_EXECUTION_MODE ?? 'test') !== 'test') {
    throw new Error('Local PostgreSQL tooling supports local/test mode only.');
  }
}

export function binaryDirectory() {
  const directory = process.env.LMPS_PG_BIN ?? execute('pg_config', ['--bindir']).trim();
  if (!isAbsolute(directory)) throw new Error('LMPS_PG_BIN must be an absolute directory.');
  const versions = ['postgres', 'pg_ctl', 'initdb'].map(name => execute(join(directory, name), ['--version']).match(/\(PostgreSQL\) (\d+\.\d+)/)?.[1]);
  if (versions.some(version => !version?.startsWith(major + '.') || version !== versions[0])) {
    throw new Error('PostgreSQL binary versions do not match the pinned major.');
  }
  return { directory, version: versions[0] };
}

async function regularFile(path) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077)) {
    throw new Error('Unsafe local PostgreSQL state permissions/type.');
  }
}

export async function loadState(base = LOCAL) {
  const canonical = await realpath(base);
  const info = await lstat(base);
  if (info.isSymbolicLink() || !info.isDirectory() || (info.mode & 0o077)) throw new Error('Unsafe cluster directory.');
  await regularFile(join(base, 'state.json'));
  const state = JSON.parse(await readFile(join(base, 'state.json'), 'utf8'));
  if (state.format !== 1 || state.base !== canonical || state.major !== major
    || !Number.isInteger(state.port) || state.port < 1024 || state.port > 65535
    || !(await lstat(join(base, 'data'))).isDirectory()
    || (await lstat(join(base, 'data'))).isSymbolicLink()
    || (await readFile(join(base, 'data/PG_VERSION'), 'utf8')).trim() !== major) {
    throw new Error('Unowned or incompatible local PostgreSQL cluster.');
  }
  return state;
}

export function dsn(state, role = 'app') {
  const user = { app: 'lmps_app', migration: 'lmps_migrator', intake: 'lmps_intake', outbox: 'lmps_outbox', reviewer: 'lmps_reviewer', policy: 'lmps_policy', case: 'lmps_case' }[role];
  if (!user || !state.passwords[role]) throw new Error('Unknown/unprepared local role.');
  return `postgresql://${user}:${encodeURIComponent(state.passwords[role])}@127.0.0.1:${state.port}/lmps_risk_local`;
}

export function running(state) {
  try {
    execFileSync(join(state.binaryDirectory, 'pg_ctl'), ['-D', join(state.base, 'data'), 'status'], { stdio: 'pipe', timeout: 5000 });
    return true;
  } catch (error) {
    if (error.status === 3) return false;
    throw new Error('Could not inspect the owned PostgreSQL cluster.');
  }
}

export async function identify(state, database = 'postgres') {
  if (!['postgres', 'lmps_risk_local'].includes(database)) throw new Error('Unsupported owned local database.');
  const client = new pg.Client({ host: '127.0.0.1', port: state.port, user: 'lmps_bootstrap', password: state.passwords.bootstrap, database, ssl: false, connectionTimeoutMillis: 1000, query_timeout: 2000 });
  try {
    await client.connect();
    const result = await client.query("SELECT current_setting('data_directory') AS directory");
    if (await realpath(result.rows[0].directory) !== join(state.base, 'data')) throw new Error('Cluster identity mismatch.');
    return client;
  } catch {
    await client.end();
    throw new Error('Could not verify the owned local cluster.');
  }
}

export async function prepareIntake(state) {
  localMode();
  const client = await identify(state);
  try {
    const existing = (await client.query("SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls, rolinherit, NOT rolcanlogin AS login_disabled FROM pg_roles WHERE rolname='lmps_intake'")).rows[0];
    if (existing && (!state.passwords.intake || Object.values(existing).some(Boolean)
      || (await client.query("SELECT 1 FROM pg_auth_members WHERE member='lmps_intake'::regrole")).rowCount)) throw new Error('Unowned/privileged intake role.');
    if (!state.passwords.intake) {
      state.passwords.intake = randomBytes(24).toString('base64url');
      await writeFile(join(state.base, 'state.json'), JSON.stringify(state), { mode: 0o600 });
    }
    if (!existing) await client.query(`CREATE ROLE lmps_intake LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${state.passwords.intake}'`);
    await client.query('GRANT CONNECT ON DATABASE lmps_risk_local TO lmps_intake');
    const path = join(state.base, 'data/pg_hba.conf');
    await regularFile(path);
    const original = await readFile(path, 'utf8');
    const before = 'host lmps_risk_local lmps_migrator,lmps_app 127.0.0.1/32 scram-sha-256';
    const previous = 'host lmps_risk_local lmps_migrator,lmps_app,lmps_intake 127.0.0.1/32 scram-sha-256';
    const after = 'host lmps_risk_local lmps_migrator,lmps_app,lmps_intake,lmps_outbox 127.0.0.1/32 scram-sha-256';
    const current = [before, previous, after].find(line => original.split('\n').includes(line));
    if (!current) throw new Error('Local HBA rule not recognized.');
    if (current !== after) {
      await writeFile(path, original.replace(current, after), { mode: 0o600 });
      await client.query('SELECT pg_reload_conf()');
      await new Promise(accept => setTimeout(accept, 100));
    }
    const probe = new pg.Client({ connectionString: dsn(state, 'intake'), ssl: false, connectionTimeoutMillis: 1000, query_timeout: 1000 });
    try { await probe.connect(); await probe.query('SELECT 1'); }
    catch { throw new Error('Intake role authentication check failed.'); }
    finally { await probe.end(); }
    await writeFile(join(state.base, 'intake.env'), `LMPS_POSTGRES_DSN=${dsn(state, 'intake')}\n`, { mode: 0o600 });
  } finally { await client.end(); }
}

export async function prepareOutbox(state) {
  localMode();
  await prepareIntake(state);
  const client = await identify(state);
  try {
    const existing = (await client.query("SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,rolinherit,NOT rolcanlogin AS login_disabled FROM pg_roles WHERE rolname='lmps_outbox'")).rows[0];
    if (existing && (!state.passwords.outbox || Object.values(existing).some(Boolean) || (await client.query("SELECT 1 FROM pg_auth_members WHERE member='lmps_outbox'::regrole")).rowCount)) throw new Error('Unowned/privileged outbox role.');
    if (!state.passwords.outbox) {
      state.passwords.outbox = randomBytes(24).toString('base64url');
      await writeFile(join(state.base, 'state.json'), JSON.stringify(state), { mode: 0o600 });
    }
    if (!existing) await client.query(`CREATE ROLE lmps_outbox LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${state.passwords.outbox}'`);
    await client.query('GRANT CONNECT ON DATABASE lmps_risk_local TO lmps_outbox');
    const probe = new pg.Client({ connectionString: dsn(state, 'outbox'), ssl: false, connectionTimeoutMillis: 1000, query_timeout: 1000 });
    try { await probe.connect(); await probe.query('SELECT 1'); }
    finally { await probe.end(); }
    await writeFile(join(state.base, 'outbox.env'), `LMPS_POSTGRES_DSN=${dsn(state, 'outbox')}\n`, { mode: 0o600 });
  } finally { await client.end(); }
}

export async function prepareReviewer(state) {
  localMode();
  const client = await identify(state);
  try {
    const existing = (await client.query("SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,rolinherit,NOT rolcanlogin AS login_disabled FROM pg_roles WHERE rolname='lmps_reviewer'")).rows[0];
    if (existing && (!state.passwords.reviewer || Object.values(existing).some(Boolean)
      || (await client.query("SELECT 1 FROM pg_auth_members WHERE member='lmps_reviewer'::regrole")).rowCount)) throw new Error('Unowned/privileged review role.');
    if (!state.passwords.reviewer) {
      state.passwords.reviewer = randomBytes(24).toString('base64url');
      await writeFile(join(state.base, 'state.json'), JSON.stringify(state), { mode: 0o600 });
    }
    if (!existing) await client.query(`CREATE ROLE lmps_reviewer LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${state.passwords.reviewer}'`);
    await client.query('GRANT CONNECT ON DATABASE lmps_risk_local TO lmps_reviewer');
    const path = join(state.base, 'data/pg_hba.conf'); await regularFile(path);
    const original = await readFile(path, 'utf8'), rule = 'host lmps_risk_local lmps_reviewer 127.0.0.1/32 scram-sha-256';
    if (!original.split('\n').includes(rule)) {
      const reject = 'host all all 0.0.0.0/0 reject';
      if (!original.split('\n').includes(reject)) throw new Error('Local HBA rule not recognized.');
      await writeFile(path, original.replace(reject, rule + '\n' + reject), { mode: 0o600 });
      await client.query('SELECT pg_reload_conf()'); await new Promise(accept => setTimeout(accept, 100));
    }
    const probe = new pg.Client({ connectionString: dsn(state, 'reviewer'), ssl: false, connectionTimeoutMillis: 1000, query_timeout: 1000 });
    try { await probe.connect(); await probe.query('SELECT 1'); }
    finally { await probe.end(); }
    await writeFile(join(state.base, 'reviewer.env'), `LMPS_LOCAL_REVIEW_DSN=${dsn(state, 'reviewer')}\n`, { mode: 0o600 });
  } finally { await client.end(); }
}

export async function preparePolicy(state) {
  localMode();
  const client = await identify(state);
  try {
    const existing = (await client.query("SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,rolinherit,NOT rolcanlogin AS login_disabled FROM pg_roles WHERE rolname='lmps_policy'")).rows[0];
    if (existing && (!state.passwords.policy || Object.values(existing).some(Boolean)
      || (await client.query("SELECT 1 FROM pg_auth_members WHERE member='lmps_policy'::regrole")).rowCount)) throw new Error('Unowned/privileged policy role.');
    if (!state.passwords.policy) {
      state.passwords.policy = randomBytes(24).toString('base64url');
      await writeFile(join(state.base, 'state.json'), JSON.stringify(state), { mode: 0o600 });
    }
    if (!existing) await client.query(`CREATE ROLE lmps_policy LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${state.passwords.policy}'`);
    await client.query('GRANT CONNECT ON DATABASE lmps_risk_local TO lmps_policy');
    const path = join(state.base, 'data/pg_hba.conf'); await regularFile(path);
    const original = await readFile(path, 'utf8'), rule = 'host lmps_risk_local lmps_policy 127.0.0.1/32 scram-sha-256';
    if (!original.split('\n').includes(rule)) {
      const reject = 'host all all 0.0.0.0/0 reject';
      if (!original.split('\n').includes(reject)) throw new Error('Local HBA rule not recognized.');
      await writeFile(path, original.replace(reject, rule + '\n' + reject), { mode: 0o600 });
      await client.query('SELECT pg_reload_conf()'); await new Promise(accept => setTimeout(accept, 100));
    }
    const probe = new pg.Client({ connectionString: dsn(state, 'policy'), ssl: false, connectionTimeoutMillis: 1000, query_timeout: 1000 });
    try { await probe.connect(); await probe.query('SELECT 1'); }
    finally { await probe.end(); }
    await writeFile(join(state.base, 'policy.env'), `LMPS_LOCAL_POLICY_DSN=${dsn(state, 'policy')}\n`, { mode: 0o600 });
  } finally { await client.end(); }
}

export async function prepareCase(state) {
  localMode();
  const client = await identify(state);
  try {
    const existing = (await client.query("SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,rolinherit,NOT rolcanlogin AS login_disabled FROM pg_roles WHERE rolname='lmps_case'")).rows[0];
    if (existing && (!state.passwords.case || Object.values(existing).some(Boolean)
      || (await client.query("SELECT 1 FROM pg_auth_members WHERE member='lmps_case'::regrole")).rowCount)) throw new Error('Unowned/privileged case role.');
    if (!state.passwords.case) {
      state.passwords.case = randomBytes(24).toString('base64url');
      await writeFile(join(state.base, 'state.json'), JSON.stringify(state), { mode: 0o600 });
    }
    if (!existing) await client.query(`CREATE ROLE lmps_case LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${state.passwords.case}'`);
    await client.query('GRANT CONNECT ON DATABASE lmps_risk_local TO lmps_case');
    const path = join(state.base, 'data/pg_hba.conf'); await regularFile(path);
    const original = await readFile(path, 'utf8'), rule = 'host lmps_risk_local lmps_case 127.0.0.1/32 scram-sha-256';
    if (!original.split('\n').includes(rule)) {
      const reject = 'host all all 0.0.0.0/0 reject';
      if (!original.split('\n').includes(reject)) throw new Error('Local HBA rule not recognized.');
      await writeFile(path, original.replace(reject, rule + '\n' + reject), { mode: 0o600 });
      await client.query('SELECT pg_reload_conf()'); await new Promise(accept => setTimeout(accept, 100));
    }
    const probe = new pg.Client({ connectionString: dsn(state, 'case'), ssl: false, connectionTimeoutMillis: 1000, query_timeout: 1000 });
    try { await probe.connect(); await probe.query('SELECT 1'); }
    finally { await probe.end(); }
    await writeFile(join(state.base, 'case.env'), `LMPS_LOCAL_CASE_DSN=${dsn(state, 'case')}\n`, { mode: 0o600 });
  } finally { await client.end(); }
}

export async function startCluster(state) {
  if (!running(state)) {
    await regularFile(join(state.base, 'data/postgresql.conf'));
    await writeFile(join(state.base, 'data/postgresql.conf'), configuration, { mode: 0o600 });
    execute(join(state.binaryDirectory, 'pg_ctl'), ['-D', join(state.base, 'data'), '-l', join(state.base, 'server.log'), '-o', `-p ${state.port}`, '-w', '-t', '15', 'start']);
  }
  const client = await identify(state);
  await client.end();
}

export async function stopCluster(state) {
  if (running(state)) {
    const client = await identify(state);
    await client.end();
    execute(join(state.binaryDirectory, 'pg_ctl'), ['-D', join(state.base, 'data'), '-m', 'fast', '-w', '-t', '15', 'stop']);
  }
}

export async function availablePort() {
  const server = createServer();
  await new Promise((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', accept); });
  const port = server.address().port;
  await new Promise((accept, reject) => server.close(error => error ? reject(error) : accept()));
  return port;
}

export async function initializeCluster(base, port) {
  localMode();
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid local cluster port.');
  const binaries = binaryDirectory();
  await mkdir(dirname(base), { recursive: true, mode: 0o700 });
  await mkdir(base, { mode: 0o700 }); // Exclusive: never initialize over an existing directory.
  const canonical = await realpath(base);
  const state = { format: 1, base: canonical, major, serverVersion: binaries.version, binaryDirectory: binaries.directory, port,
    ready: false, passwords: { bootstrap: randomBytes(24).toString('base64url'), app: randomBytes(24).toString('base64url'), migration: randomBytes(24).toString('base64url') } };
  await writeFile(join(base, 'state.json'), JSON.stringify(state), { mode: 0o600, flag: 'wx' });
  const passwordFile = join(base, 'init-password');
  await writeFile(passwordFile, state.passwords.bootstrap, { mode: 0o600, flag: 'wx' });
  try {
    execute(join(binaries.directory, 'initdb'), ['-D', join(canonical, 'data'), '-U', 'lmps_bootstrap', '--pwfile', passwordFile, '--auth-host=scram-sha-256', '--auth-local=reject', '--encoding=UTF8', '--locale=C', '--no-instructions']);
  } finally {
    await unlink(passwordFile);
  }
  await writeFile(join(base, 'data/postgresql.conf'), configuration, { mode: 0o600 });
  await writeFile(join(base, 'data/pg_hba.conf'), [
    'local all all reject',
    'host all lmps_bootstrap 127.0.0.1/32 scram-sha-256',
    'host lmps_risk_local lmps_migrator,lmps_app 127.0.0.1/32 scram-sha-256',
    'host all all 0.0.0.0/0 reject',
    'host all all ::0/0 reject', '',
  ].join('\n'), { mode: 0o600 });
  await writeFile(join(base, 'server.log'), '', { mode: 0o600, flag: 'wx' });
  try {
    await startCluster(state);
    const client = await identify(state);
    try {
      // Values originate only from randomBytes/base64url, never from caller SQL.
      for (const [role, key] of [['lmps_migrator', 'migration'], ['lmps_app', 'app']]) {
        await client.query(`CREATE ROLE ${role} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${state.passwords[key]}'`);
      }
      await client.query('CREATE DATABASE lmps_risk_local OWNER lmps_migrator');
      await client.query('REVOKE ALL ON DATABASE lmps_risk_local FROM PUBLIC');
      await client.query('GRANT CONNECT ON DATABASE lmps_risk_local TO lmps_app');
      await client.query('REVOKE ALL ON DATABASE postgres, template1 FROM PUBLIC');
    } finally { await client.end(); }
    const migration = new pg.Client({ host: '127.0.0.1', port, user: 'lmps_migrator', password: state.passwords.migration, database: 'lmps_risk_local', ssl: false, connectionTimeoutMillis: 1000, query_timeout: 2000 });
    try {
      await migration.connect();
      await migration.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
    } finally { await migration.end(); }
    await prepareIntake(state);
    await prepareOutbox(state);
    await prepareReviewer(state);
    await preparePolicy(state);
    await prepareCase(state);
    state.ready = true;
    await writeFile(join(base, 'state.json'), JSON.stringify(state), { mode: 0o600 });
    await writeFile(join(base, 'app.env'), `LMPS_POSTGRES_DSN=${dsn(state)}\n`, { mode: 0o600, flag: 'wx' });
    await chmod(join(base, 'state.json'), 0o600);
  } finally { await stopCluster(state); }
  return state;
}

async function main() {
  localMode();
  const command = process.argv[2];
  if (command === 'init') {
    try {
      await lstat(LOCAL);
      const state = await loadState();
      if (!state.ready) throw new Error();
      console.info('Local PostgreSQL already initialized; no changes made.');
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error('Existing cluster is incomplete or unowned; refusing to overwrite.');
      await initializeCluster(LOCAL, 18503);
      console.info('Local PostgreSQL initialized on port 18503 (stopped).');
    }
    return;
  }
  const state = await loadState();
  if (command === 'stop') await stopCluster(state);
  else if (command === 'status') console.info(running(state) ? 'Local PostgreSQL running.' : 'Local PostgreSQL stopped.');
  else {
    if (!state.ready) throw new Error('Local bootstrap is incomplete.');
    if (command === 'start') await startCluster(state);
    else if (command === 'prepare-intake') {
      await prepareIntake(state);
      console.info('Owned local intake role prepared; credentials remain private.');
    }
    else if (command === 'prepare-outbox') {
      await prepareOutbox(state);
      console.info('Owned local fake-outbox role prepared; credentials remain private.');
    }
    else if (command === 'prepare-case') {
      await prepareCase(state);
      console.info('Owned local case role prepared; credentials remain private.');
    }
    else if (command === 'prepare-policy') {
      await preparePolicy(state);
      console.info('Owned local policy role prepared; credentials remain private.');
    }
    else if (command === 'prepare-reviewer') {
      await prepareReviewer(state);
      console.info('Owned local review role prepared; credentials remain private.');
    }
    else if (command === 'migrate' || command === 'migration-status') {
      const { migrations } = await import('./migrations.mjs');
      const result = await migrations(dsn(state, 'migration'), command === 'migrate');
      console.info(JSON.stringify(result));
    } else throw new Error('Unknown local PostgreSQL command.');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    console.error('Local PostgreSQL command failed; no credentials or tool diagnostics are printed. Check the ignored local state/log and usage guide.');
    process.exitCode = 1;
  });
}
