import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, open, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT } from '../packages/database/scripts/local.mjs';

export const INTAKE_SUITES = [
  ['contracts', 'packages/contracts/test'], ['risk', 'packages/risk/test'],
  ['database', 'packages/database/test'], ['workers', 'apps/risk-workers/test'],
  ['api', 'apps/risk-api/test'], ['portal', '../LMPS_Risk_Portal/test'],
];

// Existing native suites own disposable clusters. The persistent Intake/primary DSNs
// and outbound provider configuration are never inherited by the test processes.
export async function runIntakeSuite() {
  const output = join(ROOT, '.local/intake-acceptance', new Date().toISOString().replaceAll(':','-'));
  await mkdir(output, { recursive: true, mode: 0o700 });
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('LMPS_') && key !== 'LMPS_PG_BIN') delete env[key];
  delete env.NODE_ENV;
  const report = { format: 1, status: 'running', scope: 'existing-module-regression', production_ready: false, intake_all_modules_connected: false, suites: [] };
  const save = () => writeFile(join(output,'report.json'), JSON.stringify(report,null,2), { mode: 0o600 });
  await save();
  for (const [name, relative] of INTAKE_SUITES) {
    const directory = resolve(ROOT, relative);
    const tests = (await readdir(directory)).filter(f=>f.endsWith('.test.mjs')).sort().map(f=>join(directory,f));
    if (!tests.length) throw new Error('Intake suite has no tests.');
    const logPath=join(output,name+'.log'), log=await open(logPath,'wx',0o600), started=Date.now();
    const exit = await new Promise((accept,reject)=>{
      const child=spawn(process.execPath,['--test','--test-concurrency=2',...tests],{cwd:resolve(directory,'..'),env,stdio:['ignore',log.fd,log.fd]});
      const timer=setTimeout(()=>{child.kill('SIGTERM');},20*60*1000);
      child.once('error',error=>{clearTimeout(timer);reject(error);});
      child.once('exit',(code,signal)=>{clearTimeout(timer);accept({code,signal});});
    }).finally(()=>log.close());
    const content=await readFile(logPath);
    const result={ name, files: tests.length, ...exit, passed: exit.code===0 && exit.signal===null, elapsed_ms: Date.now()-started, log_sha256:createHash('sha256').update(content).digest('hex') };
    report.suites.push(result);await save();console.info(JSON.stringify(result));
  }
  report.status=report.suites.every(s=>s.passed)?'regression_passed_intake_wiring_pending':'failed';await save();
  return { output, ...report };
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{if(process.argv.length!==2)throw new Error();const result=await runIntakeSuite();console.info(JSON.stringify({status:result.status,report_directory:result.output,production_ready:false}));if(result.status==='failed')process.exitCode=1;}
  catch{console.error('INTAKE_SUITE_FAILED; inspect private test receipts.');process.exitCode=1;}
}
