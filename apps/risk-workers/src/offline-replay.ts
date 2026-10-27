import { createOfflineDatasets, datasetRowHash, ruleEvidenceHash, validateDatasetSnapshot } from '@lmps/database';
import { DATASET_COLUMNS } from '@lmps/contracts/offline-dataset';
import { MAX_REPLAY_REPORT_BYTES, OFFLINE_REPLAY_VERSION, OfflineReplayError, validateReplayInput,
  type ReplayReport, type ReplayRow } from '@lmps/contracts/offline-replay';

export function evaluateOfflineReplay(input: unknown, snapshotInput: unknown): ReplayReport {
  const request = validateReplayInput(input), { manifest, rows } = validateDatasetSnapshot(snapshotInput);
  if (manifest.workspace_key !== request.workspace_key || manifest.batch_ref !== request.batch_ref
    || manifest.dataset_sha256 !== request.dataset_sha256) throw new OfflineReplayError('REPLAY_INPUT_CONFLICT');
  const columns: readonly string[] = DATASET_COLUMNS[manifest.source_table];
  const amountIndex = columns.indexOf('amount'), currencyIndex = columns.indexOf('ccy');
  const thresholds = new Map(request.policy.thresholds.map(t => [t.source_ccy, t.amount_gte]));
  const counts = { rows: rows.length, matched: 0, not_matched: 0, unavailable: 0 };
  const results: ReplayRow[] = rows.map((values, i) => {
    const amount = values[amountIndex] ?? null, source_ccy = values[currencyIndex] ?? null;
    const threshold = source_ccy === null ? null : thresholds.get(source_ccy) ?? null;
    let outcome: ReplayRow['outcome'], reason_code: ReplayRow['reason_code'];
    if (amount === null || source_ccy === null) { outcome = 'unavailable'; reason_code = 'AMOUNT_FIELDS_UNAVAILABLE'; }
    else if (threshold === null) { outcome = 'unavailable'; reason_code = 'CURRENCY_POLICY_MISSING'; }
    else {
      // Signed raw decimals stay exact; no lifecycle, reversal, currency conversion or absolute-value inference.
      const matched = BigInt(amount.replace('.', '')) >= BigInt(threshold.replace('.', ''));
      outcome = matched ? 'matched' : 'not_matched'; reason_code = matched ? 'AMOUNT_AT_OR_ABOVE_THRESHOLD' : 'AMOUNT_BELOW_THRESHOLD';
    }
    counts[outcome]++;
    return { row_number: i + 1, row_sha256: datasetRowHash(values), outcome, reason_code, amount, source_ccy, threshold };
  });
  const report: ReplayReport = { format: 1, source_kind: 'user_supplied_file', execution_mode: 'offline_analysis', evaluator_version: OFFLINE_REPLAY_VERSION,
    purpose: 'simulation_only', source_semantics: 'unverified', canonical_emission: false, enforcement: false, operational_alerts: false,
    status: counts.unavailable ? 'partial' : 'complete', run_id: request.run_id, input_sha256: ruleEvidenceHash(request),
    policy_sha256: ruleEvidenceHash(request.policy), policy: request.policy,
    dataset: { workspace_key: manifest.workspace_key, batch_ref: manifest.batch_ref, source_namespace: manifest.source_namespace,
      source_table: manifest.source_table, profile_version: manifest.profile_version, dataset_sha256: manifest.dataset_sha256,
      rows_sha256: manifest.rows_sha256, expected_rows: manifest.expected_rows }, counts, rows: results };
  if (Buffer.byteLength(JSON.stringify(report)) > MAX_REPLAY_REPORT_BYTES) throw new OfflineReplayError('REPLAY_REPORT_UNAVAILABLE');
  return report;
}

export async function replayOfflineDataset(dsn: string, input: unknown): Promise<ReplayReport> {
  const request = validateReplayInput(input), repo = createOfflineDatasets(dsn);
  try {
    const snapshot = await repo.readComplete(request.workspace_key, request.batch_ref, request.dataset_sha256);
    return evaluateOfflineReplay(request, snapshot);
  } finally { await repo.close(); }
}

export function replayCsv(report: ReplayReport): string {
  const quote = (value: string | number | null, literal = false) => '"' + (value === null ? '' : (literal ? "'" : '') + String(value)).replaceAll('"', '""') + '"';
  const lines = ['run_id,batch_ref,policy_version,evaluator_version,purpose,source_semantics,row_number,row_sha256,outcome,reason_code,amount,source_ccy,threshold'];
  for (const row of report.rows) lines.push([quote(report.run_id), quote(report.dataset.batch_ref), quote(report.policy.version), quote(report.evaluator_version),
    quote(report.purpose), quote(report.source_semantics), quote(row.row_number), quote(row.row_sha256),
    quote(row.outcome), quote(row.reason_code), quote(row.amount, true), quote(row.source_ccy, true), quote(row.threshold, true)].join(','));
  const csv = lines.join('\r\n') + '\r\n';
  if (Buffer.byteLength(csv) > MAX_REPLAY_REPORT_BYTES) throw new OfflineReplayError('REPLAY_REPORT_UNAVAILABLE');
  return csv;
}
