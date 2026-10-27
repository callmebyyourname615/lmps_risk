import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const TASK_ID = 'US-001';
export const STATE_DIRECTORY = '.local/ralph';
export const TRACKER = 'tasks/ralph/prd.json';
export const EXIT = Object.freeze({ failed: 1, verification: 65, quota: 75, authentication: 77, state: 78, timeout: 124, interrupted: 130 });

export function toolchain(root = ROOT) {
  const prefix = join(userInfo().homedir, '.nvm/versions/node/v24.19.0/bin');
  return {
    node: join(root, 'node_modules/.bin/node'),
    pnpm: join(prefix, 'pnpm'),
    codex: join(prefix, 'codex'),
    python: join(root, '.venv/bin/python'),
    ralph: '/opt/homebrew/bin/ralph-tui',
    bun: '/opt/homebrew/bin/bun',
    git: '/opt/homebrew/bin/git',
    path: [join(root, 'node_modules/.bin'), prefix, '/opt/homebrew/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':'),
  };
}

export function environment(root = ROOT, home = 'plusd') {
  if (!['plusb', 'pluse', 'plusd'].includes(home)) throw new Error('Choose one of plusb, pluse or plusd explicitly.');
  return {
    HOME: homedir(),
    PATH: toolchain(root).path,
    TMPDIR: process.env.TMPDIR || '/private/tmp',
    LANG: 'en_US.UTF-8',
    TERM: 'dumb',
    NO_COLOR: '1',
    CODEX_HOME: join(homedir(), `.codex-${home}`),
    LMPS_ENVIRONMENT: 'test',
    LMPS_EXECUTION_MODE: 'test',
  };
}

export function digest(value) {
  return createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
}

export function privateDirectory(directory) {
  const absolute = resolve(directory);
  let current = absolute;
  while (current !== dirname(current)) {
    if (existsSync(current) && (!lstatSync(current).isDirectory() || lstatSync(current).isSymbolicLink())) throw new Error('Private directory contains an unsafe path.');
    current = dirname(current);
  }
  mkdirSync(absolute, { recursive: true, mode: 0o700 });
  chmodSync(absolute, 0o700);
  return absolute;
}

export function readJson(file) {
  const info = lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 8 * 1024 * 1024) throw new Error('Unsafe state file.');
  try { return JSON.parse(readFileSync(file, 'utf8')); }
  catch { throw new Error('Invalid state JSON; raw content withheld.'); }
}

export function writeJson(file, value) {
  privateDirectory(dirname(file));
  if (existsSync(file)) readJson(file);
  const temporary = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  const pending = openSync(temporary, 'r');
  try { fsyncSync(pending); } finally { closeSync(pending); }
  renameSync(temporary, file);
  const parent = openSync(dirname(file), 'r');
  try { fsyncSync(parent); } finally { closeSync(parent); }
}

export function sourceSnapshot(root = ROOT) {
  const command = toolchain(root).git;
  const names = execFileSync(command, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }).split('\0').filter(Boolean);
  const source = [...new Set(names)].sort().filter(name => name !== TRACKER).map(name => {
    const file = join(root, name);
    const info = lstatSync(file);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('Source inventory includes a non-regular file.');
    return { name, sha256: digest(readFileSync(file)), mode: info.mode & 0o777 };
  });
  const planDirectory = join(dirname(root), 'plan');
  const plan = readdirSync(planDirectory).filter(name => name.endsWith('.md')).sort().map(name => ({ name, sha256: digest(readFileSync(join(planDirectory, name))) }));
  const branch = execFileSync(command, ['symbolic-ref', '--quiet', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const tracked = execFileSync(command, ['ls-files', '--stage', '-z'], { cwd: root, encoding: 'utf8' });
  const head = spawnSync(command, ['rev-parse', '--verify', 'HEAD'], { cwd: root, encoding: 'utf8' });
  return { source, plan, branch, head: head.status === 0 ? head.stdout.trim() : null, indexSha256: digest(tracked) };
}

export function assertCheckpoint(root = ROOT) {
  const checkpoint = readJson(join(root, STATE_DIRECTORY, 'checkpoint.json'));
  if (digest(checkpoint.snapshot) !== digest(sourceSnapshot(root))) throw new Error('Source, plan, branch or index changed since the reviewed checkpoint. Reconcile before running.');
  return checkpoint;
}

export function verifyConfiguration(root = ROOT) {
  const file = join(root, '.ralph-tui/config.toml');
  const parser = 'const c=Bun.TOML.parse(await Bun.file(process.argv[1]).text());console.log(JSON.stringify(c));';
  const result = spawnSync(toolchain(root).bun, ['-e', parser, file], { cwd: '/private/tmp', env: environment(root), encoding: 'utf8', timeout: 15000, maxBuffer: 65536 });
  if (result.status !== 0) throw new Error('Ralph configuration could not be parsed.');
  let config;
  try { config = JSON.parse(result.stdout); } catch { throw new Error('Invalid Ralph configuration.'); }
  if (config.configVersion !== '2.1' || config.agent !== 'codex' || config.command !== join(root, 'tools/ralph/agent-adapter.mjs') || config.tracker !== 'json' || config.maxIterations !== 1 || config.autoCommit !== false || config.fallbackAgents?.length !== 0 || config.agents?.length || config.trackers?.length || config.agentOptions?.fullAuto !== false || config.agentOptions?.sandbox !== 'read-only' || config.errorHandling?.strategy !== 'abort' || config.errorHandling?.maxRetries !== 0 || config.rateLimitHandling?.maxRetries !== 0 || config.parallel?.mode !== 'never' || config.prompt_template !== '.ralph-tui/prompt.hbs') throw new Error('Ralph configuration differs from the approved read-only pilot policy.');
  if (existsSync(join(homedir(), '.config/ralph-tui/config.toml'))) throw new Error('A global Ralph configuration needs review before this pinned pilot.');
  return true;
}

export function trackerDefinition(tracker) {
  return {
    name: tracker.name,
    branchName: tracker.branchName,
    userStories: tracker.userStories.map(({ id, title, description, acceptanceCriteria, dependsOn, priority }) => ({ id, title, description, acceptanceCriteria, dependsOn, priority })),
  };
}

export function readTracker(root = ROOT) {
  const tracker = readJson(join(root, TRACKER));
  if (!Array.isArray(tracker.userStories) || tracker.userStories.length !== 1 || tracker.userStories[0].id !== TASK_ID || typeof tracker.userStories[0].passes !== 'boolean') throw new Error('Only the approved read-only US-001 pilot may run.');
  return tracker;
}

export function reconcile(root = ROOT, repair = false) {
  const checkpoint = assertCheckpoint(root);
  const tracker = readTracker(root);
  const definitionSha256 = digest(trackerDefinition(tracker));
  if (checkpoint.definitionSha256 !== definitionSha256) throw new Error('Approved task definition changed.');
  const receiptPath = join(root, STATE_DIRECTORY, 'receipt.json');
  const receipt = existsSync(receiptPath) ? readJson(receiptPath) : null;
  if (receipt && (receipt.status !== 'verified' || receipt.taskId !== TASK_ID || receipt.definitionSha256 !== definitionSha256 || receipt.planSha256 !== digest(checkpoint.snapshot.plan))) throw new Error('Completion receipt does not match the approved task and plan.');
  const passed = tracker.userStories[0].passes;
  if (passed && !receipt) throw new Error('Tracker claims completion without a verification receipt. Manual reconciliation required.');
  if (receipt && !passed && repair) {
    tracker.userStories[0].passes = true;
    writeJson(join(root, TRACKER), tracker);
  }
  return { taskId: TASK_ID, complete: Boolean(receipt), trackerRepairNeeded: Boolean(receipt && !passed), definitionSha256 };
}

export function takeLock(root = ROOT) {
  const file = join(privateDirectory(join(root, STATE_DIRECTORY)), 'launcher.lock');
  const lock = { pid: process.pid, token: randomUUID(), createdAt: new Date().toISOString() };
  try {
    writeFileSync(file, JSON.stringify(lock), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('Launcher lock exists. Inspect status; locks are never overridden automatically.');
    throw error;
  }
  return () => {
    if (existsSync(file) && readJson(file).token === lock.token) unlinkSync(file);
  };
}

export function preserveOriginals(root = ROOT) {
  const original = readJson(join(root, STATE_DIRECTORY, 'baseline-before-setup/manifest.json'));
  const allowed = new Set(['.gitignore', 'docs/implementation-status/current.md']);
  for (const entry of original.source) {
    if (!allowed.has(entry.name) && digest(readFileSync(join(root, entry.name))) !== entry.sha256) throw new Error('An original application/source file changed outside the approved tooling scope.');
  }
  for (const entry of original.plan) {
    if (digest(readFileSync(join(dirname(root), 'plan', entry.name))) !== entry.sha256) throw new Error('Original plan changed.');
  }
  return { originalFiles: original.source.length, planFiles: original.plan.length, allowedChangedFiles: [...allowed] };
}
