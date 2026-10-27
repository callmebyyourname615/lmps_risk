import { execFileSync, spawnSync } from 'node:child_process';
import { constants, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync, openSync, closeSync, fsyncSync, chmodSync, mkdtempSync, realpathSync, symlinkSync, rmSync, statfsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { digest, environment, privateDirectory, readJson, sourceSnapshot, toolchain, writeJson } from './state.mjs';

export const BATCH_TRACKER = 'tasks/ralph/batches/rlp-b01.json';

export function batchSnapshot(root, tracker = BATCH_TRACKER) {
  const snapshot = sourceSnapshot(root);
  snapshot.source = snapshot.source.filter(row => row.name !== tracker);
  return snapshot;
}

export function fileHash(file) {
  if (!existsSync(file)) return null;
  const info = lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw new Error('Unsafe source file.');
  return { sha256: digest(readFileSync(file)), mode: info.mode & 0o777 };
}

function equal(a, b) { return digest(a) === digest(b); }

export function changedFiles(root, candidate, before, allowed, taskId, policy = null) {
  const names = execFileSync(toolchain(root).git, ['-c', 'core.fsmonitor=false', 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: candidate, encoding: 'utf8' }).split('\0').filter(Boolean);
  const expected = new Map(before.source.map(row => [row.name, { sha256: row.sha256, mode: row.mode }]));
  const changed = [];
  for (const name of new Set([...names, ...expected.keys()])) {
    if (name === (policy?.tracker ?? BATCH_TRACKER)) {
      const proposed = readJson(join(candidate, name)), current = readJson(join(root, name));
      if (proposed.metadata) delete proposed.metadata.updatedAt;
      if (current.metadata) delete current.metadata.updatedAt;
      if (!equal(proposed, current)) throw new Error('Candidate tracker changed.');
      continue;
    }
    if (name.startsWith('/') || name.split('/').includes('..')) throw new Error('Unsafe inventory path.');
    const actual = fileHash(join(candidate, name));
    if (!equal(actual, expected.get(name) ?? null)) {
      if (!allowed.includes(name) || !actual) throw new Error('Candidate changed a protected or unapproved file.');
      changed.push({ name, before: expected.get(name) ?? null, after: actual });
    }
  }
  if (!changed.length && !policy?.allowUnchanged) throw new Error('No implementation changes were produced.');
  for (const row of changed) {
    const original = expected.has(row.name) ? readFileSync(join(root, row.name), 'utf8') : null;
    const proposed = readFileSync(join(candidate, row.name), 'utf8');
    if (policy) {
      const edit = policy.edits?.[row.name];
      if (row.name === 'packages/contracts/package.json' || row.name === 'package.json') {
        if (!edit || !original) throw new Error('Missing manifest-field permission.');
        const old = JSON.parse(original), next = JSON.parse(proposed);
        const field = edit.kind === 'export' ? 'exports' : edit.kind === 'script' ? 'scripts' : null;
        if (!field || old[field]?.[edit.key] !== undefined || !equal(next[field]?.[edit.key], edit.value)) throw new Error('Unapproved manifest entry.');
        delete next[field][edit.key];
        if (!equal(old, next)) throw new Error('Protected manifest fields changed.');
      }
      if (row.name === 'packages/risk/src/index.ts' && (!edit || edit.kind !== 'append' || !proposed.startsWith(original) || proposed.slice(original.length).trim() !== edit.value)) throw new Error('Unapproved risk export.');
      if (['docs/implementation-status/current.md','docs/architecture/engineering-foundation-gates.md'].includes(row.name) && original && !proposed.startsWith(original)) throw new Error('Existing document history was changed.');
      if (!original && (row.after.mode & 0o111) && !row.name.endsWith('.mjs')) throw new Error('Unexpected executable file.');
      continue;
    }
    if (row.name === 'packages/contracts/package.json' || row.name === 'package.json') {
      const old = JSON.parse(original), next = JSON.parse(proposed);
      if (taskId === 'US-101' && row.name === 'packages/contracts/package.json') {
        const entry = next.exports?.['./pretransfer-simulation'];
        if (!equal(entry, { types: './dist/pretransfer-simulation.d.ts', import: './dist/pretransfer-simulation.js' })) throw new Error('Unapproved contract export.');
        delete next.exports['./pretransfer-simulation'];
      } else if (taskId === 'US-104' && row.name === 'package.json') {
        if (next.scripts?.['risk:simulate-pretransfer'] !== 'pnpm --filter @lmps/risk-workers build && pnpm exec node apps/risk-workers/scripts/pretransfer-simulate.mjs') throw new Error('Unapproved simulator command.');
        delete next.scripts['risk:simulate-pretransfer'];
      } else throw new Error('Unapproved manifest edit.');
      if (!equal(old, next)) throw new Error('Protected manifest fields changed.');
    }
    if (row.name === 'packages/risk/src/index.ts') {
      const line = taskId === 'US-102' ? "export * from './pretransfer-simulation.js';" : "export * from './pretransfer-reservations.js';";
      if (!proposed.startsWith(original) || proposed.slice(original.length).trim() !== line) throw new Error('Risk index changes must be the approved additive export.');
    }
    if (row.name === 'docs/implementation-status/current.md' && !proposed.endsWith(original) && !proposed.startsWith(original)) throw new Error('Existing status history was changed.');
    if (!original && (row.after.mode & 0o111) && !row.name.endsWith('.mjs')) throw new Error('Unexpected executable file.');
  }
  return changed.sort((a, b) => a.name.localeCompare(b.name));
}

export function makeCandidate(root, directory, snapshot, tracker = BATCH_TRACKER) {
  if (existsSync(join(directory, 'candidate'))) throw new Error('Candidate already exists; explicit resume is required.');
  const candidate = privateDirectory(join(directory, 'candidate'));
  for (const row of snapshot.source) {
    const target = join(candidate, row.name);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(root, row.name), target, constants.COPYFILE_EXCL);
    chmodSync(target, row.mode);
  }
  mkdirSync(dirname(join(candidate, tracker)), { recursive: true });
  copyFileSync(join(root, tracker), join(candidate, tracker), constants.COPYFILE_EXCL);
  const plans = privateDirectory(join(directory, 'plan'));
  for (const row of snapshot.plan) copyFileSync(join(dirname(root), 'plan', row.name), join(plans, row.name), constants.COPYFILE_EXCL);
  execFileSync(toolchain(root).git, ['init', '--quiet', '-b', 'main'], { cwd: candidate });
  return candidate;
}

export function restoreInstallerFormatting(root, candidate, baseline) {
  for (const row of baseline.source) {
    const actual = fileHash(join(candidate, row.name));
    if (equal(actual, { sha256: row.sha256, mode: row.mode })) continue;
    if (!actual || actual.mode !== row.mode || !row.name.endsWith('.json') || !equal(readJson(join(root, row.name)), readJson(join(candidate, row.name)))) throw new Error('Installer changed protected source semantics.');
    if (!equal(fileHash(join(root, row.name)), { sha256: row.sha256, mode: row.mode })) throw new Error('Original source changed during setup.');
    copyFileSync(join(root, row.name), join(candidate, row.name));
  }
}

export function sandboxArguments(candidate, command) {
  return ['sandbox', '-P', ':workspace', '-C', candidate, '--', ...command];
}

export function fixtureVerificationProfile(root, candidate, directory) {
  const home = privateDirectory(join(directory, 'verifier-home'));
  const codexHome = privateDirectory(join(home, '.codex'));
  const cache = privateDirectory(join(directory, 'verifier-cache-v2'));
  const temporaryState = join(directory, 'verification-scratch.json');
  let temporary;
  if (existsSync(temporaryState)) {
    temporary = readJson(temporaryState).path;
    if (typeof temporary !== 'string' || !temporary.startsWith('/private/tmp/lmps-ralph-') || realpathSync(temporary) !== temporary || lstatSync(temporary).uid !== process.getuid()) throw new Error('Unsafe verification scratch directory.');
  } else {
    temporary = mkdtempSync('/private/tmp/lmps-ralph-');
    chmodSync(temporary, 0o700);
    writeJson(temporaryState, { path: temporary });
  }
  const config = `default_permissions = "lmps-local-fixtures"\n[features]\nnetwork_proxy = true\n[permissions.lmps-local-fixtures]\nextends = ":workspace"\n[permissions.lmps-local-fixtures.filesystem]\n${JSON.stringify(cache)} = "write"\n[permissions.lmps-local-fixtures.network]\nenabled = true\nallow_local_binding = true\nenable_socks5_udp = false\n[permissions.lmps-local-fixtures.network.domains]\n"localhost" = "allow"\n"127.0.0.1" = "allow"\n"::1" = "allow"\n`;
  writeFileSync(join(codexHome, 'config.toml'), config, { mode: 0o600 });
  return { home, codexHome, cache, temporary, profileSha256: digest(config), arguments: ['sandbox', '-P', 'lmps-local-fixtures', '--allow-unix-socket', '/private/tmp', '-C', candidate, '--'] };
}

export function seedVerificationCaches(root, context) {
  const ready = ['uv-ready.json','pnpm-v11-ready.json'].every(name=>existsSync(join(context.cache,name)));
  assertVerificationCapacity(root,ready ? 2*1024**3 : 6*1024**3);
  for (const [name, source] of [['uv', join(environment(root).HOME, '.cache/uv')], ['pnpm/v11', join(environment(root).HOME, 'Library/pnpm/store/v11')]]) {
    const target = join(context.cache, name), receipt = join(context.cache, `${name.replace('/', '-')}-ready.json`);
    if (existsSync(receipt)) continue;
    if (existsSync(target)) throw new Error('Incomplete cache clone requires review; original cache is preserved.');
    privateDirectory(dirname(target));
    cpSync(source, target, { recursive: true, mode: constants.COPYFILE_FICLONE_FORCE, verbatimSymlinks: true });
    writeJson(receipt, { source, cloned: true, method: 'private APFS clone', completedAt: new Date().toISOString() });
  }
}

export function assertVerificationCapacity(root, minimum = 6*1024**3, available = () => { const info=statfsSync(root);return info.bavail*info.bsize; }) {
  const bytes=available();
  if (!Number.isSafeInteger(bytes) || bytes < minimum) throw new Error(`Insufficient verifier disk space: need at least ${minimum/1024**3}GiB free before this stage; candidate preserved. No automatic retry.`);
  return bytes;
}

export function retireVerificationCache(root, directory) {
  if (!/^\.local\/ralph\/batches\/rlp-b\d{2}\/tasks\/US-\d{3,5}$/.test(relative(root,directory)) || realpathSync(directory)!==resolve(directory)) throw new Error('Unsafe verifier cache retirement path.');
  const receipt=readJson(join(directory,'receipt.json'));
  if (receipt.status!=='verified') throw new Error('Verifier cache retained until durable verified receipt.');
  const cache=join(directory,'verifier-cache-v2');
  if (!existsSync(cache)) return false;
  const info=lstatSync(cache);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid!==process.getuid()) throw new Error('Unsafe verifier cache directory.');
  for (const name of ['uv-ready.json','pnpm-v11-ready.json']) if (readJson(join(cache,name)).cloned!==true) throw new Error('Only owned reproducible verifier clones may be retired.');
  writeJson(join(directory,'cache-retirement.json'),{status:'prepared',taskId:receipt.taskId,receiptSha256:digest(receipt),originalStoresUntouched:true,candidateAndLogsPreserved:true});
  rmSync(cache,{recursive:true});
  writeJson(join(directory,'cache-retirement.json'),{status:'complete',taskId:receipt.taskId,receiptSha256:digest(receipt),originalStoresUntouched:true,candidateAndLogsPreserved:true});
  return true;
}

export function retireCompletedDependencies(root,directory) {
  if(!/^\.local\/ralph\/batches\/rlp-b\d{2}\/tasks\/US-\d{3,5}$/.test(relative(root,directory))||realpathSync(directory)!==resolve(directory))throw new Error('Unsafe completed dependency path.');
  const receipt=readJson(join(directory,'receipt.json'));
  if(receipt.status!=='verified'||!receipt.after)throw new Error('Dependencies retained until durable verified receipt.');
  const candidate=join(directory,'candidate'),tracker=`tasks/ralph/batches/${relative(root,directory).split('/')[3]}.json`;
  if(!existsSync(candidate)||lstatSync(candidate).isSymbolicLink()||realpathSync(candidate)!==candidate)throw new Error('Unsafe candidate dependency path.');
  try {changedFiles(root,candidate,receipt.after,[],receipt.taskId,{tracker,edits:{},allowUnchanged:true});}
  catch {writeJson(join(directory,'dependency-retirement.json'),{status:'retained',reason:'Candidate source changed; no dependencies removed.'});return [];}
  const paths=['node_modules','.venv'];
  for(const parent of ['apps','packages'])if(existsSync(join(candidate,parent)))for(const entry of readdirSync(join(candidate,parent),{withFileTypes:true}))if(entry.isDirectory())paths.push(`${parent}/${entry.name}/node_modules`);
  const removed=[];
  for(const name of paths){const path=join(candidate,name);if(!existsSync(path))continue;const info=lstatSync(path);if(!info.isDirectory()||info.isSymbolicLink()||info.uid!==process.getuid())continue;rmSync(path,{recursive:true});removed.push(name);}
  writeJson(join(directory,'dependency-retirement.json'),{status:'complete',removed,candidateSourceAndLogsPreserved:true,originalStoresUntouched:true,receiptSha256:digest(receipt)});
  return removed;
}

export function probeSandbox(root, directory) {
  const base = privateDirectory(join(directory, 'boundary-probe'));
  const candidate = privateDirectory(join(base, 'candidate'));
  const outside = join(base, 'protected.txt');
  if (!existsSync(outside)) writeFileSync(outside, 'original', { mode: 0o600 });
  const node = realpathSync(join(root, 'node_modules/.bin/node'));
  const script = 'const f=require("fs");f.writeFileSync("inside.txt","allowed");for(const p of process.argv.slice(1)){try{f.writeFileSync(p,"escaped");process.exitCode=9}catch(e){if(!["EPERM","EACCES"].includes(e.code))process.exitCode=8}}';
  const home = privateDirectory(join(base, 'home'));
  const env = { ...environment(root), HOME: home, CODEX_HOME: privateDirectory(join(home, '.codex')), TMPDIR: candidate };
  const link = join(candidate, 'escape');
  if (!existsSync(link)) symlinkSync(outside, link);
  const result = spawnSync(toolchain(root).codex, sandboxArguments(candidate, [node, '-e', script, outside, link]), { cwd: candidate, env, encoding: 'utf8', timeout: 20000 });
  const passed = result.status === 0 && readFileSync(outside, 'utf8') === 'original' && readFileSync(join(candidate, 'inside.txt'), 'utf8') === 'allowed';
  const evidence = { passed, exitCode: result.status, outsideWriteDenied: passed, symlinkWriteDenied: passed, sandbox: ':workspace', checkedAt: new Date().toISOString() };
  writeJson(join(directory, 'sandbox-probe.json'), evidence);
  if (!passed) throw new Error('Candidate sandbox boundary probe failed; write-enabled queue is disabled.');
  return evidence;
}

function syncFile(path) {
  const fd = openSync(path, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

export function promote(root, candidate, directory, baseline, changes, evidence, tracker = BATCH_TRACKER) {
  if (!equal(batchSnapshot(root, tracker), baseline)) throw new Error('Original source changed during the task; candidate preserved.');
  for (const row of changes) if (!equal(fileHash(join(candidate, row.name)), row.after)) throw new Error('Candidate changed after verification.');
  const journal = { status: 'prepared', baseline, changes, candidate, evidence, applied: [], tracker };
  writeJson(join(directory, 'promotion.json'), journal);
  return recoverPromotion(root, directory, tracker);
}

export function recoverPromotion(root, directory, tracker = BATCH_TRACKER) {
  const file = join(directory, 'promotion.json');
  const journal = readJson(file);
  const expected = structuredClone(journal.baseline);
  for (const row of journal.changes) {
    const current = fileHash(join(root, row.name));
    if (!equal(current, row.before) && !equal(current, row.after)) throw new Error('Promotion conflicts with user work; no recovery overwrite.');
    if (equal(current, row.after)) {
      expected.source = expected.source.filter(item => item.name !== row.name);
      expected.source.push({ name: row.name, ...row.after });
    }
  }
  expected.source.sort((a, b) => a.name.localeCompare(b.name));
  if (journal.tracker && journal.tracker !== tracker) throw new Error('Promotion tracker mismatch.');
  const actual = batchSnapshot(root, tracker);
  actual.source.sort((a, b) => a.name.localeCompare(b.name));
  if (!equal(expected, actual)) throw new Error('Unrelated source or Git state changed during promotion.');
  for (const row of journal.changes) {
    const destination = join(root, row.name);
    if (!equal(fileHash(destination), row.after)) {
      if (!equal(fileHash(destination), row.before) || !equal(fileHash(join(journal.candidate, row.name)), row.after)) throw new Error('Promotion source conflict.');
      mkdirSync(dirname(destination), { recursive: true });
      const pending = destination + '.ralph-pending';
      copyFileSync(join(journal.candidate, row.name), pending, constants.COPYFILE_EXCL);
      chmodSync(pending, row.after.mode);
      syncFile(pending);
      if (!equal(fileHash(destination), row.before)) throw new Error('User edit detected before publication.');
      renameSync(pending, destination);
      syncFile(dirname(destination));
    }
    journal.applied.push(row.name);
    writeJson(file, journal);
  }
  journal.status = 'promoted';
  journal.after = batchSnapshot(root, tracker);
  writeJson(file, journal);
  return journal;
}
