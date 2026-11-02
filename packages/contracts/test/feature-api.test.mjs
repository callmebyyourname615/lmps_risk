import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateFeatureApiQuery, FEATURE_API_LIMITS } from '../dist/feature-api.js';
const valid = { version: 'synthetic-feature-serving-1', query_id: 'synthetic_query', currency: 'SYN', as_of: '2026-01-01T12:00:00Z', now: '2026-01-01T12:01:00Z', minimum_generation: '1' };
test('strict scalar query detaches and bounds every field without invoking getters', () => {
  const copy = validateFeatureApiQuery(valid); assert.equal(copy.minimum_generation, 1); assert.notEqual(copy, valid);
  for (const value of [null, [], { ...valid, extra: true }, { ...valid, minimum_generation: 1 }, { ...valid, minimum_generation: '01' }, { ...valid, minimum_generation: '1001' }, { ...valid, version: 'real' }, { ...valid, currency: ['SYN'] }, { ...valid, query_id: 'x'.repeat(2097153) }, { ...valid, as_of: '2026-02-30T12:00:00Z' }, { ...valid, now: '' }]) assert.throws(() => validateFeatureApiQuery(value));
  const getter = { ...valid }; Object.defineProperty(getter, 'query_id', { enumerable: true, get() { assert.fail('getter executed'); } }); assert.throws(() => validateFeatureApiQuery(getter));
  assert.equal(validateFeatureApiQuery({ ...valid, minimum_generation: '1000' }).minimum_generation, 1000);
  assert.equal(FEATURE_API_LIMITS.response_bytes, 4096);
});
