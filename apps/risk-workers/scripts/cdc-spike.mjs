/** Explicit host-only invented CDC experiment. Import performs no native work.
 * runSpike({output?}) returns a count/hash/version-only receipt after cleanup.
 * No acceptance.json is produced here; independent host acceptance is mandatory. */
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { lstat, mkdir, mkdtemp, chmod, writeFile, readdir, rm, statfs } from 'node:fs/promises';
import { join, resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRuntime, verifyRuntime, ownedProcessHandles, childEnvironment } from './cdc-runtime.mjs';
import { LIMITS, FIXTURE, fault, parseObservation, createOracle, digest } from './cdc-oracle.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const localRoot = join(ROOT, '.local');
const privateWrite = (path, value) => writeFile(path, value, { mode: 0o600, flag: 'wx' });
const commandChildren = new Set();
/** Live exact children, including native setup and finite readers. Never PID files. */
export function ownedSpikeProcesses() { return Object.freeze([...commandChildren]); }
export function parseArgs(args) {
  if (!Array.isArray(args) || !(args.length === 1 && args[0] === 'run' || args.length === 3 && args[0] === 'run' && args[1] === '--output')) throw fault('CLI_INPUT');
  return validateOptions(args.length === 3 ? { output: args[2] } : {});
}
export function validateOptions(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(k => k !== 'output')) throw fault('CLI_INPUT');
  if (options.output !== undefined) {
    if (typeof options.output !== 'string' || options.output.length > 1024 || /[\\\x00-\x1f]/.test(options.output) || options.output.split('/').some(p => p === '..' || p === '.')) throw fault('OUTPUT_PATH');
    const path = resolve(options.output), rel = relative(localRoot, path);
    if (!rel || rel.startsWith('..') || rel.startsWith('/') || !rel.split('/').every(p => /^[A-Za-z0-9_-]{1,80}$/.test(p))) throw fault('OUTPUT_PATH');
    return { output: path };
  }
  return {};
}
async function directory(path, create = false) {
  if (create) try { await mkdir(path, { mode: 0o700 }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
  const s = await lstat(path);
  if (!s.isDirectory() || s.isSymbolicLink() || s.uid !== process.getuid() || s.mode & 0o022) throw fault('OWNERSHIP');
}
async function outputDirectory(options) {
  // Check every ancestor before creating anything below it; never traverse links.
  let ancestor = '/';
  for (const part of ROOT.split('/').filter(Boolean)) {
    ancestor = join(ancestor, part); const s = await lstat(ancestor);
    if (!s.isDirectory() || s.isSymbolicLink() || s.mode & 0o022) throw fault('OWNERSHIP');
  }
  await directory(localRoot, true);
  if (!options.output) {
    const parent = join(localRoot, 'cdc-spike'); await directory(parent, true);
    const path = await mkdtemp(join(parent, 'trial-')); await chmod(path, 0o700); return path;
  }
  let parent = localRoot;
  const parts = relative(localRoot, options.output).split('/');
  for (const part of parts.slice(0, -1)) { parent = join(parent, part); await directory(parent, true); }
  await mkdir(options.output, { mode: 0o700 }); // EEXIST is fatal; old evidence is immutable.
  return options.output;
}
export async function footprint(base, filesystem = { lstat, chmod, readdir }) {
  let bytes = 0;
  async function walk(path) {
    try {
    const s = await filesystem.lstat(path);
    if (s.isSymbolicLink() || s.uid !== process.getuid() || !s.isDirectory() && !s.isFile() && !(s.isSocket() && path === join(base, 'fixture/server.sock'))) throw fault('OWNERSHIP');
    if (!s.isSocket()) await filesystem.chmod(path, s.isDirectory() ? 0o700 : 0o600);
    bytes += s.isFile() ? Math.max(s.size, s.blocks * 512) : 0;
    if (bytes > LIMITS.storage) throw fault('STORAGE_LIMIT');
    if (s.isDirectory()) for (const name of await filesystem.readdir(path)) await walk(join(path, name));
    } catch (error) {
      // Native engines remove/rename descendants while running. The owned root
      // must remain present, and every other filesystem error stays fatal.
      if (path === base || error.code !== 'ENOENT') throw error;
    }
  }
  await walk(base); return bytes;
}
/** ConsoleConsumer's fixed formatter (partition, offset, key, value). No raw
 * payload is ever put in public errors/receipts. Reject, never truncate. */
export function decodeCapture(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > LIMITS.bytes) throw fault('CAPTURE_LIMIT');
  if (!text.endsWith('\n')) throw fault('CAPTURE_FORMAT');
  const lines = text.slice(0, -1).split('\n');
  if (lines.length > LIMITS.records) throw fault('CAPTURE_LIMIT');
  return lines.map(line => {
    if (Buffer.byteLength(line) > LIMITS.recordBytes) throw fault('RECORD_LIMIT');
    const m = /^Partition:0\tOffset:(0|[1-9][0-9]*)\t([^\t]+)\t([^\t]+)$/.exec(line);
    if (!m) throw fault('CAPTURE_FORMAT');
    let record;
    try { record = { topic: FIXTURE.topic, partition: 0, offset: Number(m[1]), key: JSON.parse(m[2]), value: JSON.parse(m[3]) }; }
    catch { throw fault('CAPTURE_FORMAT'); }
    parseObservation(record); return record;
  });
}
// Host commands use fixed absolute binaries, finite deadlines, minimal env and
// private bounded pipes. Passwords are files/stdin, never argv or public errors.
function command(binary, args, cwd, java = false) {
  return new Promise((ok, no) => {
    const mask = process.umask(0o077);
    try {
      const child = execFile(binary, args, { cwd, timeout: 15000, killSignal: 'SIGKILL', maxBuffer: java ? LIMITS.bytes : 262144, env: java ? childEnvironment({}, 128) : { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' } }, (error, stdout) => error ? no(fault('FIXTURE_TOOL')) : ok(stdout));
      commandChildren.add(child); child.once('close', () => commandChildren.delete(child));
    } finally { process.umask(mask); }
  });
}
// Fixed source-file launcher uses only inventoried existing Kafka client jars.
// Unlike ConsoleConsumer, a quiet bounded topic end is a successful finite read.
// This observes one finite window, not concurrent snapshot/DDL correctness.
const READER = `
import java.time.Duration;
import java.util.*;
import java.nio.charset.StandardCharsets;
import org.apache.kafka.clients.consumer.*;
import org.apache.kafka.common.TopicPartition;
class Capture {
  public static void main(String[] args) throws Exception {
    Properties p = new Properties();
    p.setProperty("bootstrap.servers", "127.0.0.1:" + args[0]);
    p.setProperty("key.deserializer", "org.apache.kafka.common.serialization.StringDeserializer");
    p.setProperty("value.deserializer", "org.apache.kafka.common.serialization.StringDeserializer");
    p.setProperty("enable.auto.commit", "false");
    p.setProperty("allow.auto.create.topics", "false");
    p.setProperty("default.api.timeout.ms", "3000");
    p.setProperty("request.timeout.ms", "2000");
    p.setProperty("max.poll.records", "64");
    p.setProperty("max.partition.fetch.bytes", "65536");
    p.setProperty("fetch.max.bytes", "65536");
    TopicPartition tp = new TopicPartition("lmps_cdc.lmps_cdc_invented.specimens", 0);
    int count = 0, bytes = 0, expected = Integer.parseInt(args[1]);
    long deadline = System.nanoTime() + 10000000000L, quiet = System.nanoTime();
    try (KafkaConsumer<String,String> c = new KafkaConsumer<>(p)) {
      c.assign(List.of(tp)); c.seek(tp, 0);
      while (System.nanoTime() < deadline) {
        var records = c.poll(Duration.ofMillis(200));
        for (var r : records) {
          if (++count > 2000 || r.partition() != 0 || r.key() == null) throw new Exception();
          String line = "Partition:0\\tOffset:" + r.offset() + "\\t" + r.key() + "\\t" + (r.value() == null ? "null" : r.value()) + "\\n";
          int size = line.getBytes(StandardCharsets.UTF_8).length;
          bytes += size; if (size > 32768 || bytes > 2097152) throw new Exception();
          System.out.print(line); quiet = System.nanoTime();
        }
        if (count >= expected && System.nanoTime() - quiet >= 500000000L && c.position(tp) == c.endOffsets(List.of(tp)).get(tp)) return;
      }
      throw new Exception();
    }
  }
}
`;
async function nativeReader(runtime, verified) {
  const file = join(runtime.base, 'Capture.java'); await privateWrite(file, READER);
  return async phase => {
    await verifyRuntime();
    return command(verified.java, ['-Xms16m', '-Xmx128m', '-XX:+ExitOnOutOfMemoryError', '--class-path', join(verified.kafka, 'libs', '*'), file, String(runtime.brokerPort), String({ snapshot: 2, stream: 6, restart: 8 }[phase])], runtime.base, true);
  };
}
async function nativeFixture(base, runtime, kafkaBase, guard) {
  // Import existing ownership/TLS helpers only during explicit execution.
  const helpers = await import('../../../packages/source-preflight/scripts/local.mjs');
  helpers.localMode();
  if (process.env.LMPS_MARIADB_BASE !== undefined) throw fault('RUNTIME_OVERRIDE');
  const state = { format: 1, kind: 'local_synthetic', base, port: await helpers.availablePort(), runtime: helpers.nativeDirectory(), adminPassword: randomBytes(24).toString('hex') };
  await guard();
  if (!/11\.8\.9-MariaDB/.test(await command(state.runtime.binary, ['--no-defaults', '--version'], dirname(base)))) throw fault('FIXTURE_VERSION');
  await guard();
  const password = randomBytes(24).toString('hex'), trustPassword = randomBytes(24).toString('hex');
  let started = false, initializing = false, installerUnproven = false;
  const query = async statements => {
    await guard();
    const c = await helpers.admin(state, initializing);
    try { for (const sql of statements) { await guard(); await c.query(sql); await guard(); } } finally { await c.end(); }
  };
  const tool = async (binary, args) => { await guard(); await command(binary, args, base); await guard(); };
  const startOwned = async bootstrap => {
    const mask = process.umask(0o077);
    try { await helpers.startServer(state, bootstrap); } finally { process.umask(mask); }
  };
  return {
    async initialize() {
      await mkdir(base, { mode: 0o700 });
      await privateWrite(join(base, 'state.json'), JSON.stringify(state));
      // Installer owns a bootstrap subprocess internally. If interrupted, never
      // infer descendant shutdown from just the script's exit or remove state.
      installerUnproven = true;
      await tool(state.runtime.installer, ['--no-defaults', '--basedir=' + state.runtime.base, '--datadir=' + join(base, 'data'), '--auth-root-authentication-method=normal', '--skip-test-db']);
      installerUnproven = false;
      await tool('/usr/bin/openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-keyout', 'ca.key', '-out', 'ca.crt', '-subj', '/CN=Invented CDC CA']);
      await tool('/usr/bin/openssl', ['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'server.key', '-out', 'server.csr', '-subj', '/CN=localhost']);
      await privateWrite(join(base, 'extensions.cnf'), 'subjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\nbasicConstraints=critical,CA:FALSE\n');
      await tool('/usr/bin/openssl', ['x509', '-req', '-in', 'server.csr', '-CA', 'ca.crt', '-CAkey', 'ca.key', '-CAcreateserial', '-days', '1', '-out', 'server.crt', '-extfile', 'extensions.cnf']);
      initializing = true; started = true;
      await startOwned(true);
      await guard();
      await query([`ALTER USER 'root'@'localhost' IDENTIFIED BY '${state.adminPassword}'`]); initializing = false;
      await query([
        'CREATE DATABASE lmps_cdc_invented',
        'CREATE TABLE lmps_cdc_invented.specimens (id INT PRIMARY KEY, revision INT NOT NULL, amount DECIMAL(24,4) NOT NULL, currency CHAR(3) NOT NULL) ENGINE=InnoDB',
        "INSERT INTO lmps_cdc_invented.specimens VALUES (1,1,9007199254740993.1200,'XTS'),(2,1,0.0100,'XTS')",
        `CREATE USER 'cdc_fixture'@'127.0.0.1' IDENTIFIED BY '${password}' REQUIRE SSL`,
        "GRANT SELECT, LOCK TABLES ON lmps_cdc_invented.* TO 'cdc_fixture'@'127.0.0.1'",
        "GRANT REPLICATION SLAVE, REPLICATION CLIENT, RELOAD ON *.* TO 'cdc_fixture'@'127.0.0.1'"
      ]);
      await helpers.stopServer(state); started = false;
      await guard();
      started = true; await startOwned(false);
      await guard();
      const passFile = join(base, 'trust-password'); await privateWrite(passFile, trustPassword);
      await tool(join(dirname(runtime.java), 'keytool'), ['-importcert', '-noprompt', '-alias', 'fixture', '-file', join(base, 'ca.crt'), '-keystore', join(kafkaBase, 'source.truststore'), '-storetype', 'PKCS12', '-storepass:file', passFile]);
    },
    settings() {
      return { name: 'lmps_cdc_fixture', 'connector.class': 'io.debezium.connector.mariadb.MariaDbConnector', 'database.hostname': '127.0.0.1', 'database.port': state.port, 'database.user': 'cdc_fixture', 'database.password': password, 'database.server.id': 1902, 'database.include.list': FIXTURE.database, 'table.include.list': FIXTURE.database + '.' + FIXTURE.table, 'column.include.list': ['id', 'revision', 'amount', 'currency'].map(c => FIXTURE.database + '.' + FIXTURE.table + '.' + c).join(','), 'topic.prefix': 'lmps_cdc', 'snapshot.mode': 'initial', 'decimal.handling.mode': 'string', 'tombstones.on.delete': 'true', 'database.ssl.mode': 'verify-full', 'database.ssl.truststore': join(kafkaBase, 'source.truststore'), 'database.ssl.truststore.password': trustPassword, 'max.batch.size': 64, 'max.queue.size': 256, 'poll.interval.ms': 100, 'include.schema.changes': 'false' };
    },
    stream: () => query(["INSERT INTO lmps_cdc_invented.specimens VALUES (3,1,12.3400,'XTS')", 'UPDATE lmps_cdc_invented.specimens SET revision=2, amount=9007199254740993.1201 WHERE id=1', 'DELETE FROM lmps_cdc_invented.specimens WHERE id=2']),
    paused: () => query(['UPDATE lmps_cdc_invented.specimens SET revision=2, amount=12.3401 WHERE id=3', "INSERT INTO lmps_cdc_invented.specimens VALUES (4,1,1.0000,'XTS')"]),
    async stop() { if (started) { await helpers.stopServer(state); started = false; } if (installerUnproven) throw fault('CLEANUP_UNPROVEN'); }
  };
}
/** Trusted dependency seam is only for lifecycle unit tests, never CLI input. */
export async function runSpike(options = {}, dependencies = {}) {
  const opts = validateOptions(options);
  const io = { output: outputDirectory, statfs, verify: verifyRuntime, runtime: createRuntime, fixture: nativeFixture, reader: nativeReader, footprint, handles: () => [...ownedProcessHandles(), ...ownedSpikeProcesses()], write: privateWrite, now: Date.now, mkdtemp, chmod, rm, ...dependencies };
  let output, runtime, read, fixtureBase, fixture, monitor, monitoring, resourceFailure, receipt, failureCode, clean = false, capturedBytes = 0, capturedRecords = 0;
  const began = io.now();
  async function guard() {
    if (resourceFailure) throw resourceFailure;
    // Reserve 50 seconds for verified teardown within the 180 second trial.
    if (io.now() - began >= LIMITS.trialMs - 50000) throw fault('TRIAL_LIMIT');
    const storage = (runtime ? await io.footprint(runtime.base) : 0) + (fixtureBase ? await io.footprint(fixtureBase) : 0);
    if (storage > LIMITS.storage) throw fault('STORAGE_LIMIT');
  }
  async function step(fn) { await guard(); const result = await fn(); await guard(); return result; }
  async function capture(phase) {
    const text = await step(() => read(phase));
    const records = decodeCapture(text), oracle = createOracle();
    capturedBytes += Buffer.byteLength(text); capturedRecords += records.length;
    if (capturedBytes > LIMITS.bytes || capturedRecords > LIMITS.records) throw fault('CAPTURE_LIMIT');
    // Reaching the consumer cap cannot prove that nothing was truncated.
    if (records.length === LIMITS.records) throw fault('CAPTURE_LIMIT');
    for (const record of records) oracle.accept(record);
    const proof = oracle.verify(phase);
    return { records, proof };
  }
  try {
    for (const path of [ROOT, '/private/tmp']) {
      const disk = await io.statfs(path); if (Number(disk.bavail) * Number(disk.bsize) < LIMITS.free) throw fault('FREE_SPACE');
    }
    output = await io.output(opts);
    const verified = await step(() => io.verify());
    runtime = await step(() => io.runtime());
    read = await step(() => io.reader(runtime, verified));
    fixtureBase = await step(() => io.mkdtemp('/private/tmp/lmps-cdc-'));
    await io.chmod(fixtureBase, 0o700);
    fixture = await step(() => io.fixture(join(fixtureBase, 'fixture'), verified, runtime.base, guard));
    monitor = setInterval(() => {
      if (monitoring) return;
      monitoring = guard().catch(() => { resourceFailure = fault('RESOURCE_LIMIT'); }).finally(() => { monitoring = null; });
    }, 200); monitor.unref();
    await step(() => fixture.initialize());
    await step(() => runtime.startKafka());
    for (const topic of [FIXTURE.topic, runtime.schemaHistoryTopic]) await step(() => runtime.cli('createTopic', { topic }));
    const settings = fixture.settings(); await step(() => runtime.startConnect(settings));
    const snapshot = await capture('snapshot');
    await step(() => fixture.stream()); const stream = await capture('stream');
    await step(() => runtime.stopConnect()); await step(() => runtime.stopKafka());
    await step(() => fixture.paused());
    await step(() => runtime.startKafka()); await step(() => runtime.startConnect(settings));
    const restart = await capture('restart');
    if (digest(restart.records.slice(0, stream.records.length)) !== digest(stream.records) || digest(stream.records.slice(0, snapshot.records.length)) !== digest(snapshot.records)) throw fault('CONTINUITY');
    const replay = await capture('restart'), oracle = createOracle();
    if (digest(replay.records) !== digest(restart.records)) throw fault('REPLAY_MISMATCH');
    for (let i = 0; i < 2; i++) for (const record of replay.records) oracle.accept(record);
    const replayProof = oracle.verify('restart');
    receipt = { format: 1, versions: { kafka: '4.1.2', debezium: '3.7.0.Final', java: '21.0.10', mariadb: '11.8.9' }, snapshot: snapshot.proof, stream: stream.proof, restart: restart.proof, replay: replayProof, captureSha256: digest(replay.records) };
  } catch (e) { failureCode = ['FREE_SPACE', 'TRIAL_LIMIT', 'CAPTURE_LIMIT', 'RESOURCE_LIMIT', 'STORAGE_LIMIT'].includes(e.code) ? e.code : 'EXPERIMENT_FAILED'; }
  finally {
    clearInterval(monitor); if (monitoring) await monitoring;
    let failed = false;
    try { if (runtime) await runtime.stop(); } catch { failed = true; }
    try { if (fixture) await fixture.stop(); } catch { failed = true; }
    if (io.handles().length) failed = true;
    clean = !failed;
    if (!clean) failureCode = 'CLEANUP_UNPROVEN';
    if (io.now() - began > LIMITS.trialMs) failureCode = 'TRIAL_LIMIT';
    if (!failureCode && runtime) {
      try { await runtime.dispose(); if (fixtureBase) { await io.footprint(fixtureBase); await io.rm(fixtureBase, { recursive: true }); } } catch { failureCode = 'CLEANUP_UNPROVEN'; clean = false; }
    }
    if (failureCode && output) await io.write(join(output, 'failure.json'), JSON.stringify({ format: 1, code: failureCode, cleanupVerified: clean }));
  }
  if (failureCode) throw fault(failureCode);
  await io.write(join(output, 'receipt.json'), JSON.stringify(receipt));
  return Object.freeze({ output, receipt, cleanupVerified: clean });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  Promise.resolve().then(() => runSpike(parseArgs(process.argv.slice(2)))).then(result => console.info(JSON.stringify(result.receipt))).catch(() => { console.error('CDC_SPIKE_FAILED'); process.exitCode = 1; });
}
