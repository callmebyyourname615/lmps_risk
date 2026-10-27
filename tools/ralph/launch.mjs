#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, renameSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { EXIT, ROOT, STATE_DIRECTORY, TASK_ID, TRACKER, assertCheckpoint, digest, environment, preserveOriginals, privateDirectory, readJson, readTracker, reconcile, sourceSnapshot, takeLock, toolchain, trackerDefinition, verifyConfiguration, writeJson } from './state.mjs';
import { verifyMap } from './requirements.mjs';
import { verifyIntake } from './verification.mjs';

export function parseArguments(args) {
  const [command = 'status', ...rest] = args;
  if (!['checkpoint', 'run', 'resume', 'status', 'verify', 'recover-lock'].includes(command)) throw new Error('Use checkpoint, run, resume, status, verify or recover-lock.');
  let home = 'plusd';
  let headless = false;
  let batch;
  let handoff = false;
  for (let index = 0; index < rest.length; index++) {
    if (rest[index] === '--home' && ['plusb', 'pluse', 'plusd'].includes(rest[index + 1])) home = rest[++index];
    else if (rest[index] === '--headless') headless = true;
    else if (rest[index] === '--batch' && (rest[index+1]==='rlp-master'||/^rlp-b\d{2}$/.test(rest[index + 1] ?? ''))) batch = rest[++index];
    else if (rest[index] === '--handoff') handoff = true;
    else throw new Error('Use --batch rlp-master|rlp-bNN, --home plusb|pluse|plusd, --headless and resume-only --handoff.');
  }
  if (handoff && command !== 'resume') throw new Error('--handoff is accepted only with explicit resume.');
  return { command, home, headless, ...(batch ? { batch } : {}), ...(handoff ? { handoff } : {}) };
}

export function sessionAction(session, requested) {
  if (!session) return 'run';
  if (['paused', 'running', 'interrupted'].includes(session.status)) {
    if (requested !== 'resume') throw new Error('A resumable session exists. Reconcile and use resume.');
    if (session.currentIteration >= session.maxIterations && session.maxIterations > 0) return 'restart';
    return 'resume';
  }
  if (['failed', 'completed'].includes(session.status) && requested === 'resume') return 'restart';
  return 'run';
}

function readOptional(name) {
  const file = join(ROOT, STATE_DIRECTORY, name);
  return existsSync(file) ? readJson(file) : null;
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}

function recoverLock() {
  const file = join(ROOT, STATE_DIRECTORY, 'launcher.lock');
  if (!existsSync(file)) return { status: 'no-launcher-lock' };
  const lock = readJson(file);
  const previous = readOptional('run.json');
  if (processAlive(lock.pid) || processAlive(previous?.ralphPid)) throw new Error('A launcher or Ralph process is still alive. Do not override its lock.');
  assertCheckpoint();
  const sessionFile = join(ROOT, '.ralph-tui/session.json');
  if (existsSync(sessionFile)) {
    const session = readJson(sessionFile);
    if (session.currentTaskId || session.activeTaskIds?.length) throw new Error('Ralph retains active-task state; inspect the task/processes before clearing the launcher lock.');
  }
  writeJson(join(ROOT, STATE_DIRECTORY, 'recovered-lock.json'), lock);
  if (readJson(file).token !== lock.token) throw new Error('Lock changed during inspection.');
  unlinkSync(file);
  return { status: 'stale-launcher-lock-recovered', ralphLockUntouched: true };
}

function status() {
  let reconciliation;
  try { reconciliation = reconcile(); } catch (error) { reconciliation = { status: 'review-required', reason: error.message }; }
  const result = readOptional('agent-result.json');
  return {
    scope: 'read-only-automation-pilot',
    selectedHome: readOptional('run.json')?.selectedHome ?? 'plusd',
    reconciliation,
    lastAgent: result,
    launcherLocked: existsSync(join(ROOT, STATE_DIRECTORY, 'launcher.lock')),
    automaticRetry: false,
    automaticAccountRotation: false,
    nextAction: result?.status === 'quota' ? 'Wait until the selected account is available, then inspect status and explicitly resume. No quota-reset time is guessed.' : result?.status === 'authentication' ? 'Manual authentication review required. This workflow never logs out or runs login.' : 'Only the approved intake task is executable; new feature work needs a reviewed batch.',
  };
}

async function execute({ command, home, headless }) {
  const release = takeLock();
  try {
    const state = reconcile(ROOT, true);
    if (state.complete) return { status: 'already-verified', taskId: TASK_ID, agentInvoked: false };
    const previous = readOptional('run.json');
    if (previous && processAlive(previous.ralphPid)) throw new Error('Previous Ralph process is still alive; refusing a second writer.');
    if (command === 'resume' && previous?.selectedHome !== home) throw new Error('Resume must use the previously selected home; account handoff is outside this pilot.');
    const sessionFile = join(ROOT, '.ralph-tui/session.json');
    const session = existsSync(sessionFile) ? readJson(sessionFile) : null;
    const action = sessionAction(session, command);
    if (action === 'restart') {
      const archive = privateDirectory(join(ROOT, STATE_DIRECTORY, 'archived-sessions', `${Date.now()}`));
      for (const name of ['session.json', 'session-meta.json']) {
        const file = join(ROOT, '.ralph-tui', name);
        if (existsSync(file)) {
          readJson(file);
          renameSync(file, join(archive, name));
        }
      }
    }
    const args = action === 'resume' ? ['resume', '--cwd', ROOT] : [
      'run', '--cwd', ROOT, '--agent', 'codex', '--prd', join(ROOT, TRACKER), '--serial', '--iterations', '1',
      '--no-setup', '--prompt', join(ROOT, '.ralph-tui/prompt.hbs'),
      '--output-dir', join(ROOT, STATE_DIRECTORY, 'iterations'), '--progress-file', join(ROOT, '.ralph-tui/progress.md'),
    ];
    if (headless) args.push('--headless');
    const runner = privateDirectory(join(ROOT, STATE_DIRECTORY, 'runner'));
    const env = environment(ROOT, home);
    const child = spawn(toolchain().ralph, args, { cwd: runner, env, stdio: 'inherit', shell: false });
    writeJson(join(ROOT, STATE_DIRECTORY, 'run.json'), { selectedHome: home, ralphPid: child.pid ?? null, launcherPid: process.pid, action, startedAt: new Date().toISOString() });
    const interrupt = () => child.kill('SIGINT');
    process.on('SIGINT', interrupt);
    process.on('SIGTERM', interrupt);
    const result = await new Promise(resolveResult => {
      child.once('error', () => resolveResult({ code: 1 }));
      child.once('exit', (code, signal) => resolveResult({ code, signal }));
    });
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
    const after = reconcile(ROOT, true);
    if (after.complete) return { status: 'verified', taskId: TASK_ID };
    const agent = readOptional('agent-result.json');
    const code = result.signal ? EXIT.interrupted : agent?.exitCode || result.code || EXIT.failed;
    process.exitCode = code;
    return { status: agent?.status ?? 'interrupted-or-incomplete', taskId: TASK_ID, exitCode: code, manualActionRequired: true, retryAt: agent?.retryAt ?? null };
  } finally {
    release();
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const { REGISTRY, activeRegisteredBatch, historicalBatchStatus, loadRegisteredBatch, loadMasterCatalog, masterStatus } = await import('./batch-registry.mjs');
  const masterRequested=options.batch==='rlp-master';
  if(masterRequested){
    if(!['run','resume','status','verify'].includes(options.command))throw new Error('Master supports run, resume, status and verify.');
    loadMasterCatalog();
    options.batch=readJson(join(ROOT,REGISTRY)).master.readyBatch;
  }
  if (existsSync(join(ROOT,REGISTRY))) {
    options.batch ??= activeRegisteredBatch();
    if (options.batch === 'rlp-b01'||Object.hasOwn(readJson(join(ROOT,REGISTRY)).historicalBatches??{},options.batch)) {
      if (!['run','resume','status','verify'].includes(options.command)) throw new Error('Historical batch is read-only.');
      const history=historicalBatchStatus(ROOT,options.batch);
      console.log(JSON.stringify(masterRequested?masterStatus(ROOT,history):history,null,2)); return;
    }
  }
  if (options.batch && options.batch !== 'rlp-b01') {
    loadRegisteredBatch(ROOT,options.batch);
    process.env.LMPS_RALPH_BATCH = options.batch;
    if (!process.argv.includes('--home')) options.home = 'plusb';
  }
  if (options.batch === 'rlp-b01') process.env.LMPS_RALPH_BATCH = 'rlp-b01';
  if (options.handoff && !options.batch && !existsSync(join(ROOT, '.local/ralph/batches/rlp-b01/approved.json'))) throw new Error('Manual handoff requires an approved implementation batch.');
  if (options.batch || (['run', 'resume', 'status', 'verify'].includes(options.command) && existsSync(join(ROOT, '.local/ralph/batches/rlp-b01/approved.json')))) {
    const { launchBatch } = await import('./batch-policy.mjs');
    const result=await launchBatch(options);
    console.log(JSON.stringify(masterRequested?masterStatus(ROOT,result):result, null, 2));
    return;
  }
  let result;
  if (options.command === 'status') result = status();
  else if (options.command === 'recover-lock') result = recoverLock();
  else if (options.command === 'checkpoint') {
    const release = takeLock();
    try {
      const original = preserveOriginals();
      const map = verifyMap();
      const tracker = readTracker();
      verifyConfiguration();
      writeJson(join(ROOT, STATE_DIRECTORY, 'checkpoint.json'), { format: 1, reviewedAt: new Date().toISOString(), snapshot: sourceSnapshot(), definitionSha256: digest(trackerDefinition(tracker)) });
      result = { status: 'checkpointed', ...map, originalFiles: original.originalFiles, noCommit: true };
    } finally { release(); }
  } else if (options.command === 'verify') result = verifyIntake();
  else result = await execute(options);
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(`STOP: ${error.message}`);
    process.exitCode = EXIT.state;
  });
}
