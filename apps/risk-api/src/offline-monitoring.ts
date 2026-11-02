import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { createOfflineDatasets } from '@lmps/database';
import { DATASET_DIGEST, DATASET_SCOPE, DATASET_UUID } from '@lmps/contracts/offline-dataset';
import { validateReplayInput } from '@lmps/contracts/offline-replay';
import { recordedAmountAtLeast, transferObservation } from '@lmps/contracts/intake-observation';
import { OFFLINE_MONITORING_MAX_BYTES, OFFLINE_MONITORING_MAX_ROWS, OFFLINE_MONITORING_VERSION,
  type OfflineMonitoringCatalog, type OfflineMonitoringCounts, type OfflineMonitoringDataset,
  type OfflineMonitoringTrends, type OfflineMonitoringRow } from '@lmps/contracts/offline-monitoring';
import type { Principal } from './local-auth.js';

export const OFFLINE_MONITORING = Symbol('OFFLINE_MONITORING');
export interface OfflineMonitoringGrant {
  subject: string; owner_workspace_key: string; dataset_workspace_key: string;
  batch_ref: string; dataset_sha256: string; expected_rows: number; label: string;
  thresholds: { source_ccy: string; amount_gte: string }[];
}
export interface OfflineMonitoringConfig { format: 1; default_batch_ref: string; grants: OfflineMonitoringGrant[] }
const exact = (v: unknown, keys: string[]): v is Record<string, unknown> => !!v && typeof v === 'object'
  && !Array.isArray(v) && Object.keys(v).sort().join(',') === [...keys].sort().join(',');
const fixtureKey = (v: unknown) => typeof v === 'string' && /^synthetic_[a-z0-9_]{1,40}$/.test(v);
export class OfflineMonitoringError extends Error {
  constructor(readonly code: 'OFFLINE_MONITORING_NOT_FOUND' | 'OFFLINE_MONITORING_UNAVAILABLE') { super(code); }
}

/** A private grant maps a local test principal to one immutable offline batch. */
export async function loadOfflineMonitoringConfig(path?: string): Promise<OfflineMonitoringConfig | null> {
  if (path === undefined) return null;
  try {
    if (!isAbsolute(path)) throw new Error();
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    let value: unknown;
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid?.() || (stat.mode & 0o077) || stat.size > 65536) throw new Error();
      const raw = await file.readFile(); if (raw.length > 65536) throw new Error();
      value = JSON.parse(raw.toString('utf8'));
    } finally { await file.close(); }
    if (!exact(value, ['format','default_batch_ref','grants']) || value.format !== 1
      || typeof value.default_batch_ref !== 'string' || !DATASET_UUID.test(value.default_batch_ref)
      || !Array.isArray(value.grants) || value.grants.length < 1 || value.grants.length > 16) throw new Error();
    const identities = new Set<string>();
    for (const grant of value.grants) {
      if (!exact(grant, ['subject','owner_workspace_key','dataset_workspace_key','batch_ref','dataset_sha256','expected_rows','label','thresholds'])
        || !fixtureKey(grant.subject) || !fixtureKey(grant.owner_workspace_key)
        || typeof grant.dataset_workspace_key !== 'string' || !DATASET_SCOPE.test(grant.dataset_workspace_key)
        || typeof grant.batch_ref !== 'string' || !DATASET_UUID.test(grant.batch_ref)
        || typeof grant.dataset_sha256 !== 'string' || !DATASET_DIGEST.test(grant.dataset_sha256)
        || !Number.isInteger(grant.expected_rows) || Number(grant.expected_rows) < 1 || Number(grant.expected_rows) > OFFLINE_MONITORING_MAX_ROWS
        || typeof grant.label !== 'string' || !grant.label.length || grant.label.length > 120 || /[\u0000-\u001f\u007f\ud800-\udfff]/u.test(grant.label)) throw new Error();
      validateReplayInput({ format: 1, execution_mode: 'offline_analysis', evaluator_version: 'offline-amount-screen-1',
        run_id: grant.batch_ref, workspace_key: grant.dataset_workspace_key, batch_ref: grant.batch_ref, dataset_sha256: grant.dataset_sha256,
        policy: { version: 'simulation_portal_amount_review', purpose: 'simulation_only', amount_semantics: 'raw_recorded_amount',
          amount_unit: 'as_recorded', lifecycle_scope: 'all_recorded_rows', thresholds: grant.thresholds } });
      const identity = JSON.stringify([grant.subject, grant.owner_workspace_key, grant.batch_ref]);
      if (identities.has(identity)) throw new Error(); identities.add(identity);
    }
    if (!value.grants.some(g => g.batch_ref === value.default_batch_ref)) throw new Error();
    return value as unknown as OfflineMonitoringConfig;
  } catch { throw new Error('Invalid private offline monitoring configuration.'); }
}

const empty = (): OfflineMonitoringCounts => ({ rows: 0, matched: 0, not_matched: 0, unavailable: 0 });
const descriptor = (g: OfflineMonitoringGrant): OfflineMonitoringDataset => ({ batch_ref: g.batch_ref,
  workspace_key: g.dataset_workspace_key, source_table: 'transfer', expected_rows: g.expected_rows, label: g.label });
export class OfflineMonitoringService {
  constructor(private readonly config: OfflineMonitoringConfig | null, private readonly dsn?: string,
    private readonly reader = createOfflineDatasets) {}
  private grants(principal: Principal) {
    return this.config?.grants.filter(g => g.subject === principal.subject && g.owner_workspace_key === principal.workspace) ?? [];
  }
  list(principal: Principal): OfflineMonitoringCatalog {
    const datasets = this.grants(principal).map(descriptor);
    return { version: 'offline-monitoring-datasets-1', owner_workspace_key: principal.workspace, datasets,
      default_batch_ref: datasets.find(d => d.batch_ref === this.config?.default_batch_ref)?.batch_ref ?? datasets[0]?.batch_ref ?? null };
  }
  async read(principal: Principal, batch: string): Promise<OfflineMonitoringTrends> {
    const grant = this.grants(principal).find(g => g.batch_ref === batch);
    if (!grant || !this.dsn) throw new OfflineMonitoringError('OFFLINE_MONITORING_NOT_FOUND');
    const repo = this.reader(this.dsn);
    try {
      const { manifest, rows: source } = await repo.readComplete(grant.dataset_workspace_key, batch, grant.dataset_sha256, OFFLINE_MONITORING_MAX_ROWS);
      if (manifest.source_table !== 'transfer' || manifest.expected_rows !== grant.expected_rows) throw new Error();
      const thresholds = new Map(grant.thresholds.map(t => [t.source_ccy, t.amount_gte]));
      const counts = empty(), currencies = new Map<string, OfflineMonitoringCounts>();
      const rows: OfflineMonitoringRow[] = source.map((values, index) => {
        const observation = transferObservation(manifest.source_namespace, 'file', values);
        const { id, requesttime } = observation.source_key;
        const { amount, source_currency: ccy, source_result: result, source_transaction_time: txtime } = observation;
        const threshold = thresholds.get(ccy!) ?? null;
        const outcome = threshold === null ? 'unavailable' : recordedAmountAtLeast(amount!, threshold) ? 'matched' : 'not_matched';
        const group = currencies.get(ccy!) ?? empty(); group.rows++; group[outcome]++; currencies.set(ccy!, group);
        counts.rows++; counts[outcome]++;
        return { row_number: index + 1, id: id!, requesttime: requesttime!, amount: amount!, ccy: ccy!, result: result ?? null,
          txtime: txtime!, outcome, threshold };
      });
      const report: OfflineMonitoringTrends = { version: OFFLINE_MONITORING_VERSION, owner_workspace_key: principal.workspace,
        source_kind: 'user_supplied_file', execution_mode: 'offline_analysis', source_semantics: 'unverified',
        as_of: new Date().toISOString(), consistency: 'verified_staging_snapshot', time_basis: 'raw_requesttime',
        source_timezone: 'unconfirmed_no_conversion', risk_assessment: 'not_performed', operational_alerts: false, enforcement: false,
        dataset: descriptor(grant), policy: { purpose: 'simulation_only', amount_unit: 'as_recorded', lifecycle_scope: 'all_recorded_rows',
          thresholds: structuredClone(grant.thresholds) }, counts, currencies: [...currencies].sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0)
          .map(([source_ccy, count]) => ({ source_ccy, ...count })), rows };
      if (Buffer.byteLength(JSON.stringify(report)) > OFFLINE_MONITORING_MAX_BYTES) throw new Error();
      return report;
    } catch { throw new OfflineMonitoringError('OFFLINE_MONITORING_UNAVAILABLE'); }
    finally { await repo.close(); }
  }
}
