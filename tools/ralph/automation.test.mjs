import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { buildCodexArguments, classifyFailure, runAgent, validateReport } from './agent-adapter.mjs';
import { parseArguments, sessionAction } from './launch.mjs';
import { inventory, originalPlanDocuments, render, verifyMap } from './requirements.mjs';
import { EXIT, ROOT, STATE_DIRECTORY, TRACKER, assertCheckpoint, digest, environment, readJson, reconcile, sourceSnapshot, takeLock, toolchain, trackerDefinition, writeJson } from './state.mjs';
import { HOST_COMMAND_POLICY, TASKS, authorizedHostVerification, boundedQueue, buildBatchCodexArguments, handoffDecision, maintenanceBoundary, validateBatchReport, verificationTemporaryDirectory } from './batch-policy.mjs';
import { BATCH_TRACKER, batchSnapshot, changedFiles, fileHash, fixtureVerificationProfile, makeCandidate, probeSandbox, promote, recoverPromotion, restoreInstallerFormatting, assertVerificationCapacity, retireVerificationCache, retireCompletedDependencies } from './workspace.mjs';
import { REGISTRY, historicalBatchStatus, loadRegisteredBatch, validateManifest, validateMasterCatalog,loadMasterCatalog,masterStatus } from './batch-registry.mjs';

const FAKE = join(ROOT, 'tools/ralph/fixtures/fake-codex.mjs');
test('host fresh workspaces inherit private ancestors while sandbox scratch routing stays unchanged', t => {
  const candidate = mkdtempSync(join(ROOT, '.local/host-temp-routing-'));
  t.after(() => rmSync(candidate, { recursive: true, force: true }));
  const sandbox = '/private/tmp/lmps-ralph-reviewed-scratch';
  assert.equal(verificationTemporaryDirectory(candidate, sandbox, false), sandbox);
  const host = verificationTemporaryDirectory(candidate, sandbox, true);
  assert.equal(host, join(candidate, '.local/verification-tmp'));
  assert.equal(lstatSync(host).mode & 0o777, 0o700);
  assert.equal(verificationTemporaryDirectory(candidate, undefined, false), host);
  const child = spawnSync(process.execPath, ['--input-type=module', '-e',
    "import {tmpdir} from 'node:os';import {mkdtempSync} from 'node:fs';import {join} from 'node:path';process.stdout.write(mkdtempSync(join(tmpdir(),'fresh-copy-')));"],
    { cwd: candidate, env: { ...environment(), TMPDIR: host }, encoding: 'utf8', timeout: 5000 });
  assert.equal(child.status, 0, child.stderr); assert.equal(dirname(child.stdout), host);
  for (let path = child.stdout; ; path = dirname(path)) {
    const info = lstatSync(path); assert.equal(info.isSymbolicLink(), false); assert.equal(info.mode & 0o022, 0);
    if (path === dirname(path)) break;
  }
});
const report = {
  task_id: 'US-001', status: 'verified', must_items: 104, plan_documents: 11,
  production_ready: false, read_only: true,
  blocker_codes: ['SOURCE_SEMANTICS', 'ACCOUNT_IDENTITY', 'HISTORICAL_AVAILABILITY', 'REAL_LABELS', 'PRODUCTION_APPROVAL'],
};

async function fake(mode, options = {}) {
  const emitted = [];
  let verificationCalls = 0;
  const result = await runAgent({
    executable: process.execPath, arguments_: [FAKE, mode], prompt: 'invented task', cwd: ROOT,
    env: environment(), emit: event => emitted.push(event),
    verify: () => { verificationCalls++; return { independentCheck: true }; },
    ...options,
  });
  return { result, emitted, verificationCalls };
}

function fixture(context) {
  const parent = mkdtempSync(join(realpathSync(tmpdir()), 'lmps-ralph-test-'));
  context.after(() => rmSync(parent, { recursive: true, force: true }));
  const root = join(parent, 'repo');
  mkdirSync(join(root, 'tasks/ralph'), { recursive: true });
  mkdirSync(join(parent, 'plan'));
  execFileSync('/opt/homebrew/bin/git', ['init', '--quiet', '-b', 'main'], { cwd: root });
  writeFileSync(join(root, '.gitignore'), '.local/\n.ralph-tui/*.json\n');
  writeFileSync(join(root, 'application.txt'), 'original user work\n');
  writeFileSync(join(parent, 'plan/README.md'), 'original plan\n');
  const tracker = { name: 'Invented test pilot', branchName: 'main', userStories: [{ id: 'US-001', title: 'audit', description: 'read only', acceptanceCriteria: ['check'], priority: 1, dependsOn: [], passes: false }] };
  writeFileSync(join(root, TRACKER), JSON.stringify(tracker));
  const snapshot = sourceSnapshot(root);
  writeJson(join(root, STATE_DIRECTORY, 'checkpoint.json'), { snapshot, definitionSha256: digest(trackerDefinition(tracker)) });
  const receipt = { taskId: 'US-001', status: 'verified', definitionSha256: digest(trackerDefinition(tracker)), planSha256: digest(snapshot.plan) };
  return { root, parent, tracker, receipt };
}

test('all104 requirements and historical ledger entries remain traceable without rescore', () => {
  const rows = inventory();
  assert.equal(rows.length, 104);
  assert.equal(new Set(rows.map(row => row.id)).size, 104);
  assert.equal(verifyMap().mustItems, 104);
  assert.match(render(), /historical statements below are retained/);
  assert.match(render(), /No.42-50/);
});

test('reviewed Portal supplement preserves the original eleven-document requirements map', context => {
  const { root, parent } = fixture(context);
  const originals = originalPlanDocuments();
  for (const name of originals) writeFileSync(join(parent, 'plan', name), 'original plan\n');
  assert.deepEqual(originalPlanDocuments(root), originals);
  writeFileSync(join(parent, 'plan/portal-mock-inventory-2026-10-27.md'), 'supplement only\n');
  assert.deepEqual(originalPlanDocuments(root), originals);
  assert.equal(verifyMap().planDocuments, 11);
});

test('a supplement cannot replace a missing original even when document counts match', context => {
  const { root, parent } = fixture(context);
  const originals = originalPlanDocuments();
  for (const name of originals) writeFileSync(join(parent, 'plan', name), 'original plan\n');
  rmSync(join(parent, 'plan', originals[0]));
  writeFileSync(join(parent, 'plan/portal-mock-inventory-2026-10-27.md'), 'supplement only\n');
  assert.throws(() => originalPlanDocuments(root), /inventory changed/);
});

test('unknown plan additions and nonregular original or supplemental documents fail closed', context => {
  const { root, parent } = fixture(context);
  const originals = originalPlanDocuments();
  for (const name of originals) writeFileSync(join(parent, 'plan', name), 'original plan\n');
  const unknown = join(parent, 'plan/unreviewed.md');
  writeFileSync(unknown, 'not reviewed\n');
  assert.throws(() => originalPlanDocuments(root), /inventory changed/);
  rmSync(unknown);
  for (const name of [originals[0], 'portal-mock-inventory-2026-10-27.md']) {
    const path = join(parent, 'plan', name);
    rmSync(path, {force: true});
    symlinkSync(join(parent, 'plan/README.md'), path);
    assert.throws(() => originalPlanDocuments(root), /inventory changed/);
    rmSync(path);
    writeFileSync(path, 'restored regular document\n');
  }
});

test('one valid final report triggers independent verification exactly once', async () => {
  const { result, verificationCalls, emitted } = await fake('success');
  assert.equal(result.status, 'verified');
  assert.equal(verificationCalls, 1);
  assert.equal(emitted.some(event => JSON.stringify(event).includes('<promise>')), false);
});

test('fragmented JSONL records are reassembled before report validation', async () => {
  assert.equal((await fake('fragmented')).result.status, 'verified');
});

test('quota in structured stdout is distinct, redacted and never retried', async () => {
  const { result, verificationCalls, emitted } = await fake('quota');
  assert.equal(result.status, 'quota');
  assert.equal(result.exitCode, EXIT.quota);
  assert.ok(result.retryAt);
  assert.equal(verificationCalls, 0);
  assert.doesNotMatch(JSON.stringify({ result, emitted }), /do-not-print/);
});

test('quota-looking source/tool output is not mistaken for a provider failure', async () => {
  assert.equal((await fake('success')).result.status, 'verified');
});

test('coding, authentication and network failures remain distinct', async () => {
  assert.equal((await fake('coding')).result.status, 'failed');
  assert.equal((await fake('authentication')).result.status, 'authentication');
  assert.equal((await fake('network')).result.status, 'network');
});

test('clean exit with a question is incomplete, never complete', async () => {
  const { result, verificationCalls } = await fake('incomplete');
  assert.equal(result.status, 'verification-failed');
  assert.equal(verificationCalls, 0);
});

test('completion text in a tool response cannot mark a task complete', async () => {
  const { result, verificationCalls } = await fake('forged-marker');
  assert.equal(result.status, 'incomplete');
  assert.equal(verificationCalls, 0);
});

test('early completion followed by quota remains an unfinished quota failure', async () => {
  const { result, verificationCalls, emitted } = await fake('early-marker');
  assert.equal(result.status, 'quota');
  assert.equal(verificationCalls, 0);
  assert.doesNotMatch(JSON.stringify(emitted), /COMPLETE/);
});

test('wrong report and failed independent checks never produce verified evidence', async () => {
  assert.equal((await fake('wrong-report')).result.status, 'verification-failed');
  assert.equal((await fake('success', { verify: () => { throw new Error('invented failing test'); } })).result.status, 'verification-failed');
});

test('malformed agent output stops safely', async () => {
  assert.notEqual((await fake('malformed')).result.exitCode, 0);
});

test('a child ignoring termination is killed after a bounded timeout', async () => {
  const started = Date.now();
  const { result } = await fake('hang', { timeout: 150 });
  assert.equal(result.status, 'timeout');
  assert.ok(Date.now() - started < 6000);
});

test('interruption is forwarded without completion or retry', async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 100);
  const { result, verificationCalls } = await fake('hang', { signal: controller.signal });
  clearTimeout(timer);
  assert.equal(result.status, 'interrupted');
  assert.equal(verificationCalls, 0);
});

test('retry time is used only when explicit and bounded; ordinary code errors are not quota', () => {
  const now = Date.UTC(2026, 9, 25);
  assert.equal(classifyFailure({ code: 'usage_limit_reached', retry_after_seconds: 60 }, now).retryAt, '2026-10-25T00:01:00.000Z');
  assert.equal(classifyFailure({ code: 'usage_limit_reached' }, now).retryAt, null);
  assert.equal(classifyFailure({ code: 'usage_limit_reached', retry_after_seconds: 1e12 }, now).retryAt, null);
  assert.equal(classifyFailure('TypeScript assertion failed').kind, 'failed');
});

test('report validation preserves all target blockers and rejects fabricated readiness', () => {
  assert.equal(validateReport(JSON.stringify(report)).production_ready, false);
  assert.throws(() => validateReport(JSON.stringify({ ...report, production_ready: true })));
  assert.throws(() => validateReport(JSON.stringify({ ...report, blocker_codes: [] })));
});

test('Codex invocation explicitly keeps sandbox and approval restrictions, without auth commands', () => {
  const args = buildCodexArguments();
  assert.deepEqual(args.slice(0, 3), ['-a', 'never', 'exec']);
  assert.equal(args[args.indexOf('--sandbox') + 1], 'read-only');
  for (const forbidden of ['login', 'logout', '--full-auto', '--dangerously-bypass-approvals-and-sandbox']) assert.equal(args.includes(forbidden), false);
  assert.ok(args.includes('--ignore-user-config'));
});

test('selected environment reuses one home without inheriting API/provider credentials', () => {
  const variable = ['INVENTED', 'API', 'KEY'].join('_');
  const previous = process.env[variable];
  process.env[variable] = 'do-not-print';
  try {
    const env = environment(ROOT, 'plusd');
    assert.ok(env.CODEX_HOME.endsWith('/.codex-plusd'));
    assert.equal(env[variable], undefined);
    assert.equal(env.OPENAI_API_KEY, undefined);
    assert.throws(() => environment(ROOT, 'rotate'));
  } finally {
    if (previous === undefined) delete process.env[variable];
    else process.env[variable] = previous;
  }
});

test('launcher rejects unlimited iteration, forced locks and arbitrary commands', () => {
  assert.deepEqual(parseArguments(['run', '--home', 'plusd', '--headless']), { command: 'run', home: 'plusd', headless: true });
  for (const args of [['logout'], ['run', '--iterations', '0'], ['run', '--force'], ['run', '--home', 'unknown']]) assert.throws(() => parseArguments(args));
});

test('session recovery distinguishes interruption from failed/completed sessions', () => {
  assert.equal(sessionAction(null, 'run'), 'run');
  assert.equal(sessionAction({ status: 'interrupted', currentIteration: 0, maxIterations: 1 }, 'resume'), 'resume');
  assert.equal(sessionAction({ status: 'failed' }, 'resume'), 'restart');
  assert.equal(sessionAction({ status: 'completed' }, 'resume'), 'restart');
  assert.equal(sessionAction({ status: 'interrupted', currentIteration: 1, maxIterations: 1 }, 'resume'), 'restart');
});

test('a second launcher cannot overwrite a live lock', context => {
  const { root } = fixture(context);
  const release = takeLock(root);
  assert.throws(() => takeLock(root), /lock exists/);
  release();
  const releaseAgain = takeLock(root);
  releaseAgain();
});

test('a stale lock is not automatically stolen', context => {
  const { root } = fixture(context);
  writeJson(join(root, STATE_DIRECTORY, 'launcher.lock'), { pid: 99999999, token: 'invented-dead-owner' });
  assert.throws(() => takeLock(root), /lock exists/);
});

test('source or plan edits require reconciliation before any agent execution', context => {
  const { root, parent } = fixture(context);
  assertCheckpoint(root);
  writeFileSync(join(root, 'application.txt'), 'unrelated user edit\n');
  assert.throws(() => assertCheckpoint(root), /changed/);
  writeFileSync(join(root, 'application.txt'), 'original user work\n');
  writeFileSync(join(parent, 'plan/README.md'), 'updated plan\n');
  assert.throws(() => assertCheckpoint(root), /changed/);
});

test('verified receipt repairs crash-before-tracker-update without repeating work', context => {
  const { root, receipt } = fixture(context);
  writeJson(join(root, STATE_DIRECTORY, 'receipt.json'), receipt);
  assert.equal(reconcile(root).trackerRepairNeeded, true);
  assert.equal(reconcile(root, true).complete, true);
  assert.equal(readJson(join(root, TRACKER)).userStories[0].passes, true);
  assert.equal(reconcile(root).trackerRepairNeeded, false);
});

test('completed tracker without receipt is rejected, preserving user edits', context => {
  const { root, tracker } = fixture(context);
  tracker.userStories[0].passes = true;
  writeFileSync(join(root, TRACKER), JSON.stringify(tracker));
  assert.throws(() => reconcile(root), /without a verification receipt/);
});

test('task edits, unknown tasks and mismatched receipts cannot be resumed silently', context => {
  const { root, tracker, receipt } = fixture(context);
  tracker.userStories[0].description = 'new unapproved feature';
  writeFileSync(join(root, TRACKER), JSON.stringify(tracker));
  assert.throws(() => reconcile(root), /definition changed/);
  tracker.userStories[0].description = 'read only';
  writeFileSync(join(root, TRACKER), JSON.stringify(tracker));
  writeJson(join(root, STATE_DIRECTORY, 'receipt.json'), { ...receipt, taskId: 'US-999' });
  assert.throws(() => reconcile(root), /does not match/);
});

test('installed Ralph stops after one simulated quota failure and leaves task pending', context => {
  const parent = mkdtempSync(join(realpathSync(tmpdir()), 'lmps-ralph-engine-'));
  context.after(() => rmSync(parent, { recursive: true, force: true }));
  mkdirSync(join(parent, '.ralph-tui'));
  execFileSync('/opt/homebrew/bin/git', ['init', '--quiet', '-b', 'main'], { cwd: parent });
  const agent = join(parent, 'invented-agent.mjs');
  writeFileSync(agent, '#!/usr/bin/env node\nimport {appendFileSync,readFileSync} from "node:fs";if(process.argv.includes("--version")){console.log("codex-cli 0.164.0");}else{readFileSync(0,"utf8");appendFileSync("calls.txt","one\\n");console.error("usage limit exceeded");console.log(JSON.stringify({type:"turn.failed",error:{code:"usage_limit_reached"}}));process.exitCode=75;}\n');
  chmodSync(agent, 0o700);
  writeFileSync(join(parent, 'prd.json'), JSON.stringify({ name: 'Invented quota test', branchName: 'main', userStories: [{ id: 'US-001', title: 'invented', description: 'No real authentication or source access.', acceptanceCriteria: ['never complete'], passes: false, priority: 1 }] }));
  writeFileSync(join(parent, '.ralph-tui/config.toml'), `configVersion = "2.1"\nagent = "codex"\ncommand = "${agent}"\ntracker = "json"\nautoCommit = false\nfallbackAgents = []\n[agentOptions]\nfullAuto = false\nsandbox = "read-only"\n[rateLimitHandling]\nenabled = true\nmaxRetries = 0\nrecoverPrimaryBetweenIterations = false\n[errorHandling]\nstrategy = "abort"\nmaxRetries = 0\n`);
  const result = spawnSync('/opt/homebrew/bin/ralph-tui', ['run', '--cwd', parent, '--agent', 'codex', '--prd', join(parent, 'prd.json'), '--serial', '--iterations', '1', '--headless', '--no-setup'], { cwd: parent, env: { ...environment(), HOME: parent, CODEX_HOME: join(parent, 'invented-unused-home') }, encoding: 'utf8', timeout: 45000, maxBuffer: 1024 * 1024 });
  assert.equal(result.error, undefined, 'Installed Ralph should finish within a bounded timeout.');
  assert.doesNotMatch(result.stdout + result.stderr, /Upgrading ralph-tui configuration|Installing bundled skills/);
  assert.equal(existsSync(join(parent, 'calls.txt')), true, result.stderr);
  assert.equal(readFileSync(join(parent, 'calls.txt'), 'utf8'), 'one\n');
  assert.equal(JSON.parse(readFileSync(join(parent, 'prd.json'), 'utf8')).userStories[0].passes, false);
});

test('approved batch is explicit and finite; old pilot arguments retain their behavior', () => {
  assert.deepEqual(parseArguments(['run', '--batch', 'rlp-b01', '--headless']), { command: 'run', home: 'plusd', headless: true, batch: 'rlp-b01' });
  assert.throws(() => parseArguments(['run', '--batch', 'anything']));
  assert.equal(TASKS.length, 5);
  assert.deepEqual(TASKS.map(row => row.dependsOn), [[], ['US-101'], ['US-102'], ['US-103'], ['US-104']]);
});

for (const failure of ['quota', 'coding', 'batch-blocked']) test(`bounded queue stops at third task on ${failure}; resume skips verified tasks`, async () => {
  const calls = [], completed = [];
  const execute = async (task, mode) => {
    calls.push(task.id);
    const result = await runAgent({ executable: process.execPath, arguments_: [FAKE, mode, task.id], prompt: 'synthetic fixture', cwd: ROOT, env: environment(), validate: text => validateBatchReport(text, task.id), verify: () => { completed.push(task.id); return { trusted: true }; } });
    return result;
  };
  const first = await boundedQueue(TASKS, [], task => execute(task, task.id === 'US-103' ? failure : 'batch-success'));
  assert.notEqual(first.status, 'verified');
  assert.deepEqual(calls, ['US-101', 'US-102', 'US-103']);
  assert.deepEqual(completed, ['US-101', 'US-102']);
  calls.length = 0;
  const resumed = await boundedQueue(TASKS, completed, task => execute(task, 'batch-success'));
  assert.equal(resumed.status, 'verified');
  assert.deepEqual(calls, ['US-103', 'US-104', 'US-105']);
});

function batchFixture(context) {
  const base = fixture(context);
  mkdirSync(dirnamePath(join(base.root, BATCH_TRACKER)), { recursive: true });
  writeFileSync(join(base.root, BATCH_TRACKER), JSON.stringify({ name: 'invented batch', userStories: [] }));
  const baseline = batchSnapshot(base.root);
  const directory = join(base.root, '.local/task');
  const candidate = makeCandidate(base.root, directory, baseline);
  return { ...base, baseline, directory, candidate };
}

function dirnamePath(path) { return path.slice(0, path.lastIndexOf('/')); }

test('candidate contains source and plan but excludes auth, environment and private state', context => {
  const { root, candidate } = batchFixture(context);
  assert.equal(readFileSync(join(candidate, 'application.txt'), 'utf8'), 'original user work\n');
  assert.equal(existsSync(join(candidate, '.local/task')), false);
  assert.equal(existsSync(join(candidate, '.env')), false);
  assert.equal(existsSync(join(candidate, '.codex')), false);
  assert.equal(readFileSync(join(root, 'application.txt'), 'utf8'), 'original user work\n');
});

test('protected source changes and symlink escapes fail the publication gate', context => {
  const { root, parent, candidate, baseline } = batchFixture(context);
  writeFileSync(join(candidate, 'application.txt'), 'unapproved');
  assert.throws(() => changedFiles(root, candidate, baseline, ['new.ts'], 'US-101'), /protected/);
  rmSync(join(candidate, 'application.txt'));
  symlinkSync(join(parent, 'plan/README.md'), join(candidate, 'application.txt'));
  assert.throws(() => changedFiles(root, candidate, baseline, ['application.txt'], 'US-101'), /Unsafe/);
});

test('manifest guard rejects hidden scripts and dependency changes', context => {
  const { root } = fixture(context);
  mkdirSync(join(root, 'packages/contracts'), { recursive: true });
  mkdirSync(dirnamePath(join(root, BATCH_TRACKER)), { recursive: true });
  const manifest = { exports: {}, scripts: { test: 'original-check' }, dependencies: {} };
  writeFileSync(join(root, 'packages/contracts/package.json'), JSON.stringify(manifest));
  writeFileSync(join(root, BATCH_TRACKER), '{}');
  const baseline = batchSnapshot(root);
  const candidate = makeCandidate(root, join(root, '.local/task'), baseline);
  const next = structuredClone(manifest);
  next.exports['./pretransfer-simulation'] = { types: './dist/pretransfer-simulation.d.ts', import: './dist/pretransfer-simulation.js' };
  writeFileSync(join(candidate, 'packages/contracts/package.json'), JSON.stringify(next));
  assert.equal(changedFiles(root, candidate, baseline, ['packages/contracts/package.json'], 'US-101').length, 1);
  next.scripts.test = 'true';
  writeFileSync(join(candidate, 'packages/contracts/package.json'), JSON.stringify(next));
  assert.throws(() => changedFiles(root, candidate, baseline, ['packages/contracts/package.json'], 'US-101'), /Protected manifest/);
});

test('concurrent user edit prevents promotion and is preserved', context => {
  const { root, candidate, baseline, directory } = batchFixture(context);
  writeFileSync(join(candidate, 'application.txt'), 'approved candidate');
  const changes = changedFiles(root, candidate, baseline, ['application.txt'], 'US-101');
  writeFileSync(join(root, 'application.txt'), 'new user work');
  assert.throws(() => promote(root, candidate, directory, baseline, changes, { checks: [] }), /Original source changed/);
  assert.equal(readFileSync(join(root, 'application.txt'), 'utf8'), 'new user work');
});

test('durable partial promotion recovers once; later user conflict is never overwritten', context => {
  const { root, candidate, baseline, directory } = batchFixture(context);
  writeFileSync(join(candidate, 'application.txt'), 'approved candidate');
  writeFileSync(join(candidate, 'new.ts'), 'synthetic addition');
  const changes = changedFiles(root, candidate, baseline, ['application.txt', 'new.ts'], 'US-101');
  writeJson(join(directory, 'promotion.json'), { status: 'prepared', baseline, changes, candidate, evidence: { checks: [] }, applied: [] });
  writeFileSync(join(root, 'application.txt'), 'approved candidate');
  const recovered = recoverPromotion(root, directory);
  assert.equal(recovered.status, 'promoted');
  assert.equal(readFileSync(join(root, 'new.ts'), 'utf8'), 'synthetic addition');
  assert.equal(recoverPromotion(root, directory).status, 'promoted');
  writeFileSync(join(root, 'application.txt'), 'user follow-up');
  assert.throws(() => recoverPromotion(root, directory), /conflicts with user work/);
  assert.equal(readFileSync(join(root, 'application.txt'), 'utf8'), 'user follow-up');
});

test('installed sandbox permits candidate writes and denies outside writes including symlinks', context => {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), 'lmps-boundary-'));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  assert.equal(probeSandbox(ROOT, directory).passed, true);
});

test('installed Ralph runs two verified tasks then stops at quota without invoking successors', context => {
  const parent = mkdtempSync(join(realpathSync(tmpdir()), 'lmps-batch-engine-'));
  context.after(() => rmSync(parent, { recursive: true, force: true }));
  mkdirSync(join(parent, '.ralph-tui'));
  execFileSync('/opt/homebrew/bin/git', ['init', '--quiet', '-b', 'main'], { cwd: parent });
  const agent = join(parent, 'agent.mjs');
  writeFileSync(agent, '#!/usr/bin/env node\nimport{readFileSync,appendFileSync}from"node:fs";if(process.argv.includes("--version")){console.log("codex-cli 0.164.0")}else{const p=readFileSync(0,"utf8"),id=p.match(/RALPH_TASK_ID=(US-\\d+)/)?.[1];appendFileSync("calls.txt",id+"\\n");if(id==="US-103"){console.log(JSON.stringify({type:"turn.failed",error:{code:"usage_limit_reached"}}));process.exitCode=75}else{console.log(JSON.stringify({type:"item.completed",item:{type:"agent_message",text:"<promise>COMPLETE</promise>"}}))}}\n');
  chmodSync(agent, 0o700);
  writeFileSync(join(parent, 'prd.json'), JSON.stringify({ name: 'synthetic bounded batch', branchName: 'main', userStories: TASKS.map((task, index) => ({ id: task.id, title: task.id, description: 'Synthetic fixture only', acceptanceCriteria: ['independent receipt required'], passes: false, priority: index + 1, dependsOn: task.dependsOn })) }));
  writeFileSync(join(parent, 'prompt.hbs'), 'RALPH_TASK_ID={{taskId}}\n');
  writeFileSync(join(parent, '.ralph-tui/config.toml'), `configVersion = "2.1"\nagent = "codex"\ncommand = "${agent}"\ntracker = "json"\nautoCommit = false\nfallbackAgents = []\n[agentOptions]\nfullAuto = false\nsandbox = "read-only"\n[rateLimitHandling]\nenabled = true\nmaxRetries = 0\n[errorHandling]\nstrategy = "abort"\nmaxRetries = 0\n`);
  const result = spawnSync('/opt/homebrew/bin/ralph-tui', ['run', '--cwd', parent, '--prd', join(parent, 'prd.json'), '--prompt', join(parent, 'prompt.hbs'), '--serial', '--iterations', '5', '--headless', '--no-setup'], { cwd: parent, env: { ...environment(), HOME: parent, CODEX_HOME: join(parent, 'unused') }, timeout: 60000, encoding: 'utf8', maxBuffer: 1024 * 1024 });
  assert.equal(result.error, undefined);
  assert.doesNotMatch(result.stdout + result.stderr, /Upgrading ralph-tui configuration|Installing bundled skills/);
  assert.equal(readFileSync(join(parent, 'calls.txt'), 'utf8'), 'US-101\nUS-102\nUS-103\n');
  assert.deepEqual(readJson(join(parent, 'prd.json')).userStories.map(task => task.passes), [true, true, false, false, false]);
});

test('trusted offline setup restores only equivalent JSON formatting and rejects semantic changes', context => {
  const { root } = fixture(context);
  mkdirSync(dirnamePath(join(root, BATCH_TRACKER)), { recursive: true });
  writeFileSync(join(root, BATCH_TRACKER), '{}');
  writeFileSync(join(root, 'package.json'), '{\n "name": "synthetic-fixture", "private": true\n}\n');
  const baseline = batchSnapshot(root);
  const candidate = makeCandidate(root, join(root, '.local/setup-test'), baseline);
  writeFileSync(join(candidate, 'package.json'), JSON.stringify(readJson(join(root, 'package.json'))));
  restoreInstallerFormatting(root, candidate, baseline);
  assert.equal(readFileSync(join(candidate, 'package.json'), 'utf8'), readFileSync(join(root, 'package.json'), 'utf8'));
  writeFileSync(join(candidate, 'package.json'), '{"name":"synthetic-fixture","private":false}');
  assert.throws(() => restoreInstallerFormatting(root, candidate, baseline), /semantics/);
});

test('candidate Git fsmonitor cannot execute during host inventory', context => {
  const { root, candidate, baseline, directory } = batchFixture(context);
  const hook = join(directory, 'fsmonitor.sh'), marker = join(directory, 'unexpected-effect');
  writeFileSync(hook, '#!/bin/sh\ntouch "' + marker + '"\n', { mode: 0o700 });
  execFileSync('/opt/homebrew/bin/git', ['config', 'core.fsmonitor', hook], { cwd: candidate });
  writeFileSync(join(candidate, 'application.txt'), 'approved synthetic update');
  assert.equal(changedFiles(root, candidate, baseline, ['application.txt'], 'US-101').length, 1);
  assert.equal(existsSync(marker), false);
});

test('resume accepts only the Ralph-owned tracker timestamp, never task or completion changes', context => {
  const { root, candidate, baseline } = batchFixture(context);
  const tracker = { name: 'invented batch', userStories: [], metadata: { createdAt: 'fixed', updatedAt: 'first' } };
  writeFileSync(join(candidate, BATCH_TRACKER), JSON.stringify(tracker));
  writeFileSync(join(root, BATCH_TRACKER), JSON.stringify({ ...tracker, metadata: { ...tracker.metadata, updatedAt: 'second' } }));
  writeFileSync(join(candidate, 'application.txt'), 'approved fixture change');
  assert.equal(changedFiles(root, candidate, baseline, ['application.txt'], 'US-103').length, 1);
  tracker.userStories.push({ id: 'US-103', passes: true });
  writeFileSync(join(candidate, BATCH_TRACKER), JSON.stringify(tracker));
  assert.throws(() => changedFiles(root, candidate, baseline, ['application.txt'], 'US-103'), /tracker changed/);
});

test('maintenance preserves old receipt boundaries and cannot authorize application or plan changes', () => {
  const before = { source: [{ name: 'tools/ralph/workspace.mjs', sha256: 'old', mode: 420 }, { name: 'app.ts', sha256: 'original', mode: 420 }], plan: [{ name: 'PLAN.md', sha256: 'original' }], branch: 'main', head: null, indexSha256: 'empty' };
  const after = structuredClone(before); after.source[0].sha256 = 'new';
  const record = { before, after, fromPolicy: 'old-policy', toPolicy: 'new-policy', changedFiles: ['tools/ralph/workspace.mjs'], checks: { passed: true, testCount: 42 } };
  assert.deepEqual(maintenanceBoundary(before, 'old-policy', record), { expected: after, policy: 'new-policy' });
  assert.throws(() => maintenanceBoundary(before, 'wrong-policy', record), /invalid/);
  const malicious = structuredClone(record); malicious.after.source[1].sha256 = 'changed';
  assert.throws(() => maintenanceBoundary(before, 'old-policy', malicious), /application/);
  const planChange = structuredClone(record); planChange.after.plan[0].sha256 = 'changed';
  assert.throws(() => maintenanceBoundary(before, 'old-policy', planChange), /plan/);
  const ciBefore = structuredClone(before); ciBefore.source[0].name = 'ci/verify.py';
  const ciAfter = structuredClone(ciBefore); ciAfter.source[0].sha256 = 'reviewed-timeout-fix';
  const ciRecord = { ...record, before: ciBefore, after: ciAfter, changedFiles: ['ci/verify.py'] };
  assert.deepEqual(maintenanceBoundary(ciBefore, 'old-policy', ciRecord), { expected: ciAfter, policy: 'new-policy' });
  const unrelated = structuredClone(ciRecord); unrelated.changedFiles = ['ci/security.py'];
  assert.throws(() => maintenanceBoundary(ciBefore, 'old-policy', unrelated), /invalid/);
  const fixtureBefore = structuredClone(before); fixtureBefore.source[0].name = 'apps/risk-workers/test/feature-stream-spike.test.mjs';
  const fixtureAfter = structuredClone(fixtureBefore); fixtureAfter.source[0].sha256 = 'reviewed-raw-traversal-fixture';
  const fixtureRecord = { ...record, before: fixtureBefore, after: fixtureAfter, changedFiles: ['apps/risk-workers/test/feature-stream-spike.test.mjs'] };
  assert.deepEqual(maintenanceBoundary(fixtureBefore, 'old-policy', fixtureRecord), { expected: fixtureAfter, policy: 'new-policy' });
  for (const name of ['apps/risk-workers/scripts/feature-stream-spike.mjs', 'apps/risk-workers/test/feature-stream-consumer.test.mjs']) {
    const forbidden = structuredClone(fixtureRecord); forbidden.changedFiles = [name];
    assert.throws(() => maintenanceBoundary(fixtureBefore, 'old-policy', forbidden), /invalid/);
  }
});

test('reviewed monitoring plan transition rejects unreviewed scope and preserves its inputs', context => {
  const { root, parent } = fixture(context);
  mkdirSync(join(root, 'apps/risk-api/src'), { recursive: true });
  const name = 'apps/risk-api/src/overview.controller.ts';
  writeFileSync(join(root, name), 'previous calendar');
  const before = sourceSnapshot(root);
  writeFileSync(join(root, name), 'reviewed calendar');
  writeFileSync(join(parent, 'plan/README.md'), 'automatic monitoring plan');
  const after = sourceSnapshot(root);
  const pending = [{ id: 'US-902', files: ['apps/risk-workers/scripts/feature-streams-candidate.mjs'] }];
  const record = { kind: 'source-plan-review', authorization: 'explicit-user-approval', scope: 'monitoring', productionReady: false, beforeTask: 'US-902', before, after, fromPolicy: 'old', toPolicy: 'new', changedFiles: [], sourceChanges: [name], planChanges: ['README.md'], taskMapping: [{ id: 'US-902', requirements: ['P04-02', 'P04-03'] }], checks: { passed: true, testCount: 70 } };
  const original = structuredClone(record);
  assert.deepEqual(maintenanceBoundary(before, 'old', record, pending), { expected: after, policy: 'new' });
  assert.deepEqual(record, original);
  for (const changes of [{ authorization: 'agent-request' }, { beforeTask: 'US-901' }, { productionReady: true }, { sourceChanges: [] }, { planChanges: [] }, { taskMapping: [] }, { checks: { passed: true } }, { after: { ...after, head: 'unreviewed-commit' } }, { after: { ...after, plan: [] } }]) {
    assert.throws(() => maintenanceBoundary(before, 'old', { ...record, ...changes }, pending));
  }
  assert.throws(() => maintenanceBoundary(before, 'old', record, [{ ...pending[0], files: [name] }]), /protected scope/);
  assert.throws(() => maintenanceBoundary(before, 'old', { ...record, kind: undefined }, pending), /application/);
  const forged = structuredClone(record);
  forged.after.source.push({ name: 'tools/ralph/state.mjs', sha256: 'invented', mode: 420 });
  forged.sourceChanges = [...record.sourceChanges, 'tools/ralph/state.mjs'].sort();
  assert.throws(() => maintenanceBoundary(before, 'old', forged, pending), /protected scope/);
  const dependency = structuredClone(record);
  dependency.after.source.push({ name: 'apps/risk-api/package.json', sha256: 'invented', mode: 420 });
  dependency.sourceChanges = [...record.sourceChanges, 'apps/risk-api/package.json'].sort();
  assert.throws(() => maintenanceBoundary(before, 'old', dependency, pending), /protected scope/);
  const deleted = structuredClone(record);
  deleted.after.source = deleted.after.source.filter(row => row.name !== name);
  assert.throws(() => maintenanceBoundary(before, 'old', deleted, pending), /protected scope/);
});

test('blocked structured notes persist while host verification is never called', async () => {
  let invoked = false;
  const result = await runAgent({ executable: process.execPath, arguments_: [FAKE, 'batch-blocked', 'US-103'], prompt: 'invented task', cwd: ROOT, env: environment(), validate: text => validateBatchReport(text, 'US-103'), verify: () => { invoked = true; } });
  assert.equal(result.status, 'blocked');
  assert.equal(result.report.status, 'blocked');
  assert.equal(invoked, false);
});

test('local-fixture verifier permits localhost while denying remote traffic and writes to host guards', context => {
  const { root, candidate, directory } = batchFixture(context);
  const profile = fixtureVerificationProfile(ROOT, candidate, directory);
  context.after(() => rmSync(profile.temporary, { recursive: true, force: true }));
  const script = 'const f=require("fs"),n=require("net");(async()=>{for(const p of process.argv.slice(1)){let denied=false;try{f.writeFileSync(p,"unsafe")}catch(e){denied=["EPERM","EACCES"].includes(e.code)}if(!denied)throw Error("host write allowed")}const t=f.mkdtempSync("/tmp/lmps-fixture-check-");f.writeFileSync(t+"/owned.txt","synthetic");f.rmSync(t,{recursive:true});const s=n.createServer(c=>c.end("synthetic"));await new Promise((r,j)=>{s.on("error",j);s.listen(0,"127.0.0.1",r)});await new Promise((r,j)=>{const c=n.connect(s.address().port,"127.0.0.1");c.on("data",()=>{});c.on("end",r);c.on("error",j)});await new Promise(r=>s.close(r));await new Promise((r,j)=>{const c=n.connect({host:"192.0.2.1",port:443});c.setTimeout(1000,()=>{c.destroy();j(Error("remote not denied"))});c.on("error",e=>["EPERM","EACCES"].includes(e.code)?r():j(e));c.on("connect",()=>{c.destroy();j(Error("remote allowed"))})});console.log("LOCAL_FIXTURE_BOUNDARIES_VERIFIED")})().catch(()=>{console.log("FIXTURE_BOUNDARY_FAILED");process.exitCode=1});';
  const before = readFileSync(join(root, 'application.txt'), 'utf8');
  const configBefore = readFileSync(join(profile.codexHome, 'config.toml'), 'utf8');
  const result = spawnSync(toolchainForTest().codex, [...profile.arguments, process.execPath, '-e', script, join(root, 'application.txt'), join(profile.codexHome, 'config.toml')], { cwd: candidate, env: { ...environment(), HOME: profile.home, CODEX_HOME: profile.codexHome, TMPDIR: profile.temporary }, timeout: 15000, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /LOCAL_FIXTURE_BOUNDARIES_VERIFIED/);
  assert.equal(readFileSync(join(root, 'application.txt'), 'utf8'), before);
  assert.equal(readFileSync(join(profile.codexHome, 'config.toml'), 'utf8'), configBefore);
});

function toolchainForTest() { return { codex: '/Users/macbookpro/.nvm/versions/node/v24.19.0/bin/codex' }; }

test('host exception requires explicit approval for fixed tasks, proposal, policy and commands', () => {
  const approval = { authorization: 'explicit-user-approval', batchId: 'rlp-b01', mode: 'trusted-host-fixtures', taskIds: ['US-104', 'US-105'], policySha256: 'reviewed-policy', proposalSha256: 'reviewed-proposal', commandPolicySha256: HOST_COMMAND_POLICY };
  assert.equal(authorizedHostVerification(null, 'US-104', 'reviewed-policy', 'reviewed-proposal'), false);
  assert.equal(authorizedHostVerification(approval, 'US-103', 'reviewed-policy', 'reviewed-proposal'), false);
  assert.equal(authorizedHostVerification(approval, 'US-104', 'reviewed-policy', 'reviewed-proposal'), true);
  assert.equal(authorizedHostVerification(approval, 'US-105', 'reviewed-policy', 'reviewed-proposal'), true);
  for (const extra of [{ authorization: 'agent-request' }, { policySha256: 'changed' }, { proposalSha256: 'changed' }, { taskIds: ['US-103', 'US-104', 'US-105'] }, { commandPolicySha256: 'agent-shell-text' }]) {
    assert.throws(() => authorizedHostVerification({ ...approval, ...extra }, 'US-104', 'reviewed-policy', 'reviewed-proposal'), /approval/);
  }
});

test('host approval cannot broaden the centralized coding-agent permission arguments', () => {
  const args = buildBatchCodexArguments();
  assert.equal(args[args.indexOf('--sandbox') + 1], 'workspace-write');
  assert.deepEqual(args.slice(0, 3), ['-a', 'never', 'exec']);
  assert.ok(args.includes('--ignore-user-config') && args.includes('--ignore-rules'));
  assert.ok(args.includes('sandbox_workspace_write.exclude_tmpdir_env_var=true'));
  assert.ok(args.includes('sandbox_workspace_write.exclude_slash_tmp=true'));
  assert.doesNotMatch(args.join(' '), /danger-full-access|dangerously|--full-auto|login|logout|permission-profile/);
});

test('manual account handoff is an explicit resume-only launcher flag', () => {
  assert.deepEqual(parseArguments(['resume', '--batch', 'rlp-b01', '--home', 'plusb', '--handoff', '--headless']), { command: 'resume', home: 'plusb', headless: true, batch: 'rlp-b01', handoff: true });
  assert.throws(() => parseArguments(['run', '--handoff']), /explicit resume/);
  assert.throws(() => parseArguments(['status', '--handoff']), /explicit resume/);
  assert.throws(() => parseArguments(['resume', '--home', 'unreviewed', '--handoff']));
  assert.throws(() => parseArguments(['resume', '--handoff', '--force']));
});

test('quota never changes accounts implicitly; explicit handoff preserves prior state', () => {
  const previous = { selectedHome: 'plusd', lastStatus: 'quota', completed: ['US-101', 'US-102'] };
  const before = structuredClone(previous);
  for (const home of ['plusb', 'pluse']) {
    assert.throws(() => handoffDecision(previous, { command: 'resume', home }), /explicitly request/);
    assert.deepEqual(handoffDecision(previous, { command: 'resume', home, handoff: true }), { from: 'plusd', to: home });
  }
  assert.equal(handoffDecision(previous, { command: 'resume', home: 'plusd' }), null);
  assert.equal(handoffDecision(null, { command: 'run', home: 'plusb' }), null);
  assert.throws(() => handoffDecision(previous, { command: 'run', home: 'plusb', handoff: true }), /explicitly request/);
  assert.throws(() => handoffDecision(previous, { command: 'resume', home: 'other', handoff: true }), /Unknown/);
  assert.throws(() => handoffDecision({ selectedHome: '../unreviewed' }, { command: 'resume', home: 'plusb', handoff: true }), /requires review/);
  assert.deepEqual(previous, before);
});

test('anonymous verifier HOME preserves installed pinned tool paths without reading authentication', context => {
  const parent = mkdtempSync(join(realpathSync(tmpdir()), 'lmps-home-test-'));
  context.after(() => rmSync(parent, { recursive: true, force: true }));
  const script = 'const{toolchain}=await import(process.argv[1]);const{existsSync}=await import("node:fs");const t=toolchain();console.log(JSON.stringify({codex:t.codex,pnpm:t.pnpm,exists:existsSync(t.codex)&&existsSync(t.pnpm)}));';
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script, join(ROOT, 'tools/ralph/state.mjs')], { cwd: parent, env: { ...environment(), HOME: parent, CODEX_HOME: join(parent, 'unused-auth-home') }, encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 0);
  const actual = JSON.parse(result.stdout);
  assert.equal(actual.codex, toolchain().codex);
  assert.equal(actual.pnpm, toolchain().pnpm);
  assert.equal(actual.exists, true);
});

test('installed pnpm11 uses the private versioned store under an anonymous HOME', context => {
  const parent = mkdtempSync(join(realpathSync(tmpdir()), 'lmps-store-test-'));
  context.after(() => rmSync(parent, { recursive: true, force: true }));
  const cache = join(parent, 'private-store');
  const env = { ...environment(), HOME: parent, CODEX_HOME: join(parent, 'unused-auth-home'), COREPACK_HOME: join(userInfo().homedir, '.cache/node/corepack'), COREPACK_ENABLE_NETWORK: '0', pnpm_config_store_dir: cache };
  const result = spawnSync(toolchain().pnpm, ['store', 'path'], { cwd: ROOT, env, encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), join(cache, 'v11'));
});

function registryFixture(context) {
  const {root,parent} = fixture(context);
  mkdirSync(join(root,'tools/ralph'),{recursive:true});
  for (const name of ['state.mjs','workspace.mjs','batch-policy.mjs','batch-registry.mjs','agent-adapter.mjs','verification.mjs','requirements.mjs','launch.mjs','batch-response.schema.json']) writeFileSync(join(root,'tools/ralph',name),readFileSync(join(ROOT,'tools/ralph',name)));
  mkdirSync(join(root,'.ralph-tui'),{recursive:true});
  writeFileSync(join(root,'.ralph-tui/batch-prompt.hbs'),'fixture prompt');
  const historicalIds = ['US-101','US-102','US-103','US-104','US-105'];
  const oldTracker = {name:'completed predecessor',branchName:'main',userStories:historicalIds.map(id=>({id,passes:true}))};
  writeJson(join(root,'tasks/ralph/batches/rlp-b01.json'),oldTracker);
  const records = ['approved.json','maintenance.json','completion-audit.json',...historicalIds.map(id=>`tasks/${id}/receipt.json`)].map(name=>{
    const file=join(root,'.local/ralph/batches/rlp-b01',name);writeJson(file,{fixture:name,status:'verified'});return {name,sha256:digest(readFileSync(file))};
  });
  const seal={batchId:'rlp-b01',status:{status:'verified',batchId:'rlp-b01',completed:historicalIds,verifiedCount:5,remainingCount:0,nextTask:null},records,tracker:oldTracker,run:{selectedHome:'plusd'}};
  const sealFile=join(root,'.local/ralph/registry-preparation/b01-seal.json');writeJson(sealFile,seal);
  const manifest={version:1,batchId:'rlp-b02',predecessor:'rlp-b01',tracker:'tasks/ralph/batches/rlp-b02.json',document:'tasks/ralph/batches/rlp-b02.md',proposal:'.local/ralph/proposals/implementation-batch-002.md',tasks:[
    {id:'US-201',dependsOn:[],files:['packages/risk/src/fixture-one.ts'],checkGroup:'risk',edits:{}},
    {id:'US-202',dependsOn:['US-201'],files:['packages/risk/src/fixture-two.ts'],checkGroup:'risk',edits:{}},
  ]};
  const file=join(root,'tasks/ralph/batches/rlp-b02.manifest.json');writeJson(file,manifest);
  writeFileSync(join(root,manifest.document),'approved fixture document');
  mkdirSync(join(root,'.local/ralph/proposals'),{recursive:true});writeFileSync(join(root,manifest.proposal),'explicit test approval');
  const tracker={name:'approved fixture',branchName:'main',userStories:manifest.tasks.map((task,index)=>({id:task.id,title:task.id,description:'fixture',priority:index+1,acceptanceCriteria:Array(6).fill('independent fixture check'),dependsOn:task.dependsOn,passes:false}))};
  writeJson(join(root,manifest.tracker),tracker);
  writeJson(join(root,'.local/ralph/batches/rlp-b02/response.schema.json'),{type:'object'});
  const registration={authorization:'explicit-user-approval',manifestSha256:digest(readFileSync(file)),proposalSha256:digest(readFileSync(join(root,manifest.proposal))),predecessorSealSha256:digest(readFileSync(sealFile)),definitionSha256:digest(trackerDefinition(tracker))};
  writeJson(join(root,REGISTRY),{version:1,active:'rlp-b02',historicalSealSha256:registration.predecessorSealSha256,entries:{'rlp-b02':registration}});
  return {root,parent,manifest,registration};
}

test('registered manifests reject unreviewed commands, traversal, dependency cycles and extra permissions', context=>{
  const {manifest}=registryFixture(context);
  assert.equal(validateManifest(manifest,'rlp-b02').tasks.length,2);
  for (const mutate of [m=>m.tasks[0].dependsOn.push('US-202'),m=>m.tasks[0].files.push('../outside.ts'),m=>m.tasks[0].files.push('tools/ralph/launch.mjs'),m=>m.tasks[0].checkGroup='agent-shell-command',m=>m.tasks[0].command=['sh','-c','invented'],m=>m.tasks[0].files.push('package.json')]) {
    const bad=structuredClone(manifest);mutate(bad);assert.throws(()=>validateManifest(bad,'rlp-b02'));
  }
});

test('registration binds proposal, definitions, completed predecessor and manifest bytes', context=>{
  const {root,manifest}=registryFixture(context);
  assert.equal(loadRegisteredBatch(root,'rlp-b02').batchId,'rlp-b02');
  assert.equal(historicalBatchStatus(root).verifiedCount,5);
  assert.throws(()=>loadRegisteredBatch(root,'rlp-b99'));
  const tracker=readJson(join(root,manifest.tracker));tracker.userStories[0].acceptanceCriteria[0]='changed requirement';writeJson(join(root,manifest.tracker),tracker);
  assert.throws(()=>loadRegisteredBatch(root,'rlp-b02'),/definition/);
  tracker.userStories[0].acceptanceCriteria[0]='independent fixture check';writeJson(join(root,manifest.tracker),tracker);
  writeFileSync(join(root,manifest.proposal),'unapproved new scope');assert.throws(()=>loadRegisteredBatch(root,'rlp-b02'),/Proposal/);
  writeFileSync(join(root,manifest.proposal),'explicit test approval');
  writeJson(join(root,'tasks/ralph/batches/rlp-b02.manifest.json'),{...manifest,version:2});assert.throws(()=>loadRegisteredBatch(root,'rlp-b02'),/registered/);
});

test('historical completion cannot be rewritten or reset by a later batch', context=>{
  const {root}=registryFixture(context);
  const before=historicalBatchStatus(root);assert.equal(before.agentInvoked,false);
  writeJson(join(root,'.local/ralph/batches/rlp-b01/tasks/US-103/receipt.json'),{status:'modified'});
  assert.throws(()=>historicalBatchStatus(root),/evidence changed/);
});

test('generic field permissions protect unrelated manifests and original status history', context=>{
  const {root,manifest}=registryFixture(context);
  mkdirSync(join(root,'docs/implementation-status'),{recursive:true});writeFileSync(join(root,'docs/implementation-status/current.md'),'original history\n');
  mkdirSync(join(root,'docs/architecture'),{recursive:true});writeFileSync(join(root,'docs/architecture/engineering-foundation-gates.md'),'original foundation history\n');
  writeJson(join(root,'package.json'),{scripts:{original:'preserve'}});
  const baseline=batchSnapshot(root,manifest.tracker);
  const candidate=makeCandidate(root,join(root,'.local/candidate-test'),baseline,manifest.tracker);
  const policy={tracker:manifest.tracker,edits:{'package.json':{kind:'script',key:'allowed',value:'reviewed command'}}};
  writeFileSync(join(candidate,'package.json'),JSON.stringify({scripts:{original:'preserve',allowed:'reviewed command'}}));
  assert.equal(changedFiles(root,candidate,baseline,['package.json'],'US-201',policy).length,1);
  writeFileSync(join(candidate,'package.json'),JSON.stringify({scripts:{original:'altered',allowed:'reviewed command'}}));
  assert.throws(()=>changedFiles(root,candidate,baseline,['package.json'],'US-201',policy),/Protected manifest/);
  writeFileSync(join(candidate,'package.json'),readFileSync(join(root,'package.json')));
  writeFileSync(join(candidate,'docs/implementation-status/current.md'),'rewritten history\n');
  assert.throws(()=>changedFiles(root,candidate,baseline,['docs/implementation-status/current.md'],'US-201',policy),/history/);
  writeFileSync(join(candidate,'docs/implementation-status/current.md'),readFileSync(join(root,'docs/implementation-status/current.md')));
  writeFileSync(join(candidate,'docs/architecture/engineering-foundation-gates.md'),'rewritten foundation');
  assert.throws(()=>changedFiles(root,candidate,baseline,['docs/architecture/engineering-foundation-gates.md'],'US-301',policy),/history/);
});

test('fake-agent successor resumes after receipt repair and never invokes completed predecessor', context=>{
  const {root}=registryFixture(context);
  const script=`
    import assert from 'node:assert/strict';import{writeFileSync,mkdirSync}from'node:fs';import{join,dirname}from'node:path';
    const root=process.argv[1],fake=process.argv[2];
    const s=await import(join(root,'tools/ralph/state.mjs'));const p=await import(join(root,'tools/ralph/batch-policy.mjs'));const w=await import(join(root,'tools/ralph/workspace.mjs'));const r=await import(join(root,'tools/ralph/batch-registry.mjs'));const{runAgent}=await import(join(root,'tools/ralph/agent-adapter.mjs'));
    const tracker='tasks/ralph/batches/rlp-b02.json';
    s.writeJson(join(root,'.local/ralph/batches/rlp-b02/approved.json'),{policySha256:p.policyDigest(root),baseline:w.batchSnapshot(root,tracker)});
    const calls=[];
    const outcome=await p.boundedQueue(p.TASKS,[],async task=>{
      calls.push(task.id);const folder=join(root,'.local/ralph/batches/rlp-b02/tasks',task.id);const before=w.batchSnapshot(root,tracker);const candidate=w.makeCandidate(root,folder,before,tracker);
      mkdirSync(dirname(join(candidate,task.files[0])),{recursive:true});writeFileSync(join(candidate,task.files[0]),task.id+' fixture code');
      return runAgent({executable:process.execPath,arguments_:[fake,'batch-success',task.id],prompt:'fixture only',cwd:candidate,env:s.environment(root),validate:text=>p.validateBatchReport(text,task.id),verify:()=>{
        const changes=w.changedFiles(root,candidate,before,task.files,task.id,{tracker,edits:task.edits});assert.equal(changes.length,1);const evidence={checks:[{name:'fixture scope check',passed:true}]};
        const journal=w.promote(root,candidate,folder,before,changes,evidence,tracker);s.writeJson(join(folder,'receipt.json'),{status:'verified',taskId:task.id,policySha256:p.policyDigest(root),before,after:journal.after,changes,evidence});return evidence;
      }});
    });
    assert.equal(outcome.status,'verified');assert.deepEqual(calls,['US-201','US-202']);
    assert.equal(s.readJson(join(root,tracker)).userStories[0].passes,false);
    const repaired=p.batchReconcile(root,true);assert.equal(repaired.status,'verified');assert.equal(repaired.verifiedCount,2);
    const again=await p.boundedQueue(p.TASKS,repaired.completed,()=>{throw Error('completed task restarted')});assert.equal(again.status,'verified');
    assert.equal(r.historicalBatchStatus(root).verifiedCount,5);assert.equal(r.historicalBatchStatus(root).agentInvoked,false);
    writeFileSync(join(root,'application.txt'),'new unrelated user edit');assert.throws(()=>p.batchReconcile(root),/Source, plan or Git/);
    console.log(JSON.stringify({status:'verified',calls,predecessorInvoked:false,receiptRepair:true}));
  `;
  const result=spawnSync(process.execPath,['--input-type=module','-e',script,root,FAKE],{cwd:root,env:{...environment(root),LMPS_RALPH_BATCH:'rlp-b02'},encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).calls,['US-201','US-202']);
});

test('reviewed plan re-registration preserves a completed receipt and stops subsequent drift', context => {
  const { root } = registryFixture(context);
  const script = `
    import assert from 'node:assert/strict';import {writeFileSync,mkdirSync,readFileSync} from 'node:fs';import {join,dirname} from 'node:path';
    const root=process.argv[1],s=await import(join(root,'tools/ralph/state.mjs')),p=await import(join(root,'tools/ralph/batch-policy.mjs')),w=await import(join(root,'tools/ralph/workspace.mjs'));
    const dir=join(root,'.local/ralph/batches/rlp-b02'),tracker='tasks/ralph/batches/rlp-b02.json',before=w.batchSnapshot(root,tracker),policy=p.policyDigest(root);
    s.writeJson(join(dir,'approved.json'),{baseline:before,policySha256:policy});
    const task=p.TASKS[0],folder=join(dir,'tasks',task.id),candidate=w.makeCandidate(root,folder,before,tracker);
    mkdirSync(dirname(join(candidate,task.files[0])),{recursive:true});writeFileSync(join(candidate,task.files[0]),'verified fixture implementation');
    const changes=w.changedFiles(root,candidate,before,task.files,task.id,{tracker,edits:task.edits}),evidence={checks:[{passed:true}]};
    const journal=w.promote(root,candidate,folder,before,changes,evidence,tracker),receipt=join(folder,'receipt.json');
    s.writeJson(receipt,{status:'verified',taskId:task.id,policySha256:policy,before,after:journal.after,changes,evidence});
    const receiptHash=s.digest(readFileSync(receipt)),name='docs/api/calendar.md';mkdirSync(dirname(join(root,name)),{recursive:true});writeFileSync(join(root,name),'reviewed API documentation');writeFileSync(join(dirname(root),'plan/README.md'),'new monitoring direction');
    assert.throws(()=>p.batchReconcile(root),/Source, plan or Git/);
    s.writeJson(join(dir,'maintenance.json'),{updates:[{kind:'source-plan-review',authorization:'explicit-user-approval',scope:'monitoring',productionReady:false,beforeTask:p.TASKS[1].id,before:journal.after,after:w.batchSnapshot(root,tracker),fromPolicy:policy,toPolicy:policy,changedFiles:[],sourceChanges:[name],planChanges:['README.md'],taskMapping:[{id:p.TASKS[1].id,requirements:['P04-02']}],checks:{passed:true,testCount:70}}]});
    const state=p.batchReconcile(root,true);assert.deepEqual(state.completed,[task.id]);assert.equal(state.nextTask,p.TASKS[1].id);assert.equal(s.digest(readFileSync(receipt)),receiptHash);
    writeFileSync(join(root,name),'later unreviewed edit');assert.throws(()=>p.batchReconcile(root),/Source, plan or Git/);assert.equal(s.digest(readFileSync(receipt)),receiptHash);
    console.log('reviewed-plan-preserves-receipt');
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script, root], { cwd: root, env: { ...environment(root), LMPS_RALPH_BATCH: 'rlp-b02' }, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /reviewed-plan-preserves-receipt/);
});

test('disk preflight stops before cache preparation while accepting explicit capacity boundaries',()=>{
  const minimum=6*1024**3;
  assert.throws(()=>assertVerificationCapacity(ROOT,minimum,()=>minimum-1),/Insufficient verifier disk/);
  assert.equal(assertVerificationCapacity(ROOT,minimum,()=>minimum),minimum);
  assert.throws(()=>assertVerificationCapacity(ROOT,minimum,()=>NaN),/Insufficient verifier disk/);
});

test('only owned completed verifier clones are retired, preserving candidate, logs and original files',context=>{
  const{root}=fixture(context);const folder=join(root,'.local/ralph/batches/rlp-b02/tasks/US-201');
  const cache=join(folder,'verifier-cache-v2');mkdirSync(cache,{recursive:true});
  for(const name of ['uv-ready.json','pnpm-v11-ready.json'])writeJson(join(cache,name),{cloned:true});
  writeJson(join(folder,'receipt.json'),{status:'pending',taskId:'US-201'});
  writeFileSync(join(folder,'candidate-code.txt'),'uncommitted implementation');writeFileSync(join(folder,'checks.log'),'test evidence');
  symlinkSync(join(root,'application.txt'),join(cache,'outside-link'));
  assert.throws(()=>retireVerificationCache(root,folder),/durable verified/);
  assert.ok(existsSync(cache));writeJson(join(folder,'receipt.json'),{status:'verified',taskId:'US-201'});
  assert.equal(retireVerificationCache(root,folder),true);assert.equal(retireVerificationCache(root,folder),false);
  assert.equal(readFileSync(join(root,'application.txt'),'utf8'),'original user work\n');
  assert.equal(readFileSync(join(folder,'candidate-code.txt'),'utf8'),'uncommitted implementation');assert.equal(readFileSync(join(folder,'checks.log'),'utf8'),'test evidence');
  assert.equal(readJson(join(folder,'cache-retirement.json')).status,'complete');assert.throws(()=>retireVerificationCache(root,join(root,'application.txt')),/Unsafe/);
});

function thirdBatchFixture(context,full=false){
  const f=registryFixture(context),{root}=f;
  const prior=structuredClone(f.manifest);
  if(full)for(let i=2;i<4;i++)prior.tasks.push({id:`US-${201+i}`,dependsOn:[`US-${200+i}`],files:[`packages/risk/src/fixture-${i}.ts`],checkGroup:'risk',edits:{}});
  const tracker={name:'completed fixture B02',branchName:'main',userStories:prior.tasks.map((task,i)=>({id:task.id,title:task.id,description:'fixture',priority:i+1,acceptanceCriteria:Array(6).fill('independent fixture check'),dependsOn:task.dependsOn,passes:true}))};
  writeJson(join(root,prior.tracker),tracker);writeJson(join(root,'tasks/ralph/batches/rlp-b02.manifest.json'),prior);
  const directory=join(root,'.local/ralph/batches/rlp-b02');
  const names=['approved.json','maintenance.json','completion-audit.json','host-verification-approval.json','response.schema.json',...prior.tasks.map(task=>`tasks/${task.id}/receipt.json`)];
  const records=names.map(name=>{const path=join(directory,name);writeJson(path,{status:'verified',taskId:name,evidence:{checks:[]},fixture:true});return{name,sha256:digest(readFileSync(path))};});
  const completed=prior.tasks.map(task=>task.id);
  const seal={batchId:'rlp-b02',status:{status:'verified',batchId:'rlp-b02',completed,verifiedCount:completed.length,remainingCount:0,nextTask:null},tracker,records,selectedHome:'plusb'};
  writeJson(join(directory,'historical-seal.json'),seal);
  const manifest=full?readJson(join(ROOT,'tasks/ralph/batches/rlp-b03.manifest.json')):{...prior,batchId:'rlp-b03',predecessor:'rlp-b02',tracker:'tasks/ralph/batches/rlp-b03.json',document:'tasks/ralph/batches/rlp-b03.md',proposal:'.local/ralph/proposals/implementation-batch-003.md',tasks:[{id:'US-301',dependsOn:[],files:['packages/risk/src/fixture-third.ts'],checkGroup:'risk',edits:{}}]};
  writeJson(join(root,'tasks/ralph/batches/rlp-b03.manifest.json'),manifest);writeFileSync(join(root,manifest.document),'registered fixture third scope');writeFileSync(join(root,manifest.proposal),'explicit fixture registration');
  const thirdTracker=full?readJson(join(ROOT,manifest.tracker)):{name:'third fixture',branchName:'main',userStories:manifest.tasks.map(task=>({id:task.id,title:task.id,description:'fixture',priority:1,acceptanceCriteria:Array(6).fill('independent fixture check'),dependsOn:task.dependsOn,passes:false}))};
  writeJson(join(root,manifest.tracker),thirdTracker);writeJson(join(root,'.local/ralph/batches/rlp-b03/response.schema.json'),{type:'object'});
  const registry=readJson(join(root,REGISTRY));registry.active='rlp-b03';registry.historicalBatches={'rlp-b02':{sealSha256:digest(readFileSync(join(directory,'historical-seal.json')))}};
  registry.entries['rlp-b03']={authorization:'explicit-user-approval',manifestSha256:digest(readFileSync(join(root,'tasks/ralph/batches/rlp-b03.manifest.json'))),proposalSha256:digest(readFileSync(join(root,manifest.proposal))),predecessorSealSha256:registry.historicalBatches['rlp-b02'].sealSha256,definitionSha256:digest(trackerDefinition(thirdTracker))};
  if(full){
    const catalog=readJson(join(ROOT,'tasks/ralph/master.json'));
    for(const row of catalog.sourceDocuments)writeFileSync(join(f.parent,'plan',row.name),readFileSync(join(ROOT,'../plan',row.name)));
    writeJson(join(root,'tasks/ralph/master.json'),catalog);
    registry.master={catalogPath:'tasks/ralph/master.json',catalogSha256:digest(readFileSync(join(root,'tasks/ralph/master.json'))),readyBatch:'rlp-b03',sourceDocuments:sourceSnapshot(root).plan,completedReceipts:Object.fromEntries(catalog.tasks.filter(task=>task.state==='verified').map(task=>[task.id,digest(readFileSync(join(root,task.receiptRef)))]))};
    registry.entries['rlp-b03'].planTaskIds=catalog.tasks.filter(task=>task.state==='registered').map(task=>task.id);
  }
  writeJson(join(root,REGISTRY),registry);
  return {...f,manifest,registry};
}

test('master CLI accepts a registered catalog alias without widening command permissions',()=>{
  assert.deepEqual(parseArguments(['run','--batch','rlp-master','--home','plusb']),{command:'run',batch:'rlp-master',home:'plusb',headless:false});
  assert.throws(()=>parseArguments(['run','--batch','master-anywhere']));
});

test('all135 registered leaves retain104-MUST coverage and blocked tasks have no executable runner',()=>{
  const catalog=readJson(join(ROOT,'tasks/ralph/master.json'));assert.equal(validateMasterCatalog(catalog).tasks.length,135);
  assert.equal(catalog.tasks.filter(task=>task.state==='verified').length,4);assert.equal(catalog.tasks.filter(task=>task.state==='registered').length,9);assert.equal(catalog.tasks.filter(task=>task.state==='blocked').length,122);
  for(const mutate of [c=>c.tasks.pop(),c=>c.requirements.pop(),c=>c.tasks.find(task=>task.state==='blocked').runner={batchId:'rlp-b03',taskId:'US-999'},c=>c.tasks[0].dependsOn=[c.tasks[0].id],c=>c.tasks[0].blockedBy=['UNREVIEWED'],c=>c.requirements.find(row=>row.remainingTasks.length).remainingTasks=[]]){const bad=structuredClone(catalog);mutate(bad);assert.throws(()=>validateMasterCatalog(bad));}
});

test('master reconciles historical receipts and pending work without treating blocked leaves as completed',context=>{
  const{root}=thirdBatchFixture(context,true);
  assert.equal(loadRegisteredBatch(root,'rlp-b03').tasks.length,9);
  const state=masterStatus(root);assert.equal(state.verifiedCount,4);assert.equal(state.registeredPendingCount,9);assert.equal(state.blockedCount,122);assert.equal(state.nextTask.taskId,'US-301');
  const after=masterStatus(root,{status:'verified',completed:Array.from({length:9},(_,i)=>`US-${301+i}`),running:false,manualActionRequired:false});
  assert.equal(after.verifiedCount,13);assert.equal(after.blockedCount,122);assert.equal(after.status,'blocked');assert.equal(after.planComplete,false);assert.equal(after.nextTask,null);
  const quota=masterStatus(root,{status:'pending',completed:[],running:false,manualActionRequired:true,lastAgent:{status:'quota'}});assert.equal(quota.status,'stopped');assert.equal(quota.automaticRetry,false);assert.equal(quota.automaticAccountRotation,false);
});

test('master catalog tampering, changed source plan and gated native remapping all fail closed',context=>{
  const{root}=thirdBatchFixture(context,true);const file=join(root,'tasks/ralph/master.json');const original=readFileSync(file);
  const catalog=readJson(file);catalog.tasks.find(task=>task.state==='blocked').acceptance.push('unreviewed owner approval');writeJson(file,catalog);assert.throws(()=>loadMasterCatalog(root),/changed/);writeFileSync(file,original);
  const registry=readJson(join(root,REGISTRY));registry.entries['rlp-b03'].planTaskIds[0]=catalog.tasks.find(task=>task.state==='blocked').id;writeJson(join(root,REGISTRY),registry);assert.throws(()=>loadRegisteredBatch(root,'rlp-b03'),/Blocked/);
  writeFileSync(join(root,'../plan/README.md'),'unreviewed original plan edit');assert.throws(()=>loadMasterCatalog(root),/Original plan changed/);
});

test('first run rejects unreviewed source changes after registration',context=>{
  const{root,manifest}=thirdBatchFixture(context);
  const registry=readJson(join(root,REGISTRY));registry.entries['rlp-b03'].baseline=batchSnapshot(root,manifest.tracker);writeJson(join(root,REGISTRY),registry);
  assert.equal(loadRegisteredBatch(root,'rlp-b03').batchId,'rlp-b03');writeFileSync(join(root,'application.txt'),'user changes after registration');assert.throws(()=>loadRegisteredBatch(root,'rlp-b03'),/changed since registration/);
});

test('a third fake-agent batch completes once while both sealed predecessors remain unchanged',context=>{
  const{root}=thirdBatchFixture(context);
  const script=`import assert from'node:assert/strict';import{join,dirname}from'node:path';import{mkdirSync,writeFileSync}from'node:fs';const root=process.argv[1];const s=await import(join(root,'tools/ralph/state.mjs'));const p=await import(join(root,'tools/ralph/batch-policy.mjs'));const w=await import(join(root,'tools/ralph/workspace.mjs'));const r=await import(join(root,'tools/ralph/batch-registry.mjs'));const{runAgent}=await import(join(root,'tools/ralph/agent-adapter.mjs'));const tracker='tasks/ralph/batches/rlp-b03.json';const before=w.batchSnapshot(root,tracker);s.writeJson(join(root,'.local/ralph/batches/rlp-b03/approved.json'),{baseline:before,policySha256:p.policyDigest(root)});const task=p.TASKS[0],folder=join(root,'.local/ralph/batches/rlp-b03/tasks',task.id),candidate=w.makeCandidate(root,folder,before,tracker);mkdirSync(dirname(join(candidate,task.files[0])),{recursive:true});writeFileSync(join(candidate,task.files[0]),'fixture third implementation');let calls=0;const result=await runAgent({executable:process.execPath,arguments_:[process.argv[2],'batch-success',task.id],prompt:'fixture only',cwd:candidate,env:s.environment(root),validate:text=>p.validateBatchReport(text,task.id),verify:()=>{calls++;const changes=w.changedFiles(root,candidate,before,task.files,task.id,{tracker,edits:{}});const evidence={checks:[{passed:true,name:'fixture guard'}]};const journal=w.promote(root,candidate,folder,before,changes,evidence,tracker);s.writeJson(join(folder,'receipt.json'),{status:'verified',taskId:task.id,policySha256:p.policyDigest(root),before,after:journal.after,changes,evidence});return evidence;}});assert.equal(result.status,'verified');const state=p.batchReconcile(root,true);assert.equal(state.verifiedCount,1);await p.boundedQueue(p.TASKS,state.completed,()=>{throw Error('third task restarted')});assert.equal(r.historicalBatchStatus(root).verifiedCount,5);assert.equal(r.historicalBatchStatus(root,'rlp-b02').verifiedCount,2);assert.equal(calls,1);console.log('verified-three-batch-history');`;
  const result=spawnSync(process.execPath,['--input-type=module','-e',script,root,FAKE],{cwd:root,env:{...environment(root),LMPS_RALPH_BATCH:'rlp-b03'},encoding:'utf8',timeout:30000,maxBuffer:1024*1024});assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/verified-three-batch-history/);
});

test('completed candidate dependency retirement preserves source and never follows outside links',context=>{
  const{root,manifest}=registryFixture(context);writeFileSync(join(root,'.gitignore'),'.local/\nnode_modules/\n.venv/\n');
  const before=batchSnapshot(root,manifest.tracker),folder=join(root,'.local/ralph/batches/rlp-b02/tasks/US-201');const candidate=makeCandidate(root,folder,before,manifest.tracker);
  mkdirSync(join(candidate,'node_modules'));mkdirSync(join(candidate,'.venv'));symlinkSync(join(root,'application.txt'),join(candidate,'.venv/outside-link'));
  writeJson(join(folder,'receipt.json'),{status:'pending',taskId:'US-201',after:before});assert.throws(()=>retireCompletedDependencies(root,folder),/durable verified/);
  writeJson(join(folder,'receipt.json'),{status:'verified',taskId:'US-201',after:before});assert.deepEqual(retireCompletedDependencies(root,folder),['node_modules','.venv']);
  assert.equal(readFileSync(join(root,'application.txt'),'utf8'),'original user work\n');assert.equal(readFileSync(join(candidate,'application.txt'),'utf8'),'original user work\n');
  mkdirSync(join(candidate,'node_modules'));writeFileSync(join(candidate,'application.txt'),'new user candidate edit');assert.deepEqual(retireCompletedDependencies(root,folder),[]);assert.ok(existsSync(join(candidate,'node_modules')));
});


test('B10 API permissions bind exact approved tasks and fixed checks',()=>{
 const manifest={version:1,batchId:'rlp-b10',predecessor:'rlp-b09',tracker:'tasks/ralph/batches/rlp-b10.json',document:'tasks/ralph/batches/rlp-b10.md',proposal:'.local/ralph/proposals/implementation-batch-010.md',tasks:[
  {id:'US-1004',dependsOn:[],files:['apps/risk-api/src/features.controller.ts','apps/risk-api/src/feature-serving.service.ts','apps/risk-api/src/app.ts','apps/risk-api/src/config.ts','apps/risk-api/test/features.test.mjs'],checkGroup:'api',edits:{}},
  {id:'US-1005',dependsOn:['US-1004'],files:['apps/risk-api/test/features-native.test.mjs'],checkGroup:'full',edits:{}}
 ]};
 const accepted=validateManifest(manifest,'rlp-b10');
 assert.deepEqual(accepted.tasks[0].checks,[['--filter','@lmps/contracts','typecheck'],['--filter','@lmps/contracts','test'],['--filter','@lmps/risk-api','typecheck'],['--filter','@lmps/risk-api','test']]);
 for(const mutate of [m=>m.tasks[0].files.push('apps/risk-api/src/auth.ts'),m=>m.tasks[0].files.push('apps/risk-portal/src/app.ts'),m=>m.tasks[0].files.push('apps/risk-api/test/other.test.mjs'),m=>m.tasks[0].files.push('apps/risk-api/src/../src/secret.ts'),m=>m.tasks[0].files.push('apps/risk-api/.env'),m=>m.tasks[1].files.push('apps/risk-api/src/app.ts'),m=>m.tasks[0].id='US-1003',m=>m.tasks[1].checkGroup='api',m=>m.tasks[0].checks=[['sh','-c','unreviewed']]]){
  const bad=structuredClone(manifest);mutate(bad);assert.throws(()=>validateManifest(bad,'rlp-b10'));
 }
});

test('API extension never grants another batch or arbitrary app prefix',()=>{
 for(const batch of ['rlp-b09','rlp-b11']){
  const manifest={version:1,batchId:batch,predecessor:'rlp-b08',tracker:`tasks/ralph/batches/${batch}.json`,document:`tasks/ralph/batches/${batch}.md`,proposal:`.local/ralph/proposals/implementation-batch-${batch.slice(-2).padStart(3,'0')}.md`,tasks:[{id:'US-1004',dependsOn:[],files:['apps/risk-api/src/app.ts'],checkGroup:'api',edits:{}}]};
  assert.throws(()=>validateManifest(manifest,batch));
  manifest.tasks[0].checkGroup='workers';assert.throws(()=>validateManifest(manifest,batch));
 }
});
