import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createDatabase, createLocalOutbox } from '@lmps/database';
import { createApp } from '../../dist/app.js';
import { authFixture } from '../../scripts/auth-fixture.mjs';
import { availablePort, dsn, initializeCluster, loadState, startCluster, stopCluster } from '../../../../packages/database/scripts/local.mjs';
import { migrations } from '../../../../packages/database/scripts/migrations.mjs';

export async function notificationsFixture() {
  let temporary, state, owner, queue, app;
  const close = async () => {
    try { await app?.close(); await queue?.close(); await owner?.close(); }
    finally {
      if (temporary && !state) try { state = await loadState(join(temporary, 'pg')); } catch {}
      if (state) await stopCluster(state);
      if (temporary) await rm(temporary, { recursive: true, force: true });
    }
  };
  try {
    temporary = await mkdtemp('/tmp/lmps-notifications-');
    state = await initializeCluster(join(temporary, 'pg'), await availablePort());
    await startCluster(state); await migrations(dsn(state, 'migration'), true);
    owner = createDatabase(dsn(state, 'migration'), 'migration'); queue = createLocalOutbox(dsn(state, 'outbox'));
    await owner.pool.query('ALTER SEQUENCE platform.local_outbox_attempts_attempt_id_seq RESTART WITH 9007199254740993');
    const workspace = 'synthetic_notifications', sharedReference = randomUUID(), entries = [], secrets = [];
    async function enqueue(name, expectedState, expired = false, scope = workspace, notification_ref = randomUUID()) {
      const semantic_key = 'synthetic_api_notifications_' + name;
      const result = await queue.enqueue({ workspace_key: scope, semantic_key, notification_ref,
        expires_at: expired ? '2020-01-01T00:00:00.000Z' : new Date(Date.now() + 86400000).toISOString() });
      const entry = { intent_ref: result.intent_ref, notification_ref, state: expectedState };
      secrets.push(semantic_key); if (scope === workspace) entries.push(entry);
      return entry;
    }
    // Select one owned fixture deterministically, without sleeping or running a worker against live data.
    async function claim(entry, scope = workspace) {
      await owner.pool.query(`UPDATE platform.local_outbox_intents SET available_at=CASE WHEN intent_ref=$2::uuid
        THEN clock_timestamp()-interval '1 day' ELSE clock_timestamp()+interval '1 day' END WHERE workspace_key=$1 AND state='pending'`, [scope, entry.intent_ref]);
      const result = await queue.claim(scope);
      if (result.status === 'claimed') {
        if (result.claim.intent_ref !== entry.intent_ref) throw Error('Owned fixture claimed the wrong intent');
        secrets.push(result.claim.lease_token);
        await owner.pool.query("UPDATE platform.local_outbox_intents SET lease_until=clock_timestamp()+interval '1 hour' WHERE intent_ref=$1", [entry.intent_ref]);
      }
      return result;
    }
    const accepted = await enqueue('accepted', 'accepted');
    let result = await claim(accepted); if (result.status !== 'claimed') throw Error('Fixture claim missing');
    await queue.finish(result.claim, 'accepted');
    const dead = await enqueue('dead', 'dead'); result = await claim(dead);
    if (result.status !== 'claimed') throw Error('Fixture claim missing'); await queue.finish(result.claim, 'permanent');
    const chain = await enqueue('chain', 'accepted');
    for (let n = 1; n <= 3; n++) {
      result = await claim(chain); if (result.status !== 'claimed') throw Error('Fixture retry missing');
      await queue.finish(result.claim, n === 3 ? 'accepted' : 'retry');
    }
    const expired = await enqueue('expired', 'expired', true);
    if ((await claim(expired)).status !== 'expired') throw Error('Fixture expiry missing');
    const leased = await enqueue('leased', 'leased'); if ((await claim(leased)).status !== 'claimed') throw Error('Fixture lease missing');
    const stale = await enqueue('stale', 'leased'); if ((await claim(stale)).status !== 'claimed') throw Error('Fixture lease missing');
    await owner.pool.query("UPDATE platform.local_outbox_intents SET lease_until=clock_timestamp()-interval '1 day' WHERE intent_ref=$1", [stale.intent_ref]);
    const overdue = await enqueue('overdue', 'pending', true);
    for (let n = 0; n < 30; n++) await enqueue('pending_' + n, 'pending', false, workspace, n < 10 ? sharedReference : randomUUID());
    const foreign = await enqueue('foreign', 'accepted', false, 'synthetic_other', sharedReference);
    result = await claim(foreign, 'synthetic_other'); if (result.status !== 'claimed') throw Error('Foreign fixture missing'); await queue.finish(result.claim, 'accepted');
    entries.sort((a, b) => a.intent_ref.localeCompare(b.intent_ref));
    const auth = await authFixture(temporary);
    ({ app } = await createApp({ LMPS_ENVIRONMENT: 'test', LMPS_POSTGRES_DSN: dsn(state), LMPS_LOCAL_AUTH_CONFIG: auth.path }));
    await app.listen(0, '127.0.0.1');
    async function fingerprint() {
      const values = {};
      for (const [table, key] of [['local_outbox_intents', 'intent_ref'], ['local_outbox_attempts', 'attempt_id'], ['audit_events', 'audit_id']]) {
        values[table] = (await owner.pool.query(`SELECT count(*)::int AS count,md5(coalesce(string_agg(to_jsonb(t)::text,'|' ORDER BY ${key}),'')) AS fingerprint FROM platform.${table} t`)).rows[0];
      }
      return values;
    }
    const baseline = await fingerprint();
    return { app, owner, queue, state, auth, workspace, entries, secrets, sharedReference, accepted, dead, chain, expired, leased, stale, overdue, foreign,
      token: changes => auth.token({ sub: 'synthetic_notification_reader', workspace_key: workspace, scope: 'operations:read', ...changes }),
      fingerprint, baseline, close, stopDatabase: () => stopCluster(state), startDatabase: () => startCluster(state) };
  } catch (error) { await close(); throw error; }
}
