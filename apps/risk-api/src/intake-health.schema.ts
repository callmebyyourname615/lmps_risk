import type { SchemaObject } from '@nestjs/swagger';

const count: SchemaObject = { type: 'integer', minimum: 0, maximum: 10_000 };
const currency: SchemaObject = { type: 'string', pattern: '^[A-Z]{3}$' };
const object = (properties: Record<string, SchemaObject>): SchemaObject => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const fixed = (value: string | boolean): SchemaObject => ({ type: typeof value === 'boolean' ? 'boolean' : 'string', enum: [value] });
export const intakeHealthSchema = object({
  format: fixed('lmps-intake-health-1'), execution_mode: fixed('test'), source_kind: fixed('user_supplied_file'),
  workspace: { type: 'string', pattern: '^synthetic_[a-z0-9_]{1,40}$' }, namespace: { type: 'string', pattern: '^synthetic_[a-z0-9_]{1,40}$' },
  as_of: { type: 'string', format: 'date-time' }, consistency: fixed('request_repeatable_read'), demo_results_included: fixed(false),
  stored_revisions: count, transactions: count, revised_transactions: count, evidence_sha256: { type: 'string', pattern: '^[a-f0-9]{64}$', description: 'Reference to stored private evidence; not source authentication.' },
  mappings: { type: 'object', additionalProperties: false, properties: { operator_intake_test_ok_failed_v1: count, operator_intake_test_result_revert_v2: count } },
  currencies: { type: 'array', maxItems: 10_000, items: object({ currency, transactions: count, succeeded: count, failed: count, unknown: count }) },
  currency_policies: { type: 'array', maxItems: 10_000, items: object({ currency, state: { type: 'string', enum: ['configured', 'waiting_policy'] } }) }, waiting_policy: count,
  refund_instruction: object({ required: count, not_indicated: count, unknown: count }), refund_completion: fixed('unverified'),
  identity: object({ verified_transactions: { ...count, maximum: 0 }, unresolved_sender_slots: count, unresolved_receiver_slots: count }),
  source_semantics: fixed('unverified'), business_payment_identity: fixed('unverified'), payment_time: fixed('unverified'), source_history_coverage: fixed('unverified'),
  stored_revision_chains_verified: fixed(true), account_linkage_performed: fixed(false), assessment_performed: fixed(false), connection_authorized: fixed(false), production_ready: fixed(false),
});
