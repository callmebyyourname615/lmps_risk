import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, chmod, readFile, writeFile, lstat, readdir, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, validateReceipt, publishAtomic, runAcceptance } from '../scripts/cdc-acceptance.mjs';

const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));

// Independent expected values. These exercise validation only, never native proof.
function receipt() {
  return {
    format: 1, versions: { kafka: '4.1.2', debezium: '3.7.0.Final', java: '21.0.10', mariadb: '11.8.9' },
    snapshot: { records: 2, observations: 2, bytes: 100, tombstones: 0, stateSha256: 'eb6c', operationsSha256: 'bad' },
    stream: {}, restart: {}, replay: {}, captureSha256: 'a'.repeat(64)
  };
}
test('import is inert and CLI rejects missing/extra/unsafe inputs without native work', async () => {
  const entry = new URL('../scripts/cdc-acceptance.mjs', import.meta.url);
  const imported = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(entry.href)})`], { encoding: 'utf8', timeout: 5000 });
  assert.equal(imported.status, 0); assert.equal(imported.stdout + imported.stderr, '');
  for (const args of [[], ['run'], ['--output'], ['--output', '/tmp/no'], ['--output', '.local/../no'], ['--output', '.local/test', '--fake'], ['--receipt', '.local/test'], ['--output', '.local/test\nsecret']]) {
    assert.throws(() => parseArgs(args));
    const child = spawnSync(process.execPath, [fileURLToPath(entry), ...args], { encoding: 'utf8', timeout: 5000 });
    assert.equal(child.status, 1); assert.equal(child.stdout, ''); assert.equal(child.stderr, 'CDC_ACCEPTANCE_FAILED\n');
  }
  assert.ok(parseArgs(['--output', fileURLToPath(new URL('../../../.local/new-native-proof', import.meta.url))]).output.endsWith('/.local/new-native-proof'));
  await assert.rejects(runAcceptance({ output: '.local/new-native-proof', fake: true }), /CLI_INPUT/);
});
test('self-reported success and incomplete/changed/limit proofs cannot validate', () => {
  for (const value of [null, {}, { accepted: true }, receipt(), { ...receipt(), format: 2 }, { ...receipt(), captureSha256: 'secret' }]) assert.throws(() => validateReceipt(value));
});
test('native runtime/pipeline/cleanup failures exit nonzero without publishing', () => {
  const entry = new URL('../scripts/cdc-acceptance.mjs', import.meta.url);
  for (const failure of ['pins', 'runtime', 'pipeline', 'cleanup', 'handles']) {
    // Test-process loader only: production command has no substitution interface.
    const script = `
      import { registerHooks } from 'node:module';
      registerHooks({ load(url, context, next) {
        if (url.endsWith('/cdc-acceptance.mjs') && ${failure === 'pins'}) {
          const loaded = next(url, context);
          return { ...loaded, source: String(loaded.source).replace('6fda3f20 ed7cf0bc 9a8fbb18 b240a436 03500102 7f3ead4e 95d42e60 0d7d0518', '0'.repeat(64)) };
        }
        if (url.endsWith('/cdc-runtime.mjs')) return { format: 'module', shortCircuit: true, source:
          'export async function verifyRuntime() { ${failure === 'pins' ? 'process.exit(77);' : failure === 'runtime' ? 'throw Error("PRIVATE");' : ''} } export function ownedProcessHandles() { return ${failure === 'handles' ? '[{}]' : '[]'}; }' };
        if (url.endsWith('/cdc-spike.mjs')) return { format: 'module', shortCircuit: true, source:
          'export const validateOptions = x => x; export const ownedSpikeProcesses = () => []; export async function runSpike(x) { ${failure === 'pipeline' ? 'throw Error("PRIVATE");' : 'return { output: x.output, cleanupVerified: ' + (failure !== 'cleanup') + ' };'} }' };
        return next(url, context);
      }});
      process.argv[1] = ${JSON.stringify(fileURLToPath(entry))};
      process.argv.splice(2, Infinity, '--output', ${JSON.stringify(join(projectRoot, '.local/unit-never-published'))});
      await import(${JSON.stringify(entry.href)});
    `;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 5000 });
    assert.equal(child.status, 1, child.stderr); assert.equal(child.stdout, '');
    assert.equal(child.stderr, 'CDC_ACCEPTANCE_FAILED\n');
  }
});
test('phase proofs bind independent exact state, operations, tombstone and replay counts', async () => {
  // Literal fixture states hashed independently of the production expectedPhase API.
  const { createHash } = await import('node:crypto');
  const hash = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');
  const row = (id, revision, amount) => ({ id, revision, amount, currency: 'XTS' });
  const r = receipt();
  const phases = [
    ['snapshot', 2, 0, [row(1, 1, '9007199254740993.1200'), row(2, 1, '0.0100')], ['r:1:1', 'r:2:1']],
    ['stream', 6, 1, [row(1, 2, '9007199254740993.1201'), row(3, 1, '12.3400')], ['r:1:1', 'r:2:1', 'c:3:1', 'u:1:2', 'd:2:1']],
    ['restart', 8, 1, [row(1, 2, '9007199254740993.1201'), row(3, 2, '12.3401'), row(4, 1, '1.0000')], ['r:1:1', 'r:2:1', 'c:3:1', 'u:1:2', 'd:2:1', 'u:3:2', 'c:4:1']]
  ];
  for (const [phase, records, tombstones, rows, ops] of phases) r[phase] = { records, observations: records, bytes: 100, tombstones, stateSha256: hash(rows), operationsSha256: hash(ops.sort()) };
  r.replay = { ...r.restart, observations: 16, bytes: 200 };
  assert.deepEqual(validateReceipt(r), { capturedRecords: 24, oracleBytes: 400 });
  for (const phase of ['snapshot', 'stream', 'restart', 'replay']) {
    for (const [key, value] of Object.entries({ records: 0, observations: 0, bytes: 2097153, tombstones: 9, stateSha256: 'a'.repeat(64), operationsSha256: 'b'.repeat(64), extra: true })) {
      const bad = structuredClone(r); bad[phase][key] = value;
      assert.throws(() => validateReceipt(bad), /ACCEPTANCE_PROOF/);
    }
    const missing = structuredClone(r); delete missing[phase]; assert.throws(() => validateReceipt(missing));
  }
  const changed = structuredClone(r); changed.versions.kafka = '4.1.3'; assert.throws(() => validateReceipt(changed));
  const replay = structuredClone(r); replay.replay.bytes = 199; assert.throws(() => validateReceipt(replay));
});
test('publication is private, complete and refuses to overwrite existing evidence', async () => {
  const base = await mkdtemp(join(projectRoot, '.cdc-acceptance-unit-'));
  await chmod(base, 0o700);
  try {
    const invalid = {}; invalid.circular = invalid;
    await assert.rejects(publishAtomic(base, invalid));
    assert.deepEqual(await readdir(base), []);
    // Filesystem primitive only; this deliberately is not an acceptance trial.
    await publishAtomic(base, { unitOnly: true });
    const path = join(base, 'acceptance.json'), bytes = await readFile(path, 'utf8');
    assert.equal(bytes, '{"unitOnly":true}\n'); assert.equal((await lstat(path)).mode & 0o077, 0);
    assert.deepEqual(await readdir(base), ['acceptance.json']);
    await assert.rejects(publishAtomic(base, { replacement: true }));
    assert.equal(await readFile(path, 'utf8'), bytes);
    await writeFile(join(base, '.acceptance-pending'), 'collision');
    await assert.rejects(publishAtomic(base, {}));
    assert.equal(await readFile(join(base, '.acceptance-pending'), 'utf8'), 'collision');
    await chmod(base, 0o755); await assert.rejects(publishAtomic(base, {})); await chmod(base, 0o700);
    const alias = base + '-link'; await symlink(base, alias);
    try { await assert.rejects(publishAtomic(alias, {})); } finally { await rm(alias); }
  } finally { await rm(base, { recursive: true, force: true }); }
});
