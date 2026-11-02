/** Import-inert parent-host-only acceptance; no injectable runner or receipt input. */
import {createHash} from 'node:crypto';
import {constants as C} from 'node:fs';
import {open,lstat,mkdir,readdir,link,unlink} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArguments as parseOutput,runFeatureEngineComparison,verifyFeatureEngineComparison,readComparisonFile} from './feature-engine-compare.mjs';
import {canonical,ownedStreamsProcessHandles} from './feature-streams-candidate.mjs';
import {ownedProcessHandles,verifyRuntime} from './cdc-runtime.mjs';
import {detachFeatureJSON} from '../../../packages/contracts/dist/feature-catalog.js';
const ROOT=fileURLToPath(new URL('../../../',import.meta.url)),MAX=16777216;
const fail=()=>Object.assign(new Error('FEATURE_ENGINE_ACCEPTANCE_FAILED'),{code:'FEATURE_ENGINE_ACCEPTANCE_FAILED'});
const check=v=>{if(!v)throw fail();};
const hash=b=>createHash('sha256').update(b).digest('hex');
const bindings=['apps/risk-workers/scripts/feature-engine-acceptance.mjs','apps/risk-workers/test/feature-engine-acceptance.test.mjs','docs/operations/local-feature-engine-comparison.md','tasks/ralph/batches/rlp-b09.md','tasks/ralph/batches/rlp-b09.manifest.json','tasks/ralph/phases/p04.md','package.json','pnpm-lock.yaml'];
let active=false;
export function parseArguments(args){try{return parseOutput(args);}catch{throw fail();}}
async function ancestors(path){for(let p=path;;p=dirname(p)){const s=await lstat(p);check(s.isDirectory()&&!s.isSymbolicLink()&&!(s.mode&0o022));if(p===join(ROOT,'.local')||p.startsWith(join(ROOT,'.local')+'/'))check(s.uid===process.getuid()&&(s.mode&511)===448);if(p===dirname(p))break;}}
async function provenance(){const out={};for(const rel of bindings){await ancestors(dirname(join(ROOT,rel)));out[rel]=hash(await readComparisonFile(join(ROOT,rel),false));}return out;}
function clean(){check(ownedStreamsProcessHandles().length===0&&ownedProcessHandles().length===0);}
async function report(output){return JSON.parse(await readComparisonFile(join(output,'comparison/comparison.json')));}
/** Read-only fresh-process API; rechecks persisted values, provenance and runtime. */
export async function verifyFeatureEngineAcceptance(output){
 try{
 check(arguments.length===1);parseArguments(['--output',output]);await ancestors(output);clean();
 check(canonical((await readdir(output)).sort())===canonical(['acceptance.json','comparison']));
 const raw=await readComparisonFile(join(output,'acceptance.json')),r=detachFeatureJSON(JSON.parse(raw));
 check(Object.keys(r).sort().join(',')==='comparison_sha256,elapsed_ms,native_acceptance,owned_processes,production_ready,scope,source_hashes,version');
 check(r.version===1&&r.scope==='local_synthetic'&&r.production_ready===false&&r.native_acceptance==='finite_supported_comparison_verified'&&r.owned_processes===0);
 check(Number.isSafeInteger(r.elapsed_ms)&&r.elapsed_ms>=0&&r.elapsed_ms<=600000);
 const before=await provenance();check(canonical(r.source_hashes)===canonical(before));
 const comparison=await readComparisonFile(join(output,'comparison/comparison.json'));check(r.comparison_sha256===hash(comparison));
 await verifyFeatureEngineComparison(join(output,'comparison'));
 const c=await report(output);check(c.evidence.bytes+comparison.length+raw.length<=MAX);
 await verifyFeatureEngineComparison(join(output,'comparison'));
 await verifyRuntime();clean();check(canonical(before)===canonical(await provenance()));
 check(comparison.equals(await readComparisonFile(join(output,'comparison/comparison.json'))));
 check(raw.equals(await readComparisonFile(join(output,'acceptance.json'))));
 return {native_acceptance:r.native_acceptance,production_ready:false};
 }catch{throw fail();}
}
export async function runFeatureEngineAcceptance(options){
 let claimed=false;
 try{
 check(arguments.length===1);const o=detachFeatureJSON(options);check(Object.keys(o).join()==='output');const {output}=parseArguments(['--output',o.output]);
 check(!active);clean();active=true;claimed=true;
 await ancestors(dirname(output));try{await lstat(output);throw fail();}catch(e){if(e.code!=='ENOENT')throw e;}
 const before=await provenance();await verifyRuntime();clean();
 await mkdir(output,{mode:0o700});const started=performance.now();
 await runFeatureEngineComparison({output:join(output,'comparison')});
 await verifyFeatureEngineComparison(join(output,'comparison'));
 const comparison=await readComparisonFile(join(output,'comparison/comparison.json')),c=await report(output);
 check(c.status==='matched_supported_semantics'&&c.matched_queries===8&&c.owned_processes===0);
 const r={version:1,scope:'local_synthetic',native_acceptance:'finite_supported_comparison_verified',production_ready:false,owned_processes:0,source_hashes:before,comparison_sha256:hash(comparison),elapsed_ms:Math.ceil(performance.now()-started)};
 check(r.elapsed_ms<=600000);const bytes=canonical(r);check(c.evidence.bytes+comparison.length+Buffer.byteLength(bytes)<=MAX);
 await verifyFeatureEngineComparison(join(output,'comparison'));
 await verifyRuntime();clean();check(canonical(before)===canonical(await provenance()));
 check(comparison.equals(await readComparisonFile(join(output,'comparison/comparison.json'))));
 const stage=join(output,'acceptance-stage.json'),f=await open(stage,C.O_WRONLY|C.O_CREAT|C.O_EXCL|C.O_NOFOLLOW,0o600);
 try{await f.writeFile(bytes);await f.sync();}finally{await f.close();}
 try{clean();await link(stage,join(output,'acceptance.json'));}finally{await unlink(stage);}
 const d=await open(output,C.O_RDONLY|C.O_DIRECTORY|C.O_NOFOLLOW);try{await d.sync();}finally{await d.close();}
 return r;
 }catch{throw fail();}finally{if(claimed)active=false;}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{await runFeatureEngineAcceptance(parseArguments(process.argv.slice(2)));process.stdout.write('FEATURE_ENGINE_ACCEPTANCE_RECORDED\n');}
 catch{process.stderr.write('FEATURE_ENGINE_ACCEPTANCE_FAILED\n');process.exitCode=1;}
}
