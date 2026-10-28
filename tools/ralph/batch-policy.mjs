import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, realpathSync, renameSync, writeFileSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ROOT, EXIT, digest, environment, privateDirectory, readJson, takeLock, toolchain, trackerDefinition, writeJson } from './state.mjs';
import { BATCH_TRACKER as LEGACY_TRACKER, batchSnapshot as snapshotFor, changedFiles as changesFor, fixtureVerificationProfile, makeCandidate as candidateFor, probeSandbox, promote as promoteFor, recoverPromotion as recoverFor, restoreInstallerFormatting, seedVerificationCaches, retireVerificationCache, assertVerificationCapacity, retireCompletedDependencies } from './workspace.mjs';
import { runAgent } from './agent-adapter.mjs';
import { loadRegisteredBatch } from './batch-registry.mjs';

export const BATCH_ID = process.env.LMPS_RALPH_BATCH || 'rlp-b01';
const registered = BATCH_ID === 'rlp-b01' ? null : loadRegisteredBatch(ROOT,BATCH_ID);
const BATCH_TRACKER = registered?.tracker ?? LEGACY_TRACKER;
const DOCUMENT = registered?.document ?? 'tasks/ralph/batches/rlp-b01.md';
const RESPONSE_SCHEMA = registered ? join(ROOT,'.local/ralph/batches',BATCH_ID,'response.schema.json') : join(ROOT,'tools/ralph/batch-response.schema.json');
const batchSnapshot = root => snapshotFor(root,BATCH_TRACKER);
const changedFiles = (root,candidate,baseline,files,id) => changesFor(root,candidate,baseline,files,id,registered ? {tracker:BATCH_TRACKER,edits:TASKS.find(task=>task.id===id)?.edits} : null);
const makeCandidate = (root,directory,snapshot) => candidateFor(root,directory,snapshot,BATCH_TRACKER);
const promote = (root,candidate,directory,baseline,changes,evidence) => promoteFor(root,candidate,directory,baseline,changes,evidence,BATCH_TRACKER);
const recoverPromotion = (root,directory) => recoverFor(root,directory,BATCH_TRACKER);
export const TASKS = Object.freeze(registered?.tasks ?? [
  { id: 'US-101', dependsOn: [], files: ['packages/contracts/src/pretransfer-simulation.ts', 'packages/contracts/package.json', 'packages/contracts/test/pretransfer-simulation.test.mjs'], checks: [['--filter', '@lmps/contracts', 'typecheck'], ['--filter', '@lmps/contracts', 'test']] },
  { id: 'US-102', dependsOn: ['US-101'], files: ['packages/risk/src/pretransfer-simulation.ts', 'packages/risk/src/index.ts', 'packages/risk/test/pretransfer-simulation.test.mjs'], checks: [['--filter', '@lmps/risk', 'typecheck'], ['--filter', '@lmps/risk', 'test']] },
  { id: 'US-103', dependsOn: ['US-102'], files: ['packages/risk/src/pretransfer-reservations.ts', 'packages/risk/src/index.ts', 'packages/risk/test/pretransfer-reservations.test.mjs'], checks: [['--filter', '@lmps/risk', 'typecheck'], ['--filter', '@lmps/risk', 'test']] },
  { id: 'US-104', dependsOn: ['US-103'], files: ['apps/risk-workers/src/pretransfer-simulator.ts', 'apps/risk-workers/scripts/pretransfer-simulate.mjs', 'apps/risk-workers/test/pretransfer-simulator.test.mjs', 'package.json', 'docs/operations/pretransfer-simulator.md'], checks: [['--filter', '@lmps/risk-workers', 'typecheck'], ['--filter', '@lmps/risk-workers', 'test']] },
  { id: 'US-105', dependsOn: ['US-104'], files: ['apps/risk-workers/test/pretransfer-acceptance.test.mjs', 'docs/operations/pretransfer-simulator.md', 'docs/implementation-status/current.md'], checks: [['typecheck'], ['test'], ['build'], ['verify:fresh']] },
]);

export const batchDirectory = (root = ROOT) => join(root, '.local/ralph/batches', BATCH_ID);
const HOST_TASK_IDS = registered ? TASKS.map(task=>task.id) : ['US-104','US-105'];
export const HOST_COMMAND_POLICY = digest({ tasks: TASKS.filter(task => HOST_TASK_IDS.includes(task.id)).map(({ id, checks }) => ({ id, checks })), additional: ['trusted-automation-tests', 'publication-and-secrets'], shell: false, timeoutMs: 600000 });
const taskDirectory = (root, id) => join(batchDirectory(root), 'tasks', id);
const optional = file => existsSync(file) ? readJson(file) : null;
const same = (a, b) => digest(a) === digest(b);

export function authorizedHostVerification(approval, taskId, policySha256, proposalSha256) {
  if (!approval || !HOST_TASK_IDS.includes(taskId)) return false;
  if (approval.authorization !== 'explicit-user-approval' || approval.batchId !== BATCH_ID || approval.mode !== 'trusted-host-fixtures' || !same(approval.taskIds, HOST_TASK_IDS) || approval.policySha256 !== policySha256 || approval.proposalSha256 !== proposalSha256 || approval.commandPolicySha256 !== HOST_COMMAND_POLICY) throw new Error('Host verification approval does not match the reviewed tasks and command policy.');
  return true;
}

export function buildBatchCodexArguments(root = ROOT, schema = join(root, 'tools/ralph/batch-response.schema.json')) {
  return ['-a', 'never', 'exec', '--ignore-user-config', '--ignore-rules', '--sandbox', 'workspace-write', '-c', 'sandbox_workspace_write.exclude_tmpdir_env_var=true', '-c', 'sandbox_workspace_write.exclude_slash_tmp=true', '--json', '--output-schema', schema, '-'];
}

export function policyDigest(root = ROOT) {
  if (registered) loadRegisteredBatch(root,BATCH_ID);
  const files = ['tools/ralph/batch-policy.mjs', 'tools/ralph/workspace.mjs', 'tools/ralph/state.mjs', 'tools/ralph/agent-adapter.mjs', 'tools/ralph/verification.mjs', 'tools/ralph/launch.mjs', 'tools/ralph/batch-response.schema.json', '.ralph-tui/batch-prompt.hbs', DOCUMENT, ...(registered ? ['tools/ralph/batch-registry.mjs',registered.manifestPath,...(registered.registration.planTaskIds?['tasks/ralph/master.json']:[])] : [])];
  const tracker = readJson(join(root, BATCH_TRACKER));
  if (!same(tracker.userStories.map(({ id, dependsOn }) => ({ id, dependsOn })), TASKS.map(({ id, dependsOn }) => ({ id, dependsOn }))) || tracker.userStories.some(row => row.acceptanceCriteria.length < 6 || typeof row.passes !== 'boolean')) throw new Error('Reviewed task definitions or dependencies are invalid.');
  return digest({ tasks: TASKS, definitions: trackerDefinition(tracker), files: files.map(name => [name, digest(readFileSync(join(root, name)))]) , ...(registered ? {schema:digest(readFileSync(RESPONSE_SCHEMA)),proposal:registered.registration.proposalSha256} : {}) });
}

export function validateBatchReport(text, id) {
  const value = JSON.parse(text);
  if (!same(Object.keys(value).sort(), ['notes', 'production_ready', 'status', 'task_id']) || value.task_id !== id || !['ready_for_verification', 'blocked'].includes(value.status) || value.production_ready !== false || !Array.isArray(value.notes) || value.notes.length > 20 || value.notes.some(note => typeof note !== 'string' || note.length > 500)) throw new Error('Agent reported incomplete or invalid output.');
  if (value.status === 'blocked') throw Object.assign(new Error('Agent reported blocked.'), { code: 'AGENT_BLOCKED', report: value });
  return value;
}

export function maintenanceBoundary(expected, policy, record, pendingTasks = []) {
  const allowed = ['tools/ralph/workspace.mjs', 'tools/ralph/agent-adapter.mjs', 'tools/ralph/batch-policy.mjs', 'tools/ralph/batch-registry.mjs', 'tools/ralph/automation.test.mjs', 'tools/ralph/README.md', 'tools/ralph/launch.mjs', 'tools/ralph/state.mjs', 'ci/verify.py', 'ci/tests/test_verification.py', 'apps/risk-workers/test/feature-stream-spike.test.mjs'];
  if (!same(record.before, expected) || record.fromPolicy !== policy || !record.checks?.passed || !Number.isSafeInteger(record.checks.testCount) || record.checks.testCount < 41 || record.changedFiles.some(name => !allowed.includes(name))) throw new Error('Runner maintenance has invalid evidence or scope.');
  const before = structuredClone(record.before), after = structuredClone(record.after);
  if (record.kind !== undefined) {
    if (record.kind !== 'source-plan-review' || record.authorization !== 'explicit-user-approval' || record.scope !== 'monitoring' || record.productionReady !== false || !pendingTasks.length || record.beforeTask !== pendingTasks[0].id || !Array.isArray(record.taskMapping) || !same(record.taskMapping.map(row => row.id), pendingTasks.map(task => task.id)) || record.taskMapping.some(row => !Array.isArray(row.requirements) || !row.requirements.length || row.requirements.some(id => !/^P04-0[1-9]$/.test(id)))) throw new Error('Source/plan review requires explicit approval and pending-task mapping.');
    const changes = section => [...new Set([...before[section], ...after[section]].map(row => row.name))].filter(name => !same(before[section].find(row => row.name === name) ?? null, after[section].find(row => row.name === name) ?? null)).sort();
    const sourceChanges = changes('source').filter(name => !record.changedFiles.includes(name));
    const reviewable = name => /^(apps\/risk-api\/(src|scripts|test)\/.+\.(ts|mjs)|docs\/api\/.+\.md|docs\/implementation-status\/current\.md|tasks\/ralph\/requirements-map\.md)$/.test(name) && !name.split('/').some(part => part.startsWith('.'));
    if (!same(record.sourceChanges, sourceChanges) || !same(record.planChanges, changes('plan')) || !same(before.plan.map(row => row.name), after.plan.map(row => row.name)) || sourceChanges.some(name => !after.source.some(row => row.name === name) || !reviewable(name) || name !== 'docs/implementation-status/current.md' && pendingTasks.some(task => task.files.includes(name)))) throw new Error('Source/plan review changed protected scope or its exact inventory.');
    before.source = before.source.filter(row => !sourceChanges.includes(row.name));
    after.source = after.source.filter(row => !sourceChanges.includes(row.name));
    before.plan = before.plan.filter(row => !record.planChanges.includes(row.name));
    after.plan = after.plan.filter(row => !record.planChanges.includes(row.name));
  }
  before.source = before.source.filter(row => !record.changedFiles.includes(row.name));
  after.source = after.source.filter(row => !record.changedFiles.includes(row.name));
  if (!same(before, after) || record.kind === undefined && record.after.source.length !== record.before.source.length) throw new Error('Maintenance changed application, plan or Git state.');
  return { expected: record.after, policy: record.toPolicy };
}

export function batchReconcile(root = ROOT, repair = false) {
  const directory = batchDirectory(root);
  const approved = optional(join(directory, 'approved.json'));
  if (!approved) return { status: 'not-activated', batchId: BATCH_ID, completed: [], nextTask: TASKS[0].id };
  const maintenanceFile = optional(join(directory, 'maintenance.json'));
  const maintenance = maintenanceFile?.updates ?? (maintenanceFile ? [maintenanceFile] : []);
  if ((maintenance.at(-1)?.toPolicy ?? approved.policySha256) !== policyDigest(root)) throw new Error('Approved runner policy or task definition changed.');
  const tracker = readJson(join(root, BATCH_TRACKER));
  let expected = approved.baseline;
  let policy = approved.policySha256;
  const completed = [];
  for (const task of TASKS) {
    for (const update of maintenance.filter(item => item.beforeTask === task.id)) ({ expected, policy } = maintenanceBoundary(expected, policy, update, TASKS.filter(item => !completed.includes(item.id))));
    const folder = taskDirectory(root, task.id);
    let receipt = optional(join(folder, 'receipt.json'));
    const journal = optional(join(folder, 'promotion.json'));
    if (!receipt && journal && repair) {
      if (!same(journal.baseline, expected)) throw new Error('Promotion baseline mismatch.');
      const recovered = recoverPromotion(root, folder);
      receipt = { status: 'verified', taskId: task.id, policySha256: policy, before: expected, after: recovered.after, changes: recovered.changes, evidence: recovered.evidence, recovered: true };
      writeJson(join(folder, 'receipt.json'), receipt);
    }
    const story = tracker.userStories.find(row => row.id === task.id);
    if (receipt) {
      if (receipt.status !== 'verified' || receipt.taskId !== task.id || receipt.policySha256 !== policy || !same(receipt.before, expected) || task.dependsOn.some(id => !completed.includes(id))) throw new Error('Invalid task receipt chain.');
      expected = receipt.after;
      completed.push(task.id);
      if (repair && !story.passes) story.passes = true;
    } else if (story.passes) throw new Error('Tracker claims completion without a trusted receipt.');
  }
  if (!same(batchSnapshot(root), expected)) throw new Error('Source, plan or Git state changed; reconcile user edits before continuing.');
  if (repair) writeJson(join(root, BATCH_TRACKER), tracker);
  const nextTask = TASKS.find(task => !completed.includes(task.id))?.id ?? null;
  return { status: nextTask ? 'pending' : 'verified', batchId: BATCH_ID, completed, verifiedCount: completed.length, remainingCount: TASKS.length - completed.length, nextTask };
}

function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}

export function batchStatus(root = ROOT) {
  let state;
  try { state = batchReconcile(root); } catch (error) { state = { status: 'review-required', reason: error.message }; }
  const previous = optional(join(batchDirectory(root), 'run.json'));
  const lastAgent = optional(join(batchDirectory(root), 'last-agent.json'));
  return { ...state, selectedHome: previous?.selectedHome ?? (registered?'plusb':'plusd'), running: alive(previous?.ralphPid), lastAgent, automaticContinuation: true, crossBatchAutomaticContinuation: false, maximumTasks: TASKS.length, automaticRetry: false, automaticAccountRotation: false, manualHandoffSupported: true, manualActionRequired: !alive(previous?.ralphPid) && !!lastAgent && lastAgent.status !== 'verified', resumeCommand: `./tools/ralph/launch.mjs resume --batch ${BATCH_ID} --home ${previous?.selectedHome ?? (registered?'plusb':'plusd')} --headless` };
}

export function handoffDecision(previous, { command, home, handoff = false }) {
  if (!['plusb', 'pluse', 'plusd'].includes(home)) throw new Error('Unknown account home.');
  if (previous && !['plusb', 'pluse', 'plusd'].includes(previous.selectedHome)) throw new Error('Previous account home requires review.');
  if (!previous || previous.selectedHome === home) return null;
  if (command !== 'resume' || !handoff) throw new Error('Resume on the same home, or explicitly request --handoff to select another existing account.');
  return { from: previous.selectedHome, to: home };
}

function recordManualHandoff(root, decision, state) {
  const directory = batchDirectory(root);
  const auth = spawnSync(toolchain(root).codex, ['login', 'status'], { cwd: '/private/tmp', env: environment(root, decision.to), encoding: 'utf8', timeout: 15000, maxBuffer: 16384 });
  if (auth.status !== 0 || !/Logged in using ChatGPT/i.test(`${auth.stdout}\n${auth.stderr}`)) throw new Error('Target account is not confirmed as an existing ChatGPT login. No login/logout was performed.');
  const folder = taskDirectory(root, state.nextTask);
  const workFile = join(folder, 'work.json');
  const work = optional(workFile);
  if (work && (work.selectedHome !== decision.from || !same(work.baseline, batchSnapshot(root)))) throw new Error('Pending candidate requires reconciliation before changing account.');
  const record = { ...decision, taskId: state.nextTask, completedTasks: state.completed, requestedBy: 'explicit-user-command', loginConfirmed: true, logoutPerformed: false, automaticRotation: false, createdAt: new Date().toISOString() };
  const file = join(directory, 'handoffs', `${Date.now()}-${decision.from}-to-${decision.to}.json`);
  writeJson(file, record);
  if (work) {
    writeJson(join(folder, `home-before-handoff-${Date.now()}.json`), { selectedHome: work.selectedHome, handoffRecord: file });
    work.selectedHome = decision.to;
    writeJson(workFile, work);
  }
  return record;
}

export async function boundedQueue(tasks, completed, execute) {
  const done = new Set(completed);
  for (const task of tasks) {
    if (done.has(task.id)) continue;
    if (task.dependsOn.some(id => !done.has(id))) return { status: 'blocked', taskId: task.id };
    const result = await execute(task);
    if (result.status !== 'verified') return { ...result, taskId: task.id };
    done.add(task.id);
  }
  return { status: 'verified', completed: [...done] };
}

export function verificationTemporaryDirectory(candidate, sandboxTemporary, useHost) {
  // Fresh host copies must retain private ancestors; /private/tmp is shared.
  return sandboxTemporary && !useHost ? sandboxTemporary : privateDirectory(join(candidate, '.local/verification-tmp'));
}

function trustedCommand(root, candidate, directory, name, command, sandbox = true, timeout = 600000, taskId = null) {
  const tools = toolchain(root);
  const approval = optional(join(batchDirectory(root), 'host-verification-approval.json'));
  const useHost = sandbox && authorizedHostVerification(approval, taskId, policyDigest(root), approval ? digest(readFileSync(join(root, registered?.proposal ?? '.local/ralph/proposals/host-fixture-verification.md'))) : null);
  const context = sandbox ? fixtureVerificationProfile(root, candidate, directory) : null;
  if (context) seedVerificationCaches(root, context);
  const isolatedHome = context?.home ?? privateDirectory(join(candidate, '.local/verification-home'));
  const env = { ...environment(candidate), HOME: isolatedHome, CODEX_HOME: privateDirectory(join(isolatedHome, '.codex')), TMPDIR: verificationTemporaryDirectory(candidate, context?.temporary, useHost), UV_CACHE_DIR: join(process.env.HOME, '.cache/uv'), UV_PYTHON: realpathSync(toolchain(root).python), UV_PYTHON_DOWNLOADS: 'never', COREPACK_HOME: join(process.env.HOME, '.cache/node/corepack'), COREPACK_ENABLE_NETWORK: '0' };
  if (context) {
    env.UV_CACHE_DIR = join(context.cache, 'uv');
    env.pnpm_config_store_dir = join(context.cache, 'pnpm');
  }
  env.LMPS_MARIADB_BASE = join(root, '.local/mariadb-runtime', readJson(join(root, 'infrastructure/mariadb/runtime.json')).formula, readJson(join(root, 'infrastructure/mariadb/runtime.json')).bottle_version);
  const args = sandbox && !useHost ? [...context.arguments, ...command] : command.slice(1);
  const start = Date.now();
  const result = spawnSync(sandbox && !useHost ? tools.codex : command[0], args, { cwd: candidate, env, encoding: 'utf8', timeout, maxBuffer: 16 * 1024 * 1024 });
  privateDirectory(join(directory, 'checks'));
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  writeFileSync(join(directory, 'checks', `${name}.log`), output, { mode: 0o600 });
  const check = { name, command, passed: result.status === 0 && !result.error, exitCode: result.status, elapsedMs: Date.now() - start, outputSha256: digest(output), verificationProfileSha256: useHost ? null : context?.profileSha256 ?? null, executionMode: useHost ? 'user-approved-host-fixtures' : sandbox ? 'codex-local-fixtures' : 'trusted-tooling-setup', hostApprovalSha256: useHost ? digest(approval) : null };
  writeJson(join(directory, 'checks', `${name}.json`), check);
  if (!check.passed) throw new Error(`Check failed: ${name}; private log preserved.`);
  return check;
}

function prepareDependencies(root, candidate, directory) {
  return [trustedCommand(root, candidate, directory, 'offline-node-dependencies', [toolchain(root).pnpm, 'install', '--frozen-lockfile', '--offline', '--store-dir', join(process.env.HOME, 'Library/pnpm/store/v11')], false, 300000), trustedCommand(root, candidate, directory, 'offline-python-dependencies', ['/opt/homebrew/bin/uv', 'sync', '--locked', '--offline', '--all-packages', '--group', 'security'], false, 300000)];
}

export function verifyBatchTask(root, candidate, directory, baseline, task) {
  const initialChanges = changedFiles(root, candidate, baseline, task.files, task.id);
  if (task.files.some(name => !initialChanges.some(row => row.name === name))) throw new Error('Required implementation, tests or documentation are missing.');
  const checks = [];
  if (task.checkGroup === 'full' || task.id === 'US-105') checks.push(trustedCommand(root, candidate, directory, 'automation', [toolchain(root).node, '--test', '--test-concurrency=1', join(root, 'tools/ralph/automation.test.mjs')], false, 240000));
  for (const [index, arguments_] of task.checks.entries()) checks.push(trustedCommand(root, candidate, directory, `quality-${index + 1}`, [toolchain(root).pnpm, ...arguments_], true, 600000, task.id));
  checks.push(trustedCommand(root, candidate, directory, 'publication-and-secrets', [toolchain(root).python, '-B', 'ci/security.py'], true, 600000, task.id));
  let changes = changedFiles(root, candidate, baseline, task.files, task.id);
  if (!same(changes, initialChanges)) throw new Error('Source changed during verification.');
  if (task.checkGroup === 'full' || task.id === 'US-105') {
    const note = `\n\nIndependent ${BATCH_ID.toUpperCase()} host acceptance — ${new Date().toISOString()}:\n\n${checks.map(check => `- PASS: ${check.name} (${check.command.join(' ')})`).join('\n')}\n\nAll listed commands completed with exit0 using private local fixtures. Actual full outputs and hashes are retained in the task's private checks directory. Online advisory audit: SKIP (offline batch). Synthetic simulation only; production readiness, real source semantics/identity/labels and the real2GB trial remain unverified/deferred. Task completion is controlled by a durable host receipt after guarded promotion.\n`;
    for (const name of registered ? task.files.filter(name=>name.endsWith('.md')) : ['docs/operations/pretransfer-simulator.md', 'docs/implementation-status/current.md']) writeFileSync(join(candidate, name), readFileSync(join(candidate, name), 'utf8') + note);
    changes = changedFiles(root, candidate, baseline, task.files, task.id);
  }
  return { changes, evidence: { checks, candidateSourceSha256: digest(changes), baselineSha256: digest(baseline), onlineAdvisoryAudit: 'SKIP: offline synthetic batch', productionReady: false } };
}

async function realSandboxSmoke(root, directory, home) {
  const receiptFile = join(directory, 'real-sandbox-smoke.json');
  const existing = optional(receiptFile);
  if (existing?.passed && existing.selectedHome === home) return existing;
  const candidate = privateDirectory(join(directory, 'real-smoke/candidate'));
  if (!existsSync(join(candidate, '.git'))) spawnSync(toolchain(root).git, ['init', '--quiet', '-b', 'main'], { cwd: candidate, env: environment(root, home) });
  const outside = join(dirname(candidate), 'protected.txt');
  if (!existsSync(outside)) writeFileSync(outside, 'original', { mode: 0o600 });
  const result = await runAgent({ executable: toolchain(root).codex, arguments_: buildBatchCodexArguments(root,RESPONSE_SCHEMA), prompt: `Approved isolated sandbox smoke only. In the current directory create exactly smoke.txt containing SANDBOX_OK followed by one newline. Do not read other paths, auth, environment, Git, projects or configuration. Do not use network or any other agent. Do not modify outside this directory. Return JSON task_id ${TASKS[0].id}, status ready_for_verification, production_ready false, notes an empty array. The host will verify the actual file.`, cwd: candidate, env: { ...environment(candidate, home), TMPDIR: privateDirectory(join(candidate, 'tmp')) }, timeout: 180000, validate: text => validateBatchReport(text, TASKS[0].id), emit: () => {}, verify: () => {
    if (readFileSync(join(candidate, 'smoke.txt'), 'utf8') !== 'SANDBOX_OK\n' || readFileSync(outside, 'utf8') !== 'original') throw new Error('Real sandbox smoke failed.');
    return { fileVerified: true, sentinelPreserved: true };
  } });
  const receipt = { passed: result.status === 'verified', status: result.status, exitCode: result.exitCode, selectedHome: home, evidence: result.evidence ?? null, checkedAt: new Date().toISOString() };
  writeJson(receiptFile, receipt);
  if (!receipt.passed) throw new Error(`Real Codex sandbox smoke stopped: ${receipt.status}. No application task started.`);
  return receipt;
}

export async function batchAdapter(args) {
  if (same(args, ['--version'])) { process.stdout.write('codex-cli 0.164.0\n'); return; }
  if (!same(args, ['exec', '--json', '--sandbox', 'read-only', '-'])) throw new Error('Unexpected Ralph adapter arguments.');
  const directory = batchDirectory();
  const run = readJson(join(directory, 'run.json'));
  if (process.env.CODEX_HOME !== environment(ROOT, run.selectedHome).CODEX_HOME || !alive(run.launcherPid)) throw new Error('Batch must be started through its trusted launcher.');
  let input = '';
  for await (const chunk of process.stdin) { input += chunk; if (Buffer.byteLength(input) > 256000) throw new Error('Prompt is too large.'); }
  const matches = [...input.matchAll(/^RALPH_TASK_ID=(US-\d+)$/gm)];
  if (matches.length !== 1) throw new Error('Exactly one approved task is required.');
  const state = batchReconcile(ROOT, true);
  if (matches[0][1] !== state.nextTask) throw new Error('Ralph selected a task out of approved order.');
  const task = TASKS.find(item => item.id === state.nextTask);
  const requireStorage = () => {
    try { assertVerificationCapacity(ROOT); }
    catch (error) {
      writeJson(join(directory,'last-agent.json'),{status:'storage-unavailable',exitCode:EXIT.state,taskId:task.id,selectedHome:run.selectedHome,manualActionRequired:true,automaticRetry:false,updatedAt:new Date().toISOString()});
      throw error;
    }
  };
  requireStorage();
  const folder = privateDirectory(taskDirectory(ROOT, task.id));
  const approved = readJson(join(directory, 'approved.json'));
  const baseline = batchSnapshot(ROOT);
  let work = optional(join(folder, 'work.json'));
  const maintenanceFile = optional(join(directory, 'maintenance.json'));
  const updates = maintenanceFile?.updates ?? (maintenanceFile ? [maintenanceFile] : []);
  const maintenance = updates.find(update => update.beforeTask === task.id && work && same(work.baseline, update.before) && same(baseline, update.after));
  if (work && maintenance) {
    for (const name of maintenance.changedFiles) {
      const original = work.baseline.source.find(row => row.name === name);
      if (!original || digest(readFileSync(join(work.candidate, name))) !== original.sha256) throw new Error('Candidate changed a protected maintenance file.');
      copyFileSync(join(ROOT, name), join(work.candidate, name));
    }
    writeJson(join(folder, 'maintenance-rebase.json'), { before: work.baseline, after: baseline, copiedTrustedFiles: maintenance.changedFiles });
    work.baseline = baseline;
    writeJson(join(folder, 'work.json'), work);
  }
  if (!work) {
    const candidate = makeCandidate(ROOT, folder, baseline);
    work = { candidate, baseline, selectedHome: run.selectedHome, prepared: false };
    writeJson(join(folder, 'work.json'), work);
  }
  if (!same(work.baseline, baseline) || work.selectedHome !== run.selectedHome) throw new Error('Candidate needs manual reconciliation.');
  if (!work.prepared) {
    try { prepareDependencies(ROOT, work.candidate, folder); restoreInstallerFormatting(ROOT, work.candidate, work.baseline); }
    catch {
      const record = { status: 'offline-setup-failed', exitCode: EXIT.state, taskId: task.id, selectedHome: run.selectedHome, manualActionRequired: true, updatedAt: new Date().toISOString() };
      writeJson(join(directory, 'last-agent.json'), record);
      throw new Error('Offline candidate dependency setup failed; private check logs preserved.');
    }
    work.prepared = true;
    writeJson(join(folder, 'work.json'), work);
    const preserved = optional(join(directory, 'preserved-us101.json'));
    if (task.id === 'US-101' && preserved) {
      for (const name of task.files) copyFileSync(join(preserved.candidate, name), join(work.candidate, name));
      writeJson(join(folder, 'preserved-implementation.json'), { source: preserved.candidate, files: task.files, reason: 'Resume existing implementation after trusted installer correction; do not implement again.' });
    }
  }
  requireStorage();
  const tracker = readJson(join(ROOT, BATCH_TRACKER));
  const story = tracker.userStories.find(item => item.id === task.id);
  const contract = readFileSync(join(ROOT, DOCUMENT), 'utf8') + (registered ? '\nFULL REVIEWED PROPOSAL:\n' + readFileSync(join(ROOT,registered.proposal),'utf8') + '\nEXACT FILE-FIELD PERMISSIONS:\n' + JSON.stringify(task.edits) : '');
  const prompt = `${input}\nAPPROVED BATCH CONTRACT:\n${contract}\nCURRENT TASK ${task.id}: ${JSON.stringify(story)}\nYou are authorized to implement this current task now. Other tasks are context only. Work ONLY in the current isolated candidate. Allowed changed files: ${JSON.stringify(task.files)}. Existing tests, AGENTS.md, lockfiles, dependencies, scripts and automation guards are protected. No Git commits, login/logout, account switching, network, real data, DB commands, providers, deployment or reading outside the candidate. Do not read .env/auth/CODEX_HOME. Do not edit a task tracker or automation files. For US-101 add only the approved contracts subpath export. For US-102/103 append only the matching export to the risk index. For US-104 add root script exactly: pnpm --filter @lmps/risk-workers build && pnpm exec node apps/risk-workers/scripts/pretransfer-simulate.mjs. Existing offline dependencies are prepared. You may inspect and run relevant checks in the candidate. The host independently runs all policy checks; do not claim a check you did not run. If previous edits exist, reconcile them and finish this task; do not reimplement prior tasks. Return the required structured JSON with status ready_for_verification only after actual implementation/tests; use blocked if missing decisions. Do not output COMPLETE.\n`;
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.on('SIGINT', abort); process.on('SIGTERM', abort);
  const emit = event => process.stdout.write(JSON.stringify(event) + '\n');
  let result;
  try {
    result = await runAgent({ executable: toolchain().codex, arguments_: buildBatchCodexArguments(ROOT,RESPONSE_SCHEMA), prompt: prompt + '\nVerification routing: the coding-agent sandbox intentionally cannot run legacy integration suites that create /tmp database fixtures or listen on localhost. Run the NEW current-task unit/subprocess tests and relevant typechecks available in this sandbox. The independent host verifier runs EVERY required worker/root suite using its tested local-fixture permission profile, private offline caches and owned local fixtures before promotion. Mark ready_for_verification when the current implementation and available unit checks are ready for that host review, listing host-only checks as pending. Actual code/test failures still require blocked. For the final task write an honest handoff with host gates pending; the trusted verifier appends actual successful check evidence after they pass. Never invent results, change permissions or bypass a blocked check yourself.\n', cwd: work.candidate, env: { ...environment(work.candidate, run.selectedHome), TMPDIR: privateDirectory(join(work.candidate, '.local/agent-tmp')) }, timeout: 1200000, signal: controller.signal, emit, validate: text => validateBatchReport(text, task.id), verify: () => {
      let verified;
      try { verified = verifyBatchTask(ROOT, work.candidate, folder, baseline, task); }
      catch (error) { writeJson(join(folder, 'verification-failure.json'), { status: 'failed', reason: error.message, checkedAt: new Date().toISOString() }); throw error; }
      const journal = promote(ROOT, work.candidate, folder, baseline, verified.changes, verified.evidence);
      const receipt = { status: 'verified', taskId: task.id, policySha256: policyDigest(ROOT), selectedHome: run.selectedHome, before: baseline, after: journal.after, changes: verified.changes, evidence: verified.evidence, verifiedAt: new Date().toISOString() };
      writeJson(join(folder, 'receipt.json'), receipt);
      if (registered) retireVerificationCache(ROOT,folder);
      if (registered?.registration.planTaskIds) retireCompletedDependencies(ROOT,folder);
      return verified.evidence;
    } });
  } finally { process.off('SIGINT', abort); process.off('SIGTERM', abort); }
  const { report, evidence, ...summary } = result;
  const record = { ...summary, taskId: task.id, selectedHome: run.selectedHome, updatedAt: new Date().toISOString() };
  writeJson(join(folder, 'agent-result.json'), record);
  if (report) writeJson(join(folder, 'agent-notes.json'), report);
  writeJson(join(directory, 'last-agent.json'), record);
  if (result.status !== 'verified') {
    process.stderr.write(`STOP ${task.id}: ${result.status}; candidate preserved. No retry, logout or account switch.\n`);
    process.exitCode = result.exitCode;
    return;
  }
  batchReconcile(ROOT, true);
  emit({ type: 'item.completed', item: { type: 'agent_message', text: `${task.id} independently verified and durably recorded.\n<promise>COMPLETE</promise>` } });
}

export async function launchBatch({ command, home, headless, handoff = false }, root = ROOT) {
  if (command === 'status') return batchStatus(root);
  if (!['run', 'resume', 'verify'].includes(command)) throw new Error('Batch supports run, resume, status and verify.');
  if (command === 'verify') return batchReconcile(root);
  const release = takeLock(root);
  try {
    const directory = privateDirectory(batchDirectory(root));
    let approved = optional(join(directory, 'approved.json'));
    const previous = optional(join(directory, 'run.json'));
    if (alive(previous?.ralphPid)) throw new Error('A Ralph writer is still running.');
    if (previous && command !== 'resume') {
      const state = batchReconcile(root);
      if (state.status === 'verified') return state;
      throw new Error('An interrupted batch exists. Use explicit resume on the same account.');
    }
    const selectedHandoff = handoffDecision(previous, { command, home, handoff });
    if (!approved) {
      if (registered) assertVerificationCapacity(root);
      probeSandbox(root, directory);
      const checks = spawnSync(toolchain(root).node, ['--test', '--test-concurrency=1', 'tools/ralph/automation.test.mjs'], { cwd: root, env: environment(root, home), timeout: 240000, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
      writeFileSync(join(directory, 'runner-acceptance.log'), `${checks.stdout}\n${checks.stderr}`, { mode: 0o600 });
      if (checks.status !== 0) throw new Error('Runner acceptance failed; write-enabled queue remains disabled.');
      await realSandboxSmoke(root, directory, home);
      approved = { policySha256: policyDigest(root), baseline: batchSnapshot(root), selectedHome: home, approvedAt: new Date().toISOString(), maximumTasks: TASKS.length, scope: `${BATCH_ID.toUpperCase()} only`, automaticRetry: false, automaticAccountRotation: false };
      writeJson(join(directory, 'approved.json'), approved);
    }
    const state = batchReconcile(root, true);
    if (state.status === 'verified') return state;
    if (selectedHandoff) recordManualHandoff(root, selectedHandoff, state);
    const coordinator = privateDirectory(join(directory, 'coordinator'));
    const configDirectory = privateDirectory(join(coordinator, '.ralph-tui'));
    for (const file of ['session.json', 'session-meta.json']) if (existsSync(join(configDirectory, file))) {
      const archive = privateDirectory(join(directory, 'archived-sessions', `${Date.now()}`));
      renameSync(join(configDirectory, file), join(archive, file));
    }
    const config = `configVersion = "2.1"\nmaxIterations = ${TASKS.length}\nautoCommit = false\nagent = "codex"\ncommand = ${JSON.stringify(join(root, 'tools/ralph/agent-adapter.mjs'))}\ntracker = "json"\nfallbackAgents = []\n[agentOptions]\nfullAuto = false\nsandbox = "read-only"\ntimeout = 1800000\n[errorHandling]\nstrategy = "abort"\nmaxRetries = 0\ncontinueOnNonZeroExit = false\n[rateLimitHandling]\nenabled = true\nmaxRetries = 0\nrecoverPrimaryBetweenIterations = false\n[parallel]\nmode = "never"\n[notifications]\nenabled = false\n`;
    writeFileSync(join(configDirectory, 'config.toml'), config, { mode: 0o600 });
    chmodSync(join(root, 'tools/ralph/agent-adapter.mjs'), 0o700);
    const args = ['run', '--cwd', coordinator, '--agent', 'codex', '--prd', join(root, BATCH_TRACKER), '--serial', '--iterations', String(state.remainingCount), '--no-setup', '--prompt', join(root, '.ralph-tui/batch-prompt.hbs'), '--output-dir', join(directory, 'iterations'), '--progress-file', join(directory, 'progress.md')];
    if (headless) args.push('--headless');
    const env = { ...environment(root, home), LMPS_RALPH_BATCH: BATCH_ID, TERM:headless?'dumb':process.env.TERM||'xterm-256color' };
    if(!headless)delete env.NO_COLOR;
    writeJson(join(directory, 'last-agent.json'), { status: 'starting', exitCode: null, taskId: state.nextTask, selectedHome: home, updatedAt: new Date().toISOString() });
    writeJson(join(directory, 'run.json'), { selectedHome: home, launcherPid: process.pid, startedAt: new Date().toISOString(), ralphPid: null });
    const child = spawn(toolchain(root).ralph, args, { cwd: coordinator, env, stdio: 'inherit', shell: false });
    writeJson(join(directory, 'run.json'), { selectedHome: home, launcherPid: process.pid, startedAt: new Date().toISOString(), ralphPid: child.pid ?? null });
    const interrupt = () => child.kill('SIGINT');
    process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt);
    const exit = await new Promise(resolveExit => { child.once('error', () => resolveExit(1)); child.once('exit', code => resolveExit(code ?? EXIT.interrupted)); });
    process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt);
    const after = batchReconcile(root, true);
    if (after.status !== 'verified') process.exitCode = optional(join(directory, 'last-agent.json'))?.exitCode || exit || EXIT.failed;
    return batchStatus(root);
  } finally { release(); }
}
