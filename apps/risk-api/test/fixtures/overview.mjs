import { randomUUID } from 'node:crypto';
import { transactionListFixture } from './transaction-list.mjs';
import { createTransactionRisks, createLocalAlerts, createAlertReviews, createLocalCases } from '@lmps/database';
import { riskHash } from '@lmps/risk';
import { publicationTransaction } from '../../../../packages/contracts/dist/synthetic-publication.js';
import { alertFixture } from '../../../../packages/database/test/fixtures/alert.mjs';
import { dsn } from '../../../../packages/database/scripts/local.mjs';
export const OVERVIEW_SCOPES = 'transactions:read risk:read alerts:read cases:read';
export async function overviewFixture() {
  const base = await transactionListFixture();
  const owned = [];
  const close = async () => { try { for (const service of owned.reverse()) await service.close(); } finally { await base.close(); } };
  try {
    const risks = createTransactionRisks(dsn(base.state, 'intake')); owned.push(risks);
    const alerts = createLocalAlerts(dsn(base.state, 'intake')); owned.push(alerts);
    const reviews = createAlertReviews(dsn(base.state, 'reviewer')); owned.push(reviews);
    const cases = createLocalCases(dsn(base.state, 'case')); owned.push(cases);
    const actor = 'synthetic_analyst', entries = [];
    const command = (action, expected_version, extra = {}) => ({ action, expected_version, request_id: randomUUID(), note: 'Synthetic Overview fixture', ...extra });
    for (let i = 1; i <= 7; i++) {
      const f = alertFixture(), id = `synthetic_overview_${String(i).padStart(3, '0')}`;
      f.f.revision.publication.binding.transaction_id = id;
      f.f.revision.transaction = publicationTransaction(f.f.revision.publication).transaction;
      const originalId = f.f.request.target.transaction_id;
      f.f.request.run_id = randomUUID(); f.f.request.target.transaction_id = id;
      f.f.request.context.binding.transaction_id = id;
      f.f.request.context.events = f.f.request.context.events.map(event => event.transaction_id === originalId ? { ...event, transaction_id: id } : event);
      f.f.request.context.binding.revision_sha256 = riskHash(f.f.revision);
      await base.writer.append(f.f.revision); await risks.evaluate(f.f.request);
      f.generation.assessment_run_id = f.f.request.run_id;
      const { alert_id } = await alerts.generate(f.generation), case_id = randomUUID();
      if (!alert_id) throw Error('Synthetic Overview alert missing');
      await cases.command('synthetic_local', case_id, actor, command('create', 0, { alert_id, title: `Synthetic review ${i}` }));
      if (i <= 2) {
        await reviews.review('synthetic_local', alert_id, actor, f.ack);
        await cases.command('synthetic_local', case_id, actor, command('assign', 1, { assignee_subject: actor }));
        await cases.command('synthetic_local', case_id, actor, command('start', 2));
      }
      if (i === 1) {
        await reviews.review('synthetic_local', alert_id, actor, f.review);
        const dimensions = Object.fromEntries(['fraud', 'mule_network', 'aml'].map(key => [key, { outcome: 'unknown', rationale: 'Synthetic evidence only' }]));
        await cases.command('synthetic_local', case_id, actor, command('record_outcome', 3, { dimensions }));
        await cases.command('synthetic_local', case_id, actor, command('close', 4));
      }
      if (i === 2) await risks.evaluate({ ...f.f.request, run_id: randomUUID() });
      entries.push({ id, case_id, alert_id, request: f.f.request, revision: f.f.revision });
    }
    const newer = structuredClone(entries[0].revision);
    newer.expected_revision = 1; newer.publication.binding.expected_revision = 1;
    newer.publication.binding.transaction_revision = 'synthetic_revision_2';
    newer.transaction = publicationTransaction(newer.publication).transaction;
    await base.writer.append(newer);
    return { ...base, entries, risks, alerts, reviews, cases, close,
      token: changes => base.token({ scope: OVERVIEW_SCOPES, ...changes }),
      expectedCounts: { transactions: 48, assessment_runs: 8, assessed_latest_transactions: 6, open_alerts: 5, acknowledged_alerts: 1, reviewed_alerts: 1, open_cases: 5, in_review_cases: 1, closed_cases: 1 } };
  } catch (error) { await close(); throw error; }
}
