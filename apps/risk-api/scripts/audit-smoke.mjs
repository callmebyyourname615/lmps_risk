import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createLocalOutbox } from '@lmps/database';
import { createApp } from '../dist/app.js';
import { dsn, loadState, localMode } from '../../../packages/database/scripts/local.mjs';
import { authFixture } from './auth-fixture.mjs';

let temporary, app, queue;
try {
  localMode(); if (process.argv.length !== 2) throw new Error();
  const state = await loadState(); const workspace = 'synthetic_audit_' + randomUUID().replaceAll('-', '');
  temporary = await mkdtemp('/tmp/lmps-audit-http-'); const fixture = await authFixture(temporary);
  queue = createLocalOutbox(dsn(state, 'outbox'));
  const input = { workspace_key: workspace, semantic_key: 'synthetic_audit_smoke', notification_ref: randomUUID(), expires_at: new Date(Date.now() + 600000).toISOString() };
  const inserted = await queue.enqueue(input); const duplicate = await queue.enqueue(input);
  const work = await queue.claim(workspace); if (work.status !== 'claimed' || work.claim.intent_ref !== inserted.intent_ref) throw new Error();
  if ((await queue.finish(work.claim, 'accepted')).status !== 'accepted' || duplicate.status !== 'duplicate') throw new Error();
  ({ app } = await createApp({ LMPS_ENVIRONMENT: 'test', LMPS_POSTGRES_DSN: dsn(state), LMPS_LOCAL_AUTH_CONFIG: fixture.path }));
  await app.listen(0, '127.0.0.1');
  const url = `http://127.0.0.1:${app.getHttpServer().address().port}/v1/local/audit/events?intent_ref=${inserted.intent_ref}`;
  const denied = await fetch(url); const wrongScope = await fetch(url, { headers: { authorization: 'Bearer ' + await fixture.token({ workspace_key: workspace }) } });
  const response = await fetch(url, { headers: { authorization: 'Bearer ' + await fixture.token({ scope: 'audit:read', workspace_key: workspace }) } });
  if (denied.status !== 401 || wrongScope.status !== 403 || response.status !== 200) throw new Error();
  const page = await response.json();
  if (page.items.length !== 5 || page.next_cursor !== null || !page.items.every(row => row.actor_role === 'lmps_outbox' && row.correlation_id === inserted.intent_ref)) throw new Error();
  console.info(JSON.stringify({ provenance: 'local_synthetic', execution_mode: 'test', provider: 'fake', unauthorized_status: denied.status,
    wrong_scope_status: wrongScope.status, authorized_status: response.status, correlated_events: page.items.length, duplicate_created_event: false }));
} catch { console.error('Local audit smoke failed; payload/token/storage diagnostics withheld.'); process.exitCode = 1; }
finally { await queue?.close(); await app?.close(); if (temporary) await rm(temporary, { recursive: true, force: true }); }
