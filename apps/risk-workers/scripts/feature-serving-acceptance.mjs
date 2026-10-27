/** Explicit local synthetic acceptance; importing this module performs no IO. */
import { createHash, randomUUID } from 'node:crypto';
import { constants as C, openSync, closeSync, fstatSync, readSync, lstatSync, mkdirSync, readdirSync, linkSync, unlinkSync, writeFileSync, fsyncSync, realpathSync } from 'node:fs';
import { findPackageJSON } from 'node:module';
import { join, dirname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const fail = () => Object.assign(new Error('FEATURE_SERVING_ACCEPTANCE_FAILED'), { code: 'FEATURE_SERVING_ACCEPTANCE_FAILED' });
const check = v => { if (!v) throw fail(); };
const encode = v => JSON.stringify(v, (_k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : x);
const hash = v => createHash('sha256').update(v).digest('hex').match(/.{8}/g).join(' ');
const equal = (a, b) => check(encode(a) === encode(b));
const at = '2026-01-01T12:01:00Z', expiry = '2026-01-02T12:01:00Z', later = '2026-01-01T12:02:00Z';
const fixed = [['11','14.11',null],['11','13.14',null],[null,null,'INPUT_MISSING'],[null,null,'HISTORY_INCOMPLETE'],['11','13.14',null],['1','7.00',null]];
const gates = ['host_full_checks','promoted_source_parent_acceptance','real_source_identity_masking','cache_selection_HA_capacity_native_Kafka','production_adoption_original_master'];
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
async function provenance() {
  const paths = ['apps/risk-workers/scripts/feature-serving-acceptance.mjs','packages/risk/test/fixtures/feature-streams/golden.json','packages/risk/fixtures/request.mjs'];
  function walk(dir, extension) {
    const s = lstatSync(join(ROOT, dir)); check(s.isDirectory() && !s.isSymbolicLink());
    for (const name of readdirSync(join(ROOT, dir)).sort()) { const p = join(dir, name), s = lstatSync(join(ROOT, p)); check(!s.isSymbolicLink()); if (s.isDirectory()) walk(p, extension); else if (name.endsWith(extension)) paths.push(p); }
  }
  for (const dir of ['packages/contracts','packages/risk','apps/risk-workers']) { paths.push(dir + '/package.json'); walk(dir + '/dist', '.js'); }
  for (const dir of ['packages/contracts','packages/risk']) walk(dir + '/src', '.ts');
  walk('packages/contracts/schemas', '.json');
  for (const name of ['feature-stream-consumer','feature-snapshot-store','feature-serving-adapter']) paths.push('apps/risk-workers/src/' + name + '.ts');
  for (const base of [new URL('../dist/feature-serving-adapter.js', import.meta.url),new URL('../../../packages/risk/dist/feature-serving.js', import.meta.url)]) {
    for (const [specifier, dir] of [['@lmps/risk','packages/risk'],['@lmps/contracts','packages/contracts']]) check(realpathSync(findPackageJSON(specifier, base)) === join(ROOT, dir, 'package.json'));
  }
  const contracts = JSON.parse(read(join(ROOT, 'packages/contracts/package.json'))), risk = JSON.parse(read(join(ROOT, 'packages/risk/package.json')));
  for (const name of ['feature-stream','feature-serving']) check(contracts.exports['./' + name] === './dist/' + name + '.js');
  equal(risk.exports['.'], { types: './dist/index.d.ts', import: './dist/index.js' });
  return Object.fromEntries(paths.sort().map(p => { check(realpathSync(join(ROOT, p)) === join(ROOT, p)); return [p, hash(read(join(ROOT, p)))]; }));
}
function fixture() {
  const raw = read(join(ROOT, 'packages/risk/test/fixtures/feature-streams/golden.json'), 32768), corpus = JSON.parse(raw);
  check(corpus.events.length === 18 && corpus.events.length <= 32 && corpus.snapshots.length === 6);
  const plan = { version: 'synthetic-feature-stream-1', identity: 'synthetic_declared', run_id: 'synthetic_run', input_identity: 'synthetic_golden_v1', namespace: 'synthetic_golden', topic: 'synthetic_golden.synthetic_run', window_seconds: 3600, coverage_start: corpus.coverage_start,
    queries: corpus.snapshots.map(({ expected, ...q }) => q), limits: { records: 32, revisions: 32, snapshots: 8, capture_bytes: 32768, state_bytes: 1048576 } };
  const scope = { version: 'synthetic-feature-serving-1', mode: 'local_synthetic', workspace_key: 'synthetic_acceptance', plan, policy: { id: 'synthetic_fixture', version: 'synthetic_v1', max_age_seconds: 3600 } };
  const deliveries = corpus.events.map((event, offset) => ({ identity: plan.identity, topic: plan.topic, partition: 0, offset, event }));
  return { corpus, plan, scope, deliveries };
}
const request = (scope, i = 0, extra = {}) => ({ version: scope.version, workspace_key: scope.workspace_key, plan: scope.plan, query: scope.plan.queries[i], currency: scope.plan.queries[i].currency, policy: scope.policy, now: at, ...extra });
function refused(fn) { let rejected = false; try { fn(); } catch (e) { check(e.code === 'FEATURE_SERVING_INVALID'); rejected = true; } check(rejected); }
async function expectedState(f) {
  const { initializeFeatureStream, applyFeatureStreamDelivery, materializeFeatureStreamSnapshot, evaluateTransactionRisk } = await import('../../../packages/risk/dist/index.js');
  const { riskFixture } = await import('../../../packages/risk/fixtures/request.mjs');
  const { corpus, plan, deliveries } = f;
  let state = initializeFeatureStream(plan); for (const d of deliveries) state = applyFeatureStreamDelivery(state, d);
  for (const [i, q] of plan.queries.entries()) {
    const result = materializeFeatureStreamSnapshot(state, q.id); state = result.state; const s = result.snapshot;
    equal([s.count, s.amount, s.reason], fixed[i]);
    equal([s.window_start, s.window_end], i === 5 ? ['2026-01-01T10:50:00Z','2026-01-01T11:50:00Z'] : ['2026-01-01T11:00:00Z','2026-01-01T12:00:00Z']);
    equal(Object.fromEntries(Object.keys(corpus.snapshots[i].expected).map(k => [k, s[k]])), corpus.snapshots[i].expected);
    const target = corpus.events.find(e => e.transaction_id === q.target), { request: req, observation } = riskFixture();
    req.target = { namespace: target.namespace, transaction_id: target.transaction_id, revision_number: target.revision_number }; req.policy.currency = q.currency;
    Object.assign(req.context, { binding: { ...req.target, revision_sha256: observation.revision_sha256 }, as_of: q.as_of, coverage_start: plan.coverage_start, coverage_complete: q.coverage_complete, events: structuredClone(corpus.events), flagged_accounts: q.flags_available ? [] : null, flagged_accounts_version: q.flags_available ? 'synthetic_empty_v1' : null });
    Object.assign(observation, { amount: target.amount, reversed_amount: target.reversed_amount, currency: target.currency, transaction_status: target.status, observed_at: q.as_of });
    if (q.evidence === 'missing') for (const k of Object.keys(observation)) observation[k] = k === 'status' ? 'missing' : null;
    const reference = evaluateTransactionRisk(req, observation);
    for (const [code, value] of [['FRAUD_COUNT_VELOCITY',fixed[i][0]],['FRAUD_AMOUNT_VELOCITY',fixed[i][1]]]) { const finding = reference.findings.find(f => f.code === code); check(finding && (finding.metric?.value ?? null) === value && (!s.reason || finding.reason_code === s.reason)); }
  }
  return state;
}
function inventory(output) {
  const files = {}; let bytes = 0;
  function walk(dir) { privateDir(dir); for (const name of readdirSync(dir).sort()) { const path = join(dir, name), s = lstatSync(path); check(!s.isSymbolicLink()); if (s.isDirectory()) walk(path); else { check(name !== 'writer.lock' && !name.startsWith('stage-')); const b = read(path, 1048576, true); bytes += b.length; check(bytes <= 16 * 1024 ** 2); files[relative(output, path)] = hash(b); } } }
  walk(output); return { files, bytes };
}
async function evidence(output, f) {
  const { scope, plan } = f, state = await expectedState(f);
  const { restoreFeatureStream, serveFeatureSnapshot } = await import('../../../packages/risk/dist/index.js');
  const { validateFeaturePublication, featurePublicationContentHash, validateFeatureServingResult } = await import('../../../packages/contracts/dist/feature-serving.js');
  privateDir(output);
  const names = readdirSync(output).sort();
  equal(names, names.includes('acceptance.json') ? ['acceptance.json','consumer','rebuilt','store'] : ['consumer','rebuilt','store']);
  privateDir(join(output, 'consumer'));
  const owner = json(join(output, 'consumer/owner.json')), cp = json(join(output, 'consumer/checkpoint.json'));
  check(typeof owner.owner === 'string' && /^[a-f0-9-]{36}$/.test(owner.owner)); equal(owner, { version: 1, owner: owner.owner });
  equal(restoreFeatureStream(cp.state, plan), state);
  equal(cp, { version: 1, owner: owner.owner, plan_hash: hash(encode(plan)), state_hash: hash(encode(state)), next_offset: 18, state });
  for (const [name, generation, time] of [['store',2,later],['rebuilt',1,at]]) {
    privateDir(join(output, name));
    const marker = json(join(output, name, 'owner.json')), env = json(join(output, name, 'publication.json'));
    check(typeof marker.owner === 'string' && /^[a-f0-9-]{36}$/.test(marker.owner)); equal(marker, { version: 1, owner: marker.owner });
    const p = validateFeaturePublication(env.publication); equal(env, { version: 1, owner: marker.owner, scope, publication: p });
    check(p.content_hash === featurePublicationContentHash(p) && p.generation === generation && p.published_at === time && p.expires_at === expiry); equal(p.scope, scope); equal(p.state, state);
    refused(() => serveFeatureSnapshot(p, scope, request(scope, 0, { currency: 'THB' })));
    refused(() => serveFeatureSnapshot(p, scope, request(scope, 0, { query: { ...plan.queries[0], id: 'synthetic_unknown_query' } })));
    for (let i = 0; i < 6; i++) { const r = validateFeatureServingResult(serveFeatureSnapshot(p, scope, request(scope, i, { now: later }))); equal([r.count, r.amount, r.reason], fixed[i]); if (r.status === 'available') { equal(r.provenance.publication, p); equal(r.provenance.snapshot, state.snapshots[i]); } else check(r.provenance === null); }
    for (const [extra, reason] of [[{now:'2026-01-01T13:00:00Z'},null],[{now:'2026-01-01T13:00:01Z'},'SOURCE_STALE'],[{now:expiry},'PUBLICATION_EXPIRED'],[{now:'2026-01-01T12:00:00Z'},'FUTURE_PUBLICATION'],[{now:later,workspace_key:'synthetic_other'},'SCOPE_MISMATCH'],[{now:later,plan:{...plan,namespace:'synthetic_other',topic:'synthetic_other.synthetic_run'}},'SCOPE_MISMATCH'],[{now:later,policy:{...scope.policy,version:'synthetic_other'}},'POLICY_MISMATCH'],[{now:later,minimum_generation:generation+1},'GENERATION_TOO_OLD']]) {
      const r = validateFeatureServingResult(serveFeatureSnapshot(p, scope, request(scope, 0, extra))); check(r.reason === reason);
      if (reason) equal([r.status,r.count,r.amount,r.provenance], ['unavailable',null,null,null]); else equal([r.status,r.count,r.amount], ['available','11','14.11']);
    }
    if (name === 'store') {
      const first = { ...p, generation: 1, predecessor: null, published_at: at }; first.content_hash = featurePublicationContentHash(first);
      equal(p.predecessor, { generation: 1, content_hash: first.content_hash });
    } else check(p.predecessor === null);
  }
  privateDir(join(output, 'consumer')); equal(readdirSync(join(output, 'consumer')).sort(), ['checkpoint.json','owner.json']);
  for (const name of ['store','rebuilt']) equal(readdirSync(join(output, name)).sort(), ['owner.json','publication.json']);
  return { deliveries: 18, snapshots: 6, next_offset: 18, generation: 2, rebuild_generation: 1, semantic_hash: hash(encode(state)), checkpoint_hash: hash(read(join(output, 'consumer/checkpoint.json'), 1048576, true)) };
}
function publish(output, value) {
  const stage = join(output, '.acceptance-' + randomUUID()), fd = openSync(stage, C.O_WRONLY | C.O_CREAT | C.O_EXCL | C.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, encode(value)); fsyncSync(fd); } finally { closeSync(fd); }
  linkSync(stage, join(output, 'acceptance.json')); unlinkSync(stage); syncDir(output);
}
/** Read-only persisted evidence/CURRENT provenance verification; no receipt input. */
export async function verifyFeatureServingAcceptance(output) {
  try {
    parseArguments(['--output', output]); ancestors(output); privateDir(output); const a = json(join(output, 'acceptance.json'));
    equal(a.source_hashes, await provenance()); equal(a.proof, await evidence(output, fixture()));
    const inv = inventory(output); delete inv.files['acceptance.json']; equal(inv.files, a.evidence_hashes);
    equal(Object.keys(a).sort(), ['version','mode','production_ready','source_hashes','proof','evidence_hashes','evidence_bytes','elapsed_ms','closed_owned_handles','remaining_gates'].sort());
    check(a.version === 1 && a.mode === 'local_synthetic' && a.production_ready === false && a.closed_owned_handles === 0 && Number.isSafeInteger(a.elapsed_ms) && a.elapsed_ms >= 0 && a.elapsed_ms <= 180000);
    equal(a.remaining_gates, gates); equal(a.source_hashes, await provenance());
    check(a.evidence_bytes === Object.keys(inv.files).reduce((n, p) => n + read(join(output, p), 1048576, true).length, 0));
    return a;
  } catch { throw fail(); }
}
/** Runner accepts exactly one new absolute project .local output destination. */
export async function runFeatureServingAcceptance(options) {
  const started = performance.now();
  try {
    check(arguments.length === 1 && options && Object.getPrototypeOf(options) === Object.prototype); equal(Reflect.ownKeys(options), ['output']);
    const d = Object.getOwnPropertyDescriptor(options, 'output'); check(d && 'value' in d);
    const { output } = parseArguments(['--output', d.value]); ancestors(output); absent(output);
    const before = await provenance(), f = fixture(); await expectedState(f);
    const { scope, deliveries } = f;
    const { openFeatureServingAdapter: open, rebuildFeatureServingStore: rebuild } = await import('../dist/feature-serving-adapter.js');
    const { openFeatureSnapshotStore } = await import('../dist/feature-snapshot-store.js');
    const { featurePublicationContentHash, validateFeatureServingResult } = await import('../../../packages/contracts/dist/feature-serving.js');
    mkdirSync(output, { mode: 0o700 }); syncDir(dirname(output));
    const c = join(output, 'consumer'), s = join(output, 'store'); let a = open(c, s, scope), first, receipt;
    const serve = req => validateFeatureServingResult(a.serve(req));
    try {
      const missing = serve(request(scope));
      equal([missing.status,missing.count,missing.amount,missing.reason,missing.provenance], ['unavailable',null,null,'PUBLICATION_MISSING',null]);
      receipt = a.publish(deliveries, at, expiry); first = a.read(); check(receipt.generation === 1 && receipt.next_offset === 18);
      const bytes = read(join(s, 'publication.json'), 1048576, true), ino = lstatSync(join(s, 'publication.json')).ino;
      equal(a.publish(deliveries, at, expiry), receipt); check(lstatSync(join(s, 'publication.json')).ino === ino); check(bytes.equals(read(join(s, 'publication.json'), 1048576, true)));
    } finally { a.close(); }
    a = open(c, s, scope);
    try {
      equal(a.publish(deliveries, at, expiry), receipt);
      refused(() => a.serve(request(scope, 0, { currency: 'THB' })));
      refused(() => a.serve(request(scope, 0, { query: { ...scope.plan.queries[0], id: 'synthetic_unknown_query' } })));
      for (let i = 0; i < 6; i++) { const r = serve(request(scope, i)); equal([r.count,r.amount,r.reason], fixed[i]); }
      for (const [extra, reason] of [[{now:'2026-01-01T13:00:00Z'},null],[{now:'2026-01-01T13:00:01Z'},'SOURCE_STALE'],[{now:expiry},'PUBLICATION_EXPIRED'],[{workspace_key:'synthetic_other'},'SCOPE_MISMATCH'],[{plan:{...scope.plan,namespace:'synthetic_other',topic:'synthetic_other.synthetic_run'}},'SCOPE_MISMATCH'],[{policy:{...scope.policy,version:'synthetic_other'}},'POLICY_MISMATCH'],[{minimum_generation:2},'GENERATION_TOO_OLD']]) {
        const r = serve(request(scope, 0, extra)); check(r.reason === reason); if (reason) equal([r.count,r.amount,r.provenance], [null,null,null]); else check(r.status === 'available');
      }
      const cp = read(join(c, 'checkpoint.json'), 1048576, true);
      refused(() => a.publish([{...deliveries[0],event:{...deliveries[0].event,amount:'99.00'}}], at, expiry)); check(cp.equals(read(join(c, 'checkpoint.json'), 1048576, true)));
      check(a.publish([], later, expiry).generation === 2);
    } finally { a.close(); }
    const store = openFeatureSnapshotStore(s, scope);
    try {
      const original = read(join(s, 'publication.json'), 1048576, true); refused(() => store.publish(first));
      const conflict = store.read(); conflict.published_at = '2026-01-01T12:03:00Z'; conflict.content_hash = featurePublicationContentHash(conflict); refused(() => store.publish(conflict));
      check(original.equals(read(join(s, 'publication.json'), 1048576, true)));
    } finally { store.close(); }
    check(rebuild(c, join(output, 'rebuilt'), scope, at, expiry).generation === 1); refused(() => rebuild(c, s, scope, at, expiry));
    const proof = await evidence(output, f), inv = inventory(output); equal(before, await provenance());
    check(performance.now() - started <= 180000);
    const acceptance = { version: 1, mode: 'local_synthetic', production_ready: false, source_hashes: before, proof, evidence_hashes: inv.files, evidence_bytes: inv.bytes, elapsed_ms: Math.ceil(performance.now() - started), closed_owned_handles: 0,
      remaining_gates: gates };
    check(inv.bytes + Buffer.byteLength(encode(acceptance)) <= 16 * 1024 ** 2);
    publish(output, acceptance); equal(json(join(output, 'acceptance.json')), acceptance); check(performance.now() - started <= 180000); return acceptance;
  } catch { throw fail(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await runFeatureServingAcceptance(parseArguments(process.argv.slice(2))); process.stdout.write('FEATURE_SERVING_ACCEPTANCE_RECORDED\n'); }
  catch { process.stderr.write('FEATURE_SERVING_ACCEPTANCE_FAILED\n'); process.exitCode = 1; }
}
