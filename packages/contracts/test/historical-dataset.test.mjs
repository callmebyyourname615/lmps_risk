import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistoricalManifest as manifest, validateHistoricalManifest as validate,
  writeHistoricalDataset as write, historicalFileContent, HISTORICAL_LIMITS } from '../dist/historical-dataset.js';

const namespace = { workspace_id: 'synthetic_workspace', run_id: 'synthetic_run', dataset_id: 'synthetic_dataset' };
const timestamp = '2026-01-01T00:00:00.000Z';
const row = (i = 0) => ({ fixture_id: `synthetic_${i}`, amount: '1.00', currency: 'USD', occurred_at: timestamp, available_at: timestamp });
const file = (i = 0, count = 1) => ({ file_id: `synthetic_file${i}`, rows: Array.from({ length: count }, (_, j) => row(i * 16 + j)) });
// No persistent store: stage privately, then publish once without an await boundary.
class FakeStore {
  complete = new Map(); failAfter = null;
  async publishComplete(m, files) {
    const key = JSON.stringify(m.namespace), prior = this.complete.get(key);
    if (prior) return JSON.stringify(prior.manifest) === JSON.stringify(m) ? 'acknowledged' : 'conflict';
    const staged = [];
    for (const f of files) {
      staged.push(structuredClone(f));
      if (staged.length === this.failAfter) throw new Error('fake staging failure');
    }
    validate(m, staged);
    this.complete.set(key, { manifest: structuredClone(m), files: staged });
    return 'published';
  }
}
test('exact row/file limits, one over, duplicate IDs, no silent truncation', () => {
  const files = Array.from({ length: 4 }, (_, i) => file(i, 16));
  assert.equal(manifest(namespace, files).row_count, 64);
  assert.equal(manifest(namespace, files).files.length, 4);
  assert.throws(() => manifest(namespace, [...files, file(4)]));
  files[0].rows.push(row(100));
  assert.throws(() => manifest(namespace, files));
  assert.throws(() => manifest(namespace, [file(), file()]));
  assert.throws(() => manifest(namespace, [{ ...file(), rows: [row(), row()] }]));
});
function byteBoundary(group = 0) {
  const f = file(0, 16);
  f.rows.forEach((r, j) => { r.fixture_id = `synthetic_${group}_${String(j).padStart(2, '0')}`; });
  let remaining = HISTORICAL_LIMITS.fileBytes - Buffer.byteLength(historicalFileContent(f.rows));
  for (const r of f.rows) {
    const n = Math.min(remaining, 74 - r.fixture_id.length);
    r.fixture_id += 'a'.repeat(n); remaining -= n;
  }
  assert.equal(remaining, 0);
  return f;
}
test('exact and one-over byte limits, aggregate bytes and detached input', () => {
  const files = Array.from({ length: 4 }, (_, i) => {
    const f = byteBoundary(i); f.file_id = `synthetic_file${i}`;
    return f;
  });
  const m = manifest(namespace, files);
  assert.equal(m.content_bytes, HISTORICAL_LIMITS.contentBytes);
  assert.equal(m.files[0].bytes, HISTORICAL_LIMITS.fileBytes);
  const r = files[0].rows.find(r => r.fixture_id.length < 74);
  assert.ok(r); r.fixture_id += 'b';
  assert.throws(() => manifest(namespace, files));
});
test('strict fields, money precision, non-coercion and code rejection', () => {
  for (const change of [r => r.amount = 1, r => r.amount = '1.001', r => r.amount = '01.00',
    r => r.amount = '1.00\n', r => r.currency = 'usd', r => r.fixture_id = 'real',
    r => r.available_at = '2025-01-01T00:00:00.000Z', r => r.extra = 'unknown',
    r => r.occurred_at = '2026-02-30T00:00:00.000Z']) {
    const f = file(); change(f.rows[0]); assert.throws(() => manifest(namespace, [f]));
  }
  let executed = false;
  const f = file(); Object.defineProperty(f.rows[0], 'amount', { get() { executed = true; return '1.00'; } });
  assert.throws(() => manifest(namespace, [f])); assert.equal(executed, false);
  assert.throws(() => manifest({ ...namespace, command: 'execute' }, [file()]));
  assert.throws(() => manifest(namespace, [{ ...file(), code: 'execute' }]));
  const extra = [file()]; extra.code = 'execute';
  assert.throws(() => manifest(namespace, extra));
  const iterator = [file()]; iterator[Symbol.iterator] = () => { executed = true; return [][Symbol.iterator](); };
  assert.throws(() => manifest(namespace, iterator)); assert.equal(executed, false);
});
test('all manifest bindings are recomputed, changed content and incomplete input rejected', () => {
  const files = [file()]; const m = manifest(namespace, files);
  assert.deepEqual(validate(m, files), m);
  for (const key of Object.keys(m)) {
    const bad = structuredClone(m); bad[key] = null;
    assert.throws(() => validate(bad, files));
  }
  assert.throws(() => validate({ ...m, extra: true }, files));
  files[0].rows[0].amount = '2.00'; assert.throws(() => validate(m, files));
  assert.throws(() => validate(m, []));
  const unavailable = file(); unavailable.rows[0].available_at = null;
  assert.deepEqual(manifest(namespace, [unavailable]).availability, { available_count: 0, unavailable_count: 1, latest: null });
});
test('atomic fake publication, retry, conflict, partial failure and concurrency', async () => {
  const store = new FakeStore(), files = [file(), file(1)], m = manifest(namespace, files);
  for (const failure of [1, 2]) {
    store.failAfter = failure;
    await assert.rejects(write(store, m, files)); assert.equal(store.complete.size, 0);
  }
  store.failAfter = null;
  assert.deepEqual(await Promise.all([write(store, m, files), write(store, m, files)]), ['published', 'acknowledged']);
  files[0].rows[0].amount = '3.00';
  assert.equal(await write(store, manifest(namespace, files), files), 'conflict');
  await assert.rejects(write(store, m, files));
  assert.equal(store.complete.values().next().value.files[0].rows[0].amount, '1.00');
  const other = { ...namespace, run_id: 'synthetic_other' };
  assert.equal(await write(store, manifest(other, files), files), 'published');
});
