// In-process transport fixture: real API authorization/localization/proof validation, synthetic storage driver.
import { randomUUID } from 'node:crypto';
import { registerPreviewSession } from './preview-session.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { AlertError, evaluateTransactionRisk, projectAlert, riskHash } from '../../../../packages/risk/dist/index.js';
import { validateAlertRow } from '../../../../packages/database/dist/index.js';
import { alertFixture } from '../../../../packages/database/test/fixtures/alert.mjs';
import { createApp } from '../../../risk-api/dist/app.js';
import { POSTGRES_DATABASE } from '../../../risk-api/dist/postgres.service.js';
import { ALERT_REVIEWS } from '../../../risk-api/dist/alerts.controller.js';
import { authFixture } from '../../../risk-api/scripts/auth-fixture.mjs';

export async function portalFixture({ preview } = {}) {
  const temporary = await mkdtemp('/tmp/lmps-portal-test-');
  let app;
  try {
    const auth = await authFixture(temporary);
    const dsn = role => { const url = new URL('postgresql://127.0.0.1:18599/lmps_risk_local'); url.username = role; url.password = randomUUID(); return url.href; };
    ({ app } = await createApp({ LMPS_ENVIRONMENT: 'test', LMPS_POSTGRES_DSN: dsn('lmps_app'), LMPS_LOCAL_AUTH_CONFIG: auth.path, LMPS_LOCAL_REVIEW_DSN: dsn('lmps_reviewer') }));
    const f = alertFixture(), state = { rows: [], failed: false, reviewCalls: [] };
    for (let i = 1; i <= 6; i++) {
      const item = alertFixture(), row = item.row;
      row.alert_id = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
      if (i === 1) {
        const risk = row.risk_snapshot; risk.request.context.flagged_accounts = null; risk.request.context.flagged_accounts_version = null;
        risk.result = evaluateTransactionRisk(risk.request, risk.observation); row.risk_snapshot_sha256 = riskHash(risk);
        row.snapshot = projectAlert(risk.result, item.policy).snapshot; row.snapshot_sha256 = riskHash(row.snapshot);
      }
      state.rows.push(row);
    }
    app.get(POSTGRES_DATABASE).pool.query = async (sql, args) => {
      if (state.failed) throw new Error('SYNTHETIC_PRIVATE_VALUE');
      if (!args || args[0] !== 'synthetic_local') return { rows: [] };
      if (sql.includes('a.alert_id=$2')) return { rows: state.rows.filter(row => row.alert_id === args[1]) };
      return { rows: state.rows.filter(row => (!args[1] || row.alert_id > args[1]) && (!args[2] || row.severity === args[2])
        && (!args[3] || row.snapshot.selected_risk_types.includes(args[3])) && (!args[4] || ['open', 'acknowledged', 'reviewed'][row.history.length] === args[4])).slice(0, args[5]) };
    };
    const review = async (workspace, id, actor, command) => {
      state.reviewCalls.push(structuredClone(command));
      if (state.failed) throw new AlertError('ALERT_STORAGE_UNAVAILABLE');
      const row = state.rows.find(r => r.alert_id === id);
      if (workspace !== 'synthetic_local' || !row) throw new AlertError('ALERT_NOT_FOUND');
      const saved = row.history.find(e => e.request_id === command.request_id);
      if (saved) {
        if (saved.actor_subject !== actor || ['expected_version', 'action', 'outcome', 'note'].some(k => saved[k] !== command[k])) throw new AlertError('ALERT_REVIEW_CONFLICT');
        return { status: 'duplicate', view: validateAlertRow(row, workspace) };
      }
      if (command.expected_version !== row.history.length || row.history.length >= 2) throw new AlertError('ALERT_REVIEW_CONFLICT');
      row.history.push({ ...f.event(command), actor_subject: actor }); return { status: 'inserted', view: validateAlertRow(row, workspace) };
    };
    app.get(ALERT_REVIEWS).review = review;
    if (preview) registerPreviewSession(app.getHttpAdapter().getInstance(), auth, preview);
    await app.init(); await app.getHttpAdapter().getInstance().ready();
    return { app, auth, state, review, async token(changes = {}) { return auth.token({ sub: 'synthetic_reviewer', scope: 'alerts:read alerts:review', ...changes }); },
      async request(url, { token, locale = 'en', method = 'GET', payload } = {}) {
        return app.inject({ method, url, ...(payload === undefined ? {} : { payload }), headers: { authorization: 'Bearer ' + (token ?? await auth.token({ scope: 'alerts:read' })), 'accept-language': locale } });
      }, async close() { await app.close(); await rm(temporary, { recursive: true, force: true }); } };
  } catch (error) { await app?.close(); await rm(temporary, { recursive: true, force: true }); throw error; }
}
