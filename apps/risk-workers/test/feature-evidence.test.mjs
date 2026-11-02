import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync, symlinkSync, linkSync, chmodSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { openFeatureEvidence as open, FEATURE_EVIDENCE_POLICY as policy } from '../dist/feature-evidence.js';
import { FEATURE_PARITY_VERSION as version, FEATURE_PARITY_SEMANTICS as semantics, featureParityInputHash, featureParityPlanHash, selectFeatureParityCohort } from '@lmps/contracts/feature-parity';
const now = '2026-01-01T12:00:00Z';
function fixture() {
  mkdirSync(resolve('.local'), { recursive: true, mode: 0o700 }); const dir = mkdtempSync(resolve('.local/evidence-unit-'));
  const corpus = JSON.parse(readFileSync(new URL('../../../packages/risk/test/fixtures/feature-streams/golden.json', import.meta.url)));
  const stream = { version: 'synthetic-feature-stream-1', identity: 'synthetic_declared', run_id: 'synthetic_run', input_identity: 'synthetic_golden_v1', namespace: 'synthetic_golden', topic: 'synthetic_golden.synthetic_run', window_seconds: 3600, coverage_start: corpus.coverage_start, queries: corpus.snapshots.map(({ expected, ...q }) => q), limits: { records: 32, revisions: 32, snapshots: 8, capture_bytes: 32768, state_bytes: 1048576 } };
  const scope = { version: 'synthetic-feature-serving-1', mode: 'local_synthetic', workspace_key: 'synthetic_workspace', plan: stream, policy: { id: 'synthetic_fixture', version: 'synthetic_v1', max_age_seconds: 120 } };
  const input = { version, mode: 'local_synthetic', records: [] };
  const query = { id: 'synthetic_empty', key: 'synthetic_key', currency: 'USD', as_of: now, anchor_at: now, window_seconds: 3600, member_ids: [] };
  const plan = { version, mode: 'local_synthetic', input_sha256: featureParityInputHash(input), semantics, runtime: { python: '3.12', typescript: '5.9', source_sha256: 'a'.repeat(64), compiled_sha256: 'b'.repeat(64) }, fixture: { now, retention_seconds: 3600, coverage: 'explicit_cohort_only' }, queries: [query] };
  const ctx = { scope, plan, input }, plan_sha256 = featureParityPlanHash(plan);
  const observation = { query, plan_sha256, input_sha256: plan.input_sha256, cohort_sha256: selectFeatureParityCohort(plan, input, query.id).cohort_sha256, semantics, runtime: plan.runtime, status: 'available', count: '0', amount: '0.00' };
  const trial = { online: [observation], offline: [structuredClone(observation)], health: { plan, now, max_age_seconds: 60, sources: [{ status: 'available', as_of: now, available_at: now, source_position: 0, consumed_position: 0, plan_sha256 }] } };
  return { dir, ctx, trial, path: join(dir, 'store') };
}
test('immutable generations, exact cap, restart, concurrent process refusal and provenance', () => {
  const f = fixture(); try {
    const before = structuredClone(f.trial), s = open(f.path, f.ctx), r = s.publish(f.trial);
    assert.equal(r.summary.parity.comparisons[0].status, 'matched_observations'); assert.equal(r.summary.acceptance, 'pending_independent_runtime_verification'); assert.equal(r.summary.production_ready, false);
    assert(Object.isFrozen(r.summary.health.statuses)); assert.deepEqual(f.trial, before); assert.throws(() => open(f.path, f.ctx));
    const module = new URL('../dist/feature-evidence.js', import.meta.url).href;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', `import {openFeatureEvidence} from ${JSON.stringify(module)}; openFeatureEvidence(${JSON.stringify(f.path)}, ${JSON.stringify(f.ctx)});`], { encoding: 'utf8' }); assert.notEqual(child.status, 0);
    for (let i = 2; i <= 8; i++) assert.equal(s.publish(f.trial).generation, i);
    const original = readFileSync(join(f.path, 'generation-1.json')); assert.throws(() => s.publish(f.trial)); assert.deepEqual(readFileSync(join(f.path, 'generation-1.json')), original);
    s.close();
    const verify = spawnSync(process.execPath, ['--input-type=module', '-e', `import {openFeatureEvidence} from ${JSON.stringify(module)}; const s=openFeatureEvidence(${JSON.stringify(f.path)}, ${JSON.stringify(f.ctx)}); s.read(1, ${JSON.stringify(f.trial)}); s.close();`], { encoding: 'utf8' }); assert.equal(verify.status, 0, verify.stderr);
    const restarted = open(f.path, f.ctx); assert.deepEqual(restarted.read(1, f.trial), r); restarted.close();
    const changed = structuredClone(f.ctx); changed.plan.runtime.python = '3.13'; assert.throws(() => open(f.path, changed));
    const other = structuredClone(f.ctx); other.scope.policy.max_age_seconds++; assert.throws(() => open(f.path, other));
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});
test('exact/one-over generation bytes and retained bytes refuse without truncation', () => {
  const f = fixture(); try {
    const s = open(f.path, f.ctx); s.publish(f.trial); s.close(); const size = readFileSync(join(f.path, 'generation-1.json')).length;
    const owner = JSON.parse(readFileSync(join(f.path, 'owner.json')));
    let total = size;
    for (let i = 0; i < 4; i++) total = size + Buffer.byteLength(JSON.stringify({ ...owner, policy: { ...policy, generation_bytes: size, retained_bytes: total } }));
    for (const [name, limits, pass] of [['exact', { ...policy, generation_bytes: size, retained_bytes: total }, true], ['byte-over', { ...policy, generation_bytes: size - 1 }, false], ['retained-over', { ...policy, generation_bytes: size, retained_bytes: total - 1 }, false]]) {
      const store = open(join(f.dir, name), f.ctx, limits);
      if (pass) { store.publish(f.trial); assert.throws(() => store.publish(f.trial)); } else assert.throws(() => store.publish(f.trial)); store.close();
    }
    assert.throws(() => open(join(f.dir, 'bad-policy'), f.ctx, { ...policy, generations: 9 }));
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});
test('unsafe, corrupt, symlink, hardlink, permission and forged acceptance refusal', () => {
  for (const kind of ['corrupt', 'symlink', 'hardlink', 'mode', 'forged-summary', 'extra']) {
    const f = fixture(); try {
      const s = open(f.path, f.ctx); s.publish(f.trial); s.close(); const file = join(f.path, 'generation-1.json'), saved = join(f.dir, 'saved');
      if (kind === 'corrupt') writeFileSync(file, '{}');
      if (kind === 'forged-summary') { const v = JSON.parse(readFileSync(file)); v.summary.health.status = 'unavailable'; writeFileSync(file, JSON.stringify(v)); }
      if (kind === 'extra') writeFileSync(join(f.path, 'unexpected'), 'x', { mode: 0o600 });
      if (kind === 'mode') chmodSync(file, 0o644);
      if (kind === 'hardlink') linkSync(file, saved);
      if (kind === 'symlink') { writeFileSync(saved, readFileSync(file), { mode: 0o600 }); rmSync(file); symlinkSync(saved, file); }
      assert.throws(() => open(f.path, f.ctx));
    } finally { rmSync(f.dir, { recursive: true, force: true }); }
  }
  const f = fixture(); try {
    assert.throws(() => open(f.dir + '/../unsafe', f.ctx));
    symlinkSync(f.dir, join(f.dir, 'alias')); assert.throws(() => open(join(f.dir, 'alias', 'bad'), f.ctx));
    assert.throws(() => open(join(f.dir, 'retention'), f.ctx, { ...policy, retention_seconds: 3599 }));
    const s = open(f.path, f.ctx); assert.throws(() => s.publish({ ...f.trial, success: true }));
    const wrong = structuredClone(f.trial); wrong.online[0].amount = '1.00'; const r = s.publish(wrong); assert.equal(r.summary.parity.comparisons[0].status, 'mismatch');
    assert.throws(() => s.read(1, f.trial)); s.close();
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});
