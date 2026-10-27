/** Import-safe, host-only synthetic trial. Second arguments are trusted test
 * seams, never CLI/environment configuration. This emits no final acceptance.
 * Local cooperating ownership only; no crash-owner recovery or HA/TTL claim.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, writeFile, mkdtemp, chmod, statfs, readdir } from 'node:fs/promises';
import { resolve, join, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRuntime, verifyRuntime, ownedProcessHandles, childEnvironment, auditState } from './cdc-runtime.mjs';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const MAX = 2097152;
const fail = () => Object.assign(new Error('FEATURE_SPIKE_FAILED'), { code: 'FEATURE_SPIKE_FAILED' });
const check = v => { if (!v) throw fail(); };
const encode = value => JSON.stringify(value, (_k, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : v);
const hash = v => createHash('sha256').update(v).digest('hex').match(/.{8}/g).join(' ');
const helpers = new Set();
let active = false;
export function ownedFeatureProcessHandles() { return Object.freeze([...ownedProcessHandles(), ...[...helpers].map(h => h.child)]); }
export function parseArguments(args) {
  check(Array.isArray(args) && args.length === 2 && args[0] === '--output');
  const output = args[1];
  check(typeof output === 'string' && isAbsolute(output) && resolve(output) === output && !/[\\\x00-\x20\x7f]/.test(output));
  const rel = relative(join(ROOT, '.local'), output);
  check(rel && !rel.startsWith('..') && !isAbsolute(rel) && rel.split('/').every(s => /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(s)));
  return { output };
}
async function destination(output) {
  parseArguments(['--output', output]);
  for (let p = dirname(output); ; p = dirname(p)) {
    const s = await lstat(p); check(s.isDirectory() && !s.isSymbolicLink() && !(s.mode & 0o022));
    if (p === dirname(p)) break;
  }
  try { await lstat(output); throw fail(); } catch (e) { if (e.code !== 'ENOENT') throw e; }
}
// Fixed Java source-file program: no shell, package installation or generated code.
export const JAVA_SOURCE = `import java.util.*;
import java.nio.file.*;
import java.time.Duration;
import org.apache.kafka.clients.producer.*;
import org.apache.kafka.clients.consumer.*;
import org.apache.kafka.common.TopicPartition;
class FeatureWire {
 public static void main(String[] a) { try { run(a); } catch(Throwable e) { System.err.println("FEATURE_WIRE_FAILED"); System.exit(1); } }
 static void run(String[] a) throws Exception {
  Properties p=new Properties(); p.put("bootstrap.servers",a[1]); p.put("request.timeout.ms","5000"); p.put("default.api.timeout.ms","10000");
  String topic=a[2];
  if(a[0].equals("send")) {
   p.put("key.serializer","org.apache.kafka.common.serialization.StringSerializer"); p.put("value.serializer","org.apache.kafka.common.serialization.StringSerializer");
   p.put("max.block.ms","10000"); p.put("delivery.timeout.ms","10000"); p.put("retries","0"); p.put("enable.idempotence","false"); p.put("acks","all");
   try(KafkaProducer<String,String> producer=new KafkaProducer<>(p)) {
    var lines=Files.readAllLines(Path.of(a[3])); if(lines.size()>32) throw new Exception();
    for(String line:lines) { String v=new String(Base64.getDecoder().decode(line),java.nio.charset.StandardCharsets.UTF_8);
     var m=producer.send(new ProducerRecord<String,String>(topic,0,null,v)).get(); System.out.println("S\\t"+m.partition()+"\\t"+m.offset()); }
   } return;
  }
  if(!a[0].equals("read")) throw new Exception();
  p.put("key.deserializer","org.apache.kafka.common.serialization.StringDeserializer"); p.put("value.deserializer","org.apache.kafka.common.serialization.StringDeserializer");
  p.put("enable.auto.commit","false"); p.put("auto.offset.reset","none"); p.put("max.poll.records","2000");
  TopicPartition tp=new TopicPartition(topic,0); int count=0,bytes=0; long quiet=0,deadline=System.nanoTime()+Duration.ofSeconds(12).toNanos();
  try(KafkaConsumer<String,String> c=new KafkaConsumer<>(p)) {
   c.assign(List.of(tp)); c.seek(tp,0);
   while(System.nanoTime()<deadline) {
    var records=c.poll(Duration.ofMillis(100));
    for(var r:records) {
     if(r.value()==null||r.key()!=null||++count>2000) throw new Exception();
     String b=Base64.getEncoder().encodeToString(r.value().getBytes(java.nio.charset.StandardCharsets.UTF_8)); bytes+=b.length(); if(bytes>2097152) throw new Exception();
     System.out.println("R\\t"+r.partition()+"\\t"+r.offset()+"\\t"+b);
    }
    long end=c.endOffsets(List.of(tp)).get(tp);
    if(c.position(tp)==end && records.isEmpty()) { if(quiet==0) quiet=System.nanoTime();
     if(System.nanoTime()-quiet>=Duration.ofSeconds(1).toNanos()) { System.out.println("E\\t"+end+"\\t"+c.position(tp)); return; }
    } else quiet=0;
   } throw new Exception();
  }
 }
}
`;
async function bounded(promise, ms) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(fail()), ms); })]); }
  finally { clearTimeout(timer); }
}
async function stopHelper(h) {
  if (h.closed) return;
  h.child.kill('SIGTERM');
  try { await bounded(h.done, 1500); }
  catch { h.child.kill('SIGKILL'); await bounded(h.done, 1500); }
}
/** Trusted child-process seam: no native execution in unit tests. */
export async function executeHelper(runtime, args, cwd, timeout = 18000, spawner = spawn, maxBytes = MAX) {
  check(Number.isInteger(timeout) && timeout > 0 && timeout <= 18000);
  check(Number.isInteger(maxBytes) && maxBytes > 0 && maxBytes <= MAX);
  let child; const mask = process.umask(0o077);
  try { child = spawner(runtime.java, ['-Xms32m', '-Xmx128m', '-XX:+ExitOnOutOfMemoryError', '--class-path', join(runtime.kafka, 'libs', '*'), ...args],
    { cwd, env: childEnvironment(runtime), shell: false, stdio: ['ignore', 'pipe', 'pipe'] }); } catch { throw fail(); } finally { process.umask(mask); }
  const h = { child, closed: false, bad: false, bytes: 0, text: '' }; helpers.add(h);
  h.done = new Promise(r => { child.once('error', () => { h.bad = true; }); child.once('close', code => { h.closed = true; h.code = code; helpers.delete(h); r(); }); });
  for (const stream of [child.stdout, child.stderr]) stream?.on('data', b => {
    h.bytes += b.length;
    if (h.bytes > maxBytes) { h.bad = true; void stopHelper(h).catch(() => {}); }
    else if (stream === child.stdout) h.text += b.toString('utf8');
  });
  try { await bounded(h.done, timeout); check(!h.bad && h.code === 0); return h.text; }
  catch { throw fail(); } finally { await stopHelper(h); }
}
export function validateCapture(text, values) {
  check(typeof text === 'string' && Buffer.byteLength(text) <= MAX && values.length <= 32);
  check(text.endsWith('\n'));
  const lines = text.slice(0, -1).split('\n'); check(lines.length <= 2001);
  const end = /^E\t(0|[1-9][0-9]*)\t(0|[1-9][0-9]*)$/.exec(lines.pop());
  check(end && Number(end[1]) === values.length && end[1] === end[2] && lines.length === values.length);
  return lines.map((line, i) => {
    const m = /^R\t0\t(0|[1-9][0-9]*)\t([A-Za-z0-9+/]*={0,2})$/.exec(line); check(m && Number(m[1]) === i);
    const b = Buffer.from(m[2], 'base64'); check(b.toString('base64') === m[2] && b.toString('utf8') === values[i]);
    try { return JSON.parse(b.toString('utf8')); } catch { throw fail(); }
  });
}
async function loadInput() {
  const raw = await readFile(new URL('../../../packages/risk/test/fixtures/feature-streams/golden.json', import.meta.url)); check(raw.length <= 32768);
  const c = JSON.parse(raw); check(c.events.length > 0 && c.events.length <= 32 && c.snapshots.length <= 8);
  const plan = { version: 'synthetic-feature-stream-1', identity: 'synthetic_declared', run_id: 'synthetic_run', input_identity: 'synthetic_golden_v1',
    namespace: 'synthetic_golden', topic: 'synthetic_golden.synthetic_run', window_seconds: 3600, coverage_start: c.coverage_start,
    queries: c.snapshots.map(({ expected, ...q }) => q), limits: { records: 32, revisions: 32, snapshots: 8, capture_bytes: 32768, state_bytes: 1048576 } };
  const values = c.events.map((event, offset) => encode({ identity: 'synthetic_declared', topic: plan.topic, partition: 0, offset, event }));
  check(Buffer.byteLength(encode(values)) <= 32768); return { c, plan, values, input_hash: hash(raw) };
}
async function compare(snapshots, c, plan) {
  const { evaluateTransactionRisk } = await import('../../../packages/risk/dist/index.js');
  const { riskFixture } = await import('../../../packages/risk/fixtures/request.mjs');
  const fixed = [['11', '14.11', null], ['11', '13.14', null], [null, null, 'INPUT_MISSING'], [null, null, 'HISTORY_INCOMPLETE'], ['11', '13.14', null], ['1', '7.00', null]];
  check(snapshots.length === fixed.length);
  for (const [i, s] of snapshots.entries()) {
    check(encode([s.count, s.amount, s.reason]) === encode(fixed[i]));
    for (const k of ['count', 'amount', 'reason', 'window_start', 'window_end']) check(s[k] === c.snapshots[i].expected[k]);
    const q = plan.queries[i], target = c.events.find(e => e.transaction_id === q.target), { request, observation } = riskFixture();
    request.target = { namespace: target.namespace, transaction_id: target.transaction_id, revision_number: target.revision_number }; request.policy.currency = q.currency;
    Object.assign(request.context, { binding: { ...request.target, revision_sha256: observation.revision_sha256 }, as_of: q.as_of, coverage_start: plan.coverage_start,
      coverage_complete: q.coverage_complete, events: structuredClone(c.events), flagged_accounts: q.flags_available ? [] : null, flagged_accounts_version: q.flags_available ? 'synthetic_empty_v1' : null });
    Object.assign(observation, { amount: target.amount, reversed_amount: target.reversed_amount, currency: target.currency, transaction_status: target.status, observed_at: q.as_of });
    if (q.evidence === 'missing') for (const k of Object.keys(observation)) observation[k] = k === 'status' ? 'missing' : null;
    const reference = evaluateTransactionRisk(request, observation);
    for (const [code, value] of [['FRAUD_COUNT_VELOCITY', s.count], ['FRAUD_AMOUNT_VELOCITY', s.amount]]) {
      const f = reference.findings.find(f => f.code === code); check(f && (f.metric?.value ?? null) === value); if (s.reason) check(f.reason_code === s.reason);
    }
  }
}
const defaults = { destination, loadInput, verify: verifyRuntime, create: createRuntime, execute: executeHelper, compare,
  scratch: async () => { const p = await mkdtemp('/private/tmp/lmps-feature-'); await chmod(p, 0o700); return p; },
  free: async () => { for (const p of [ROOT, '/private/tmp']) { const s = await statfs(p); check(Number(s.bavail) * Number(s.bsize) >= 6 * 1024 ** 3); } }, audit: auditState,
  open: async (p, plan) => (await import('../dist/feature-stream-consumer.js')).openFeatureStreamConsumer(p, plan),
  mkdir, writeFile, handles: ownedFeatureProcessHandles };
async function storageBytes(path) {
  const s = await lstat(path);
  check(!s.isSymbolicLink() && s.uid === process.getuid() && (s.isDirectory() || s.isFile()));
  if (s.isFile()) { check(s.nlink === 1); return s.size; }
  let bytes = 0;
  for (const name of await readdir(path)) { bytes += await storageBytes(join(path, name)); check(bytes <= 2 * 1024 ** 3); }
  return bytes;
}

export async function runFeatureStreamSpike(options, trusted = {}) {
  let runtime, worker, output, created = false, claimed = false, monitor, watchdog, resourceFailure = false, scratch, stopped = false, auditPending = Promise.resolve();
  const io = { ...defaults, ...trusted }, started = Date.now(), deadline = started + 150000;
  const budget = () => { check(Date.now() < deadline && !resourceFailure); };
  const interrupt = () => { resourceFailure = true; for (const child of io.handles()) child.kill('SIGTERM'); };
  let peakStorageBytes = 0;
  const resources = async () => {
    let bytes = 0;
    for (const p of [runtime?.base, created ? output : null, scratch].filter(Boolean)) {
      await io.audit(p); bytes += await storageBytes(p);
    }
    check(bytes <= 2 * 1024 ** 3); peakStorageBytes = Math.max(peakStorageBytes, bytes);
  };
  try {
    check(options && Object.keys(options).length === 1); ({ output } = parseArguments(['--output', options.output]));
    check(!active && io.handles().length === 0); active = true; claimed = true;
    await io.destination(output); const input = await io.loadInput(); await io.free(); budget();
    await io.mkdir(output, { mode: 0o700 }); created = true;
    process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt);
    // Abort only live handles owned by this module, never persisted PIDs or
    // process names. Thirty seconds remain for close-confirmed teardown.
    watchdog = setTimeout(interrupt, Math.max(1, deadline - Date.now())); watchdog.unref();
    const verified = await io.verify(); budget(); runtime = await io.create(); budget(); scratch = await io.scratch();
    await io.writeFile(join(scratch, 'FeatureWire.java'), JAVA_SOURCE, { flag: 'wx', mode: 0o600 });
    await io.writeFile(join(scratch, 'values'), input.values.map(v => Buffer.from(v).toString('base64')).join('\n') + '\n', { flag: 'wx', mode: 0o600 });
    let auditing = false;
    monitor = setInterval(async () => {
      if (auditing) return; auditing = true;
      try { budget(); await (auditPending = resources()); }
      catch { resourceFailure = true; for (const h of helpers) void stopHelper(h).catch(() => {}); void runtime.stop().catch(() => {}); }
      finally { auditing = false; }
    }, 200); monitor.unref();
    let wireBytes = 0;
    const wire = async mode => { budget(); const result = await io.execute(verified,
      [join(scratch, 'FeatureWire.java'), mode, `127.0.0.1:${runtime.brokerPort}`, input.plan.topic, join(scratch, 'values')], scratch, Math.min(18000, deadline - Date.now()), undefined, MAX - wireBytes);
      wireBytes += Buffer.byteLength(result); check(wireBytes <= MAX); budget(); return result; };
    await runtime.startKafka(); budget(); await runtime.cli('createTopic', { topic: input.plan.topic });
    check(await wire('send') === input.values.map((_, i) => `S\t0\t${i}\n`).join(''));
    const firstText = await wire('read'), first = validateCapture(firstText, input.values);
    await io.writeFile(join(output, 'capture-initial.txt'), firstText, { flag: 'wx', mode: 0o600 });
    worker = await io.open(join(output, 'consumer'), input.plan); const split = Math.max(1, Math.floor(first.length / 2));
    for (const d of first.slice(0, split)) { budget(); worker.consume(d); }
    const prefix = worker.receipt(); worker.close(); worker = null;
    await runtime.stopKafka(); budget(); await runtime.startKafka(); budget();
    const replayText = await wire('read'), replay = validateCapture(replayText, input.values); check(firstText === replayText);
    await io.writeFile(join(output, 'capture-restart.txt'), replayText, { flag: 'wx', mode: 0o600 });
    worker = await io.open(join(output, 'consumer'), input.plan); check(encode(worker.receipt()) === encode(prefix));
    for (const d of replay.slice(0, split)) worker.consume(d);
    check(encode(worker.receipt()) === encode(prefix));
    for (const d of replay.slice(split)) { budget(); worker.consume(d); }
    const snapshots = input.plan.queries.map(q => worker.materialize(q.id)); await io.compare(snapshots, input.c, input.plan);
    const committed = worker.receipt(); check(committed.next_offset === input.values.length);
    // Freeze before this controlled broker restart; retained Kafka and consumer
    // state must both survive, including already materialized evidence.
    worker.close(); worker = null;
    await runtime.stopKafka(); budget(); await runtime.startKafka(); budget();
    worker = await io.open(join(output, 'consumer'), input.plan); check(encode(worker.receipt()) === encode(committed));
    const frozenText = await wire('read'), frozen = validateCapture(frozenText, input.values); check(frozenText === firstText);
    for (const d of frozen) { budget(); worker.consume(d); }
    check(encode(worker.receipt()) === encode(committed)); check(encode(input.plan.queries.map(q => worker.materialize(q.id))) === encode(snapshots));
    worker.close(); worker = null;
    await io.writeFile(join(output, 'snapshots.json'), encode(snapshots), { flag: 'wx', mode: 0o600 });
    clearInterval(monitor); await auditPending; await resources(); budget();
    await runtime.stop(); check(io.handles().length === 0); stopped = true; budget();
    const receipt = { version: 1, production_ready: false, java_version: '21.0.10', kafka_version: '4.1.2', deliveries: first.length,
      captures: first.length * 3, capture_bytes: Buffer.byteLength(firstText) * 3, input_hash: input.input_hash, capture_hash: hash(firstText),
      snapshots_hash: hash(encode(snapshots)), prefix, committed, partition: 0, end_offset: first.length, owned_processes: 0,
      peak_storage_bytes: peakStorageBytes, elapsed_ms: Date.now() - started };
    check(receipt.captures <= 2000 && receipt.capture_bytes <= MAX && receipt.elapsed_ms <= 180000);
    await io.writeFile(join(output, 'pipeline-receipt.json'), encode(receipt), { flag: 'wx', mode: 0o600 }); return receipt;
  } catch {
    if (created) try { await io.writeFile(join(output, 'failure.json'), encode({ version: 1, code: 'FEATURE_SPIKE_FAILED', production_ready: false }), { flag: 'wx', mode: 0o600 }); } catch { /* retain existing evidence */ }
    throw fail();
  } finally {
    if (claimed) {
      clearInterval(monitor); clearTimeout(watchdog); let bad = false;
      try { await auditPending; } catch { bad = true; }
      try { worker?.close(); } catch { bad = true; }
      for (const h of helpers) try { await stopHelper(h); } catch { bad = true; }
      try { if (!stopped) await runtime?.stop(); } catch { bad = true; }
      process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt);
      active = false;
      if (bad || io.handles().length) {
        if (created) try { await io.writeFile(join(output, 'cleanup-failure.json'), encode({ version: 1, code: 'FEATURE_SPIKE_FAILED', production_ready: false }), { flag: 'wx', mode: 0o600 }); } catch { /* retain ownership and evidence */ }
        throw fail();
      }
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(encode(await runFeatureStreamSpike(parseArguments(process.argv.slice(2)))) + '\n'); }
  catch { process.stderr.write('FEATURE_SPIKE_FAILED\n'); process.exitCode = 1; }
}
