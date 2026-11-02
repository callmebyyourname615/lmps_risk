import { constants as C, openSync, closeSync, fstatSync, fsyncSync, readSync, writeFileSync, lstatSync, mkdirSync, opendirSync, linkSync, unlinkSync } from 'node:fs';
import { resolve, parse, join, sep, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { detachFeatureJSON } from '@lmps/contracts/feature-catalog';
import { validateFeatureStoreScope, featureStoreScopeIdentity } from '@lmps/contracts/feature-serving';
import { validateFeatureParityPlan, validateFeatureParityInput, compareFeatureParity, featureParityPlanHash } from '@lmps/contracts/feature-parity';
import { evaluateFeatureHealth, freezeFeatureEvidence, type FeatureHealthInput } from '@lmps/risk';

/** Finite fixture retention only: refuse overflow; never delete/evict. No production
 * backend, legal retention/hold, RPO/RTO/SLO closure. Integrated parent acceptance pending.
 */
export const FEATURE_EVIDENCE_POLICY = Object.freeze({ generations: 8, generation_bytes: 2097152, retained_bytes: 16777216, retention_seconds: 86400 });
const encode = (v: unknown): string => JSON.stringify(v, (_k, x: unknown) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : x);
const hash = (v: unknown) => createHash('sha256').update(encode(v)).digest('hex');
function check(v: unknown): asserts v { if (!v) throw new Error('FEATURE_EVIDENCE_INVALID'); }
export interface FeatureEvidenceContext { scope: unknown; plan: unknown; input: unknown }
export interface FeatureEvidenceTrial { online: unknown; offline: unknown; health: FeatureHealthInput }
function context(value: FeatureEvidenceContext) {
  const x = detachFeatureJSON(value); check(Object.keys(x).sort().join(',') === 'input,plan,scope');
  const scope = validateFeatureStoreScope(x.scope), plan = validateFeatureParityPlan(x.plan), input = validateFeatureParityInput(x.input);
  check(plan.input_sha256 === hash(input));
  return { scope: hash(featureStoreScopeIdentity(scope)), plan: featureParityPlanHash(plan), corpus: hash(input), binding: hash({ scope, plan, input }), runtime: plan.runtime, semantics: plan.semantics, fixture_now: plan.fixture.now };
}
function summarize(ctx: FeatureEvidenceContext, trial: FeatureEvidenceTrial) {
  const x = detachFeatureJSON(trial); check(Object.keys(x).sort().join(',') === 'health,offline,online');
  check(featureParityPlanHash(x.health.plan) === featureParityPlanHash(ctx.plan));
  const parity = compareFeatureParity(ctx.plan, ctx.input, x.online, x.offline), health = evaluateFeatureHealth(x.health);
  // Neither caller observations nor flags can issue actual runtime acceptance.
  return { parity, health, trial_sha256: hash(x), acceptance: 'pending_independent_runtime_verification' as const, production_ready: false as const };
}
export interface FeatureEvidenceGeneration {
  readonly version: 1; readonly generation: number; readonly binding: ReturnType<typeof context>;
  readonly summary: ReturnType<typeof summarize>; readonly content_sha256: string;
}
function privateRead(path: string, max: number): string {
  const fd = openSync(path, C.O_RDONLY | C.O_NOFOLLOW | C.O_NONBLOCK);
  try { const s = fstatSync(fd); check(s.isFile() && s.nlink === 1 && s.uid === process.getuid?.() && (s.mode & 0o777) === 0o600 && s.size <= max);
    const b = Buffer.alloc(max + 1); let n = 0, k; while ((k = readSync(fd, b, n, b.length - n, null)) > 0) { n += k; check(n <= max); }
    const text = b.subarray(0, n).toString('utf8'); check(Buffer.from(text).equals(b.subarray(0, n))); return text;
  } finally { closeSync(fd); }
}
function exclusive(path: string, text: string) { const fd = openSync(path, C.O_CREAT | C.O_EXCL | C.O_WRONLY | C.O_NOFOLLOW, 0o600); try { writeFileSync(fd, text); fsyncSync(fd); } finally { closeSync(fd); } }
/** Import inert cooperating-writer protocol. Stranded lock/stage fails closed;
 * no PID takeover, wall clock, CLI or runner injection. Stable ancestors required.
 */
export function openFeatureEvidence(directory: string, supplied: FeatureEvidenceContext, limits = FEATURE_EVIDENCE_POLICY) {
  limits = detachFeatureJSON(limits);
  check(Object.keys(limits).sort().join(',') === Object.keys(FEATURE_EVIDENCE_POLICY).sort().join(','));
  for (const key of Object.keys(FEATURE_EVIDENCE_POLICY) as (keyof typeof FEATURE_EVIDENCE_POLICY)[]) check(Number.isSafeInteger(limits[key]) && limits[key] > 0 && limits[key] <= FEATURE_EVIDENCE_POLICY[key]);
  const ctx = detachFeatureJSON(supplied) as FeatureEvidenceContext, binding = context(ctx);
  check(validateFeatureParityPlan(ctx.plan).fixture.retention_seconds <= limits.retention_seconds);
  check(directory === resolve(directory) && directory.split(sep).includes('.local'));
  const ancestors = () => { let current = parse(directory).root;
    for (const part of directory.slice(current.length).split(sep).slice(0, -1)) { current = join(current, part); const s = lstatSync(current); check(s.isDirectory() && !s.isSymbolicLink() && (s.mode & 0o022) === 0); }
  };
  const assertDir = () => { ancestors(); const s = lstatSync(directory); check(s.isDirectory() && !s.isSymbolicLink() && s.uid === process.getuid?.() && (s.mode & 0o777) === 0o700); };
  const sync = () => { const fd = openSync(directory, C.O_RDONLY | C.O_DIRECTORY | C.O_NOFOLLOW); try { fsyncSync(fd); } finally { closeSync(fd); } };
  ancestors(); let fresh = false; try { mkdirSync(directory, { mode: 0o700 }); fresh = true; } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
  assertDir();
  if (fresh) { const fd = openSync(dirname(directory), C.O_RDONLY | C.O_DIRECTORY | C.O_NOFOLLOW); try { fsyncSync(fd); } finally { closeSync(fd); } }
  const originalDir = lstatSync(directory);
  const lock = join(directory, 'writer.lock'), token = randomUUID(); exclusive(lock, token); sync();
  let closed = false;
  const owner = encode({ version: 1, binding, policy: limits });
  const scan = () => {
    check(!closed); assertDir(); const d = lstatSync(directory); check(d.ino === originalDir.ino && d.dev === originalDir.dev);
    check(privateRead(lock, 100) === token); check(privateRead(join(directory, 'owner.json'), 2097152) === owner);
    const dir = opendirSync(directory), names: string[] = [];
    try { let e; while ((e = dir.readSync())) { check(names.length < limits.generations + 2); names.push(e.name); } } finally { dir.closeSync(); }
    const gens = names.filter(n => /^generation-[1-8]\.json$/.test(n)).sort(); check(names.length === gens.length + 2 && names.includes('owner.json') && names.includes('writer.lock'));
    let bytes = Buffer.byteLength(owner);
    const values = gens.map((n, i) => { check(n === `generation-${i + 1}.json`); const raw = privateRead(join(directory, n), limits.generation_bytes); bytes += Buffer.byteLength(raw);
      const v = JSON.parse(raw); check(raw === encode(v) && Object.keys(v).sort().join(',') === 'binding,content_sha256,generation,summary,version' && v.version === 1 && v.generation === i + 1 && encode(v.binding) === encode(binding));
      check(v.content_sha256 === hash({ binding: v.binding, generation: v.generation, summary: v.summary, version: v.version }));
      check(v.summary.acceptance === 'pending_independent_runtime_verification' && v.summary.production_ready === false); return v; });
    check(bytes <= limits.retained_bytes); return { values, bytes };
  };
  try { if (fresh) { exclusive(join(directory, 'owner.json'), owner); sync(); } scan(); }
  catch (e) { if (privateRead(lock, 100) === token) { unlinkSync(lock); sync(); } throw e; }
  return {
    publish(trial: FeatureEvidenceTrial) {
      const before = scan(), summary = summarize(ctx, trial), generation = before.values.length + 1;
      check(generation <= limits.generations);
      const body = { version: 1, generation, binding, summary }, value = { ...body, content_sha256: hash(body) }, text = encode(value), size = Buffer.byteLength(text);
      check(size <= limits.generation_bytes && before.bytes + size <= limits.retained_bytes);
      const stage = join(directory, 'stage-' + token), target = join(directory, `generation-${generation}.json`);
      exclusive(stage, text); linkSync(stage, target); unlinkSync(stage); sync(); scan(); return freezeFeatureEvidence(JSON.parse(text) as FeatureEvidenceGeneration);
    },
    read(generation: number, trial: FeatureEvidenceTrial) {
      check(Number.isSafeInteger(generation) && generation >= 1); const { values } = scan(); const v = values[generation - 1]; check(v && encode(v.summary) === encode(summarize(ctx, trial))); return freezeFeatureEvidence(structuredClone(v) as FeatureEvidenceGeneration);
    },
    close() { if (closed) return; scan(); unlinkSync(lock); sync(); closed = true; }
  };
}
