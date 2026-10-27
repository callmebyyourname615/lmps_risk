import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { after, before, mock, test } from 'node:test';
import { chmod, link, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import mariadb from 'mariadb';
import { Socket } from 'node:net';
import { MAX_PROFILE_BYTES, profileSnapshot } from '../dist/profile.js';
import { profileCapture, saveProfile } from '../scripts/profile.mjs';
import { saveSnapshot } from '../scripts/spool.mjs';

let temporary;
const fixture = JSON.parse(await readFile(new URL('../../../packages/database/fixtures/source-event.json', import.meta.url), 'utf8'));
function snapshot(specs = [{}]) {
  const capture_id = randomUUID(); const generation = randomUUID(); const counts = new Map();
  return { format: 1, capture_id, events: specs.map(spec => {
    const table = spec.table ?? 'transfer'; const ordinal = (counts.get(table) ?? 0) + 1; counts.set(table, ordinal);
    return { ...structuredClone(fixture), source_namespace: 'synthetic_snapshot', source_generation: generation, capture_epoch: capture_id, event_key: table + ':' + ordinal,
      source_table: table, source_key: table === 'member' ? { code: 'PRIVATE_SOURCE_KEY_' + ordinal } : table === 'transfer_old' ? { id: String(ordinal) } : { id: String(ordinal), requesttime: spec.requesttime ?? fixture.source_key.requesttime },
      fields: table === 'member' ? { status: null, member_type: null, ...spec.fields } : { ...fixture.fields, ...spec.fields } };
  }) };
}
const withheld = error => error.message === 'Local snapshot profiling failed; source, report and path diagnostics withheld.';
const directory = (base, value) => join(base, 'v1', value.capture_id);
before(async () => { temporary = await mkdtemp('/tmp/lmps-profile-'); });
after(async () => { if (temporary) await rm(temporary, { recursive: true, force: true }); });

test('amount statistics remain exact beyond Number precision, preserve signs and separate tables/raw currencies', () => {
  const value = snapshot([
    { fields: { amount: '9999999999999999999999.99', ccy: 'RAW_A' } }, { fields: { amount: '9999999999999999999999.99', ccy: 'RAW_A' } },
    { fields: { amount: '-0.01', ccy: 'RAW_A' } }, { fields: { amount: '-0.00', ccy: 'RAW_A' } },
    { fields: { amount: '0.10', ccy: 'RAW_B' } }, { fields: { amount: '0.20', ccy: 'RAW_B' } },
    { table: 'transfer_hist', fields: { amount: '-3.25', ccy: 'RAW_A' } }, { table: 'transfer_old', fields: { amount: '3.25', ccy: 'RAW_A' } },
  ]);
  const result = profileSnapshot(value); const groups = result.tables.transfer.amounts_by_raw_currency;
  assert.deepEqual(groups[0], { raw_currency: 'RAW_A', rows: 4, positive_rows: 2, zero_rows: 1, negative_rows: 1,
    observed_amount_sum: '19999999999999999999999.97', min: '-0.01', max: '9999999999999999999999.99' });
  assert.equal(groups[1].observed_amount_sum, '0.30');
  assert.equal(result.tables.transfer_hist.amounts_by_raw_currency[0].observed_amount_sum, '-3.25');
  assert.equal(result.tables.transfer_old.amounts_by_raw_currency[0].observed_amount_sum, '3.25');
  assert.equal(result.business_payment_deduplication, 'not_performed'); assert.ok(!('total_amount' in result));
});

test('null, empty and distinct non-null counts remain different and raw codes are never trimmed or case-normalized', () => {
  const result = profileSnapshot(snapshot([
    { fields: { ccy: 'raw', result: null } }, { fields: { ccy: ' RAW ', result: '' } }, { fields: { ccy: 'RAW', result: '0' } },
    { table: 'member', fields: { status: null, member_type: '' } }, { table: 'member', fields: { status: '', member_type: '__proto__' } },
  ]));
  assert.deepEqual(result.tables.transfer.fields.result, { non_null_rows: 2, null_rows: 1, empty_rows: 1, distinct_non_null: 2 });
  assert.deepEqual(result.tables.transfer.raw_code_counts.result, [{ value: null, rows: 1 }, { value: '', rows: 1 }, { value: '0', rows: 1 }]);
  assert.deepEqual(result.tables.transfer.amounts_by_raw_currency.map(row => row.raw_currency), [' RAW ', 'RAW', 'raw']);
  assert.equal(result.tables.member.fields.member_type.empty_rows, 1); assert.equal(result.tables.member.raw_code_counts.member_type[1].value, '__proto__');
  assert.equal(Object.prototype.rows, undefined); assert.equal(result.currency_and_status_semantics, 'unverified');
});

test('naive time ranges use observed calendar strings without inventing timezone, latency or source completeness', () => {
  const result = profileSnapshot(snapshot([
    { requesttime: '2026-01-03 23:00:00', fields: { txtime: null } },
    { requesttime: '2026-01-01 00:00:00', fields: { txtime: '2026-01-02 02:30:00' } },
    { table: 'transfer_old' }, { table: 'member' },
  ]));
  assert.deepEqual(result.tables.transfer.source_naive_times.requesttime, { projection: 'included', non_null_rows: 2, min: '2026-01-01 00:00:00', max: '2026-01-03 23:00:00' });
  assert.equal(result.tables.transfer.source_naive_times.txtime.non_null_rows, 1);
  assert.equal(result.tables.transfer_old.source_naive_times.requesttime.projection, 'not_in_projection');
  assert.equal(result.tables.member.source_naive_times.txtime.projection, 'not_in_projection');
  assert.equal(result.observed_at_utc, fixture.observed_at); assert.equal(result.source_timezone, 'unverified');
  assert.equal(result.source_completeness, 'unverified'); assert.equal(result.target_reconciliation, 'not_checked'); assert.equal(result.job_fingerprint_binding, 'not_checked');
});

test('empty observations retain explicit unknown gates and do not fabricate source/account coverage', () => {
  const result = profileSnapshot(snapshot([])); assert.equal(result.observed_rows, 0); assert.equal(result.observed_at_utc, null);
  assert.equal(result.scope, 'observed_snapshot_rows'); assert.equal(result.account_identity, 'not_observed');
  for (const table of Object.values(result.tables)) { assert.equal(table.observed_rows, 0); assert.deepEqual(table.amounts_by_raw_currency, []); assert.equal(table.source_naive_times.txtime.min, null); }
});

test('profiles are deterministic across object-key order, exclude source identifiers and bind changed evidence to a new hash', () => {
  const value = snapshot([{ table: 'member' }]); const result = profileSnapshot(value);
  const reordered = JSON.parse(JSON.stringify(value, (_key, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v));
  assert.deepEqual(profileSnapshot(reordered), result);
  const text = JSON.stringify(result);
  for (const secret of [value.events[0].source_key.code, value.events[0].source_generation, 'source_key', 'event_key', 'sender_account_id']) assert.ok(!text.includes(secret));
  const changed = structuredClone(value); changed.events[0].fields.status = 'changed'; assert.notEqual(profileSnapshot(changed).snapshot_sha256, result.snapshot_sha256);
});

test('all400 maximum-width observations fit the report bound without truncation', () => {
  const specs = [];
  for (const table of ['transfer', 'transfer_hist', 'transfer_old', 'member']) for (let i = 0; i < 100; i++) {
    const suffix = String(i).padStart(3, '0');
    specs.push({ table, fields: table === 'member' ? { status: 'ก'.repeat(13) + suffix, member_type: 'ก'.repeat(17) + suffix }
      : { ccy: 'ก'.repeat(197) + suffix, result: 'ก'.repeat(197) + suffix, amount: '9999999999999999999999.99' } });
  }
  const result = profileSnapshot(snapshot(specs)); assert.equal(result.observed_rows, 400); assert.ok(Buffer.byteLength(JSON.stringify(result)) <= MAX_PROFILE_BYTES);
  for (const table of Object.values(result.tables)) assert.equal(table.observed_rows, 100);
});

test('private durable publication is replayable, excludes aggregates from public output and never overwrites changed evidence', async () => {
  const base = join(temporary, 'durable'); const value = snapshot(); const first = await saveProfile(base, value);
  assert.deepEqual(first, { status: 'profiled', capture_id: value.capture_id, observed_rows: 1 });
  const path = join(directory(base, value), 'profile.json'); const original = await readFile(path);
  assert.deepEqual(JSON.parse(original), profileSnapshot(value));
  for (const path of [base, join(base, 'v1'), directory(base, value)]) assert.equal((await lstat(path)).mode & 0o077, 0);
  assert.equal((await lstat(path)).mode & 0o077, 0);
  assert.equal((await saveProfile(base, value)).status, 'duplicate');
  const changed = structuredClone(value); changed.events[0].fields.amount = '999.00'; await assert.rejects(saveProfile(base, changed), withheld);
  assert.deepEqual(await readFile(path), original); assert.ok(!JSON.stringify(first).includes('123.45'));
});

test('profiling the published spool never connects to MariaDB/PostgreSQL or loads their private state', async () => {
  const value = snapshot(); const spool = join(temporary, 'offline-spool'); await saveSnapshot(spool, value);
  const maria = mock.method(mariadb, 'createConnection', () => { throw new Error('Unexpected source connection.'); });
  const network = mock.method(Socket.prototype, 'connect', () => { throw new Error('Unexpected target connection.'); });
  try {
    const result = await profileCapture(spool, join(temporary, 'offline-profile'), value.capture_id);
    assert.equal(result.status, 'profiled'); assert.equal(maria.mock.callCount(), 0); assert.equal(network.mock.callCount(), 0);
    await assert.rejects(profileCapture(spool, join(temporary, 'invalid-profile'), 'SYNTHETIC_PRIVATE_VALUE'), withheld);
  } finally { maria.mock.restore(); network.mock.restore(); }
});

test('insecure, linked, FIFO, oversized and tampered report files fail closed without repair or raw diagnostics', async () => {
  const base = join(temporary, 'unsafe'); const value = snapshot(); await saveProfile(base, value);
  const path = join(directory(base, value), 'profile.json'); const original = await readFile(path);
  await chmod(path, 0o644); await assert.rejects(saveProfile(base, value), withheld); await chmod(path, 0o600);
  await link(path, join(temporary, 'report-hardlink')); await assert.rejects(saveProfile(base, value), withheld); await rm(join(temporary, 'report-hardlink'));
  await symlink(base, join(temporary, 'linked-base')); await assert.rejects(saveProfile(join(temporary, 'linked-base'), value), withheld);
  await rm(path); await symlink(join(temporary, 'missing'), path); await assert.rejects(saveProfile(base, value), withheld); await rm(path);
  execFileSync('mkfifo', ['-m', '600', path]); await assert.rejects(saveProfile(base, value), withheld); await rm(path);
  await writeFile(path, Buffer.alloc(MAX_PROFILE_BYTES + 1), { mode: 0o600 }); await assert.rejects(saveProfile(base, value), withheld);
  await writeFile(path, '{"private":"SYNTHETIC_PRIVATE_VALUE"}', { mode: 0o600 }); await assert.rejects(saveProfile(base, value), withheld);
  await writeFile(path, original, { mode: 0o600 }); assert.equal((await saveProfile(base, value)).status, 'duplicate');
});

test('partial publication is preserved for review and concurrent publishers cannot replace a winner', async () => {
  const base = join(temporary, 'partial'); const value = snapshot();
  await mkdir(join(base, 'v1', value.capture_id), { recursive: true, mode: 0o700 }); const pending = join(directory(base, value), 'pending.json');
  await writeFile(pending, 'partial', { mode: 0o600 }); await assert.rejects(saveProfile(base, value), withheld); assert.equal(await readFile(pending, 'utf8'), 'partial');
  const fresh = snapshot(); const results = await Promise.allSettled(Array.from({ length: 8 }, () => saveProfile(base, fresh)));
  assert.equal(results.filter(result => result.status === 'fulfilled' && result.value.status === 'profiled').length, 1);
  for (const result of results) if (result.status === 'rejected') assert.ok(withheld(result.reason)); else assert.ok(['profiled', 'duplicate'].includes(result.value.status));
  assert.equal((await saveProfile(base, fresh)).status, 'duplicate');
  assert.deepEqual(JSON.parse(await readFile(join(directory(base, fresh), 'profile.json'), 'utf8')), profileSnapshot(fresh));
});

test('invalid/real/money-number inputs and live mode are rejected before creating report directories', async () => {
  const value = snapshot(); const invalid = [null, { ...value, extra: true }, structuredClone(value), structuredClone(value)];
  invalid[2].events[0].fields.amount = 1.23; invalid[3].events[0].workspace_key = 'real_bank';
  for (const input of invalid) { assert.throws(() => profileSnapshot(input)); await assert.rejects(saveProfile(join(temporary, 'rejected'), input), withheld); }
  await assert.rejects(lstat(join(temporary, 'rejected')), { code: 'ENOENT' });
  const previous = process.env.LMPS_EXECUTION_MODE;
  try { process.env.LMPS_EXECUTION_MODE = 'live'; assert.throws(() => profileSnapshot(value)); }
  finally { if (previous === undefined) delete process.env.LMPS_EXECUTION_MODE; else process.env.LMPS_EXECUTION_MODE = previous; }
});
