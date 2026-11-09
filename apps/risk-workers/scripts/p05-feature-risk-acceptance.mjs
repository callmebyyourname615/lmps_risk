/** Explicit local synthetic acceptance; importing this module performs no IO. */
import { createHash, randomUUID } from 'node:crypto';
import { constants as C, openSync, closeSync, fstatSync, readSync, lstatSync, mkdirSync, readdirSync, linkSync, unlinkSync, writeFileSync, fsyncSync, realpathSync } from 'node:fs';
import { findPackageJSON } from 'node:module';
import { join, dirname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const fail = () => Object.assign(new Error('P05_FEATURE_RISK_ACCEPTANCE_FAILED'), { code: 'P05_FEATURE_RISK_ACCEPTANCE_FAILED' });
const check = v => { if (!v) throw fail(); };
const encode = v => JSON.stringify(v, (_k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : x);
const hash = v => createHash('sha256').update(v).digest('hex').match(/.{8}/g).join(' ');
const equal = (a, b) => check(encode(a) === encode(b));
function read(path, max = 1048576, privateFile = false) {
  const fd = openSync(path, C.O_RDONLY | C.O_NOFOLLOW | C.O_NONBLOCK);
  try {
    const s = fstatSync(fd); check(s.isFile() && s.nlink === 1 && s.size <= max);
    if (privateFile) check(s.uid === process.getuid() && (s.mode & 0o777) === 0o600);
    const b = Buffer.alloc(max + 1); let n = 0, got;
    while ((got = readSync(fd, b, n, b.length - n, null))) { n += got; check(n <= max); }
    const result = b.subarray(0, n); check(Buffer.from(result.toString('utf8')).equals(result)); return result;
  } finally { closeSync(fd); }
}
const json = p => { const bytes = read(p, 1048576, true), value = JSON.parse(bytes); check(bytes.toString('utf8') === encode(value)); return value; };
function syncDir(p) { const fd = openSync(p, C.O_RDONLY | C.O_DIRECTORY | C.O_NOFOLLOW); try { fsyncSync(fd); } finally { closeSync(fd); } }
export function parseArguments(args) {
  check(Array.isArray(args) && args.length === 2 && args[0] === '--output'); const output = args[1];
  check(typeof output === 'string' && isAbsolute(output) && resolve(output) === output && !/[\\\x00-\x20\x7f]/.test(output));
  const rel = relative(join(ROOT, '.local'), output);
  check(rel && !rel.startsWith('..') && !isAbsolute(rel) && rel.split('/').every(s => /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(s)));
  return { output };
}
function ancestors(output) {
  const local = join(ROOT, '.local');
  for (let p = dirname(output);; p = dirname(p)) {
    const s = lstatSync(p); check(s.isDirectory() && !s.isSymbolicLink() && !(s.mode & 0o022));
    if (p === local || p.startsWith(local + '/')) check(s.uid === process.getuid() && (s.mode & 0o777) === 0o700);
    if (p === dirname(p)) break;
  }
}
function privateDir(p) { const s = lstatSync(p); check(s.isDirectory() && !s.isSymbolicLink() && s.uid === process.getuid() && (s.mode & 0o777) === 0o700); }
function absent(p) { try { lstatSync(p); } catch (e) { if (e.code === 'ENOENT') return; throw e; } throw fail(); }
async function fixture({ missing = false, partial = false, zero = false } = {}) {
  const { riskFixture } = await import("../../../packages/risk/fixtures/request.mjs");
  const { request, observation } = riskFixture();
  request.run_id = "00000000-0000-4000-8000-000000000001";
  request.context = null;
  observation.amount = zero ? '0.00' : '10.00'; observation.observed_at = '2026-01-01T12:00:00Z';
  const query = { id: 'current', target: request.target.transaction_id, as_of: observation.observed_at,
    currency: 'SYN', evidence: missing ? 'missing' : 'available', coverage_complete: !partial, flags_available: false };
  const plan = { version: 'synthetic-feature-stream-1', identity: 'synthetic_declared', run_id: 'synthetic_run', input_identity: 'synthetic_serving',
    namespace: request.target.namespace, topic: request.target.namespace + '.synthetic_run', window_seconds: 3600,
    coverage_start: '2026-01-01T08:00:00Z', queries: [query],
    limits: { records: 32, revisions: 32, snapshots: 8, capture_bytes: 32768, state_bytes: 1048576 } };
  const scope = { version: 'synthetic-feature-serving-1', mode: 'local_synthetic', workspace_key: request.workspace_key, plan,
    policy: { id: 'synthetic_fixture', version: 'synthetic_v1', max_age_seconds: 120 } };
  const serving_request = { version: scope.version, workspace_key: scope.workspace_key, plan, query,
    currency: 'SYN', policy: scope.policy, now: '2026-01-01T12:02:00Z' };
  const event = (transaction_id, amount, extra = {}) => ({ ...request.target, transaction_id, amount,
    reversed_amount: '0.00', currency: 'SYN', status: 'succeeded', sender: 'synthetic_A', receiver: 'synthetic_B',
    occurred_at: '2026-01-01T11:30:00Z', available_at: '2026-01-01T11:30:00Z', ...extra });
  const events = [event(request.target.transaction_id, observation.amount, { occurred_at: query.as_of, available_at: query.as_of })];
  if (!zero) events.push(event('synthetic_prior', '1.01'), event('synthetic_prior', '1.01'),
    event('synthetic_prior', '1.01', { revision_number: 2, reversed_amount: '0.01', status: 'partially_reversed' }),
    event('synthetic_reversed', '9.00', { reversed_amount: '9.00', status: 'reversed' }),
    event('synthetic_future', '999.00', { available_at: '2026-01-01T12:00:01Z' }));
  const deliveries = events.map((event, offset) => ({ identity: plan.identity, topic: plan.topic, partition: 0, offset, event }));
  return { scope, serving_request, risk_request: request, observation, deliveries };
}
const SELF = fileURLToPath(import.meta.url), at = '2026-01-01T12:00:00Z', expiry = '2026-01-01T13:00:00Z';
const variants = [{},{missing:true},{partial:true},{zero:true}];
const gates = ['host_root_typecheck_test_build_frozen_offline_fresh','trusted_automation_publication_source_plan_git',
 'final_promoted_cli_fresh_process_verification','verified_source_account_identity','owner_reviewed_policy',
 'historical_eligibility','workload_SLO','durable_alert_integration','production_adoption'];
function provenance() {
 const paths = [relative(ROOT,SELF),'packages/risk/fixtures/request.mjs','package.json','pnpm-lock.yaml'];
 function walk(dir) {
  check(!lstatSync(join(ROOT,dir)).isSymbolicLink());
  for (const n of readdirSync(join(ROOT,dir)).sort()) {
   const p = join(dir,n), s = lstatSync(join(ROOT,p)); check(!s.isSymbolicLink());
   if (s.isDirectory()) walk(p); else if (/\.(ts|js|json)$/.test(n)) paths.push(p);
   check(paths.length <= 4096);
  }
 }
 for (const base of ['packages/contracts','packages/risk','apps/risk-workers']) {
  paths.push(base+'/package.json'); walk(base+'/src'); walk(base+'/dist');
 }
 walk('packages/contracts/schemas');
 for (const base of [new URL('../dist/feature-risk-serving.js',import.meta.url),new URL('../../../packages/risk/dist/feature-risk.js',import.meta.url)]) {
  for (const [name,dir] of [['@lmps/risk','packages/risk'],['@lmps/contracts','packages/contracts']])
   check(realpathSync(findPackageJSON(name,base)) === join(ROOT,dir,'package.json'));
 }
 return Object.fromEntries(paths.sort().map(p => { check(realpathSync(join(ROOT,p)) === join(ROOT,p)); return [p,hash(read(join(ROOT,p),4194304))]; }));
}
function rejected(fn) { let refused = false; try { fn(); } catch { refused = true; } check(refused); }
async function results(publication,f,reader = {read:() => publication}) {
 const { serveFeatureRisk } = await import('../dist/feature-risk-serving.js');
 const { replayFeatureRisk,compareFeatureRiskReplay } = await import('../dist/feature-risk-replay.js');
 const { projectFeatureRiskAlerts,riskHash,RISK_CODES } = await import('../../../packages/risk/dist/index.js');
 const { serving_request:s,risk_request:r,observation:o } = f;
 const tuple = {serving_request:s,risk_request:r,observation:o};
 const served = serveFeatureRisk(reader,f.scope,s,r,o), replay = replayFeatureRisk(publication,f.scope,[tuple]);
 check(compareFeatureRiskReplay(publication,f.scope,[tuple],[served]).status === 'match');
 const policy = {policy_id:'synthetic_alerts',version:'synthetic_v1',minimum_severity:'high',included_codes:[...RISK_CODES],include_partial:true};
 const project = p => projectFeatureRiskAlerts(publication,f.scope,s,r,o,p);
 const alerts = project(policy); check(served.assessment.findings.length === 15 && alerts.production_ready === false);
 equal(riskHash(served.assessment),alerts.identities.assessment_sha256);
 const reason = s.query.evidence === 'missing' ? 'INPUT_MISSING' : !s.query.coverage_complete ? 'HISTORY_INCOMPLETE' : null;
 equal(served.feature.reason,reason);
 if (reason) check(served.context.status === 'withheld');
 else if (o.amount !== '0.00') {
  const metric = code => served.assessment.findings.find(x => x.code === code).metric.value;
  equal([metric('FRAUD_COUNT_VELOCITY'),metric('FRAUD_AMOUNT_VELOCITY')],['2','11.00']);
 }
 else equal([served.feature.count,served.feature.amount],['0','0.00']);
 equal(alerts.candidates.map(c => c.snapshot.selected_risk_types), reason || o.amount === '0.00' ? [] : [['FRAUD_COUNT_VELOCITY']]);
 equal(alerts.reason_code,reason ? 'FEATURE_CONTEXT_WITHHELD' : o.amount === '0.00' ? 'ALERT_ASSESSMENT_INELIGIBLE' : 'ALERT_CREATED');
 const versioned = project({...policy,version:'synthetic_v2'}); check(riskHash(versioned) !== riskHash(alerts));
 if (alerts.candidates.length) {
  check(versioned.candidates[0].candidate_sha256 !== alerts.candidates[0].candidate_sha256);
  equal(project({...policy,include_partial:false}).reason_code,'ALERT_PARTIAL_EXCLUDED');
 }
 const stale = serveFeatureRisk(reader,f.scope,{...s,now:'2026-01-01T12:02:01Z'},r,o);
 check(stale.context.status === 'withheld'); equal(stale.feature.reason,reason ?? 'SOURCE_STALE');
 const future = serveFeatureRisk(reader,f.scope,{...s,now:'2026-01-01T11:59:59Z'},r,o); equal(future.feature.reason,'FUTURE_PUBLICATION');
 rejected(() => serveFeatureRisk(reader,f.scope,{...s,currency:'USD'},r,o));
 rejected(() => serveFeatureRisk(reader,{...f.scope,extra:true},s,r,o));
 rejected(() => serveFeatureRisk(reader,f.scope,s,{...r,context:{}},o));
 rejected(() => serveFeatureRisk(reader,f.scope,s,r,{...o,observed_at:'2026-01-01T12:00:01Z'}));
 const forged = structuredClone(publication);
 const { featurePublicationContentHash } = await import('../../../packages/contracts/dist/feature-serving.js');
 rejected(() => { forged.state.snapshots[0].amount = '123.45'; forged.content_hash = featurePublicationContentHash(forged);
  replayFeatureRisk(forged,f.scope,[tuple]); });
 return {served,replay,alert_policy:policy,alerts,versioned,stale,future};
}
function inventory(output) {
 let bytes = 0, entries = 0; const files = {};
 function walk(dir) { privateDir(dir); for (const n of readdirSync(dir).sort()) {
  check(++entries <= 256); const p = join(dir,n), s = lstatSync(p); check(!s.isSymbolicLink());
  if (s.isDirectory()) walk(p); else { check(!/lock|stage/.test(n)); const b = read(p,2097152,true); bytes += b.length;
   check(bytes <= 16777216); files[relative(output,p)] = hash(b); }
 } }
 walk(output); return {files,bytes};
}
function write(output,name,value) {
 const stage = join(output,'stage-'+randomUUID()), fd = openSync(stage,C.O_CREAT|C.O_EXCL|C.O_WRONLY|C.O_NOFOLLOW,0o600);
 try { writeFileSync(fd,encode(value)); fsyncSync(fd); } finally { closeSync(fd); }
 linkSync(stage,join(output,name)); unlinkSync(stage); syncDir(output);
}
function receipt(output,sources) {
 const inv = inventory(output); delete inv.files['acceptance.json'];
 const bindings = variants.map((_,i) => {
  const dir = join(output,'case-'+i), f = json(join(dir,'input.json')), r = json(join(dir,'result.json'));
  return {input_sha256:hash(encode(f)),policy_sha256:hash(encode(f.risk_request.policy)),
   alert_policy_sha256:hash(encode(r.alert_policy)),publication_sha256:hash(encode(json(join(dir,'store/publication.json')).publication)),
   result_sha256:hash(encode(r))};
 });
 return {version:1,mode:'local_synthetic',production_ready:false,source_hashes:sources,evidence_hashes:inv.files,bindings,
  owned_handles:0,owned_processes:0,remaining_gates:gates};
}
async function body(output) {
 ancestors(output); privateDir(output); const sources = provenance();
 equal(readdirSync(output).sort(),['acceptance.json','case-0','case-1','case-2','case-3']);
 for (const [i,variant] of variants.entries()) {
  const dir = join(output,'case-'+i), f = await fixture(variant); privateDir(dir);
  equal(readdirSync(dir).sort(),['consumer','input.json','result.json','store']); equal(json(join(dir,'input.json')),f);
  for (const sub of ['consumer','store']) { privateDir(join(dir,sub)); equal(readdirSync(join(dir,sub)).sort(),
   sub === 'store' ? ['owner.json','publication.json'] : ['checkpoint.json','owner.json']); }
  const env = json(join(dir,'store/publication.json')), owner = json(join(dir,'store/owner.json'));
  equal(env.owner,owner.owner); equal(env.scope,f.scope); check(env.version === 1 && owner.version === 1); equal(env.publication.generation,1);
  const { initializeFeatureStream,applyFeatureStreamDelivery,materializeFeatureStreamSnapshot } = await import('../../../packages/risk/dist/index.js');
  let state = initializeFeatureStream(f.scope.plan);
  for (const d of f.deliveries) state = applyFeatureStreamDelivery(state,d);
  state = materializeFeatureStreamSnapshot(state,'current').state;
  equal(env.publication.state,state); equal([env.publication.published_at,env.publication.expires_at,env.publication.predecessor],[at,expiry,null]);
  equal(json(join(dir,'result.json')),await results(env.publication,f));
  const cp = json(join(dir,'consumer/checkpoint.json')); equal(cp.owner,json(join(dir,'consumer/owner.json')).owner); equal(cp.state,env.publication.state);
 }
 equal(sources,provenance()); return receipt(output,sources);
}
export async function verifyP05FeatureRiskAcceptance(output) {
 parseArguments(['--output',output]); ancestors(output); privateDir(output);
 const receipt = json(join(output,'acceptance.json')); equal(receipt,await body(output)); return receipt;
}
export async function runP05FeatureRiskAcceptance(options) {
 check(arguments.length === 1 && options && Object.getPrototypeOf(options) === Object.prototype);
 equal(Reflect.ownKeys(options),['output']); const d = Object.getOwnPropertyDescriptor(options,'output'); check(d && 'value' in d);
 const {output} = parseArguments(['--output',d.value]); ancestors(output); absent(output);
 const started = performance.now(), sources = provenance(); mkdirSync(output,{mode:0o700}); syncDir(dirname(output));
 const { openFeatureServingAdapter:open } = await import('../dist/feature-serving-adapter.js');
 const { serveFeatureRisk } = await import('../dist/feature-risk-serving.js');
 for (const [i,variant] of variants.entries()) {
  const f = await fixture(variant), dir = join(output,'case-'+i); mkdirSync(dir,{mode:0o700}); write(dir,'input.json',f);
  let store = open(join(dir,'consumer'),join(dir,'store'),f.scope);
  try {
   equal(serveFeatureRisk(store,f.scope,f.serving_request,f.risk_request,f.observation).feature.reason,'PUBLICATION_MISSING');
   equal(store.publish(f.deliveries,at,expiry).generation,1); equal(store.publish(f.deliveries,at,expiry).generation,1);
  } finally { store.close(); }
  store = open(join(dir,'consumer'),join(dir,'store'),f.scope);
  try { write(dir,'result.json',await results(store.read(),f,store)); } finally { store.close(); }
 }
 equal(sources,provenance()); check(performance.now()-started <= 180000);
 write(output,'acceptance.json',receipt(output,sources));
 return verifyP05FeatureRiskAcceptance(output);
}
if (process.argv[1] && resolve(process.argv[1]) === SELF) {
 try {
  const args = process.argv.slice(2);
  if (args.length === 2 && args[0] === '--verify') await verifyP05FeatureRiskAcceptance(parseArguments(['--output',args[1]]).output);
  else await runP05FeatureRiskAcceptance(parseArguments(args));
  process.stdout.write('P05_LOCAL_SYNTHETIC_VERIFIED production_ready=false\n');
 } catch { process.stderr.write('P05_FEATURE_RISK_ACCEPTANCE_FAILED\n'); process.exitCode = 1; }
}
