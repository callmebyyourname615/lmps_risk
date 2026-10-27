// Explicit opt-in scale acceptance; excluded from the ordinary *.test.mjs CI suite.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readdir, lstat, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { parseArgs, promisify } from 'node:util';
import { ROOT } from '../../../packages/database/scripts/local.mjs';
import { prepareBulk, importBulk } from '../scripts/dataset-bulk.mjs';

async function size(path){let bytes=0;for(const name of await readdir(path)){const file=join(path,name),info=await lstat(file);if(info.isSymbolicLink())throw new Error();bytes+=info.isDirectory()?await size(file):info.size;}return bytes;}
try{
  const {values}=parseArgs({options:{output:{type:'string'}}});
  if(!values.output||!isAbsolute(values.output))throw new Error();
  await mkdir(values.output,{mode:0o700});
  const source=join(values.output,'invented-source'),prepared=join(values.output,'prepared'),trial=join(values.output,'trial');
  const execute=promisify(execFile);
  await execute(join(ROOT,'.venv/bin/python'),['-B','-c','import sys;from pathlib import Path;sys.path.insert(0,sys.argv[1]);from test_dataset_bulk import write_source;write_source(Path(sys.argv[2]),1000000,25000)',join(ROOT,'apps/risk-workers/test'),source],{cwd:ROOT,timeout:180000});
  const preparation=await prepareBulk(source,prepared,1000000);
  const small=await importBulk(prepared,trial,100000);assert.equal(small.loaded_rows,100000);assert.equal(small.restore_status,'PASS');
  const large=await importBulk(prepared,trial,1000000);assert.equal(large.loaded_rows,1000000);assert.equal(large.restore_status,'PASS');
  const report={format:'lmps-bulk-scale-1',data:'invented_only',preparation,trial_100k:small,trial_1m:large,retained_bytes:await size(values.output),real_2gb:'DEFERRED_BY_USER'};
  await writeFile(join(values.output,'acceptance.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
  console.info(JSON.stringify({format:report.format,status:'PASS',rows_100k:small.loaded_rows,rows_1m:large.loaded_rows,prepare_ms:preparation.elapsed_ms,import_100k_ms:small.elapsed_ms,import_1m_ms:large.elapsed_ms,python_peak_rss_bytes:preparation.peak_rss_bytes,node_peak_rss_bytes:large.node_peak_rss_bytes,retained_bytes:report.retained_bytes,real_2gb:report.real_2gb}));
}catch{console.error('BULK_SCALE_FAILED; inspect private count-only trial artifacts.');process.exitCode=1;}
