import { mkdir, writeFile, lstat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, loadState, startCluster, stopCluster, identify } from '../packages/database/scripts/local.mjs';
import { createBackup, forkBackup } from '../packages/database/scripts/backup.mjs';
import { runtimeProfile } from './runtime-profile.mjs';

export async function prepareIntakeEnvironment() {
  const profile = runtimeProfile({ LMPS_RUNTIME_PROFILE: 'intake' });
  const parent = resolve(ROOT, '.local/environments/intake');
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const info = await lstat(parent);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) || info.uid !== process.getuid()) throw new Error('Unsafe Intake environment directory.');
  const source = await loadState(); process.env.LMPS_PG_BIN = source.binaryDirectory;
  // Refuse existing state before taking another backup. Resume uses start/status, never reseeding.
  try { await lstat(profile.stateDirectory); throw new Error('Intake environment already exists; use start or status.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const backup = await createBackup(source);
  const fork = await forkBackup(backup.directory, profile.stateDirectory, 18513);
  const receipt = { format: 1, profile: 'intake', source_backup_id: fork.backup_id, verified_tables: fork.tables, postgres_port: fork.state.port, api_port: profile.apiPort, session_port: profile.issuerPort, production_ready: false };
  await writeFile(join(parent, 'prepared.json'), JSON.stringify(receipt, null, 2), { mode: 0o600, flag: 'wx' });
  await writeFile(join(parent, 'runtime.env'), `LMPS_RUNTIME_PROFILE=intake\nPORT=18443\nLMPS_POSTGRES_STATE_DIR=${profile.stateDirectory}\nLMPS_API_PORT=${profile.apiPort}\nLMPS_ALERT_SESSION_PORT=${profile.issuerPort}\nLMPS_RISK_API_ORIGIN=${profile.apiOrigin}\nLMPS_SESSION_ORIGIN=${profile.sessionOrigin}\nLMPS_WEB_PUSH_WORKER=0\n`, { mode: 0o600, flag: 'wx' });
  return receipt;
}

export async function intakeEnvironment(command) {
  if (command === 'prepare') return prepareIntakeEnvironment();
  const profile = runtimeProfile({ LMPS_RUNTIME_PROFILE: 'intake' });
  const state = await loadState(profile.stateDirectory);
  if (state.port !== 18513) throw new Error('Unexpected Intake cluster port.');
  if (command === 'start') await startCluster(state);
  else if (command === 'stop') await stopCluster(state);
  else if (command !== 'status') throw new Error('Unknown Intake environment command.');
  if (command !== 'stop') { const client = await identify(state, 'lmps_risk_local'); await client.end(); }
  return { profile: 'intake', status: command === 'stop' ? 'stopped' : 'available', postgres_port: state.port, production_ready: false };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw new Error();
    console.info(JSON.stringify(await intakeEnvironment(process.argv[2])));
  } catch { console.error('INTAKE_ENVIRONMENT_FAILED; existing data retained; private diagnostics withheld.'); process.exitCode = 1; }
}
