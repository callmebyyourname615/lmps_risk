import { createHash } from 'node:crypto';
import { validateDatasetValues } from './offline-dataset.js';

export const INTAKE_OBSERVATION_VERSION = 'intake-transfer-observation-1';
export interface TransferObservation {
  version: typeof INTAKE_OBSERVATION_VERSION;
  identity: string; revision_sha256: string; source_namespace: string;
  transport: 'file' | 'sync';
  source_kind: 'user_supplied_file' | 'database_sync';
  source_key: { id: string; requesttime: string };
  amount: string; source_currency: string; source_result: string | null;
  source_transaction_time: string;
  lifecycle_status: 'unknown'; occurred_at: null; source_timezone: 'unverified';
  amount_unit: 'unverified'; account_identity: 'unresolved';
}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Both transports supply the same six raw fields. Transport/checkpoint is deliberately
// excluded from identity and content hashes: changing file -> sync must not create a second payment.
// This preserves observations; it grants no lifecycle, currency-unit or account semantics.
export function transferObservation(namespace: string, transport: 'file' | 'sync', values: unknown): TransferObservation {
  try {
    if (typeof namespace !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(namespace) || !['file','sync'].includes(transport)) throw new Error();
    const [id, requesttime, amount, ccy, result, txtime] = validateDatasetValues('transfer', values);
    return { version: INTAKE_OBSERVATION_VERSION,
      identity: digest([INTAKE_OBSERVATION_VERSION, namespace, 'transfer', id, requesttime]),
      revision_sha256: digest([INTAKE_OBSERVATION_VERSION, namespace, 'transfer', id, requesttime, amount, ccy, result, txtime]),
      source_namespace: namespace, transport, source_kind: transport === 'file' ? 'user_supplied_file' : 'database_sync',
      source_key: { id: id!, requesttime: requesttime! }, amount: amount!, source_currency: ccy!, source_result: result ?? null,
      source_transaction_time: txtime!, lifecycle_status: 'unknown', occurred_at: null, source_timezone: 'unverified',
      amount_unit: 'unverified', account_identity: 'unresolved' };
  } catch { throw new Error('INTAKE_OBSERVATION_INVALID; source values withheld.'); }
}

export function recordedAmountAtLeast(amount: string, threshold: string): boolean {
  if (![amount, threshold].every(v => typeof v === 'string' && /^-?(0|[1-9]\d{0,21})\.\d{2}$/.test(v))) throw new Error('INTAKE_AMOUNT_INVALID; source values withheld.');
  return BigInt(amount.replace('.', '')) >= BigInt(threshold.replace('.', ''));
}
