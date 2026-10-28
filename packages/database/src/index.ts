import pg, { type PoolConfig } from 'pg';

export type DatabaseRole = 'app' | 'migration' | 'intake' | 'outbox' | 'reviewer' | 'policy' | 'case';
export type PostgresStatus = 'available' | 'unavailable' | 'not_configured';

export function localPoolConfig(dsn: string, role: DatabaseRole = 'app'): PoolConfig {
  try {
    if (!['app', 'migration', 'intake', 'outbox', 'reviewer', 'policy', 'case'].includes(role)) throw new Error();
    const url = new URL(dsn);
    const user = { app: 'lmps_app', migration: 'lmps_migrator', intake: 'lmps_intake', outbox: 'lmps_outbox', reviewer: 'lmps_reviewer', policy: 'lmps_policy', case: 'lmps_case' }[role];
    const port = Number(url.port);
    if (url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1'
      || !/^\d+$/.test(url.port) || port < 1 || port > 65535
      || url.pathname !== '/lmps_risk_local' || url.username !== user
      || !url.password || url.search || url.hash) throw new Error();
    return {
      host: '127.0.0.1', port, database: 'lmps_risk_local', user,
      password: decodeURIComponent(url.password), ssl: false,
      application_name: `lmps-local-${role}`,
      max: { app: 4, migration: 1, intake: 2, outbox: 2, reviewer: 2, policy: 2, case: 2 }[role],
      connectionTimeoutMillis: 1000, idleTimeoutMillis: 5000,
      statement_timeout: role === 'migration' ? 5000 : 1000,
      lock_timeout: 500, idle_in_transaction_session_timeout: 5000,
      query_timeout: role === 'migration' ? 5500 : 1500,
      options: '-c search_path=pg_catalog -c timezone=UTC',
    };
  } catch {
    throw new Error('Invalid local PostgreSQL configuration.');
  }
}

export function createDatabase(dsn: string, role: DatabaseRole = 'app') {
  const pool = new pg.Pool(localPoolConfig(dsn, role));
  // Idle backend failures must not crash the process or log credentials/query values.
  pool.on('error', () => {});
  return {
    pool,
    async health(): Promise<PostgresStatus> {
      try {
        await pool.query('SELECT 1');
        return 'available';
      } catch {
        return 'unavailable';
      }
    },
    close: () => pool.end(),
  };
}

export type Database = ReturnType<typeof createDatabase>;

export { createSourceIntake, appendSourceEvent, validateSourceEvent, IntakeError, type LocalSourceEvent } from './source-intake.js';
export { createLocalOutbox, enqueueLocalIntent, OutboxError, type LocalIntent, type LocalClaim } from './outbox.js';

export { createSyncJobs, SyncJobError, type SyncIdentity, type SyncClaim, type SyncOutcome } from './sync-jobs.js';
export { createTransactionRevisions, validateTransactionRevision, TransactionRevisionError, type LocalTransactionRevision } from './transaction-revisions.js';

export { RULE_EVALUATOR_VERSION, MAX_BACKTEST_MANIFEST_BYTES, MAX_BACKTEST_REPORT_BYTES, validateBacktestManifest, evaluateBacktest, runBacktest, ruleEvidenceHash, type SyntheticRule, type BacktestTarget, type BacktestManifest, type BacktestObservation, type BacktestReport } from './rule-backtest.js';
export { createRuleAssessments, validateRuleVersion, validateAssessmentReport, RuleAssessmentError } from './rule-assessments.js';

export { createTransactionRisks, riskObservation, validateFrozenTransactionRisk, type FrozenTransactionRisk } from './transaction-risks.js';

export { createLocalAlerts, createAlertReviews, readLocalAlert, listLocalAlerts, validateAlertRow, type AlertView, type AlertQuery } from './alerts.js';

export { createRiskJobs, validateRiskJobInput, riskJobInputHash, RiskJobError, type RiskJobClaim } from './risk-jobs.js';

export { listRiskJobs, readRiskJob, readRiskJobAttempts } from './risk-job-reads.js';
export { createDetectionHandoff, readDetectionHealth, DetectionError } from './detection-handoff.js';

export { createOfflineDatasets, datasetRowsHash, datasetRowHash, datasetIdentity, validateDatasetSnapshot } from './offline-datasets.js';

export { createRiskPolicies, readRiskPolicy, listRiskPolicies, readPolicyBinding, compareStoredRiskPolicies } from './risk-policies.js';

export { createLocalCases, readLocalCase, listLocalCases, readCaseHistory, caseAlertEvidence, type CaseQuery } from './cases.js';

export { createModelSignals, readModelReceipt, type FrozenModelReceipt } from './model-signals.js';

export {createLabelReviews,readLabelReview,labelCandidates,validateLabelCommand,LabelError,type LabelCommand,type LabelReviewView} from './label-reviews.js';

export {labelCommandSchema} from '@lmps/contracts/label-review';

export { readMonitoringSummary, readMonitoringSnapshot, MonitoringReadError } from './monitoring-reads.js';
export { readMonitoringTimeline } from './monitoring-timeline.js';
