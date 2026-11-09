import { datasetMode, validateDatasetValues } from './offline-dataset.js';

export const INTAKE_SOURCE_MAPPING = 'operator_intake_test_ok_failed_v1';
export const INTAKE_JOINT_MAPPING = 'operator_intake_test_result_revert_v2';
export const INTAKE_DECLARED_MAPPING = 'operator_intake_independent_status_refund_v3';

/** Independent user-declared facts for offline screening; never a normalized payment. */
export function declaredIntakeLifecycle(input: unknown) {
  try {
    datasetMode();
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype) throw Error();
    const names = ['result', 'shouldrevert', 'reference', 'originalreference'];
    if (Reflect.ownKeys(input).length !== names.length) throw Error();
    const values = names.map(name => {
      const d = Object.getOwnPropertyDescriptor(input, name);
      if (!d?.enumerable || !('value' in d)) throw Error();
      const v: unknown = d.value;
      if (v !== null && (typeof v !== 'string' || v.length > 400 || [...v].length > 200 || /[\u0000-\u001f\u007f\ud800-\udfff]/u.test(v))) throw Error();
      return v as string | null;
    });
    const [result, revert, reference, original] = values as [string | null, string | null, string | null, string | null];
    if (revert !== null && (!/^(0|-?[1-9][0-9]{0,9})$/.test(revert) || BigInt(revert) < -2147483648n || BigInt(revert) > 2147483647n)) throw Error();
    return {
      mapping: INTAKE_DECLARED_MAPPING,
      reported_success: result === 'OK' ? 'succeeded' as const : result && result.trim() === result ? 'not_successful' as const : 'unknown' as const,
      refund_instruction: revert === '1' ? 'required' as const : revert === '0' ? 'not_required' as const : 'unknown' as const,
      refund_completion: 'unverified' as const, reversed_amount: null, net_executed_amount: null,
      drs_reference: !original ? 'not_indicated' as const : !reference ? 'unknown' as const
        : original === reference ? 'same_reference_requires_review' as const : 'prior_reference_candidate' as const,
      business_payment_identity: 'unverified' as const, account_identity: 'unverified' as const,
      source_semantics: 'unverified' as const, authority: 'operator_declared_test_only' as const,
      occurrence_field: 'txtime' as const, request_received_field: 'requesttime' as const,
      occurred_at: null, known_at: null, timezone: 'unverified' as const,
    };
  } catch { throw Error('INTAKE_DECLARED_MAPPING_INVALID; source values withheld.'); }
}

/** Operator-declared joint rule; publication v2 requires bound rich review evidence. */
export function jointIntakeLifecycle(input: unknown) {
  try {
    datasetMode();
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.getPrototypeOf(input) !== Object.prototype) throw Error();
    const keys = Reflect.ownKeys(input);
    if (keys.length !== 2 || !keys.includes('result') || !keys.includes('shouldrevert')) throw Error();
    const descriptors = ['result', 'shouldrevert'].map(key => Object.getOwnPropertyDescriptor(input, key)!);
    if (descriptors.some(d => !d.enumerable || !('value' in d))) throw Error();
    const result: unknown = descriptors[0]!.value, revert: unknown = descriptors[1]!.value;
    if (result !== null && (typeof result !== 'string' || result.length > 200
      || /[\u0000-\u001f\u007f\ud800-\udfff]/u.test(result))) throw Error();
    if (revert !== null && (typeof revert !== 'string' || !/^(0|-?[1-9][0-9]{0,9})$/.test(revert)
      || BigInt(revert) < -2147483648n || BigInt(revert) > 2147483647n)) throw Error();
    const normal = result === 'OK' && revert === '0';
    const refund = typeof result === 'string' && result.length > 0 && result.trim() === result
      && result !== 'OK' && revert === '1';
    return {
      mapping: INTAKE_JOINT_MAPPING,
      transaction_status: normal ? 'succeeded' as const : refund ? 'failed' as const : 'unknown' as const,
      refund_instruction: refund ? 'required' as const : normal ? 'not_indicated' as const : 'unknown' as const,
      refund_completion: 'unverified' as const,
      reason: normal ? 'OPERATOR_NORMAL_PAIR' as const : refund ? 'OPERATOR_UNSUCCESSFUL_REFUND_REQUIRED' as const : 'JOINT_PAIR_UNCONFIRMED' as const,
      authority: 'operator_declared_test_only' as const, source_semantics: 'unverified' as const,
      occurred_at: null, account_identity: 'unverified' as const,
    };
  } catch { throw Error('INTAKE_JOINT_MAPPING_INVALID; source values withheld.'); }
}

/** Six-column Intake test interpretation only. No owner codebook, clock or identity approval. */
export function intakeSourceFacts(input: unknown) {
  try {
    datasetMode();
    const values = validateDatasetValues('transfer', input);
    const amount = values[2]!, currency = values[3]!;
    if (amount.startsWith('-') || !/^[A-Z]{3}$/.test(currency)) throw Error();
    return {
      mapping: INTAKE_SOURCE_MAPPING,
      amount, currency,
      transaction_status: values[4] === 'OK' ? 'succeeded' as const
        : values[4] === 'TRANSACTION_FAILED' ? 'failed' as const : 'unknown' as const,
      amount_semantics: 'raw_recorded_for_test' as const,
      source_semantics: 'unverified' as const,
      occurred_at: null, account_identity: 'unverified' as const,
    };
  } catch { throw Error('INTAKE_SOURCE_CONTRACT_INVALID; source values withheld.'); }
}
