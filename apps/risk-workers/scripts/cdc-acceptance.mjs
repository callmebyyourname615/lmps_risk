/** Explicit host gate. Import and invalid input never start native services. */
import { createHash } from 'node:crypto';
import { readFile, lstat, open, link, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSpike, validateOptions, ownedSpikeProcesses } from './cdc-spike.mjs';
import { verifyRuntime, ownedProcessHandles } from './cdc-runtime.mjs';
import { expectedPhase, digest, LIMITS, fault } from './cdc-oracle.mjs';

const PIN_HASH = '6fda3f20 ed7cf0bc 9a8fbb18 b240a436 03500102 7f3ead4e 95d42e60 0d7d0518'.replaceAll(' ', '');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const versions = { kafka: '4.1.2', debezium: '3.7.0.Final', java: '21.0.10', mariadb: '11.8.9' };
const requireProof = condition => { if (!condition) throw fault('ACCEPTANCE_PROOF'); };
export function parseArgs(args) {
  if (!Array.isArray(args) || args.length !== 2 || args[0] !== '--output' || !args[1]) throw fault('CLI_INPUT');
  return validateOptions({ output: args[1] });
}
/** Pure rejection boundary; a valid object alone is never native evidence. */
export function validateReceipt(receipt) {
  requireProof(receipt && receipt.format === 1 && JSON.stringify(receipt.versions) === JSON.stringify(versions));
  requireProof(Object.keys(receipt).sort().join(',') === 'captureSha256,format,replay,restart,snapshot,stream,versions');
  requireProof(typeof receipt.captureSha256 === 'string' && /^[a-f0-9]{64}$/.test(receipt.captureSha256));
  let bytes = 0, observations = 0;
  for (const phase of ['snapshot', 'stream', 'restart', 'replay']) {
    const p = receipt[phase], e = expectedPhase(phase === 'replay' ? 'restart' : phase);
    requireProof(p && Object.keys(p).sort().join(',') === 'bytes,observations,operationsSha256,records,stateSha256,tombstones');
    requireProof(p.records === e.count && p.observations === e.count * (phase === 'replay' ? 2 : 1) && p.tombstones === e.tombstones);
    requireProof(Number.isSafeInteger(p.bytes) && p.bytes > 0 && p.bytes <= LIMITS.bytes);
    requireProof(p.stateSha256 === digest(e.rows) && p.operationsSha256 === digest(e.operations.sort()));
    if (phase === 'replay') requireProof(p.bytes === receipt.restart.bytes * 2);
    bytes += phase === 'replay' ? p.bytes / 2 : p.bytes;
    observations += p.records;
  }
  requireProof(bytes <= LIMITS.bytes && observations <= LIMITS.records);
  return { capturedRecords: observations, oracleBytes: bytes };
}
async function privateFile(path) {
  const s = await lstat(path);
  requireProof(s.isFile() && !s.isSymbolicLink() && s.uid === process.getuid() && (s.mode & 0o077) === 0 && s.nlink === 1 && s.size <= 16384);
  return readFile(path);
}
async function provenance() {
  const hashes = {};
  for (const name of ['cdc-runtime-pins.json', 'cdc-runtime.mjs', 'cdc-oracle.mjs', 'cdc-spike.mjs', 'cdc-acceptance.mjs']) hashes[name] = sha(await readFile(new URL(name, import.meta.url)));
  requireProof(hashes['cdc-runtime-pins.json'] === PIN_HASH);
  return hashes;
}
/** Atomic exclusive publication; unit-testable without running native services. */
export async function publishAtomic(directory, receipt) {
  const s = await lstat(directory);
  requireProof(s.isDirectory() && !s.isSymbolicLink() && s.uid === process.getuid() && (s.mode & 0o077) === 0);
  const temporary = join(directory, '.acceptance-pending'), destination = join(directory, 'acceptance.json');
  let file, created = false, linked = false;
  try {
    file = await open(temporary, 'wx', 0o600); created = true;
    await file.writeFile(JSON.stringify(receipt) + '\n'); await file.sync(); await file.close(); file = null;
    // Atomic no-clobber link avoids rename's replacement of existing evidence.
    await link(temporary, destination); linked = true;
    await unlink(temporary);
    const dir = await open(directory, 'r'); try { await dir.sync(); } finally { await dir.close(); }
  } catch (error) {
    if (file) await file.close().catch(() => {});
    if (created) await unlink(temporary).catch(() => {});
    if (linked) await unlink(destination).catch(() => {});
    throw error;
  }
}
async function nativeAcceptance(options, interrupted) {
  if (!options || Object.keys(options).length !== 1 || !options.output) throw fault('CLI_INPUT');
  const opts = validateOptions(options), began = Date.now();
  const before = await provenance();
  await verifyRuntime();
  // No runner injection, receipt-file input, fake mode or retry in this command.
  const result = await runSpike(opts);
  requireProof(result.output === opts.output && result.cleanupVerified === true);
  requireProof(ownedProcessHandles().length === 0 && ownedSpikeProcesses().length === 0);
  const evidence = await privateFile(join(result.output, 'receipt.json'));
  requireProof(evidence.toString() === JSON.stringify(result.receipt));
  const counts = validateReceipt(result.receipt);
  await verifyRuntime();
  const after = await provenance();
  requireProof(JSON.stringify(before) === JSON.stringify(after));
  requireProof(Date.now() - began <= LIMITS.trialMs);
  requireProof(!interrupted());
  requireProof(ownedProcessHandles().length === 0 && ownedSpikeProcesses().length === 0);
  const acceptance = {
    format: 1, kind: 'local_synthetic_native_cdc', production_ready: false,
    completedAt: new Date().toISOString(), elapsedMs: Date.now() - began,
    sourceSha256: after, pipelineReceiptSha256: sha(evidence), versions, limits: LIMITS,
    ...counts, cleanupVerified: true, proofs: result.receipt,
    pendingGates: ['P03 owner/adoption/source/operations', 'concurrent initial snapshot updates', 'DDL', 'expired log recovery', 'ACL/HA/capacity', 'account identity/masking']
  };
  await publishAtomic(result.output, acceptance);
  return acceptance;
}
export async function runAcceptance(options) {
  // Let the bounded pipeline reach its finally/owned teardown on interruption.
  // Repeated signals must never bypass cleanup by invoking Node's default exit.
  let interrupted = false;
  const stop = () => { interrupted = true; };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  try { return await nativeAcceptance(options, () => interrupted); }
  finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  Promise.resolve().then(() => runAcceptance(parseArgs(process.argv.slice(2))))
    .then(() => console.info('CDC_ACCEPTANCE_PUBLISHED'))
    .catch(() => { console.error('CDC_ACCEPTANCE_FAILED'); process.exitCode = 1; });
}
