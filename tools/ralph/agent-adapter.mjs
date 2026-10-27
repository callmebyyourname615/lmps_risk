#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { EXIT, ROOT, STATE_DIRECTORY, TASK_ID, assertCheckpoint, digest, environment, readTracker, reconcile, toolchain, trackerDefinition, writeJson } from './state.mjs';
import { verifyIntake } from './verification.mjs';

export function classifyFailure(value, now = Date.now()) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  let kind = 'failed';
  if (/usage_limit_reached|rate[_ -]limit(?:[_ -]exceeded)?|insufficient_quota|quota[_ -]exceeded|you(?:'|’)ve hit your usage limit|usage limit (?:has been )?(?:reached|exceeded)|too many requests|(?:HTTP|status|code)[\s:=]*429/i.test(text)) kind = 'quota';
  else if (/refresh_token_reused|refresh_token_expired|invalid_grant|authentication (?:failed|required)|not logged in|unauthorized|(?:HTTP|status|code)[\s:=]*401/i.test(text)) kind = 'authentication';
  else if (/ECONNRESET|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|network|connection|TLS|certificate/i.test(text)) kind = 'network';
  let retryAt = null;
  if (kind === 'quota' && value && typeof value === 'object') {
    const detail = value.error && typeof value.error === 'object' ? value.error : value;
    const reset = detail.resets_at ?? detail.reset_at;
    const seconds = detail.retry_after_seconds;
    const candidate = typeof seconds === 'number' ? now + seconds * 1000 : typeof reset === 'number' ? reset * 1000 : typeof reset === 'string' ? Date.parse(reset) : NaN;
    if (Number.isFinite(candidate) && candidate > now && candidate < now + 30 * 86400000) retryAt = new Date(candidate).toISOString();
  }
  return { kind, retryAt, exitCode: kind === 'network' ? EXIT.failed : EXIT[kind] };
}

export function validateReport(text) {
  let report;
  try { report = JSON.parse(text); } catch { throw new Error('Agent did not return the required structured audit report.'); }
  const expected = ['ACCOUNT_IDENTITY', 'HISTORICAL_AVAILABILITY', 'PRODUCTION_APPROVAL', 'REAL_LABELS', 'SOURCE_SEMANTICS'];
  if (report.task_id !== TASK_ID || report.status !== 'verified' || report.must_items !== 104 || report.plan_documents !== 11 || report.production_ready !== false || report.read_only !== true || !Array.isArray(report.blocker_codes) || JSON.stringify([...report.blocker_codes].sort()) !== JSON.stringify(expected)) throw new Error('Agent report does not satisfy the approved intake criteria.');
  return { task_id: TASK_ID, status: 'verified', must_items: 104, plan_documents: 11, production_ready: false, read_only: true, blocker_codes: expected };
}

export async function runAgent({ executable, arguments_, prompt, cwd, env, verify, validate = validateReport, emit = () => {}, timeout = 300000, signal }) {
  let pending = '';
  let stderr = '';
  let totalBytes = 0;
  let reportText = null;
  let failure = null;
  let completed = false;
  let interrupted = false;
  let timedOut = false;
  let events = 0;
  const child = spawn(executable, arguments_, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], shell: false });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  let killTimer;
  const terminate = () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill('SIGTERM');
    killTimer ??= setTimeout(() => child.kill('SIGKILL'), 3000);
  };
  const stop = () => {
    interrupted = true;
    terminate();
  };
  signal?.addEventListener('abort', stop, { once: true });
  if (signal?.aborted) stop();
  const timer = setTimeout(() => {
    timedOut = true;
    terminate();
  }, timeout);
  const acceptLine = line => {
    if (!line.trim()) return;
    let event;
    try { event = JSON.parse(line); } catch { failure ??= { kind: 'failed', retryAt: null, exitCode: EXIT.failed }; terminate(); return; }
    events++;
    if (event.type === 'error' || event.type === 'turn.failed') {
      const detected = classifyFailure(event.error ?? event.message ?? event);
      if (!failure || detected.kind === 'quota') failure = detected;
    }
    if (event.type === 'turn.completed') completed = true;
    if (event.type === 'item.completed' && event.item?.type === 'agent_message') reportText = event.item.text;
    if (['thread.started', 'turn.started', 'turn.completed'].includes(event.type)) emit({ type: 'item.completed', item: { type: 'agent_message', text: `Codex progress: ${event.type}; raw output withheld.` } });
  };
  child.stdout.on('data', chunk => {
    totalBytes += Buffer.byteLength(chunk);
    if (totalBytes > 16 * 1024 * 1024) { failure = { kind: 'failed', retryAt: null, exitCode: EXIT.failed }; terminate(); return; }
    pending += chunk.toString('utf8');
    const lines = pending.split('\n');
    pending = lines.pop();
    if (Buffer.byteLength(pending) > 2 * 1024 * 1024) { failure = { kind: 'failed', retryAt: null, exitCode: EXIT.failed }; terminate(); return; }
    for (const line of lines) acceptLine(line);
  });
  child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString('utf8')).slice(-65536); });
  child.stdin.on('error', () => {});
  child.stdin.end(prompt);
  const result = await new Promise(resolveResult => {
    child.once('error', () => resolveResult({ code: 1, signal: null }));
    child.once('close', (code, childSignal) => resolveResult({ code, signal: childSignal }));
  });
  clearTimeout(timer);
  signal?.removeEventListener('abort', stop);
  if (pending.trim()) acceptLine(pending);
  clearTimeout(killTimer);
  if (timedOut) return { status: 'timeout', exitCode: EXIT.timeout, events };
  if (interrupted) return { status: 'interrupted', exitCode: EXIT.interrupted, events };
  if (failure) return { status: failure.kind, exitCode: failure.exitCode, retryAt: failure.retryAt, events };
  if (result.signal) return { status: 'interrupted', exitCode: EXIT.interrupted, events };
  if (result.code !== 0) {
    const detected = classifyFailure(stderr);
    return { status: detected.kind, exitCode: detected.exitCode, retryAt: detected.retryAt, events };
  }
  if (!completed || !reportText) return { status: 'incomplete', exitCode: EXIT.failed, events };
  let report;
  try {
    report = validate(reportText);
    const evidence = await verify(report);
    return { status: 'verified', exitCode: 0, events, report, evidence };
  } catch (error) {
    if (error.code === 'AGENT_BLOCKED') return { status: 'blocked', exitCode: EXIT.verification, events, report: error.report };
    return { status: 'verification-failed', exitCode: EXIT.verification, events, ...(report ? { report } : {}) };
  }
}

export function buildCodexArguments(root = ROOT) {
  return ['-a', 'never', 'exec', '--ignore-user-config', '--ignore-rules', '--sandbox', 'read-only', '--json', '--output-schema', join(root, 'tools/ralph/pilot-response.schema.json'), '-'];
}

async function main() {
  const args = process.argv.slice(2);
  if (process.env.LMPS_RALPH_BATCH) {
    const { batchAdapter } = await import('./batch-policy.mjs');
    return batchAdapter(args);
  }
  if (args.length === 1 && args[0] === '--version') {
    const result = spawnSync(toolchain().codex, ['--version'], { env: environment(), encoding: 'utf8', timeout: 15000 });
    if (result.status !== 0) throw new Error('Pinned Codex executable is unavailable.');
    process.stdout.write(result.stdout);
    return;
  }
  if (JSON.stringify(args) !== JSON.stringify(['exec', '--json', '--sandbox', 'read-only', '-'])) throw new Error('Adapter accepts only the approved read-only execution arguments.');
  let prompt = '';
  for await (const chunk of process.stdin) {
    prompt += chunk;
    if (Buffer.byteLength(prompt) > 256000) throw new Error('Prompt is too large.');
  }
  if (prompt.split('\n').filter(line => line === `RALPH_TASK_ID=${TASK_ID}`).length !== 1) throw new Error('Unapproved task or preflight prompt rejected.');
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.on('SIGINT', abort);
  process.on('SIGTERM', abort);
  const emit = event => process.stdout.write(JSON.stringify(event) + '\n');
  const state = reconcile(ROOT);
  if (state.complete) {
    emit({ type: 'item.completed', item: { type: 'agent_message', text: '<promise>COMPLETE</promise>' } });
    return;
  }
  const selectedHome = ['plusb', 'pluse', 'plusd'].find(home => process.env.CODEX_HOME === environment(ROOT, home).CODEX_HOME);
  if (!selectedHome) throw new Error('Select an existing CODEX_HOME through the launcher.');
  const result = await runAgent({
    executable: toolchain().codex,
    arguments_: buildCodexArguments(),
    prompt,
    cwd: ROOT,
    env: environment(ROOT, selectedHome),
    verify: () => verifyIntake(),
    emit,
    signal: controller.signal,
  });
  const { report, evidence, ...summary } = result;
  writeJson(join(ROOT, STATE_DIRECTORY, 'agent-result.json'), { ...summary, taskId: TASK_ID, selectedHome, updatedAt: new Date().toISOString() });
  if (result.status === 'verified') {
    const checkpoint = assertCheckpoint();
    writeJson(join(ROOT, STATE_DIRECTORY, 'receipt.json'), {
      status: 'verified', taskId: TASK_ID, selectedHome, verifiedAt: new Date().toISOString(),
      definitionSha256: digest(trackerDefinition(readTracker())), planSha256: digest(checkpoint.snapshot.plan),
      sourceSha256: digest(checkpoint.snapshot.source), report, evidence,
    });
    emit({ type: 'item.completed', item: { type: 'agent_message', text: 'US-001 independently verified; application files and original plans preserved.\n<promise>COMPLETE</promise>' } });
  } else {
    process.stderr.write(`Ralph stopped: ${result.status}. Task remains unfinished. Inspect launcher status; no automatic retry, logout or account switch.\n`);
    process.exitCode = result.exitCode;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    process.stderr.write('Adapter stopped safely: state, arguments or runtime require review. Raw details withheld.\n');
    process.exitCode = EXIT.state;
  });
}
