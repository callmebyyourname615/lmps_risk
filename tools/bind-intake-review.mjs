import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual, parseArgs, promisify } from 'node:util';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, loadState, identify } from '../packages/database/scripts/local.mjs';
import { runtimeProfile } from './runtime-profile.mjs';
import { readPrivateJson, savePrivateReport } from '../apps/risk-workers/scripts/private-json.mjs';
import { createOfflineDatasets } from '../packages/database/dist/index.js';
import { dsn } from '../packages/database/scripts/local.mjs';
import { sourceContentHash, sourceTransactionId, sourcePublicationTransaction } from '../packages/contracts/dist/source-publication.js';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const requireValue = value => { if (!value) throw Error('REVIEW_BINDING_INVALID'); };

/** Compare verified rich-file commitments with exact staged and stored evidence; no mapping decisions. */
export function matchReviewBindings(review, snapshot, stored) {
  requireValue(review?.format === 'lmps-review-binding-input-1'
    && [review.manifest_sha256, review.review_sha256, review.import_sha256].every(sha)
    && review.review_file === 'review/transfer-0000.csv' && review.import_file === 'import/transfer-0000.csv'
    && snapshot.manifest.source_table === 'transfer' && snapshot.manifest.dataset_sha256 === review.import_sha256
    && Array.isArray(review.rows) && review.rows.length > 0 && review.rows.length <= 1000
    && review.rows.length === snapshot.rows.length && stored.length === review.rows.length);
  const staged = new Map(snapshot.rows.map(values => [sourceTransactionId(values), values]));
  const current = new Map(stored.map(row => [row.transaction_id, row]));
  requireValue(staged.size === review.rows.length && current.size === stored.length);
  const seen = new Set(), positions = new Set();
  const rows = review.rows.map(row => {
    requireValue(sha(row.review_row_sha256) && Number.isInteger(row.review_row_number)
      && row.review_row_number >= 1 && row.review_row_number <= review.rows.length
      && !positions.has(row.review_row_number));
    positions.add(row.review_row_number);
    const id = sourceTransactionId(row.values), evidence = current.get(id);
    requireValue(!seen.has(id) && staged.has(id) && isDeepStrictEqual(staged.get(id), row.values) && evidence);
    seen.add(id);
    const checked = sourcePublicationTransaction(evidence.publication);
    requireValue(evidence.workspace_key === 'synthetic_local' && evidence.namespace === 'synthetic_csv'
      && Number.isInteger(evidence.revision_number) && evidence.revision_number > 0
      && checked.publication.source.workspace_key === evidence.workspace_key
      && checked.publication.source.source_namespace === evidence.namespace
      && checked.publication.binding.expected_revision + 1 === evidence.revision_number
      && isDeepStrictEqual(checked.transaction, evidence.payload)
      && isDeepStrictEqual(checked.publication.origin.values, row.values)
      && checked.transaction.transaction_id === id);
    return { transaction_id: id, revision_number: evidence.revision_number,
      transaction_revision: evidence.payload.transaction_revision, payload_sha256: digest(evidence.payload),
      publication_sha256: digest(evidence.publication), import_values_sha256: sourceContentHash(row.values),
      review_row_number: row.review_row_number, review_row_sha256: row.review_row_sha256 };
  });
  return { format: 'lmps-intake-review-binding-1', workspace: 'synthetic_local', namespace: 'synthetic_csv',
    batch_ref: snapshot.manifest.batch_ref, rows_sha256: snapshot.manifest.rows_sha256,
    manifest_sha256: review.manifest_sha256, review_file: review.review_file, review_sha256: review.review_sha256,
    import_file: review.import_file, import_sha256: review.import_sha256, rows,
    mapping_applied: false, revisions_created: false, source_semantics: 'unverified', account_identity: 'unverified' };
}

export async function bindIntakeReview(bundle) {
  const profile = runtimeProfile();
  requireValue(profile.profile === 'intake');
  const bridge = 'import json,sys;from verify_csv_export import review_binding_rows;print(json.dumps(review_binding_rows(sys.argv[1])))';
  const { stdout } = await promisify(execFile)(join(ROOT, '.venv/bin/python'),
    ['-B', '-c', bridge, resolve(bundle)], { cwd: join(ROOT, '../Data_Requirement'), timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
  const review = JSON.parse(stdout);
  requireValue(sha(review.import_sha256));
  const request = await readPrivateJson(join(ROOT, '.local/intake-csv', review.import_sha256, 'request-v2.json'), 16384);
  const state = await loadState(profile.stateDirectory);
  requireValue(state.port === 18513 && request.manifest.dataset_sha256 === review.import_sha256
    && request.manifest.workspace_key === 'offline_intake'
    && request.publication.namespace === 'synthetic_csv' && request.publication.workspace === 'synthetic_local');
  const staging = createOfflineDatasets(dsn(state, 'intake'));
  let snapshot;
  try { snapshot = await staging.readComplete('offline_intake', request.manifest.batch_ref, review.import_sha256); }
  finally { await staging.close(); }
  const client = await identify(state, 'lmps_risk_local');
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const ids = snapshot.rows.map(sourceTransactionId);
    const stored = (await client.query(
      "SELECT DISTINCT ON(transaction_id) workspace_key,namespace,transaction_id,revision_number,payload,publication FROM platform.local_transaction_revisions WHERE workspace_key='synthetic_local' AND namespace='synthetic_csv' AND transaction_id=ANY($1) ORDER BY transaction_id,revision_number DESC", [ids])).rows;
    const report = matchReviewBindings(review, snapshot, stored);
    await client.query('COMMIT');
    const reportSha = digest(report);
    const id = reportSha.slice(0, 8) + '-' + reportSha.slice(8, 12) + '-' + reportSha.slice(12, 16) + '-' + reportSha.slice(16, 20) + '-' + reportSha.slice(20, 32);
    const base = join(ROOT, '.local/intake-review-bindings');
    const created = await savePrivateReport(base, 'v1', id, 'binding.json', report, 2 * 1024 * 1024);
    return { status: created ? 'bound' : 'duplicate', matched_rows: report.rows.length, binding_sha256: reportSha,
      receipt: join(base, 'v1', id, 'binding.json'), mapping_applied: false, revisions_created: false };
  } finally { await client.end(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { bundle: { type: 'string' } } });
    requireValue(values.bundle);
    console.log(JSON.stringify(await bindIntakeReview(values.bundle)));
  } catch {
    console.error('REVIEW_BINDING_FAILED; source values and credentials withheld.'); process.exitCode = 1;
  }
}
