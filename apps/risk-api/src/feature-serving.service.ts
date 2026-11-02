import { constants, openSync, closeSync, fstatSync, readSync, lstatSync } from 'node:fs';
import { isAbsolute, resolve, join, parse, sep } from 'node:path';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { validateFeatureStoreScope, featureStoreScopeIdentity, type FeatureStoreScope, type FeatureServingResult } from '../../../packages/contracts/dist/feature-serving.js';
import { validateFeatureApiQuery, FEATURE_API_LIMITS, type FeatureApiResponse, type FeatureApiReason } from '../../../packages/contracts/dist/feature-api.js';
import { serveFeatureSnapshot } from '@lmps/risk';
import type { Principal } from './local-auth.js';
export const FEATURE_READS = Symbol('FEATURE_READS');
/** Structural US1002 capability; not a cache address or launch instruction. */
export interface FeatureCacheRuntime {
  ready(): boolean;
  request(args: string[]): Promise<unknown>;
  receipt(): { mode: string; unit_only: boolean; native_acceptance: boolean; production_ready: boolean; binarySha256: string };
}
type CacheRead = FeatureServingResult | { status: 'unavailable'; reason: 'CACHE_UNAVAILABLE' | 'CACHE_INVALID'; count: null; amount: null; provenance: null };
interface CacheReader { serve(input: unknown): Promise<CacheRead> }
function pathCheck(path: string) {
  if (!isAbsolute(path) || resolve(path) !== path) throw Error();
  let current = parse(path).root;
  for (const part of path.slice(current.length).split(sep).slice(0, -1)) { current = join(current, part); const s = lstatSync(current); if (!s.isDirectory() || s.isSymbolicLink() || (s.mode & 0o022)) throw Error(); }
}
/** Bounded private read only; never opens stores/locks or writes evidence. */
function privateJson(path: string, max: number): unknown {
  pathCheck(path); const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try { const s = fstatSync(fd); if (!s.isFile() || s.nlink !== 1 || s.uid !== process.getuid?.() || (s.mode & 0o777) !== 0o600 || s.size > max) throw Error();
    const b = Buffer.alloc(max + 1); let n = 0; while (n < b.length) { const r = readSync(fd, b, n, b.length - n, n); if (!r) break; n += r; } if (n > max) throw Error();
    const text = b.subarray(0,n).toString('utf8'); if (!Buffer.from(text).equals(b.subarray(0,n))) throw Error(); return JSON.parse(text);
  } finally { closeSync(fd); }
}
export interface FeatureFixture { mode: 'local_synthetic'; scope: FeatureStoreScope; cache_policy: 'no_cache' | 'required'; store_directory: string }
function fixture(input: unknown): FeatureFixture {
  const x = input as FeatureFixture;
  if (!x || Object.keys(x).sort().join(',') !== 'cache_policy,mode,scope,store_directory' || x.mode !== 'local_synthetic' || !['no_cache','required'].includes(x.cache_policy) || typeof x.store_directory !== 'string' || !isAbsolute(x.store_directory) || resolve(x.store_directory) !== x.store_directory) throw Error();
  const scope = validateFeatureStoreScope(x.scope);
  if (scope.plan.limits.records > 2000 || scope.plan.queries.length > 8 || scope.plan.limits.state_bytes > 2097152) throw Error();
  return { ...x, scope };
}
export function loadFeatureFixture(path: string): FeatureFixture {
  try { const x = fixture(privateJson(path, 1048576)); pathCheck(join(x.store_directory, 'publication.json')); return x; }
  catch { throw Error('Invalid private local feature configuration.'); }
}
/** Explicit trusted unit IO seams; createApp never supplies them. Native reads
 * use a private B07 store or the parent-owned US1002 runtime capability. No
 * environment-selected cache host/port and no implicit filesystem fallback. */
export interface FeatureReadUnitIO { publication?: () => unknown; cache?: CacheReader['serve'] }
export class FeatureServingService {
  private readonly config: FeatureFixture;
  private cache?: Promise<CacheReader>;
  constructor(input: FeatureFixture, private readonly runtime?: FeatureCacheRuntime, private readonly unitIO?: FeatureReadUnitIO) {
    try { this.config = fixture(input); }
    catch { throw Error('Invalid private local feature configuration.'); }
  }
  async read(principal: Principal, input: unknown): Promise<FeatureApiResponse> {
    const scope = this.config.scope;
    if (!principal || principal.workspace !== scope.workspace_key) throw new ForbiddenException({ code: 'FORBIDDEN' });
    let q; try { q = validateFeatureApiQuery(input); } catch { throw new BadRequestException({ code: 'INVALID_FEATURE_QUERY' }); }
    const query = scope.plan.queries.find(x => x.id === q.query_id && x.currency === q.currency && x.as_of === q.as_of);
    if (!query) throw new BadRequestException({ code: 'INVALID_FEATURE_QUERY' });
    const request = { version: q.version, workspace_key: principal.workspace, plan: scope.plan, query, currency: q.currency, policy: scope.policy, now: q.now, minimum_generation: q.minimum_generation };
    const base = { version: q.version, mode: 'local_synthetic' as const, production_ready: false as const,
      freshness: { as_of: q.as_of, now: q.now, source_age_seconds: (Date.parse(q.now)-Date.parse(q.as_of))/1000, max_age_seconds: scope.policy.max_age_seconds } };
    const unavailable = (reason: FeatureApiReason): FeatureApiResponse => ({ ...base, status: 'unavailable', reason, count: null, amount: null, coverage: 'unavailable', source: null });
    try {
      let result;
      if (this.config.cache_policy === 'required') {
        if (this.unitIO?.cache) result = await this.unitIO.cache(request);
        else {
          if (!this.runtime) return unavailable('CACHE_UNAVAILABLE');
          // Lazy import keeps ordinary app startup independent of worker builds.
          // Only the fixed project module is supported, never caller input.
          this.cache ??= import(new URL('../../risk-workers/dist/feature-cache.js', import.meta.url).href)
            .then((module: { openFeatureCache(runtime: FeatureCacheRuntime, config: unknown): CacheReader }) => module.openFeatureCache(this.runtime!, scope));
          result = await (await this.cache).serve(request);
        }
      } else {
        let publication: unknown;
        if (this.unitIO?.publication) publication = this.unitIO.publication();
        else {
          const envelope = privateJson(join(this.config.store_directory, 'publication.json'), 1048576) as { version: number; owner: string; scope: unknown; publication: unknown };
          const owner = privateJson(join(this.config.store_directory, 'owner.json'), 200) as {version: number; owner: string};
          if (Object.keys(envelope).sort().join(',') !== 'owner,publication,scope,version' || Object.keys(owner).sort().join(',') !== 'owner,version' || envelope.version !== 1 || owner.version !== 1 || !/^[0-9a-f-]{36}$/.test(owner.owner) || envelope.owner !== owner.owner || featureStoreScopeIdentity(envelope.scope) !== featureStoreScopeIdentity(scope)) throw Error();
          publication = envelope.publication;
        }
        result = serveFeatureSnapshot(publication, scope, request);
      }
      if (result.status !== 'available') return unavailable(result.reason);
      const response: FeatureApiResponse = { ...base, status: 'available', reason: null, count: result.count, amount: result.amount, coverage: 'complete', source: { generation: result.provenance.publication.generation, content_hash: result.provenance.publication.content_hash } };
      if (Buffer.byteLength(JSON.stringify(response)) > FEATURE_API_LIMITS.response_bytes) throw Error(); return response;
    } catch { return unavailable('EVIDENCE_UNAVAILABLE'); }
  }
}
