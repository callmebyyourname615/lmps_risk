import { FEATURE_SERVING_VERSION, type FeatureUnavailableReason } from './feature-serving.js';
export const FEATURE_API_LIMITS = Object.freeze({ request_bytes: 2048, response_bytes: 4096 });
export interface FeatureApiQuery { version: typeof FEATURE_SERVING_VERSION; query_id: string; currency: string; as_of: string; now: string; minimum_generation: number }
interface FeatureApiMetadata {
  version: typeof FEATURE_SERVING_VERSION; mode: 'local_synthetic'; production_ready: false;
  freshness: { as_of: string; now: string; source_age_seconds: number; max_age_seconds: number };
}
export type FeatureApiReason = FeatureUnavailableReason | 'CACHE_UNAVAILABLE' | 'CACHE_INVALID' | 'EVIDENCE_UNAVAILABLE';
export type FeatureApiResponse = FeatureApiMetadata & (
  { status: 'available'; reason: null; count: string; amount: string; coverage: 'complete'; source: { generation: number; content_hash: string } }
  | { status: 'unavailable'; reason: FeatureApiReason; count: null; amount: null; coverage: 'unavailable'; source: null }
);
export function validateFeatureApiQuery(input: unknown): FeatureApiQuery {
  const fail = (): never => { throw Error('Invalid local feature query'); };
  if (!input || typeof input !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) return fail();
  const keys = ['version', 'query_id', 'currency', 'as_of', 'now', 'minimum_generation'];
  const own = Reflect.ownKeys(input); if (own.length !== keys.length || own.some(k => typeof k !== 'string' || !keys.includes(k))) return fail();
  const q: Record<string, string> = {};
  for (const key of keys) { const d = Object.getOwnPropertyDescriptor(input, key); if (!d || !d.enumerable || !('value' in d) || typeof d.value !== 'string' || d.value.length > 100) return fail(); q[key] = d.value; }
  if (Buffer.byteLength(JSON.stringify(q)) > FEATURE_API_LIMITS.request_bytes || q.version !== FEATURE_SERVING_VERSION || !/^[A-Za-z0-9_]{1,80}$/.test(q.query_id!) || !/^[A-Z]{3}$/.test(q.currency!) || !/^[1-9][0-9]{0,3}$/.test(q.minimum_generation!) || Number(q.minimum_generation) > 1000) return fail();
  for (const key of ['as_of', 'now']) { const t = q[key]!; if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(t) || !Number.isFinite(Date.parse(t)) || new Date(t).toISOString() !== t.replace('Z', '.000Z')) return fail(); }
  return { ...q, minimum_generation: Number(q.minimum_generation) } as unknown as FeatureApiQuery;
}
