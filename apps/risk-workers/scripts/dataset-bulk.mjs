import { execFile, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { once } from 'node:events';
import { lstat, mkdir, open, realpath, rename, statfs } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { validateBulkPlan } from '@lmps/contracts/bulk-dataset';
import { datasetMode } from '@lmps/contracts/offline-dataset';
import { riskHash } from '@lmps/risk';
import { createBackup, restoreDrill, verifyBackup } from '../../../packages/database/scripts/backup.mjs';
import { ROOT, LOCAL, availablePort, dsn, initializeCluster, loadState, startCluster, stopCluster } from '../../../packages/database/scripts/local.mjs';
import { migrations } from '../../../packages/database/scripts/migrations.mjs';
import { importOfflineDataset } from '../dist/offline-dataset.js';
import { readOfflineDataset } from './dataset-import.mjs';
import { privateDirectory, readPrivateJson, savePrivateReport } from './private-json.mjs';

const execute = promisify(execFile);
const python = join(ROOT, '.venv/bin/python'), script = join(ROOT, 'apps/risk-workers/scripts/dataset_bulk.py');
const overlap = (a,b) => a === b || a.startsWith(b + sep) || b.startsWith(a + sep);
const fail = () => new Error('BULK_OPERATION_FAILED; private diagnostics withheld.');

async function child(args) {
  const result = await execute(python, ['-B', script, ...args], { timeout: 300000, maxBuffer: 1024 * 1024 });
  if (result.stderr) throw fail(); return JSON.parse(result.stdout);
}
export async function checkpoint(path, value) {
  const pending = path + '.pending';
  // A stopped writer may leave a pending file; never follow or truncate an unrelated file.
  let file;
  try { file = await open(pending, 'wx', 0o600); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  if (!file) {
    const prior = await lstat(pending);
    if (!prior.isFile() || prior.isSymbolicLink() || prior.nlink !== 1 || prior.uid !== process.getuid() || prior.mode & 0o077) throw fail();
    file = await open(pending, constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const info=await file.stat();
    if(!info.isFile() || info.nlink !== 1 || info.uid !== process.getuid() || info.mode & 0o077) {await file.close();throw fail();}
    await file.truncate(0);
  }
  try { await file.writeFile(JSON.stringify(value)); await file.sync(); } finally { await file.close(); }
  await rename(pending, path);
  const directory = await open(dirname(path), 'r'); try { await directory.sync(); } finally { await directory.close(); }
}
export async function acquire(trial) {
  const guard = spawn(python, ['-B', script, 'lock', join(trial, 'active.lock')], { stdio: ['pipe','pipe','ignore'] });
  const ended = once(guard, 'exit').catch(() => {});
  let timer;
  try {
    await new Promise((accept,reject) => {
      timer = setTimeout(reject,5000);
      guard.once('error',reject); guard.once('exit',reject);
      guard.stdout.once('data',data => data.toString() === 'LOCKED\n' ? accept() : reject());
    });
  } catch { guard.kill('SIGKILL'); await ended; throw fail(); }
  finally { clearTimeout(timer); }
  return async () => { guard.stdin.end(); await ended; };
}

export async function prepareBulk(bundle, prepared, rows) {
  try {
    datasetMode();
    if (![bundle,prepared].every(p => typeof p === 'string' && isAbsolute(p)) || !Number.isInteger(rows) || rows < 1 || rows > 1000000) throw fail();
    const target=resolve(await realpath(dirname(prepared)),basename(prepared));
    if(overlap(target,resolve(LOCAL))) throw fail();
    return await child(['prepare',bundle,prepared,String(rows)]);
  } catch {throw fail();}
}

export async function importBulk(prepared, trial, throughRows) {
  datasetMode(); let state, release, ownsRuntime = false;
  const started = performance.now(), runId = randomUUID();
  try {
    if (![prepared,trial].every(p => typeof p === 'string' && isAbsolute(p))) throw fail();
    await privateDirectory(prepared); await privateDirectory(dirname(trial));
    const source = await realpath(prepared), target = resolve(await realpath(dirname(trial)),basename(trial));
    if (overlap(source,target) || overlap(target,resolve(LOCAL))) throw fail();
    const plan = validateBulkPlan(await child(['verify',prepared]));
    const limit = throughRows ?? plan.unique_rows;
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000000 || (limit < plan.unique_rows && limit % 25000 !== 0)) throw fail();
    const targetRows = Math.min(limit,plan.unique_rows);
    const space = await statfs(dirname(trial));
    if (space.bavail * space.bsize < Math.max(512 * 1024**2,targetRows * 4096)) throw fail();
    try { await mkdir(trial,{mode:0o700}); } catch(error) { if(error.code !== 'EEXIST') throw error; }
    await privateDirectory(trial); release = await acquire(trial);
    const owner = {format:'lmps-bulk-trial-1',plan_sha256:riskHash(plan),runtime:'isolated_local_pg',maximum_rows:1000000};
    const ownerPath = join(trial,'owner.json');
    try { if (riskHash(await readPrivateJson(ownerPath,4096)) !== riskHash(owner)) throw fail(); }
    catch(error) { if(error.code !== 'ENOENT') throw error; const file=await open(ownerPath,'wx',0o600);try{await file.writeFile(JSON.stringify(owner));await file.sync();}finally{await file.close();} }
    const runtime = join(trial,'pg');
    try { await lstat(runtime); state=await loadState(runtime); if(!state.ready) throw fail(); }
    catch(error) { if(error.code !== 'ENOENT') throw error; state=await initializeCluster(runtime,await availablePort()); }
    if (state.port === 18503 || state.base !== await realpath(runtime)) throw fail();
    await startCluster(state); ownsRuntime=true; await migrations(dsn(state,'migration'),true);
    const backups=join(trial,'backups');
    const before=await createBackup(state,backups), baseline=await verifyBackup(before.directory);
    const existing=baseline.tables['platform.offline_dataset_rows'].rows;
    if(existing > targetRows || baseline.tables['platform.offline_dataset_batches'].rows > plan.chunks.length) throw fail();
    if(existing >= 100000) await restoreDrill(before.directory);
    const completed=[];let rows=0;
    for(const chunk of plan.chunks) {
      if(rows >= targetRows) break;
      const snapshot=await readOfflineDataset(chunk.input,join(prepared,chunk.csv));
      const result=await importOfflineDataset(dsn(state,'intake'),snapshot);
      if(result.status !== 'complete' || result.reconciliation_status !== 'matched' || result.loaded_rows !== chunk.input.expected_rows) throw fail();
      rows+=result.loaded_rows;completed.push(result.batch_ref);
      await checkpoint(join(trial,'progress.json'),{...owner,loaded_rows:rows,completed_chunks:completed.length,run_id:runId});
      console.info(JSON.stringify({record:'bulk_checkpoint',loaded_rows:rows,completed_chunks:completed.length,target_rows:targetRows}));
      if(rows === 100000 && targetRows > rows && existing < rows) {
        const gate=await createBackup(state,backups);await verifyBackup(gate.directory);await restoreDrill(gate.directory);
      }
    }
    const after=await createBackup(state,backups), manifest=await verifyBackup(after.directory);
    if(manifest.tables['platform.offline_dataset_rows'].rows !== rows || manifest.tables['platform.offline_dataset_batches'].rows !== completed.length) throw fail();
    const restored=await restoreDrill(after.directory);
    const report={format:'lmps-bulk-trial-report-1',plan_sha256:owner.plan_sha256,execution_mode:'offline_analysis',source_semantics:'unverified',
      status:rows === plan.unique_rows ? 'complete' : 'checkpointed',selected_rows:plan.selected_rows,unique_rows:plan.unique_rows,
      loaded_rows:rows,matched_rows:rows,completed_chunks:completed.length,restore_status:restored.status,
      account_identity:'unverified',assessment_performed:false,operational_alerts:false,canonical_emission:false,enforcement:false};
    const phaseId=createHash('sha256').update(owner.plan_sha256+String(targetRows)).digest('hex').slice(0,32);
    const reportId=[phaseId.slice(0,8),phaseId.slice(8,12),phaseId.slice(12,16),phaseId.slice(16,20),phaseId.slice(20)].join('-');
    const created=await savePrivateReport(join(trial,'reports'),'v1',reportId,'bulk.json',report,65536);
    const metrics={...report,run_id:runId,publication:created?'created':'duplicate',before_backup_id:before.backup_id,after_backup_id:after.backup_id,
      elapsed_ms:Math.round(performance.now()-started),node_peak_rss_bytes:process.resourceUsage().maxRSS*1024};
    await savePrivateReport(join(trial,'runs'),'v1',runId,'run.json',metrics,65536);
    return metrics;
  } catch { throw fail(); }
  finally { try {if(state && ownsRuntime) await stopCluster(state);} finally {await release?.();} }
}

export async function main(args=process.argv.slice(2)) {
  try {
    const {positionals,values}=parseArgs({args,allowPositionals:true,options:{bundle:{type:'string'},prepared:{type:'string'},trial:{type:'string'},rows:{type:'string'},'through-rows':{type:'string'}}});
    if(positionals.length !== 1) throw fail();
    let result;
    if(positionals[0] === 'prepare' && Object.keys(values).sort().join(',') === 'bundle,prepared,rows' && /^[1-9][0-9]{0,6}$/.test(values.rows))
      result=await prepareBulk(values.bundle,values.prepared,Number(values.rows));
    else if(positionals[0] === 'import' && ['prepared,trial','prepared,through-rows,trial'].includes(Object.keys(values).sort().join(','))) {
      if(values['through-rows'] !== undefined && !/^[1-9][0-9]{0,6}$/.test(values['through-rows'])) throw fail();
      result=await importBulk(values.prepared,values.trial,values['through-rows']===undefined?undefined:Number(values['through-rows']));
    } else throw fail();
    const {plan_sha256: _privateHash,...publicResult}=result;
    console.info(JSON.stringify(publicResult));return 0;
  } catch {console.error('BULK_OPERATION_FAILED; private diagnostics withheld.');return 1;}
}
if(process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode=await main();
