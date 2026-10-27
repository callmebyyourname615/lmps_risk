import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createDatabase, createTransactionRevisions, validateTransactionRevision } from '../dist/index.js';
import { availablePort, dsn, initializeCluster, loadState, startCluster, stopCluster } from '../scripts/local.mjs';
import { migrations } from '../scripts/migrations.mjs';
import { revision } from './fixtures/transaction-revision.mjs';
import { publicationFixture } from '../../contracts/fixtures/synthetic-publication.mjs';
import { publicationTransaction } from '@lmps/contracts/synthetic-publication';

let temporary, state, owner, writer, app, outbox, intake;
const count = async () => (await app.pool.query('SELECT count(*)::int AS n FROM platform.local_transaction_revisions')).rows[0].n;
before(async () => {
  temporary = await mkdtemp('/tmp/lmps-revisions-');
  state = await initializeCluster(join(temporary, 'pg'), await availablePort()); await startCluster(state);
  await migrations(dsn(state, 'migration'), true);
  owner = createDatabase(dsn(state, 'migration'), 'migration'); writer = createTransactionRevisions(dsn(state, 'intake'));
  app = createDatabase(dsn(state)); intake = createDatabase(dsn(state, 'intake'), 'intake'); outbox = createDatabase(dsn(state, 'outbox'), 'outbox');
});
beforeEach(async () => { await owner.pool.query('TRUNCATE platform.local_transaction_revisions'); });
after(async () => {
  await writer?.close(); await app?.close(); await outbox?.close(); await intake?.close(); await owner?.close();
  if (temporary && !state) { try { state = await loadState(join(temporary, 'pg')); } catch { return; } }
  if (state) await stopCluster(state); if (temporary) await rm(temporary, { recursive: true, force: true });
});

test('local profile reuses the draft contract, rejects unknown/live/resolved/mapped data and detaches inputs', async () => {
  const input = revision(); const copy = validateTransactionRevision(input);
  copy.transaction.amount = '1'; assert.notEqual(copy.transaction.amount, input.transaction.amount);
  const invalid = [null, [], {}, { ...input, extra: true }, { ...input, expected_revision: -1 }, { ...input, expected_revision: 0.5 }, { ...input, expected_revision: 2147483647 }, { ...input, workspace_key: 'real_bank' }];
  for (const [field, value] of [['execution_mode', 'live'], ['transaction_status', 'succeeded'], ['occurred_at', '2026-10-17T10:00:00Z'],
    ['amount', 1.25], ['amount', '-1.00'], ['observed_at', '2026-02-30T00:00:00Z'], ['source_bank_id', 'real_bank'], ['extra', 'SYNTHETIC_PRIVATE_VALUE']]) {
    const valueInput = revision(); valueInput.transaction[field] = value; invalid.push(valueInput);
  }
  for (const change of [v => v.transaction.source_reference.mapping_version = 'approved', v => v.transaction.source_reference.namespace = 'real_source',
    v => v.transaction.sender.status = 'resolved', v => v.transaction.receiver.source_representation = 'masked',
    v => v.transaction.source_reference.record_ref = 'unverified_source_row']) { const v = revision(); change(v); invalid.push(v); }
  for (const value of invalid) await assert.rejects(writer.append(value), error => error.code === 'INVALID_REVISION' && !error.message.includes('SYNTHETIC_PRIVATE_VALUE'));
  assert.equal(await count(), 0);
});

test('immutable sequential revisions retain exact strings; retry compares complete JSON content independent of object key order', async () => {
  const first = revision();
  const result = writer.append(first); first.transaction.amount = '1';
  assert.deepEqual(await result, { status: 'inserted', revision_number: 1 });
  const reordered = revision(); reordered.transaction = Object.fromEntries(Object.entries(reordered.transaction).reverse());
  assert.deepEqual(await writer.append(reordered), { status: 'duplicate', revision_number: 1 });
  const second = revision(1); second.transaction.amount = '0.000000000000000001'; second.transaction.observed_at = '2020-01-01T00:00:00Z';
  assert.deepEqual(await writer.append(second), { status: 'inserted', revision_number: 2 });
  assert.equal((await writer.append(revision())).status, 'duplicate');
  const rows = (await app.pool.query('SELECT revision_number,previous_revision,payload,recorded_by FROM platform.local_transaction_revisions ORDER BY revision_number')).rows;
  assert.equal(rows[0].previous_revision, null); assert.equal(rows[1].previous_revision, 1);
  assert.equal(rows[0].payload.amount, revision().transaction.amount);
  assert.equal(rows[1].payload.amount, second.transaction.amount);
  assert.equal(rows[0].payload.transaction_id, '0009007199254740993');
  assert.equal(rows[0].recorded_by, 'lmps_intake');
});

test('conflicting payloads, skipped predecessors and revision-ref reuse fail without rows; retry after rollback works', async () => {
  await assert.rejects(writer.append(revision(1)), { code: 'REVISION_CONFLICT' }); assert.equal(await count(), 0);
  await writer.append(revision());
  const changed = revision(); changed.transaction.amount = '2.00';
  await assert.rejects(writer.append(changed), { code: 'REVISION_CONFLICT' });
  const reused = revision(1); reused.transaction.transaction_revision = revision().transaction.transaction_revision;
  await assert.rejects(writer.append(reused), { code: 'REVISION_CONFLICT' });
  await assert.rejects(writer.append(revision(2)), { code: 'REVISION_CONFLICT' });
  assert.equal(await count(), 1); await writer.append(revision(1)); assert.equal(await count(), 2);
});

test('competing identical and conflicting publications have one winner with no branches or duplicate effects', async () => {
  const matches = await Promise.all([writer.append(revision()), writer.append(revision())]);
  assert.deepEqual(matches.map(value => value.status).sort(), ['duplicate', 'inserted']);
  const a = revision(1), b = revision(1); b.transaction.amount = '2.00';
  const results = await Promise.allSettled([writer.append(a), writer.append(b)]);
  assert.equal(results.filter(value => value.status === 'fulfilled').length, 1);
  assert.equal(results.find(value => value.status === 'rejected').reason.code, 'REVISION_CONFLICT');
  assert.equal(await count(), 2);
});

test('workspace, namespace and opaque transaction ID are all part of revision identity', async () => {
  const a = revision(), b = revision(), c = revision();
  b.workspace_key = 'synthetic_other'; c.transaction.source_reference.namespace = 'synthetic_other';
  await writer.append(a); await writer.append(b); await writer.append(c);
  const leading = revision(); leading.transaction.transaction_id = '9007199254740993'; await writer.append(leading);
  assert.equal(await count(), 4);
});

test('app/outbox cannot publish; app and intake cannot update/delete/truncate history or spoof stored metadata', async () => {
  await writer.append(revision());
  for (const database of [app, intake]) {
    for (const sql of ["UPDATE platform.local_transaction_revisions SET payload='{}'", 'DELETE FROM platform.local_transaction_revisions', 'TRUNCATE platform.local_transaction_revisions']) {
      await assert.rejects(database.pool.query(sql), { code: '42501' });
    }
  }
  for (const database of [app, outbox]) await assert.rejects(database.pool.query("INSERT INTO platform.local_transaction_revisions(workspace_key) VALUES ('synthetic_local')"), { code: '42501' });
  await assert.rejects(outbox.pool.query('SELECT * FROM platform.local_transaction_revisions'), { code: '42501' });
  await assert.rejects(intake.pool.query("INSERT INTO platform.local_transaction_revisions(workspace_key,recorded_at) VALUES ('synthetic_local',now())"), { code: '42501' });
  assert.equal(await count(), 1);
});

test('SQL guards reject malformed profile, mismatched keys and missing predecessor even when bypassing the repository', async () => {
  const base = revision().transaction;
  for (const payload of [{}, { ...base, transaction_id: 'different' }, { ...base, execution_mode: 'live' }, { ...base, sender: { ...base.sender, account_token: 'SYNTHETIC_PRIVATE_VALUE' } }]) {
    await assert.rejects(intake.pool.query('INSERT INTO platform.local_transaction_revisions(workspace_key,namespace,transaction_id,revision_number,payload) VALUES ($1,$2,$3,1,$4)',
      ['synthetic_local', base.source_reference.namespace, base.transaction_id, payload]), error => ['23502', '23514'].includes(error.code));
  }
  await assert.rejects(intake.pool.query('INSERT INTO platform.local_transaction_revisions(workspace_key,namespace,transaction_id,revision_number,payload) VALUES ($1,$2,$3,2,$4)',
    ['synthetic_local', base.source_reference.namespace, base.transaction_id, base]), { code: '23503' });
  assert.equal(await count(), 0);
});

test('runtime guards reject production/live append before acquiring storage', async () => {
  for (const [key, value] of [['NODE_ENV', 'production'], ['LMPS_ENVIRONMENT', 'production'], ['LMPS_EXECUTION_MODE', 'live']]) {
    const previous = process.env[key]; process.env[key] = value;
    try {
      assert.throws(() => createTransactionRevisions(dsn(state, 'intake')), { code: 'INVALID_REVISION' });
      await assert.rejects(writer.append(revision()), { code: 'INVALID_REVISION' });
    } finally { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; }
  }
  assert.equal(await count(), 0);
});

test('database outage returns fixed failure; restart preserves history and permits exact replay', async () => {
  await writer.append(revision()); await stopCluster(state);
  try { await assert.rejects(writer.append(revision(1)), error => error.code === 'STORAGE_FAILED' && error.message === 'Local transaction storage failed; details withheld.'); }
  finally { await startCluster(state); }
  assert.equal((await writer.append(revision())).status, 'duplicate');
  await writer.append(revision(1)); assert.equal(await count(), 2);
});

test('known lifecycle requires recomputed publication proof and preserves exact amounts beside legacy unknown rows', async () => {
  const input = publicationFixture();
  await writer.append(revision()); await writer.append(input);
  const row = (await app.pool.query("SELECT payload,publication FROM platform.local_transaction_revisions WHERE transaction_id=$1", [input.transaction.transaction_id])).rows[0];
  assert.deepEqual(row.payload, input.transaction); assert.deepEqual(row.publication, input.publication);
  const invalid = [() => { const v = publicationFixture(); delete v.publication; return v; },
    () => { const v = publicationFixture(); v.transaction.amount = '1.00'; return v; },
    () => { const v = publicationFixture(); v.publication.normalization_input.status_code = 'UNKNOWN'; return v; },
    () => { const v = publicationFixture(); v.publication.binding.expected_revision = 1; return v; },
    () => ({ ...revision(), publication: null })];
  for (const create of invalid) await assert.rejects(writer.append(create()), { code: 'INVALID_REVISION' });
  assert.equal(await count(), 2);
});

test('cross-capture and cross-row replay retains first lineage; changed amounts, units, generation or frozen evidence conflict', async () => {
  const first = publicationFixture(); await writer.append(first);
  const next = structuredClone(first.publication); next.capture_id = '33333333-3333-4333-8333-333333333333'; next.source.capture_epoch = next.capture_id;
  next.source.observed_at = next.normalization_input.observed_at = '2026-01-02T00:00:01.000Z'; next.snapshot_sha256 = 'c'.repeat(64);
  const replay = p => ({ ...first, ...publicationTransaction(p) });
  assert.equal((await writer.append(replay(next))).status, 'duplicate');
  const alias = structuredClone(first.publication); alias.source.source_table = 'transfer_hist';
  alias.source.event_key = alias.binding.event_key = alias.normalization_input.source_reference.record_ref = 'transfer_hist:1';
  assert.equal((await writer.append(replay(alias))).status, 'duplicate');
  for (const change of [p => p.normalization_input.amount = '1.00', p => p.binding.currency.code = 'BAD',
    p => p.source.source_generation = '44444444-4444-4444-8444-444444444444', p => p.snapshot_sha256 = 'd'.repeat(64)]) {
    const p = structuredClone(first.publication); change(p); await assert.rejects(writer.append(replay(p)), { code: 'REVISION_CONFLICT' });
  }
  const stored = (await app.pool.query('SELECT payload,publication FROM platform.local_transaction_revisions')).rows[0];
  assert.deepEqual(stored.publication, first.publication); assert.deepEqual(stored.payload, first.transaction); assert.equal(await count(), 1);
});

test('normalized competing writes, predecessor gaps and handles keep a single immutable chain', async () => {
  await assert.rejects(writer.append(publicationFixture(1)), { code: 'REVISION_CONFLICT' });
  const results = await Promise.all([writer.append(publicationFixture()), writer.append(publicationFixture())]);
  assert.deepEqual(results.map(v => v.status).sort(), ['duplicate', 'inserted']);
  const a = publicationFixture(1), b = publicationFixture(1); b.publication.normalization_input.amount = '1.00';
  b.transaction = publicationTransaction(b.publication).transaction;
  const race = await Promise.allSettled([writer.append(a), writer.append(b)]);
  assert.equal(race.filter(v => v.status === 'fulfilled').length, 1); assert.equal(race.find(v => v.status === 'rejected').reason.code, 'REVISION_CONFLICT');
  const reused = publicationFixture(2); reused.publication.binding.transaction_revision = a.transaction.transaction_revision;
  reused.transaction = publicationTransaction(reused.publication).transaction;
  await assert.rejects(writer.append(reused), { code: 'REVISION_CONFLICT' }); assert.equal(await count(), 2);
});

test('SQL and writer permissions withhold known status without proof and prohibit publication edits', async () => {
  const input = publicationFixture();
  await assert.rejects(intake.pool.query('INSERT INTO platform.local_transaction_revisions(workspace_key,namespace,transaction_id,revision_number,payload) VALUES ($1,$2,$3,1,$4)',
    [input.workspace_key, input.transaction.source_reference.namespace, input.transaction.transaction_id, input.transaction]), { code: '23514' });
  await writer.append(input);
  for (const db of [intake, app]) await assert.rejects(db.pool.query("UPDATE platform.local_transaction_revisions SET publication=NULL"), { code: '42501' });
  assert.equal(await count(), 1);
});
