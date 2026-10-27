// Shared implementation keeps offline and persisted assessments on the same evaluator.
export { RULE_EVALUATOR_VERSION, MAX_BACKTEST_MANIFEST_BYTES, MAX_BACKTEST_REPORT_BYTES, validateBacktestManifest, evaluateBacktest, runBacktest } from '@lmps/database';
export type { SyntheticRule, BacktestTarget, BacktestManifest, BacktestObservation, BacktestReport } from '@lmps/database';
