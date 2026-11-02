import { createHash } from 'node:crypto';
import { FeatureServingError, validateFeatureStoreScope, validateFeaturePublication, validateFeatureServingRequest,
  featurePublicationContentHash, featureStoreScopeIdentity, type FeaturePublication, type FeatureServingResult } from '@lmps/contracts/feature-serving';
import { restoreFeatureStream, serveFeatureSnapshot } from '@lmps/risk';

export interface OwnedFeatureCacheRuntime {
  ready(): boolean;
  request(args: string[]): Promise<unknown>;
  receipt(): { mode: string; unit_only: boolean; native_acceptance: boolean; production_ready: boolean; binarySha256: string };
}
export const FEATURE_CACHE_LIMITS = Object.freeze({ keys: 1, bytes: 1048576, records: 2000, queries: 8, ttl_seconds: 86400, timeout_ms: 1100 });
const PIN = '48a07c38 92d5982a 1af6c3fb b9db896b 50e7aa56 4b1d4e6a bcb12fcb 6b6b6e0d'.replaceAll(' ', '');
const KEY = 'lmps:local_synthetic:feature-cache:1';
/** UTF-8 value budget, inclusive. Checked before transport or JSON parsing. */
export function validateFeatureCacheBytes(text: unknown): asserts text is string {
  check(typeof text === 'string' && Buffer.byteLength(text) <= FEATURE_CACHE_LIMITS.bytes);
}
const encode = (v: unknown): string => JSON.stringify(v, (_k, x: unknown) => x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : x);
function check(v: unknown): asserts v { if (!v) throw new FeatureServingError(); }

/** One retained head per newly owned runtime; expiry is logical, never eviction.
 * Scope includes workspace, namespace, full plan, policy and serving version.
 * Lua compares generation/predecessor/content atomically on the Redis server.
 */
export const FEATURE_CACHE_CAS = `
local old = redis.call('GET', KEYS[1])
if redis.call('DBSIZE') ~= (old and 1 or 0) then return 'capacity' end
if string.len(ARGV[1]) > 1048576 then return 'capacity' end
local n = cjson.decode(ARGV[1])
if old then
  local ok, p = pcall(cjson.decode, old)
  if not ok or p.scope ~= n.scope then return 'conflict' end
  if old == ARGV[1] then return 'idempotent' end
  if ARGV[2] == 'rebuild' then return 'conflict' end
  if redis.sha1hex(old) ~= ARGV[3] then return 'conflict' end
  if n.generation ~= p.generation + 1 or n.previous_generation ~= p.generation or n.previous_hash ~= p.hash then return 'conflict' end
else
  if ARGV[3] ~= '' then return 'conflict' end
  if ARGV[2] ~= 'rebuild' and (n.generation ~= 1 or n.previous_generation ~= 0) then return 'conflict' end
end
redis.call('SET', KEYS[1], ARGV[1])
return 'published'
`;
export type FeatureCacheRead = FeatureServingResult | {
  version: FeatureServingResult['version']; request: FeatureServingResult['request']; status: 'unavailable';
  reason: 'CACHE_UNAVAILABLE' | 'CACHE_INVALID'; count: null; amount: null; provenance: null;
};

/** Import-inert synthetic adapter. Only supply a US1001 owned runtime, never a
 * remote configuration. One runtime holds one exact scope and one <=1MiB key.
 * Durable filesystem/cache commits are separate. No fallback is implicit.
 * Timeout has uncertain outcome: retry identical content, never infer rollback.
 * Source age uses query as_of, not cache write time. Logical expiry retains the
 * generation head so old rebuilds cannot reset it. Runtime has no persistence.
 * Rebuild restores and validates retained evidence without rebasing generation;
 * use a NEW owned runtime after restart. No failover/legal/adoption claim.
 * Unit seams do not establish real Redis CAS or restart acceptance.
 */
function adapter(runtime: OwnedFeatureCacheRuntime, config: unknown, unit: boolean) {
  const scope = validateFeatureStoreScope(config), identity = featureStoreScopeIdentity(scope);
  check(scope.plan.limits.records <= FEATURE_CACHE_LIMITS.records && scope.plan.queries.length <= FEATURE_CACHE_LIMITS.queries);
  const receipt = runtime.receipt();
  check(receipt.mode === 'local_synthetic' && receipt.unit_only === unit && receipt.native_acceptance === false && receipt.production_ready === false && receipt.binarySha256 === PIN);
  const scopeHash = createHash('sha256').update(identity).digest('hex');
  const key = KEY + ':' + scopeHash;
  const validate = (input: unknown): FeaturePublication => {
    const p = validateFeaturePublication(input);
    check(featureStoreScopeIdentity(p.scope) === identity);
    p.state = restoreFeatureStream(p.state, scope.plan);
    check(p.content_hash === featurePublicationContentHash(p)); return p;
  };
  const envelope = (p: FeaturePublication) => encode({ version: 1, scope: identity, scope_hash: scopeHash,
    generation: p.generation, hash: p.content_hash, previous_generation: p.predecessor?.generation ?? 0,
    previous_hash: p.predecessor?.content_hash ?? null, publication: p });
  const decode = (raw: unknown): FeaturePublication => {
    validateFeatureCacheBytes(raw);
    const e = JSON.parse(raw), p = validate(e.publication); check(raw === envelope(p)); return p;
  };
  let tail: Promise<unknown> = Promise.resolve();
  const command = (args: string[]): Promise<unknown> => {
    const work = tail.then(async () => {
      check(runtime.ready()); let timer: ReturnType<typeof setTimeout> | undefined;
      try { return await Promise.race([runtime.request(args), new Promise((_, reject) => { timer = setTimeout(() => reject(new FeatureServingError()), FEATURE_CACHE_LIMITS.timeout_ms); })]); }
      finally { clearTimeout(timer); }
    });
    tail = work.catch(() => {}); return work;
  };
  const publish = async (input: unknown, rebuild = false) => {
    const p = validate(input), text = envelope(p); validateFeatureCacheBytes(text);
    // Validation read is advisory only. Lua compares its fingerprint plus the
    // SHA256 publication predecessor atomically. Only the fingerprint is sent
    // twice, keeping a full-size update below US1001's 2MiB request bound.
    const prior = await command(['GET', key]);
    if (prior !== null) {
      const previous = decode(prior);
      if (p.generation !== previous.generation) {
        check(p.state.next_offset >= previous.state.next_offset);
        check(encode(p.state.deliveries.slice(0, previous.state.deliveries.length)) === encode(previous.state.deliveries));
        check(encode(p.state.snapshots.slice(0, previous.state.snapshots.length)) === encode(previous.state.snapshots));
      }
    }
    check(prior === null || typeof prior === 'string');
    const fingerprint = prior === null ? '' : createHash('sha1').update(prior).digest('hex');
    const result = await command(['EVAL', FEATURE_CACHE_CAS, '1', key, text, rebuild ? 'rebuild' : 'publish', fingerprint]);
    check(result === 'published' || result === 'idempotent');
    return { status: result, generation: p.generation, content_hash: p.content_hash, production_ready: false as const };
  };
  return Object.freeze({
    capability: Object.freeze({ mode: 'local_synthetic', scope_hash: scopeHash, ...FEATURE_CACHE_LIMITS, production_ready: false, unit_only: unit }),
    publish: (input: unknown) => publish(input),
    async serve(input: unknown): Promise<FeatureCacheRead & { source_age_seconds: number }> {
      const request = validateFeatureServingRequest(input);
      const source_age_seconds = (Date.parse(request.now) - Date.parse(request.query.as_of)) / 1000;
      const unavailable = (reason: 'CACHE_UNAVAILABLE' | 'CACHE_INVALID') => ({ version: scope.version, request, status: 'unavailable' as const, reason, count: null, amount: null, provenance: null, source_age_seconds });
      const preliminary = serveFeatureSnapshot(null, scope, request);
      if (preliminary.reason !== 'PUBLICATION_MISSING') return { ...preliminary, source_age_seconds };
      let raw: unknown;
      try { raw = await command(['GET', key]); } catch { return unavailable('CACHE_UNAVAILABLE'); }
      try {
        if (raw === null) return { ...preliminary, source_age_seconds };
        const p = decode(raw);
        return { ...serveFeatureSnapshot(p, scope, request), source_age_seconds };
      } catch { return unavailable('CACHE_INVALID'); }
    },
    async rebuild(retained: unknown) {
      // Independently replays arithmetic/hash validation; never fabricates gen 1.
      return publish(validate(retained), true);
    },
  });
}
export const openFeatureCache = (runtime: OwnedFeatureCacheRuntime, scope: unknown) => adapter(runtime, scope, false);
/** Explicit trusted unit seam; cannot generate native acceptance. */
export const testFeatureCache = (runtime: OwnedFeatureCacheRuntime, scope: unknown) => adapter(runtime, scope, true);
