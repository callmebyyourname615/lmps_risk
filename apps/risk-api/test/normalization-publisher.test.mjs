import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, test } from 'node:test';
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createDatabase } from '@lmps/database';
import { createApp } from '../dist/app.js';
import { authFixture } from '../scripts/auth-fixture.mjs';
import { availablePort, dsn, initializeCluster, loadState, startCluster, stopCluster } from '../../../packages/database/scripts/local.mjs';
import { migrations } from '../../../packages/database/scripts/migrations.mjs';
import { publishSnapshot } from '../../risk-workers/dist/normalization-publisher.js';
import { publisherFixture, rebindFixture } from '../../risk-workers/test/fixtures/publication.mjs';
import { snapshotIdentity } from '../../risk-workers/dist/sync-job.js';
import { saveSnapshot } from '../../risk-workers/scripts/spool.mjs';
import { savePrivateReport } from '../../risk-workers/scripts/private-json.mjs';
import { publishCapture } from '../../risk-workers/scripts/publish.mjs';

let temporary, state, owner, app, auth, origin, spool, evidenceBase, bindings;
const f = publisherFixture();
const path = '/v1/local/transactions/synthetic_snapshot/synthetic_payment_001/revisions';
const publish = (input = f) => publishSnapshot(input.snapshot, input.evidence, input.manifest, dsn(state, 'intake'));
const get = async (suffix = '', claims = { scope: 'transactions:read' }) => fetch(origin + path + suffix, { headers: { authorization: 'Bearer ' + await auth.token(claims) } });
before(async () => {
  temporary = await mkdtemp('/tmp/lmps-publication-http-'); auth = await authFixture(temporary);
  state = await initializeCluster(join(temporary, 'pg'), await availablePort()); await startCluster(state); await migrations(dsn(state, 'migration'), true);
  owner = createDatabase(dsn(state, 'migration'), 'migration');
  ({ app } = await createApp({ LMPS_ENVIRONMENT: 'test', LMPS_POSTGRES_DSN: dsn(state), LMPS_LOCAL_AUTH_CONFIG: auth.path }));
  await app.listen(0, '127.0.0.1'); origin = `http://127.0.0.1:${app.getHttpServer().address().port}`;
  spool = join(temporary, 'snapshots'); evidenceBase = join(temporary, 'evidence'); bindings = join(temporary, 'bindings');
  await saveSnapshot(spool, f.snapshot);
  await savePrivateReport(evidenceBase, 'v1', f.snapshot.capture_id, 'evidence.json', f.evidence, 2 * 1024 * 1024);
  await savePrivateReport(bindings, 'v1', f.snapshot.capture_id, 'publication.json', f.manifest, 512 * 1024);
});
beforeEach(async () => { await owner.pool.query('TRUNCATE platform.local_transaction_revisions'); });
after(async () => {
  await app?.close(); await owner?.close();
  if (temporary && !state) { try { state = await loadState(join(temporary, 'pg')); } catch { return; } }
  if (state) await stopCluster(state); if (temporary) await rm(temporary, { recursive: true, force: true });
});

test('frozen private snapshot/evidence/binding → publisher → PG → scoped history/latest APIs, with no source/outbox writes', async () => {
  const before = await owner.pool.query('SELECT (SELECT count(*) FROM platform.source_events)::int AS events,(SELECT count(*) FROM platform.local_outbox_intents)::int AS outbox');
  const result = await publishCapture(spool, evidenceBase, bindings, f.snapshot.capture_id, dsn(state, 'intake'));
  assert.equal(result.status, 'complete'); assert.deepEqual(result.counts, { total: 7, eligible: 3, withheld: 4, inserted: 3, duplicate: 0, conflict: 0, failed: 0, unattempted: 0 });
  const response = await get('/latest'); assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  const page = await response.json(), item = page.items[0];
  assert.equal(page.canonical_emission, false); assert.equal(page.source_semantics, 'unverified');
  assert.equal(item.payload.transaction_status, 'succeeded'); assert.equal(item.payload.amount, '42.50'); assert.equal(item.payload.currency, 'SYN');
  assert.equal(item.payload.occurred_at, null); assert.equal(item.payload.sender.status, 'unresolved');
  assert.equal(item.publication.capture_id, f.snapshot.capture_id); assert.equal(item.publication.snapshot_sha256, f.manifest.snapshot_sha256);
  assert.equal(item.publication.binding.currency.raw, 'SYNTH_CCY_A'); assert.deepEqual((await (await get()).json()).items, page.items);
  assert.deepEqual((await owner.pool.query('SELECT (SELECT count(*) FROM platform.source_events)::int AS events,(SELECT count(*) FROM platform.local_outbox_intents)::int AS outbox')).rows, before.rows);
  assert.equal((await fetch(origin + '/health/ready')).status, 503);
});

test('whole capture replay and later capture replay do not add revisions or replace first evidence', async () => {
  await publish(); assert.equal((await publish()).counts.duplicate, 3);
  const later = structuredClone(f); later.snapshot.capture_id = randomUUID();
  for (const e of later.snapshot.events) { e.capture_epoch = later.snapshot.capture_id; e.observed_at = '2026-01-02T00:00:01.000Z'; }
  later.evidence.capture_id = later.snapshot.capture_id; later.evidence.snapshot_sha256 = snapshotIdentity(later.snapshot).snapshot_sha256; rebindFixture(later);
  const result = await publish(later); assert.equal(result.status, 'complete'); assert.equal(result.counts.duplicate, 3);
  const first = (await (await get('/latest')).json()).items[0]; assert.equal(first.publication.capture_id, f.snapshot.capture_id);
  assert.equal((await owner.pool.query('SELECT count(*)::int AS n FROM platform.local_transaction_revisions')).rows[0].n, 3);
});

test('explicit next revisions preserve historical state; revised amount under an old handle conflicts', async () => {
  await publish(); const next = structuredClone(f); next.manifest.bindings = [next.manifest.bindings[0]];
  next.manifest.bindings[0].expected_revision = 1; next.manifest.bindings[0].transaction_revision = 'synthetic_revision_2';
  next.evidence.entries[0].status_code = 'SYNTH_FAILED'; rebindFixture(next);
  assert.equal((await publish(next)).counts.inserted, 1);
  const page = await (await get('?limit=1')).json(); assert.equal(page.next_cursor, '1'); assert.equal(page.items[0].payload.transaction_status, 'succeeded');
  assert.equal((await (await get('/latest')).json()).items[0].payload.transaction_status, 'failed');
  const conflict = structuredClone(f); conflict.snapshot.events[0].fields.amount = '43.00';
  conflict.evidence.snapshot_sha256 = snapshotIdentity(conflict.snapshot).snapshot_sha256; rebindFixture(conflict);
  const result = await publish(conflict); assert.equal(result.status, 'conflict'); assert.equal(result.counts.conflict, 1); assert.ok(result.counts.unattempted > 0);
});

test('normalized reads enforce independent scope and workspace and revalidate corrupted publication proof', async () => {
  await publish();
  assert.equal((await get('', { scope: 'source:read' })).status, 403);
  assert.deepEqual((await (await get('', { scope: 'transactions:read', workspace_key: 'synthetic_other' })).json()).items, []);
  const row = (await owner.pool.query('SELECT publication FROM platform.local_transaction_revisions WHERE transaction_id=$1', ['synthetic_payment_001'])).rows[0];
  await owner.pool.query("UPDATE platform.local_transaction_revisions SET publication=jsonb_set(publication,'{normalization_input,status_code}',to_jsonb('SYNTHETIC_PRIVATE_VALUE'::text)) WHERE transaction_id='synthetic_payment_001'");
  const response = await get('/latest'); assert.equal(response.status, 503); assert.ok(!(await response.text()).includes('SYNTHETIC_PRIVATE_VALUE'));
  await owner.pool.query("UPDATE platform.local_transaction_revisions SET publication=$1 WHERE transaction_id='synthetic_payment_001'", [row.publication]);
  assert.equal((await get('/latest')).status, 200);
});

test('private binding file permissions, symlinks, partial input and bad fingerprint fail before any PG write', async () => {
  const file = join(bindings, 'v1', f.snapshot.capture_id, 'publication.json'); const original = await readFile(file);
  const reject = () => assert.rejects(publishCapture(spool, evidenceBase, bindings, f.snapshot.capture_id, dsn(state, 'intake')), /diagnostics withheld/);
  await chmod(file, 0o644); try { await reject(); } finally { await chmod(file, 0o600); }
  const alternate = join(temporary, 'binding-link'); await symlink(bindings, alternate); await assert.rejects(publishCapture(spool, evidenceBase, alternate, f.snapshot.capture_id, dsn(state, 'intake')));
  await writeFile(file, '{', { mode: 0o600 }); await reject();
  const bad = JSON.parse(original); bad.snapshot_sha256 = '0'.repeat(64); await writeFile(file, JSON.stringify(bad), { mode: 0o600 }); await reject();
  await writeFile(file, original, { mode: 0o600 });
  assert.equal((await owner.pool.query('SELECT count(*)::int AS n FROM platform.local_transaction_revisions')).rows[0].n, 0);
});

test('publisher failure is bounded and replay after PG recovery finishes without extra revisions', async () => {
  await stopCluster(state);
  try { const result = await publish(); assert.equal(result.status, 'failed'); assert.equal(result.counts.failed, 1); }
  finally { await startCluster(state); }
  assert.equal((await publish()).counts.inserted, 3); assert.equal((await publish()).counts.duplicate, 3);
});

test('failure after one committed revision rolls back the failing row and replay resumes without duplicate effects', async () => {
  await owner.pool.query(`CREATE FUNCTION platform.synthetic_publication_failure() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.transaction_id='synthetic_payment_001' THEN RAISE EXCEPTION 'synthetic failure'; END IF; RETURN NEW; END $$`);
  await owner.pool.query('CREATE TRIGGER synthetic_publication_failure BEFORE INSERT ON platform.local_transaction_revisions FOR EACH ROW EXECUTE FUNCTION platform.synthetic_publication_failure()');
  try {
    const result = await publish(); assert.equal(result.status, 'failed');
    assert.equal(result.counts.inserted, 1); assert.equal(result.counts.failed, 1); assert.equal(result.counts.unattempted, 1);
    assert.equal((await owner.pool.query('SELECT count(*)::int AS n FROM platform.local_transaction_revisions')).rows[0].n, 1);
  } finally {
    await owner.pool.query('DROP TRIGGER synthetic_publication_failure ON platform.local_transaction_revisions');
    await owner.pool.query('DROP FUNCTION platform.synthetic_publication_failure()');
  }
  const resumed = await publish(); assert.equal(resumed.status, 'complete'); assert.equal(resumed.counts.duplicate, 1); assert.equal(resumed.counts.inserted, 2);
  assert.equal((await publish()).counts.duplicate, 3);
});
