/** Import-inert actual comparison; native execution belongs to the parent host. */
import { createHash, randomUUID } from 'node:crypto';
import { constants as C, lstatSync, fstatSync, readSync, readdirSync, openSync, closeSync, writeFileSync, mkdirSync, linkSync, unlinkSync, fsyncSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArguments, runFeatureServingAcceptance, verifyFeatureServingAcceptance } from './feature-serving-acceptance.mjs';
import { createRuntime, ownedProcessHandles } from './feature-cache-runtime.mjs';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const check = v => { if (!v) throw Error('FEATURE_CACHE_COMPARISON_FAILED'); };
const encode = v => JSON.stringify(v, (_k,x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0)) : x);
const hash = v => createHash('sha256').update(v).digest('hex');
const binaryHash = '48a07c38 92d5982a 1af6c3fb b9db896b 50e7aa56 4b1d4e6a bcb12fcb 6b6b6e0d'.replaceAll(' ', '');
const same = (a,b) => check(encode(a) === encode(b));
const at = '2026-01-01T12:02:00Z';
const fixed = [['11','14.11',null],['11','13.14',null],[null,null,'INPUT_MISSING'],[null,null,'HISTORY_INCOMPLETE'],['11','13.14',null],['1','7.00',null]];
const observations = ['fixed_six_reads','idempotent','generation_2','stale_publish_rejected','stale_rebuild_rejected','expiry_null','stale_null','outage_null','restart_missing','rebuild_generation_2'];
const gates = ['parent_promoted_source_and_process_proof','full_host_checks','ownership_legal_target_cache_retention_SLO','production_adoption'];
const restart = 'RDB and AOF disabled; stopped owned runtime deleted; new owned runtime has no keys; durable evidence explicitly rebuilt at retained generation 2.';
export function parseCli(args) { return parseArguments(args); }
function read(p, privateFile = false) {
  check(typeof p === 'string' && p === resolve(p) && p.startsWith(root));
  const fd = openSync(p,C.O_RDONLY | C.O_NOFOLLOW | C.O_NONBLOCK);
  try {
    const s = fstatSync(fd); check(s.isFile() && s.nlink === 1 && s.size <= 2097152);
    if (privateFile) check(s.uid === process.getuid() && (s.mode & 0o777) === 0o600);
    const buffer = Buffer.alloc(2097153); let bytes = 0, n;
    while ((n = readSync(fd, buffer, bytes, buffer.length - bytes, null))) { bytes += n; check(bytes <= 2097152); }
    const b = buffer.subarray(0, bytes); check(Buffer.from(b.toString('utf8')).equals(b)); return b;
  } finally { closeSync(fd); }
}
export { read as readFeatureCacheEvidence };
function directory(p) { const s = lstatSync(p); check(s.isDirectory() && !s.isSymbolicLink() && s.uid === process.getuid() && (s.mode & 0o777) === 0o700); }
function parents(p) {
  for (let d = dirname(p);; d = dirname(d)) {
    const s = lstatSync(d); check(s.isDirectory() && !s.isSymbolicLink() && !(s.mode & 0o022));
    if (d === join(root,'.local') || d.startsWith(join(root,'.local')+'/')) directory(d);
    if (d === dirname(d)) break;
  }
}
function provenance() {
  const out = {};
  function walk(p) { const s = lstatSync(join(root,p)); check(!s.isSymbolicLink()); if (s.isDirectory()) for (const n of readdirSync(join(root,p)).sort()) walk(join(p,n)); else out[p] = hash(read(join(root,p))); }
  for (const p of ['packages/contracts/src','packages/contracts/dist','packages/contracts/schemas','packages/risk/src','packages/risk/dist','apps/risk-workers/src','apps/risk-workers/dist']) walk(p);
  for (const p of ['apps/risk-workers/scripts/feature-cache-compare.mjs','apps/risk-workers/scripts/feature-cache-runtime.mjs','apps/risk-workers/scripts/feature-serving-acceptance.mjs','apps/risk-workers/fixtures/feature-cache-runtime.json','packages/risk/test/fixtures/feature-streams/golden.json','packages/risk/fixtures/request.mjs','apps/risk-workers/package.json','packages/risk/package.json','packages/contracts/package.json']) walk(p);
  return out;
}
const json = p => JSON.parse(read(p,true));
function evidenceBytes(output) {
  let bytes=0, files=0;
  function walk(p) {
    directory(p);
    for(const n of readdirSync(p)) {
      const f=join(p,n), s=lstatSync(f); check(!s.isSymbolicLink());
      if(s.isDirectory()) walk(f);
      else { check(++files <= 128); bytes += read(f,true).length; check(bytes <= 16*1024**2); }
    }
  }
  walk(output); return bytes;
}
function request(scope,i=0,extra={}) { return { version:scope.version,workspace_key:scope.workspace_key,plan:scope.plan,query:scope.plan.queries[i],currency:scope.plan.queries[i].currency,policy:scope.policy,now:at,...extra }; }
/** Independent assertions; this helper cannot publish native acceptance. */
export function assertObservation(r,i,generation,reason = fixed[i]?.[2]) {
  check(Number.isInteger(i) && i >= 0 && i < fixed.length);
  same([r.status,r.count,r.amount,r.reason],reason ? ['unavailable',null,null,reason] : ['available',fixed[i][0],fixed[i][1],null]);
  if (reason) check(r.provenance === null);
  else {
    const p=r.provenance?.publication;
    check(p?.generation === generation && p.scope.version === r.request.version && p.scope.workspace_key === r.request.workspace_key);
    same(p.scope.plan,r.request.plan); same(p.scope.policy,r.request.policy);
  }
}
async function rejected(fn) { let bad=false; try { await fn(); } catch { bad=true; } check(bad); }
function stopped(r) { const v=r.receipt(); check(v.unit_only === false && v.native_acceptance === false && v.cleanup_verified && v.state === 'stopped'); return v; }
/** Fixed fixture counters validate evidence shape; they do not prove native execution. */
export function assertRuntimeReceipt(v, i) {
  check(i === 0 || i === 1);
  same(Object.keys(v).sort(), ['format','mode','unit_only','native_acceptance','production_ready','state','cleanup_verified','requests','outputBytes','binarySha256','configSha256'].sort());
  check(v.format === 1 && v.mode === 'local_synthetic' && v.unit_only === false && v.native_acceptance === false && v.production_ready === false && v.cleanup_verified === true && v.state === 'stopped' && v.binarySha256 === binaryHash);
  check(v.requests === [22,13][i] && Number.isSafeInteger(v.outputBytes) && v.outputBytes >= 0 && v.outputBytes <= 65536 && typeof v.configSha256 === 'string' && /^[a-f0-9]{64}$/.test(v.configSha256));
}
/** Rechecks current source and persisted B07 evidence. Parent must independently
 * establish execution provenance and no remaining processes; JSON is not trust. */
export async function verifyFeatureCacheComparison(output) {
  parseCli(['--output',output]); parents(output); directory(output);
  same(readdirSync(output).sort(),['baseline','comparison.json']);
  evidenceBytes(output);
  const r=json(join(output,'comparison.json'));
  same(Object.keys(r).sort(),['version','mode','production_ready','native_acceptance','source_hashes','baseline_hash','publication_hash','observations','runtimes','metrics','elapsed_ms','restart','remaining_gates'].sort());
  same(r.source_hashes,provenance()); await verifyFeatureServingAcceptance(join(output,'baseline'));
  check(r.baseline_hash === hash(read(join(output,'baseline/acceptance.json'),true)));
  const p=json(join(output,'baseline/store/publication.json')).publication;
  check(r.publication_hash === hash(encode(p)));
  check(r.version === 1 && r.mode === 'local_synthetic' && r.production_ready === false && r.native_acceptance === true);
  same(r.restart,restart); same(r.remaining_gates,gates); same(r.observations,observations);
  check(r.runtimes.length === 2); r.runtimes.forEach(assertRuntimeReceipt);
  const {featureStoreScopeIdentity} = await import('../../../packages/contracts/dist/feature-serving.js');
  const identity = featureStoreScopeIdentity(p.scope);
  const envelope = encode({version:1,scope:identity,scope_hash:hash(identity),generation:p.generation,hash:p.content_hash,previous_generation:p.predecessor?.generation ?? 0,previous_hash:p.predecessor?.content_hash ?? null,publication:p});
  check(r.metrics.keys === 1 && r.metrics.value_bytes === Buffer.byteLength(envelope) && r.metrics.value_bytes <= 1048576);
  for (const n of [r.elapsed_ms,r.metrics.baseline_ms,r.metrics.cache_ms]) check(Number.isFinite(n) && n >= 0 && n <= 180000);
  same(r.source_hashes,provenance()); return r;
}
export async function runFeatureCacheComparison(options) {
  check(arguments.length === 1 && options && Object.getPrototypeOf(options) === Object.prototype);
  same(Reflect.ownKeys(options),['output']); check('value' in Object.getOwnPropertyDescriptor(options,'output'));
  const {output}=parseCli(['--output',options.output]); parents(output);
  const before=provenance(), started=performance.now();
  mkdirSync(output,{mode:0o700}); // exclusive destination; never reuse a service or receipt
  let runtime; const receipts=[];
  try {
    const t=performance.now(); await runFeatureServingAcceptance({output:join(output,'baseline')}); const baseline_ms=performance.now()-t;
    await verifyFeatureServingAcceptance(join(output,'baseline'));
    const env=json(join(output,'baseline/store/publication.json')), p=env.publication, scope=p.scope;
    const first=json(join(output,'baseline/rebuilt/publication.json')).publication;
    const {openFeatureCache}=await import('../dist/feature-cache.js');
    const {serveFeatureSnapshot}=await import('../../../packages/risk/dist/index.js');
    const {featureStoreScopeIdentity}=await import('../../../packages/contracts/dist/feature-serving.js');
    const key='lmps:local_synthetic:feature-cache:1:'+hash(featureStoreScopeIdentity(scope));
    const nativeStart=performance.now();
    runtime=await createRuntime({output:'.local/cache-compare-'+randomUUID()});
    let cache=openFeatureCache(runtime,scope);
    assertObservation(await cache.serve(request(scope)),0,0,'PUBLICATION_MISSING');
    check((await cache.publish(first)).status === 'published'); check((await cache.publish(first)).status === 'idempotent');
    check((await cache.publish(p)).generation === 2);
    for(let i=0;i<6;i++) { assertObservation(await cache.serve(request(scope,i)),i,2); assertObservation(serveFeatureSnapshot(p,scope,request(scope,i)),i,2); }
    const raw=await runtime.request(['GET',key]); check(typeof raw === 'string'); same(JSON.parse(raw).publication,p);
    const value_bytes=Buffer.byteLength(raw); check(await runtime.request(['DBSIZE']) === 1);
    await rejected(()=>cache.publish(first)); await rejected(()=>cache.rebuild(first)); same(await runtime.request(['GET',key]),raw);
    assertObservation(await cache.serve(request(scope,0,{now:p.expires_at})),0,2,'PUBLICATION_EXPIRED');
    assertObservation(await cache.serve(request(scope,0,{now:'2026-01-01T13:00:01Z'})),0,2,'SOURCE_STALE');
    await runtime.stop(); receipts.push(stopped(runtime));
    assertObservation(await cache.serve(request(scope)),0,2,'CACHE_UNAVAILABLE');
    runtime=await createRuntime({output:'.local/cache-compare-'+randomUUID()}); cache=openFeatureCache(runtime,scope);
    check(await runtime.request(['DBSIZE']) === 0); assertObservation(await cache.serve(request(scope)),0,0,'PUBLICATION_MISSING');
    await verifyFeatureServingAcceptance(join(output,'baseline')); same(json(join(output,'baseline/store/publication.json')),env);
    check((await cache.rebuild(json(join(output,'baseline/store/publication.json')).publication)).generation === 2);
    for(let i=0;i<6;i++) assertObservation(await cache.serve(request(scope,i)),i,2);
    await rejected(()=>cache.rebuild(first)); same(JSON.parse(await runtime.request(['GET',key])).publication,p);
    await runtime.stop(); receipts.push(stopped(runtime)); check(ownedProcessHandles().length === 0);
    same(before,provenance()); check(performance.now()-started < 175000); receipts.forEach(assertRuntimeReceipt);
    const result={version:1,mode:'local_synthetic',production_ready:false,native_acceptance:true,source_hashes:before,baseline_hash:hash(read(join(output,'baseline/acceptance.json'),true)),publication_hash:hash(encode(p)),observations,runtimes:receipts,metrics:{keys:1,value_bytes,baseline_ms,cache_ms:performance.now()-nativeStart},elapsed_ms:performance.now()-started,restart,remaining_gates:gates};
    check(Buffer.byteLength(encode(result)) < 1048576 && evidenceBytes(output)+Buffer.byteLength(encode(result)) <= 16*1024**2);
    const stage=join(output,'.stage-'+randomUUID()), fd=openSync(stage,C.O_WRONLY | C.O_CREAT | C.O_EXCL | C.O_NOFOLLOW,0o600);
    try { writeFileSync(fd,encode(result)); fsyncSync(fd); } finally { closeSync(fd); }
    linkSync(stage,join(output,'comparison.json')); unlinkSync(stage);
    const dir=openSync(output,C.O_RDONLY | C.O_DIRECTORY | C.O_NOFOLLOW); try { fsyncSync(dir); } finally { closeSync(dir); }
    return await verifyFeatureCacheComparison(output);
  } finally { if(runtime) await runtime.stop(); }
}
if(process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  Promise.resolve().then(()=>runFeatureCacheComparison(parseCli(process.argv.slice(2)))).then(()=>process.stdout.write('Local synthetic comparison verified; production_ready=false.\n'),()=>{process.stderr.write('Feature cache comparison failed; no acceptance claim.\n');process.exitCode=1;});
}
