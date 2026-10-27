import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { after, before, mock, test } from 'node:test';
import { chmod, link, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Socket } from 'node:net';
import mariadb from 'mariadb';
import { normalizeSnapshot, MAX_EVIDENCE_BYTES, MAX_NORMALIZATION_REPORT_BYTES } from '../dist/normalization-pipeline.js';
import { saveNormalization, normalizeCapture } from '../scripts/normalize.mjs';
import { saveSnapshot } from '../scripts/spool.mjs';
import { snapshotIdentity } from '../dist/sync-job.js';
import { main } from '../scripts/local.mjs';
import { normalizationFixture } from './fixtures/normalization-pipeline.mjs';

let temporary;
before(async () => { temporary = await mkdtemp('/tmp/lmps-normalization-'); });
after(async () => { if (temporary) await rm(temporary, { recursive: true, force: true }); });
const withheld = error => error.message === 'Local snapshot normalization failed; source, evidence, report and path diagnostics withheld.';
const rejected = error => error.message === 'Local normalization pipeline rejected snapshot or evidence; details withheld.';
const directory = (base, snapshot) => join(base, 'v1', snapshot.capture_id);
const reorder = value => JSON.parse(JSON.stringify(value, (_key, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v));

test('snapshot plus explicit synthetic evidence produces bounded outcomes with complete source lineage and no canonical emission', () => {
  const { snapshot, evidence } = normalizationFixture();
  const report = normalizeSnapshot(snapshot, evidence);
  assert.deepEqual(report.counts, { total: 7, known: 4, unknown: 2, invalid: 1 });
  assert.equal(report.canonical_emission, false); assert.equal(report.account_identity, 'unresolved');
  assert.equal(report.source_semantics, 'unverified'); assert.equal(report.evidence_status, 'provided');
  assert.equal(report.snapshot_sha256, snapshotIdentity(snapshot).snapshot_sha256);
  for (const [index, row] of report.rows.entries()) {
    const source = snapshot.events[index];
    for (const name of ['workspace_key', 'source_namespace', 'source_generation', 'capture_epoch', 'event_key', 'source_table', 'source_key', 'operation', 'observed_at']) assert.deepEqual(row.source[name], source[name]);
    if (row.normalization) {
      assert.deepEqual(row.normalization.source_reference, { namespace: source.source_namespace, record_ref: source.event_key });
      assert.equal(row.normalization.raw.amount, source.fields.amount); assert.equal(row.normalization.raw.currency, source.fields.ccy);
      assert.equal(row.normalization.time.occurred_at, null);
    }
  }
  assert.equal(report.rows[1].normalization.record_kind, 'lookup'); assert.equal(report.rows[1].normalization.candidate, null);
  assert.equal(report.rows[2].normalization.candidate.cumulative_reversed_amount, '100.00');
  assert.equal(report.rows[2].normalization.raw.reversal_evidence.events.length, 3);
  assert.equal(report.rows[3].state, 'invalid'); assert.equal(report.rows[4].normalization, null);
  assert.equal(report.rows[6].normalization, null); assert.ok(Buffer.byteLength(JSON.stringify(report)) <= MAX_NORMALIZATION_REPORT_BYTES);
});

test('missing evidence never guesses semantic codes from table/result, negative source amount or history overlap', () => {
  const { snapshot } = normalizationFixture(); const report = normalizeSnapshot(snapshot);
  assert.deepEqual(report.counts, { total: 7, known: 0, unknown: 7, invalid: 0 });
  assert.equal(report.evidence_status, 'absent'); assert.equal(report.evidence_sha256, null);
  assert.ok(report.rows.every(row => row.normalization === null));
  assert.deepEqual(report.rows[3].reason_codes, ['SYNTHETIC_EVIDENCE_MISSING']);
  assert.deepEqual(report.rows[6].reason_codes, ['UNSUPPORTED_SOURCE_RECORD']);
  const evidence = { ...normalizationFixture().evidence, capture_id: snapshot.capture_id, snapshot_sha256: report.snapshot_sha256, entries: [] };
  assert.deepEqual(normalizeSnapshot(snapshot, evidence).counts, report.counts);
});

test('capture/fingerprint/codebook/context mismatch and unknown fields reject the complete batch before publishing', () => {
  const { snapshot, evidence } = normalizationFixture();
  for (const change of [{ capture_id: 'SYNTHETIC_PRIVATE_VALUE' }, { snapshot_sha256: '0'.repeat(64) }, { codebook_version: 'old' },
    { provenance: 'real' }, { execution_mode: 'live' }, { format: 2 }, { extra: true }, { entries: Array(401).fill(evidence.entries[0]) }]) assert.throws(() => normalizeSnapshot(snapshot, { ...evidence, ...change }), rejected);
  for (const input of [null, {}, [], { ...snapshot, extra: true }]) assert.throws(() => normalizeSnapshot(input, evidence), rejected);
  const changed = structuredClone(snapshot); changed.events[0].fields.amount = '41.50';
  assert.throws(() => normalizeSnapshot(changed, evidence), rejected);
  changed.events[0].operation = 'delete'; changed.events[0].fields = null;
  assert.throws(() => normalizeSnapshot(changed), rejected);
  for (const bad of [null, { ...evidence, entries: [{ ...evidence.entries[0], status_code: undefined }] }]) assert.throws(() => normalizeSnapshot(snapshot, bad), rejected);
});

test('sidecars cannot override raw money/time/key values, target members, introduce unknown events or repeat an event key', () => {
  const { snapshot, evidence } = normalizationFixture();
  for (const change of [{ amount: '999.00' }, { currency: 'SYNTH_CCY_B' }, { source_time: '2026-01-01 00:00:00' },
    { source_key: { id: '2' } }, { observed_at: '2026-01-01T00:00:00.000Z' }, { fromaccount: 'SYNTHETIC_PRIVATE_VALUE' },
    { event_key: 'member:1' }, { event_key: 'transfer:999' }]) assert.throws(() => normalizeSnapshot(snapshot, { ...evidence, entries: [{ ...evidence.entries[0], ...change }] }), rejected);
  for (const duplicate of [evidence.entries[0], { ...evidence.entries[0], status_code: 'SYNTH_FAILED' }]) {
    assert.throws(() => normalizeSnapshot(snapshot, { ...evidence, entries: [...evidence.entries, duplicate] }), rejected);
  }
});

test('row-level missing/invalid/conflicting reversal evidence withholds its candidate without truncating other outcomes', () => {
  const { snapshot, evidence } = normalizationFixture();
  const missing = structuredClone(evidence); missing.entries[2].reversal_evidence = null;
  const unknown = normalizeSnapshot(snapshot, missing); assert.equal(unknown.rows[2].state, 'unknown'); assert.equal(unknown.rows[2].normalization.candidate, null);
  const conflict = structuredClone(evidence); conflict.entries[2].reversal_evidence.events[2].amount = '31.00';
  const invalid = normalizeSnapshot(snapshot, conflict); assert.equal(invalid.rows[2].state, 'invalid'); assert.equal(invalid.rows[2].normalization.candidate, null);
  assert.equal(invalid.rows[0].state, 'known'); assert.equal(invalid.rows.length, 7);
  const malicious = structuredClone(evidence); malicious.entries[0].reversal_evidence = { account: 'SYNTHETIC_PRIVATE_VALUE' };
  const redacted = normalizeSnapshot(snapshot, malicious); assert.equal(redacted.rows[0].state, 'invalid');
  assert.ok(!JSON.stringify(redacted).includes('SYNTHETIC_PRIVATE_VALUE'));
});

test('replay and object/entry ordering preserve identities/outcomes without modifying frozen input or linking history as business identity', () => {
  const { snapshot, evidence } = normalizationFixture(); const before = structuredClone({ snapshot, evidence });
  const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
  freeze(snapshot); freeze(evidence);
  const original = normalizeSnapshot(snapshot, evidence); const changed = reorder(evidence); changed.entries.reverse();
  assert.deepEqual(normalizeSnapshot(reorder(snapshot), changed), original);
  assert.deepEqual({ snapshot, evidence }, before);
  original.rows[0].source.source_key.id = 'changed'; original.rows[0].normalization.raw.amount = '1.00';
  assert.deepEqual({ snapshot, evidence }, before);
  assert.equal(normalizeSnapshot(snapshot, evidence).rows[0].normalization.candidate.amount, '42.50');
  assert.notDeepEqual(original.rows[0].source, original.rows[4].source);
});

test('all400 allowed source observations and empty snapshots are represented without fabricated payments or truncation', () => {
  const fixture = normalizationFixture(); const seed = fixture.snapshot; const events = [];
  for (const table of ['transfer', 'transfer_hist', 'transfer_old', 'member']) for (let i = 1; i <= 100; i++) {
    const event = structuredClone(seed.events.find(row => row.source_table === table));
    event.event_key = `${table}:${i}`;
    event.source_key = table === 'member' ? { code: `SYNTHETIC_MEMBER_${i}` } : table === 'transfer_old' ? { id: String(i) } : { ...event.source_key, id: String(i) };
    events.push(event);
  }
  const report = normalizeSnapshot({ ...seed, events }); assert.deepEqual(report.counts, { total: 400, known: 0, unknown: 400, invalid: 0 });
  assert.equal(report.rows.length, 400); assert.ok(Buffer.byteLength(JSON.stringify(report)) <= MAX_NORMALIZATION_REPORT_BYTES);
  assert.deepEqual(normalizeSnapshot({ ...seed, events: [] }).counts, { total: 0, known: 0, unknown: 0, invalid: 0 });
  assert.throws(() => normalizeSnapshot(seed, { ...fixture.evidence, entries: [{ event_key: 'transfer:1', reversal_evidence: 'X'.repeat(MAX_EVIDENCE_BYTES) }] }), rejected);
});

test('private output is immutable on replay/changed evidence and public summaries contain only status/counts', async () => {
  const { snapshot, evidence } = normalizationFixture(); const base = join(temporary, 'output');
  const first = await saveNormalization(base, snapshot, evidence);
  assert.deepEqual(first, { status: 'normalized', capture_id: snapshot.capture_id, evidence_status: 'provided', counts: { total: 7, known: 4, unknown: 2, invalid: 1 } });
  const path = join(directory(base, snapshot), 'normalization.json'); const original = await readFile(path);
  assert.deepEqual(JSON.parse(original), normalizeSnapshot(snapshot, evidence));
  assert.equal((await lstat(path)).mode & 0o077, 0);
  assert.equal((await saveNormalization(base, snapshot, reorder(evidence))).status, 'duplicate');
  const changed = structuredClone(evidence); changed.entries[0].status_code = 'SYNTH_FAILED';
  await assert.rejects(saveNormalization(base, snapshot, changed), withheld);
  assert.deepEqual(await readFile(path), original);
  const text = JSON.stringify(first); for (const value of ['source_key', 'snapshot_sha256', 'amount', 'reversal_evidence', 'SYNTH_CCY_A']) assert.ok(!text.includes(value));
  assert.equal((await lstat(base)).mode & 0o077, 0); assert.equal((await lstat(directory(base, snapshot))).mode & 0o077, 0);
});

test('offline spool and evidence-file integration make zero source/network calls and preserve both frozen inputs', async () => {
  const { snapshot, evidence } = normalizationFixture();
  const spool = join(temporary, 'spool'); const inputs = join(temporary, 'evidence'); const output = join(temporary, 'integrated');
  await saveSnapshot(spool, snapshot);
  await mkdir(directory(inputs, snapshot), { recursive: true, mode: 0o700 });
  const path = join(directory(inputs, snapshot), 'evidence.json'); await writeFile(path, JSON.stringify(evidence), { mode: 0o600 });
  const sourcePath = join(spool, snapshot.capture_id, 'snapshot.json'); const frozen = await readFile(sourcePath); const frozenEvidence = await readFile(path);
  const maria = mock.method(mariadb, 'createConnection', () => { throw new Error('Unexpected source connection'); });
  const socket = mock.method(Socket.prototype, 'connect', () => { throw new Error('Unexpected network connection'); });
  try {
    const result = await normalizeCapture(spool, inputs, output, snapshot.capture_id); assert.equal(result.counts.known, 4);
    assert.equal((await normalizeCapture(spool, inputs, output, snapshot.capture_id)).status, 'duplicate');
    assert.equal(maria.mock.callCount(), 0); assert.equal(socket.mock.callCount(), 0);
    await assert.rejects(normalizeCapture(spool, inputs, output, '../SYNTHETIC_PRIVATE_VALUE'), withheld);
  } finally { maria.mock.restore(); socket.mock.restore(); }
  assert.deepEqual(await readFile(sourcePath), frozen); assert.deepEqual(await readFile(path), frozenEvidence);
  const missing = await normalizeCapture(spool, join(temporary, 'no-evidence'), join(temporary, 'no-evidence-output'), snapshot.capture_id);
  assert.deepEqual(missing.counts, { total: 7, known: 0, unknown: 7, invalid: 0 });
});

test('unsafe evidence files/directories, partial evidence and fingerprint tampering fail closed before output', async () => {
  const { snapshot, evidence } = normalizationFixture(); const spool = join(temporary, 'unsafe-spool'); const inputs = join(temporary, 'unsafe-inputs'); const output = join(temporary, 'rejected-output');
  await saveSnapshot(spool, snapshot); await mkdir(directory(inputs, snapshot), { recursive: true, mode: 0o700 });
  const path = join(directory(inputs, snapshot), 'evidence.json'); const content = JSON.stringify(evidence);
  await assert.rejects(normalizeCapture(spool, inputs, output, snapshot.capture_id), withheld);
  await writeFile(path, content, { mode: 0o600 }); await chmod(path, 0o644); await assert.rejects(normalizeCapture(spool, inputs, output, snapshot.capture_id), withheld); await chmod(path, 0o600);
  const hardlink = join(temporary, 'evidence-hardlink'); await link(path, hardlink); await assert.rejects(normalizeCapture(spool, inputs, output, snapshot.capture_id), withheld); await rm(hardlink);
  await rm(path); await symlink(join(temporary, 'missing'), path); await assert.rejects(normalizeCapture(spool, inputs, output, snapshot.capture_id), withheld); await rm(path);
  execFileSync('mkfifo', ['-m', '600', path]); await assert.rejects(normalizeCapture(spool, inputs, output, snapshot.capture_id), withheld); await rm(path);
  await writeFile(path, Buffer.alloc(MAX_EVIDENCE_BYTES + 1), { mode: 0o600 }); await assert.rejects(normalizeCapture(spool, inputs, output, snapshot.capture_id), withheld);
  await writeFile(path, JSON.stringify({ ...evidence, snapshot_sha256: 'changed' })); await assert.rejects(normalizeCapture(spool, inputs, output, snapshot.capture_id), withheld);
  await writeFile(path, content); await chmod(inputs, 0o755); await assert.rejects(normalizeCapture(spool, inputs, output, snapshot.capture_id), withheld); await chmod(inputs, 0o700);
  const linked = join(temporary, 'linked-evidence'); await symlink(inputs, linked); await assert.rejects(normalizeCapture(spool, linked, output, snapshot.capture_id), withheld);
  await assert.rejects(lstat(output), { code: 'ENOENT' });
});

test('unsafe or partial reports and concurrent publication never replace an existing winner', async () => {
  const { snapshot, evidence } = normalizationFixture(); const base = join(temporary, 'unsafe-report'); await saveNormalization(base, snapshot, evidence);
  const path = join(directory(base, snapshot), 'normalization.json'); const original = await readFile(path);
  await chmod(path, 0o644); await assert.rejects(saveNormalization(base, snapshot, evidence), withheld); await chmod(path, 0o600);
  const hardlink = join(temporary, 'report-hardlink'); await link(path, hardlink); await assert.rejects(saveNormalization(base, snapshot, evidence), withheld); await rm(hardlink);
  await rm(path); execFileSync('mkfifo', ['-m', '600', path]); await assert.rejects(saveNormalization(base, snapshot, evidence), withheld); await rm(path);
  await writeFile(path, Buffer.alloc(MAX_NORMALIZATION_REPORT_BYTES + 1), { mode: 0o600 }); await assert.rejects(saveNormalization(base, snapshot, evidence), withheld);
  await writeFile(path, original); assert.equal((await saveNormalization(base, snapshot, evidence)).status, 'duplicate');
  const partial = join(temporary, 'partial'); await mkdir(directory(partial, snapshot), { recursive: true, mode: 0o700 });
  const pending = join(directory(partial, snapshot), 'pending.json'); await writeFile(pending, 'partial', { mode: 0o600 });
  await assert.rejects(saveNormalization(partial, snapshot, evidence), withheld); assert.equal(await readFile(pending, 'utf8'), 'partial');
  const fresh = normalizationFixture(); const concurrent = join(temporary, 'concurrent');
  const results = await Promise.allSettled(Array.from({ length: 8 }, () => saveNormalization(concurrent, fresh.snapshot, fresh.evidence)));
  assert.equal(results.filter(result => result.status === 'fulfilled' && result.value.status === 'normalized').length, 1);
  for (const result of results) if (result.status === 'rejected') assert.ok(withheld(result.reason)); else assert.ok(['normalized', 'duplicate'].includes(result.value.status));
  assert.equal((await saveNormalization(concurrent, fresh.snapshot, fresh.evidence)).status, 'duplicate');
});

test('live contexts and CLI failures are redacted and do not create output directories', async () => {
  const { snapshot, evidence } = normalizationFixture(); const previous = process.env.LMPS_EXECUTION_MODE;
  try {
    process.env.LMPS_EXECUTION_MODE = 'live'; assert.throws(() => normalizeSnapshot(snapshot, evidence), rejected);
    await assert.rejects(saveNormalization(join(temporary, 'live-output'), snapshot, evidence), withheld);
  } finally { if (previous === undefined) delete process.env.LMPS_EXECUTION_MODE; else process.env.LMPS_EXECUTION_MODE = previous; }
  await assert.rejects(lstat(join(temporary, 'live-output')), { code: 'ENOENT' });
  const errors = []; const logging = mock.method(console, 'error', (...args) => errors.push(args.join(' ')));
  try { assert.equal(await main(['normalize', 'SYNTHETIC_PRIVATE_VALUE']), 1); }
  finally { logging.mock.restore(); }
  assert.ok(errors.length); assert.ok(!errors.join(' ').includes('SYNTHETIC_PRIVATE_VALUE'));
});
