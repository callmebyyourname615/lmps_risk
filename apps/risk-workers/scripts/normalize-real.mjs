import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp,writeFile,rm,realpath } from 'node:fs/promises';
import { join,resolve,isAbsolute,dirname,basename,sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs,promisify } from 'node:util';
import { validateSourceSemantics } from '@lmps/contracts/source-semantics';
import { readModelPrivateFile } from '@lmps/risk';
import { ROOT,LOCAL,localMode } from '../../../packages/database/scripts/local.mjs';
import { readPrivateJson } from './private-json.mjs';
import { draftSemantics } from './source-semantics.mjs';
const execute=promisify(execFile);
export async function normalizeReal({adapted,mapping,review,document,schema,output}) {
  let temporary;
  try {
    localMode();if(![adapted,schema,output].every(p=>typeof p==='string'&&isAbsolute(p)))throw new Error();
    const source=await realpath(adapted),target=resolve(await realpath(dirname(output)),basename(output));
    const overlap=(a,b)=>a===b||a.startsWith(b+sep)||b.startsWith(a+sep);
    if(overlap(source,target)||overlap(target,resolve(LOCAL)))throw new Error();
    const raw=await execute(join(ROOT,'.venv/bin/python'),['-B',join(ROOT,'apps/risk-workers/scripts/dataset_semantics.py'),adapted],{maxBuffer:4*1024*1024,timeout:30000});
    const evidence=JSON.parse(raw.stdout),selected=mapping?validateSourceSemantics(await readPrivateJson(mapping,2*1024*1024)):draftSemantics(evidence);
    const proof=review?await readPrivateJson(review,16384):null;
    const documentSha=document?createHash('sha256').update(await readModelPrivateFile(document,1024*1024)).digest('hex'):null;
    if((review===undefined)!==(document===undefined))throw new Error();
    temporary=await mkdtemp('/tmp/lmps-normalize-');const envelope=join(temporary,'input.json');
    await writeFile(envelope,JSON.stringify({evidence,mapping:selected,review:proof,document_sha256:documentSha,schema_path:schema,output}),{mode:0o600,flag:'wx'});
    const result=await execute(join(ROOT,'.venv/bin/python'),['-B','-m','lmps_ml.real_source',envelope],{cwd:join(ROOT,'services/ml-inference'),maxBuffer:65536,timeout:30000});
    return JSON.parse(result.stdout);
  } catch {throw new Error('SOURCE_NORMALIZATION_FAILED; private diagnostics withheld.');}
  finally{if(temporary)await rm(temporary,{recursive:true,force:true});}
}
export async function main(args=process.argv.slice(2)){
  try{const {values}=parseArgs({args,options:Object.fromEntries(['adapted','mapping','review','document','schema','output'].map(k=>[k,{type:'string'}]))});
    const result=await normalizeReal(values);console.info(JSON.stringify(result));return result.counts.unavailable?2:0;
  }catch{console.error('SOURCE_NORMALIZATION_FAILED; private diagnostics withheld.');return 1;}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))process.exitCode=await main();
