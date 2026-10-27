import { execFileSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, rename, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { createDatabase } from '../dist/index.js';
import { ROOT, availablePort, binaryDirectory, dsn, identify, initializeCluster, loadState, localMode, startCluster, stopCluster } from './local.mjs';
import { migrations } from './migrations.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const LEGACY_TABLES = { 'platform.source_records': 'record_id', 'platform.source_events': 'event_id', 'platform.local_outbox_intents': 'intent_ref', 'platform.local_outbox_attempts': 'attempt_id', 'lmps_migrations.__drizzle_migrations': 'id' };
const AUDIT_TABLES = { ...LEGACY_TABLES, 'platform.audit_events': 'audit_id' };
const JOB_TABLES = { ...AUDIT_TABLES, 'platform.local_sync_jobs': 'job_id', 'platform.local_sync_attempts': 'workspace_key,job_ref,attempt_number' };
const REVISION_TABLES = { ...JOB_TABLES, 'platform.local_transaction_revisions': 'workspace_key,namespace,transaction_id,revision_number' };
const RULE_TABLES = { ...REVISION_TABLES, 'platform.local_rule_versions': 'workspace_key,rule_id,rule_version', 'platform.local_assessment_runs': 'workspace_key,run_id' };
const RISK_TABLES = { ...RULE_TABLES, 'platform.local_risk_policies': 'workspace_key,policy_id,policy_version', 'platform.local_transaction_risks': 'workspace_key,run_id' };
const ALERT_TABLES = { ...RISK_TABLES, 'platform.local_alert_policies': 'workspace_key,policy_id,policy_version', 'platform.local_alerts': 'workspace_key,alert_id', 'platform.local_alert_reviews': 'workspace_key,alert_id,version' };
const RISK_JOB_TABLES = { ...ALERT_TABLES, 'platform.local_risk_jobs': 'workspace_key,job_ref', 'platform.local_risk_job_attempts': 'workspace_key,job_ref,attempt_number' };
const OFFLINE_TABLES = { ...RISK_JOB_TABLES, 'platform.offline_dataset_batches': 'workspace_key,batch_ref', 'platform.offline_dataset_rows': 'workspace_key,batch_ref,row_number' };
const POLICY_TABLES = { ...OFFLINE_TABLES, 'platform.local_risk_policy_versions': 'workspace_key,policy_id,policy_version', 'platform.local_risk_policy_bindings': 'workspace_key,namespace,currency', 'platform.local_risk_policy_events': 'workspace_key,request_id', 'platform.local_risk_job_policy_bindings': 'workspace_key,job_ref' };
const CASE_TABLES = { ...POLICY_TABLES, 'platform.local_cases': 'workspace_key,case_id', 'platform.local_case_alerts': 'workspace_key,alert_id', 'platform.local_case_events': 'workspace_key,case_id,version', 'platform.local_case_outcomes': 'workspace_key,case_id,version' };
const MODEL_TABLES = { ...CASE_TABLES, 'platform.local_model_gate_policies': 'workspace_key,policy_id,policy_version', 'platform.local_model_receipts': 'workspace_key,request_id' };
const TABLES = { ...MODEL_TABLES, 'platform.local_label_adjudications': 'workspace_key,label_id,version' };
const INVENTORIES = [TABLES, MODEL_TABLES, CASE_TABLES, POLICY_TABLES, OFFLINE_TABLES, RISK_JOB_TABLES, ALERT_TABLES, RISK_TABLES, RULE_TABLES, REVISION_TABLES, JOB_TABLES, AUDIT_TABLES, LEGACY_TABLES];
const MAX_DUMP_BYTES = 128 * 1024 * 1024;
const rowLimit = table => table === 'platform.offline_dataset_rows' ? 1_000_000 : 1000;
const BASE = join(ROOT, '.local/backups');
const fail = () => new Error('Local backup/restore failed; data, credentials and tool diagnostics withheld.');

async function privateDirectory(path) {
  const info = await lstat(path);
  if (!isAbsolute(path) || !info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) || info.uid !== process.getuid()) throw fail();
}
async function syncDirectory(path) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { await file.sync(); } finally { await file.close(); }
}
async function privateFile(path, maximum) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o077) || stat.uid !== process.getuid() || stat.size > maximum) throw fail();
    return file;
  } catch (error) { await file.close(); throw error; }
}
async function digest(path) {
  const file = await privateFile(path, MAX_DUMP_BYTES);
  try {
    const hash = createHash('sha256'); const buffer = Buffer.alloc(65536); let length = 0;
    while (true) {
      const result = await file.read(buffer, 0, buffer.length, null);
      if (!result.bytesRead) break; length += result.bytesRead;
      if (length > MAX_DUMP_BYTES) throw fail(); hash.update(buffer.subarray(0, result.bytesRead));
    }
    return hash.digest('hex');
  } finally { await file.close(); }
}
function tools() {
  const result = binaryDirectory();
  for (const name of ['pg_dump', 'pg_restore']) {
    const version = execFileSync(join(result.directory, name), ['--version'], { encoding: 'utf8', stdio: 'pipe', timeout: 2000 });
    if (version.match(/\(PostgreSQL\) (\d+\.\d+)/)?.[1] !== result.version) throw fail();
  }
  return result;
}
async function fingerprints(client, tables) {
  const visible = (await client.query(`SELECT table_schema||'.'||table_name AS name FROM information_schema.tables WHERE table_type='BASE TABLE' AND table_schema NOT IN ('pg_catalog','information_schema') ORDER BY name LIMIT ${Object.keys(TABLES).length + 1}`)).rows.map(row => row.name).sort();
  tables ??= INVENTORIES.find(candidate => JSON.stringify(visible) === JSON.stringify(Object.keys(candidate).sort()));
  if (!tables) throw fail();
  if (JSON.stringify(visible) !== JSON.stringify(Object.keys(tables).sort())) throw fail();
  const result = {};
  for (const [table, key] of Object.entries(tables)) {
    const hash = createHash('sha256'); let count = 0;
    await client.query(`DECLARE local_backup_rows NO SCROLL CURSOR FOR SELECT row_to_json(t)::text AS row FROM ${table} t ORDER BY ${key} LIMIT ${rowLimit(table) + 1}`);
    while (true) {
      const rows = (await client.query('FETCH FORWARD 500 FROM local_backup_rows')).rows;
      if (!rows.length) break;
      for (const row of rows) {
        if (++count > rowLimit(table)) throw fail();
        if (count > 1) hash.update('\n'); hash.update(row.row);
      }
    }
    await client.query('CLOSE local_backup_rows');
    result[table] = { rows: count, sha256: hash.digest('hex') };
  }
  return result;
}
async function credentialTool(state, directory, binary, args, timeout = 10000) {
  const path = join(directory, 'temporary.pgpass');
  const file = await open(path, 'wx', 0o600);
  try {
    try { await file.writeFile(`127.0.0.1:${state.port}:lmps_risk_local:lmps_bootstrap:${state.passwords.bootstrap.replace(/\\/g, '\\\\').replace(/:/g, '\\:')}\n`); }
    finally { await file.close(); }
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (key.startsWith('PG')) delete env[key];
    Object.assign(env, { PGPASSFILE: path, PGSSLMODE: 'disable', PGCONNECT_TIMEOUT: '2' });
    execFileSync(binary, ['--host=127.0.0.1', '--port=' + state.port, '--username=lmps_bootstrap', '--dbname=lmps_risk_local', '--no-password', ...args], { env, stdio: ['ignore', 'pipe', 'pipe'], timeout, maxBuffer: 1024 * 1024 });
  } finally { await rm(path, { force: true }); }
}

export async function createBackup(state, base = BASE) {
  localMode(); let client;
  try {
    const native = tools();
    if (native.version !== state.serverVersion) throw fail();
    await privateDirectory(dirname(base)); await mkdir(base, { mode: 0o700, recursive: true }); await privateDirectory(base); await syncDirectory(dirname(base));
    const id = randomUUID(); const directory = join(base, id); await mkdir(directory, { mode: 0o700 }); await syncDirectory(base);
    client = await identify(state, 'lmps_risk_local'); await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL idle_in_transaction_session_timeout='20s'"); await client.query("SET LOCAL TimeZone='UTC'");
    const tables = await fingerprints(client);
    const large = (tables['platform.offline_dataset_rows']?.rows ?? 0) > 100000;
    if (large) await client.query("SET LOCAL idle_in_transaction_session_timeout='180s'");
    const snapshot = (await client.query('SELECT pg_export_snapshot() AS snapshot')).rows[0].snapshot;
    const pending = join(directory, 'pending.dump'); const file = await open(pending, 'wx', 0o600); await file.close();
    await credentialTool(state, directory, join(native.directory, 'pg_dump'), ['--format=custom', '--no-tablespaces', '--snapshot=' + snapshot, '--file=' + pending], large ? 120000 : 10000);
    await client.query('COMMIT'); await client.end(); client = undefined;
    const artifact = await privateFile(pending, MAX_DUMP_BYTES); try { await artifact.sync(); } finally { await artifact.close(); }
    await rename(pending, join(directory, 'database.dump'));
    const offline = Boolean(tables['platform.offline_dataset_batches']);
    const manifest = { format: offline ? 'local_pg_backup_v2' : 'local_pg_backup_v1', provenance: offline ? 'local_workspace' : 'local_synthetic', backup_id: id, created_at: new Date().toISOString(), postgres_version: native.version, sha256: await digest(join(directory, 'database.dump')), tables };
    const metadata = await open(join(directory, 'pending.json'), 'wx', 0o600);
    try { await metadata.writeFile(JSON.stringify(manifest)); await metadata.sync(); } finally { await metadata.close(); }
    await rename(join(directory, 'pending.json'), join(directory, 'manifest.json')); await syncDirectory(directory);
    return { directory, backup_id: id, provenance: manifest.provenance, tables: Object.fromEntries(Object.entries(tables).map(([name, table]) => [name, table.rows])) };
  } catch { throw fail(); }
  finally { if (client) { await client.query('ROLLBACK').catch(() => {}); await client.end(); } }
}

export async function verifyBackup(directory) {
  localMode();
  try {
    await privateDirectory(dirname(directory)); await privateDirectory(directory);
    const file = await privateFile(join(directory, 'manifest.json'), 16384); let manifest;
    try {
      const buffer = Buffer.alloc(16385); const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      if (bytesRead > 16384) throw fail(); manifest = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'));
    } finally { await file.close(); }
    if (!manifest || Object.keys(manifest).sort().join(',') !== 'backup_id,created_at,format,postgres_version,provenance,sha256,tables'
      || (manifest.tables?.['platform.offline_dataset_batches']
        ? manifest.format !== 'local_pg_backup_v2' || manifest.provenance !== 'local_workspace'
        : manifest.format !== 'local_pg_backup_v1' || manifest.provenance !== 'local_synthetic') || !UUID.test(manifest.backup_id) || basename(directory) !== manifest.backup_id
      || typeof manifest.created_at !== 'string' || new Date(manifest.created_at).toISOString() !== manifest.created_at
      || !/^18\.\d+$/.test(manifest.postgres_version) || !/^[0-9a-f]{64}$/.test(manifest.sha256)
      || !manifest.tables || !INVENTORIES.some(tables => JSON.stringify(Object.keys(manifest.tables).sort()) === JSON.stringify(Object.keys(tables).sort()))) throw fail();
    for (const [table, value] of Object.entries(manifest.tables)) if (!value || Object.keys(value).sort().join(',') !== 'rows,sha256' || !Number.isInteger(value.rows) || value.rows < 0 || value.rows > rowLimit(table) || !/^[0-9a-f]{64}$/.test(value.sha256)) throw fail();
    if (await digest(join(directory, 'database.dump')) !== manifest.sha256) throw fail();
    return manifest;
  } catch { throw fail(); }
}

export async function restoreDrill(directory) {
  localMode(); let temporary, state, client, app;
  const started = Date.now();
  try {
    const manifest = await verifyBackup(directory); const native = tools();
    if (native.version !== manifest.postgres_version) throw fail();
    temporary = await mkdtemp('/tmp/lmps-restore-');
    state = await initializeCluster(join(temporary, 'pg'), await availablePort()); await startCluster(state);
    await credentialTool(state, temporary, join(native.directory, 'pg_restore'), ['--clean', '--if-exists', '--single-transaction', '--exit-on-error', '--no-tablespaces', join(directory, 'database.dump')], (manifest.tables['platform.offline_dataset_rows']?.rows ?? 0) > 100000 ? 120000 : 10000);
    client = await identify(state, 'lmps_risk_local'); await client.query("SET TimeZone='UTC'");
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const expectedTables = Object.fromEntries(Object.keys(manifest.tables).map(name => [name, TABLES[name]]));
    const actual = await fingerprints(client, expectedTables);
    if (!isDeepStrictEqual(actual, manifest.tables)) throw fail();
    await client.query('COMMIT');
    await client.end(); client = undefined;
    await migrations(dsn(state, 'migration'));
    app = createDatabase(dsn(state));
    if(manifest.tables['platform.local_label_adjudications']) {
      await app.pool.query('SELECT 1 FROM platform.local_label_adjudications LIMIT 1');
      for(const action of ['DELETE FROM','TRUNCATE']) {let denied=false;try{await app.pool.query(`${action} platform.local_label_adjudications`);}catch(error){denied=error.code==='42501';}if(!denied)throw fail();}
    }
    if (manifest.tables['platform.local_model_receipts']) {
      for(const table of ['platform.local_model_gate_policies','platform.local_model_receipts']) {
        await app.pool.query(`SELECT 1 FROM ${table} LIMIT 1`);
        for(const action of ['DELETE FROM','TRUNCATE']) {
          let denied=false;try{await app.pool.query(`${action} ${table}`);}catch(error){denied=error.code==='42501';}if(!denied)throw fail();
        }
      }
    }
    if (manifest.tables['platform.local_cases']) {
      for (const table of ['platform.local_cases','platform.local_case_alerts','platform.local_case_events','platform.local_case_outcomes']) {
        await app.pool.query(`SELECT 1 FROM ${table} LIMIT 1`);
        for (const action of ['DELETE FROM','TRUNCATE']) {
          let denied=false;try {await app.pool.query(`${action} ${table}`);}catch(error){denied=error.code==='42501';}if(!denied)throw fail();
        }
      }
      let denied=false;try{await app.pool.query("SELECT platform.command_local_case('synthetic_local',gen_random_uuid(),'synthetic_probe','{}',NULL,NULL)");}catch(error){denied=error.code==='42501';}if(!denied)throw fail();
    }
    if (manifest.tables['platform.local_risk_policy_versions']) {
      for (const table of ['platform.local_risk_policy_versions','platform.local_risk_policy_bindings','platform.local_risk_policy_events','platform.local_risk_job_policy_bindings']) {
        await app.pool.query(`SELECT 1 FROM ${table} LIMIT 1`);
        for (const action of ['DELETE FROM','TRUNCATE']) {
          let denied = false; try { await app.pool.query(`${action} ${table}`); } catch(error) { denied = error.code === '42501'; }
          if (!denied) throw fail();
        }
      }
      let denied = false; try { await app.pool.query("SELECT platform.command_local_risk_policy('synthetic_local','synthetic_probe','{}',NULL)"); } catch(error) { denied = error.code === '42501'; }
      if (!denied) throw fail();
    }
    if (manifest.tables['platform.offline_dataset_batches']) {
      for (const table of ['platform.offline_dataset_batches','platform.offline_dataset_rows']) {
        let denied = false;
        try { await app.pool.query(`SELECT * FROM ${table} LIMIT 1`); } catch (error) { denied = error.code === '42501'; }
        if (!denied) throw fail();
      }
    }
    if (manifest.tables['platform.local_risk_jobs']) {
      for (const table of ['platform.local_risk_jobs', 'platform.local_risk_job_attempts']) {
        await app.pool.query(`SELECT 1 FROM ${table} LIMIT 1`);
        for (const action of ['DELETE FROM', 'TRUNCATE']) {
          let denied = false;
          try { await app.pool.query(`${action} ${table}`); } catch (error) { denied = error.code === '42501'; }
          if (!denied) throw fail();
        }
      }
    }
    if (manifest.tables['platform.local_alerts']) {
      for (const table of ['platform.local_alert_policies', 'platform.local_alerts', 'platform.local_alert_reviews']) {
        await app.pool.query(`SELECT 1 FROM ${table} LIMIT 1`);
        let denied = false;
        try { await app.pool.query(`DELETE FROM ${table}`); } catch (error) { denied = error.code === '42501'; }
        if (!denied) throw fail();
      }
      let denied = false;
      try { await app.pool.query("SELECT * FROM platform.review_local_alert('synthetic_local',gen_random_uuid(),0,gen_random_uuid(),'acknowledge',NULL,NULL,'synthetic_probe')"); } catch (error) { denied = error.code === '42501'; }
      if (!denied) throw fail();
    }
    if (manifest.tables['platform.local_transaction_risks']) {
      for (const table of ['platform.local_risk_policies', 'platform.local_transaction_risks']) {
        await app.pool.query(`SELECT 1 FROM ${table} LIMIT 1`);
        let denied = false;
        try { await app.pool.query(`DELETE FROM ${table}`); } catch (error) { denied = error.code === '42501'; }
        if (!denied) throw fail();
      }
    }
    if (manifest.tables['platform.local_assessment_runs']) {
      for (const table of ['platform.local_rule_versions', 'platform.local_assessment_runs']) {
        await app.pool.query(`SELECT 1 FROM ${table} LIMIT 1`);
        let denied = false;
        try { await app.pool.query(`DELETE FROM ${table}`); } catch (error) { denied = error.code === '42501'; }
        if (!denied) throw fail();
      }
    }
    if (manifest.tables['platform.local_transaction_revisions']) {
      await app.pool.query('SELECT 1 FROM platform.local_transaction_revisions LIMIT 1');
      let denied = false;
      try { await app.pool.query('DELETE FROM platform.local_transaction_revisions'); } catch (error) { denied = error.code === '42501'; }
      if (!denied) throw fail();
    }
    if (manifest.tables['platform.audit_events']) {
      await app.pool.query('SELECT 1 FROM platform.audit_events LIMIT 1');
      let auditDenied = false;
      try { await app.pool.query('DELETE FROM platform.audit_events'); } catch (error) { auditDenied = error.code === '42501'; }
      if (!auditDenied) throw fail();
    }
    if (manifest.tables['platform.local_sync_jobs']) {
      await app.pool.query('SELECT 1 FROM platform.local_sync_jobs LIMIT 1');
      await app.pool.query('SELECT 1 FROM platform.local_sync_attempts LIMIT 1');
      let denied = false;
      try { await app.pool.query('DELETE FROM platform.local_sync_jobs'); } catch (error) { denied = error.code === '42501'; }
      if (!denied) throw fail();
    }
    await app.pool.query('SELECT 1 FROM platform.source_events LIMIT 1'); await app.pool.query('SELECT 1 FROM platform.local_outbox_intents LIMIT 1');
    let denied = false;
    try { await app.pool.query('DELETE FROM platform.source_events'); } catch (error) { denied = error.code === '42501'; }
    if (!denied) throw fail();
    return { status: 'PASS', backup_id: manifest.backup_id, table_counts: Object.fromEntries(Object.entries(actual).map(([name, table]) => [name, table.rows])), app_read_only_checked: true, workers_started: false, verification_elapsed_ms: Date.now() - started };
  } catch { throw fail(); }
  finally {
    await client?.end(); await app?.close();
    if (temporary && !state) { try { state = await loadState(join(temporary, 'pg')); } catch { temporary = undefined; } }
    if (state) await stopCluster(state);
    if (temporary) await rm(temporary, { recursive: true, force: true });
  }
}

async function main() {
  try {
    const [command, id, ...rest] = process.argv.slice(2);
    if (rest.length) throw fail();
    if (command === 'backup' && id === undefined) {
      const result = await createBackup(await loadState());
      console.info(JSON.stringify({ provenance: result.provenance, execution_mode: 'test', backup_id: result.backup_id, table_counts: result.tables }));
    } else if (command === 'restore-drill' && typeof id === 'string' && UUID.test(id)) console.info(JSON.stringify(await restoreDrill(join(BASE, id))));
    else throw fail();
  } catch { console.error(fail().message); process.exitCode = 1; }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
