/** Explicit host acceptance. Import is inert; no injected runner or receipt API. */
import { createHash, randomUUID } from 'node:crypto';
import { constants as C } from 'node:fs';
import { open, lstat, mkdir, readdir, link, unlink, realpath } from 'node:fs/promises';
import { findPackageJSON } from 'node:module';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runFeatureStreamSpike, ownedFeatureProcessHandles, parseArguments, validateCapture } from './feature-stream-spike.mjs';
import { verifyRuntime, ownedProcessHandles } from './cdc-runtime.mjs';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const fail = () => Object.assign(new Error('FEATURE_ACCEPTANCE_FAILED'), { code: 'FEATURE_ACCEPTANCE_FAILED' });
const check = x => { if (!x) throw fail(); };
const encode = v => JSON.stringify(v, (_k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : x);
const hash = v => createHash('sha256').update(v).digest('hex').match(/.{8}/g).join(' ');
async function read(path, max = 2097152, privateFile = false) {
  const fd = await open(path, C.O_RDONLY | C.O_NOFOLLOW | C.O_NONBLOCK);
  try {
    const s = await fd.stat(); check(s.isFile() && s.nlink === 1 && s.size <= max);
    if (privateFile) check(s.uid === process.getuid() && (s.mode & 0o777) === 0o600);
    const b = Buffer.alloc(max + 1); let n = 0, got;
    while ((got = (await fd.read(b, n, b.length - n, null)).bytesRead)) { n += got; check(n <= max); }
    const result = b.subarray(0, n); check(Buffer.from(result.toString('utf8')).equals(result)); return result;
  } finally { await fd.close(); }
}
const json = async (p, max) => JSON.parse((await read(p, max, true)).toString());
async function syncDir(path) { const fd = await open(path, C.O_RDONLY | C.O_DIRECTORY | C.O_NOFOLLOW); try { await fd.sync(); } finally { await fd.close(); } }
async function provenance() {
  const workerURL = new URL('../dist/feature-stream-consumer.js', import.meta.url);
  const riskURL = new URL('../../../packages/risk/dist/feature-stream.js', import.meta.url);
  for (const [base, specifier, intended, subpath] of [[workerURL,'@lmps/risk','packages/risk','.'],[workerURL,'@lmps/contracts','packages/contracts','./feature-stream'],[riskURL,'@lmps/contracts','packages/contracts','./feature-stream']]) {
    const manifest = await realpath(findPackageJSON(specifier,base)); check(manifest === join(ROOT,intended,'package.json'));
    const exports = JSON.parse(await read(manifest)).exports;
    check(encode(exports[subpath]) === encode(subpath === '.' ? {types:'./dist/index.d.ts',import:'./dist/index.js'} : './dist/feature-stream.js'));
  }
  const paths = ['packages/contracts/src/feature-stream.ts', 'packages/risk/src/feature-stream.ts', 'packages/risk/src/index.ts',
    'packages/contracts/package.json', 'packages/risk/package.json', 'apps/risk-workers/package.json',
    'apps/risk-workers/src/feature-stream-consumer.ts', 'apps/risk-workers/scripts/cdc-runtime.mjs',
    'apps/risk-workers/scripts/cdc-runtime-pins.json', 'apps/risk-workers/scripts/feature-stream-spike.mjs',
    'apps/risk-workers/scripts/feature-stream-acceptance.mjs', 'packages/risk/test/fixtures/feature-streams/golden.json', 'packages/risk/fixtures/request.mjs'];
  async function walk(dir) {
    const directory = await lstat(join(ROOT,dir)); check(directory.isDirectory() && !directory.isSymbolicLink());
    for (const name of (await readdir(join(ROOT, dir))).sort()) {
      const p = join(dir, name), s = await lstat(join(ROOT, p)); check(!s.isSymbolicLink());
      if (s.isDirectory()) await walk(p); else if (name.endsWith('.js')) paths.push(p);
    }
  }
  for (const dir of ['packages/contracts/dist', 'packages/risk/dist', 'apps/risk-workers/dist']) await walk(dir);
  check(paths.includes('apps/risk-workers/dist/feature-stream-consumer.js'));
  return Object.fromEntries(await Promise.all(paths.sort().map(async p => [p, hash(await read(join(ROOT, p)))])));
}
async function verifyEvidence(output, receipt) {
  for (const p of [output, join(output,'consumer')]) {
    const s = await lstat(p); check(s.isDirectory() && !s.isSymbolicLink() && s.uid === process.getuid() && (s.mode & 0o777) === 0o700);
  }
  check(encode(await json(join(output, 'pipeline-receipt.json'))) === encode(receipt));
  check(encode(Object.keys(receipt).sort()) === encode(['version','production_ready','java_version','kafka_version','deliveries','captures','capture_bytes','input_hash','capture_hash','snapshots_hash','prefix','committed','partition','end_offset','owned_processes','peak_storage_bytes','elapsed_ms'].sort()));
  const raw = await read(join(ROOT, 'packages/risk/test/fixtures/feature-streams/golden.json'), 32768), corpus = JSON.parse(raw);
  check(corpus.events.length === 18 && corpus.snapshots.length === 6);
  const plan = { version: 'synthetic-feature-stream-1', identity: 'synthetic_declared', run_id: 'synthetic_run', input_identity: 'synthetic_golden_v1', namespace: 'synthetic_golden', topic: 'synthetic_golden.synthetic_run', window_seconds: 3600, coverage_start: corpus.coverage_start,
    queries: corpus.snapshots.map(({ expected, ...q }) => q), limits: { records: 32, revisions: 32, snapshots: 8, capture_bytes: 32768, state_bytes: 1048576 } };
  const values = corpus.events.map((event, offset) => encode({ identity: 'synthetic_declared', topic: plan.topic, partition: 0, offset, event }));
  const initial = (await read(join(output, 'capture-initial.txt'), 2097152, true)).toString();
  check(initial === (await read(join(output, 'capture-restart.txt'), 2097152, true)).toString());
  const deliveries = validateCapture(initial, values);
  const { initializeFeatureStream, applyFeatureStreamDelivery, materializeFeatureStreamSnapshot, evaluateTransactionRisk } = await import('../../../packages/risk/dist/index.js');
  const { riskFixture } = await import('../../../packages/risk/fixtures/request.mjs');
  let state = initializeFeatureStream(plan), prefixState;
  for (const [i, d] of deliveries.entries()) { state = applyFeatureStreamDelivery(state, d); if (i === 8) prefixState = state; }
  const snapshots = await json(join(output, 'snapshots.json'), 1048576);
  const fixed = [['11','14.11',null],['11','13.14',null],[null,null,'INPUT_MISSING'],[null,null,'HISTORY_INCOMPLETE'],['11','13.14',null],['1','7.00',null]];
  check(snapshots.length === 6);
  for (const [i, q] of plan.queries.entries()) {
    const result = materializeFeatureStreamSnapshot(state, q.id); state = result.state;
    check(encode(result.snapshot) === encode(snapshots[i])); const s = snapshots[i];
    check(encode([s.count,s.amount,s.reason]) === encode(fixed[i]));
    for (const k of ['count','amount','reason','window_start','window_end']) check(s[k] === corpus.snapshots[i].expected[k]);
    const target = corpus.events.find(e => e.transaction_id === q.target), { request, observation } = riskFixture();
    request.target = { namespace: target.namespace, transaction_id: target.transaction_id, revision_number: target.revision_number }; request.policy.currency = q.currency;
    Object.assign(request.context, { binding: { ...request.target, revision_sha256: observation.revision_sha256 }, as_of: q.as_of, coverage_start: plan.coverage_start, coverage_complete: q.coverage_complete, events: structuredClone(corpus.events), flagged_accounts: q.flags_available ? [] : null, flagged_accounts_version: q.flags_available ? 'synthetic_empty_v1' : null });
    Object.assign(observation, { amount: target.amount, reversed_amount: target.reversed_amount, currency: target.currency, transaction_status: target.status, observed_at: q.as_of });
    if (q.evidence === 'missing') for (const k of Object.keys(observation)) observation[k] = k === 'status' ? 'missing' : null;
    const reference = evaluateTransactionRisk(request, observation);
    for (const [code, value] of [['FRAUD_COUNT_VELOCITY',s.count],['FRAUD_AMOUNT_VELOCITY',s.amount]]) { const f = reference.findings.find(f => f.code === code); check(f && (f.metric?.value ?? null) === value && (!s.reason || f.reason_code === s.reason)); }
  }
  const checkpoint = await json(join(output, 'consumer/checkpoint.json'), 1048576), owner = await json(join(output, 'consumer/owner.json'), 200);
  check(encode((await readdir(join(output, 'consumer'))).sort()) === encode(['checkpoint.json','owner.json']));
  check(checkpoint.owner === owner.owner && checkpoint.version === 1 && checkpoint.next_offset === 18 && encode(checkpoint.state) === encode(state));
  check(typeof owner.owner === 'string' && /^[a-f0-9-]{36}$/.test(owner.owner) && encode(owner) === encode({version:1,owner:owner.owner}));
  const planHash = hash(encode(plan)), stateHash = hash(encode(state));
  check(checkpoint.plan_hash === planHash && checkpoint.state_hash === stateHash);
  check(encode(checkpoint) === encode({version:1,owner:owner.owner,plan_hash:planHash,state_hash:stateHash,next_offset:18,state}));
  const prefixHash = hash(encode(prefixState));
  check(encode(receipt.prefix) === encode({version:1,production_ready:false,next_offset:9,snapshots:0,state_hash:prefixHash,plan_hash:planHash,
    checkpoint_hash:hash(encode({version:1,owner:owner.owner,plan_hash:planHash,state_hash:prefixHash,next_offset:9,state:prefixState}))}));
  check(receipt.committed.next_offset === 18 && receipt.committed.snapshots === 6 && receipt.committed.state_hash === stateHash && receipt.committed.plan_hash === planHash && receipt.committed.checkpoint_hash === hash(await read(join(output,'consumer/checkpoint.json'),1048576,true)));
  const { openFeatureStreamConsumer } = await import('../dist/feature-stream-consumer.js');
  const restored = openFeatureStreamConsumer(join(output,'consumer'), plan);
  try { check(encode(restored.receipt()) === encode(receipt.committed)); }
  finally { restored.close(); }
  check(receipt.version === 1 && receipt.production_ready === false && receipt.java_version === '21.0.10' && receipt.kafka_version === '4.1.2' && receipt.partition === 0 && receipt.end_offset === 18 && receipt.deliveries === 18 && receipt.captures === 54 && receipt.capture_bytes === Buffer.byteLength(initial)*3 && receipt.capture_bytes <= 2097152 && receipt.input_hash === hash(raw) && receipt.capture_hash === hash(initial) && receipt.snapshots_hash === hash(encode(snapshots)) && receipt.owned_processes === 0);
  check(Number.isFinite(receipt.elapsed_ms) && receipt.elapsed_ms > 0 && receipt.elapsed_ms <= 180000 && Number.isSafeInteger(receipt.peak_storage_bytes) && receipt.peak_storage_bytes > 0 && receipt.peak_storage_bytes <= 2*1024**3);
  return { deliveries: 18, snapshots: 6, captures: 54, pipeline_hash: hash(encode(receipt)), checkpoint_hash: receipt.committed.checkpoint_hash, snapshots_hash: receipt.snapshots_hash };
}
async function publish(directory, value) {
  const stage = join(directory, `.acceptance-${randomUUID()}`), final = join(directory,'acceptance.json');
  const fd = await open(stage, C.O_WRONLY | C.O_CREAT | C.O_EXCL | C.O_NOFOLLOW, 0o600);
  try {
    try { await fd.writeFile(encode(value)); await fd.sync(); } finally { await fd.close(); }
    // Atomic exclusive publication: rename would overwrite evidence.
    await link(stage, final);
  } finally {
    // This invocation exclusively created the stage; never remove final evidence.
    await unlink(stage);
  }
  await syncDir(directory);
}
export async function runFeatureStreamAcceptance(options) {
  const started = Date.now(); let watchdog, escalation, expired = false;
  const interrupt = () => { expired = true; for (const h of ownedFeatureProcessHandles()) h.kill('SIGTERM'); };
  try {
    check(arguments.length === 1 && options && Object.keys(options).length === 1);
    const { output } = parseArguments(['--output', options.output]);
    for (let p = dirname(output);; p = dirname(p)) { const s = await lstat(p); check(s.isDirectory() && !s.isSymbolicLink() && !(s.mode & 0o022)); if (p === dirname(p)) break; }
    try { await lstat(output); throw fail(); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    check(ownedFeatureProcessHandles().length === 0 && ownedProcessHandles().length === 0);
    // Reserve thirty seconds of the complete trial for owned teardown.
    process.on('SIGINT',interrupt); process.on('SIGTERM',interrupt);
    watchdog = setTimeout(interrupt,150000);
    watchdog.unref();
    escalation = setTimeout(() => { expired = true; for (const h of ownedFeatureProcessHandles()) h.kill('SIGKILL'); },170000); escalation.unref();
    const before = await provenance(); await verifyRuntime();
    check(!expired && Date.now()-started < 150000);
    await mkdir(output, { mode: 0o700 });
    const receipt = await runFeatureStreamSpike({ output: join(output,'pipeline') });
    const proof = await verifyEvidence(join(output,'pipeline'), receipt);
    await verifyRuntime(); const after = await provenance(); check(encode(before) === encode(after));
    check(!expired && ownedFeatureProcessHandles().length === 0 && ownedProcessHandles().length === 0 && Date.now()-started <= 180000);
    const acceptance = { version: 1, production_ready: false, proof, owned_processes: 0, source_hashes: before, elapsed_ms: Date.now()-started,
      remaining_gates: ['original_phase_master_leaves','production_adoption','source_configuration_and_masking_boundary','stable_real_identity','operations_capacity_HA_crash_recovery_event_time_TTL'] };
    await publish(output, acceptance); return acceptance;
  } catch { throw fail(); } finally { clearTimeout(watchdog); clearTimeout(escalation); process.off('SIGINT',interrupt); process.off('SIGTERM',interrupt); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await runFeatureStreamAcceptance(parseArguments(process.argv.slice(2))); process.stdout.write('FEATURE_ACCEPTANCE_RECORDED\n'); }
  catch { process.stderr.write('FEATURE_ACCEPTANCE_FAILED\n'); process.exitCode = 1; }
}
