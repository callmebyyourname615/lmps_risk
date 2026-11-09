import { createHash } from 'node:crypto';
import { DATASET_MAX_BYTES, DATASET_MAX_ROWS, datasetMode, validateDatasetValues } from '@lmps/contracts/offline-dataset';
import { INTAKE_SOURCE_MAPPING, intakeSourceFacts } from '@lmps/contracts/intake-source-contract';
import { RISK_CATALOG, RISK_CATALOG_VERSION, riskHash, validatePolicy } from '@lmps/risk';

type Status = 'eligible_for_test' | 'waiting_policy' | 'unavailable' | 'not_applicable' | 'disabled';
const counts = (): Record<Status, number> => ({ eligible_for_test: 0, waiting_policy: 0, unavailable: 0, not_applicable: 0, disabled: 0 });
const requirements: Record<string, string> = {
  identity: 'ACCOUNT_IDENTITY_UNVERIFIED', history: 'HISTORY_COVERAGE_UNVERIFIED',
  baseline: 'BASELINE_UNAVAILABLE', graph: 'ACCOUNT_GRAPH_UNAVAILABLE', flags: 'FLAGGED_ACCOUNTS_UNAVAILABLE',
};

/** Aggregate capability audit; never evaluates a signal or authorizes a source/policy. */
export function analyzeIntakeSourceContract(input: unknown, policyInput: unknown = null) {
  try {
    datasetMode();
    if (!Array.isArray(input) || input.length < 1 || input.length > DATASET_MAX_ROWS) throw Error();
    const policy = policyInput === null ? null : validatePolicy(policyInput);
    const patterns = RISK_CATALOG.map(entry => ({ code: entry.code, dimension: entry.dimension,
      source_blockers: ['SOURCE_DECLARATIONS_NOT_INDEPENDENTLY_VERIFIED', 'NET_EXECUTION_UNVERIFIED',
        ...(entry.requires.length ? ['SOURCE_TIME_SEMANTICS_UNVERIFIED', ...entry.requires.map(key => requirements[key] ?? 'REQUIRED_CONTEXT_UNAVAILABLE')] : [])],
      counts: counts(), reason_codes: new Set<string>() }));
    const currencies = new Map<string, { currency: string; rows: number; lifecycle: { succeeded: number; failed: number; unknown: number } }>();
    const keys = new Set<string>(), hash = createHash('sha256');
    let bytes = 0;
    for (const raw of input) {
      const values = validateDatasetValues('transfer', raw), facts = intakeSourceFacts(values);
      const serialized = JSON.stringify(values), key = JSON.stringify(values.slice(0, 2));
      bytes += Buffer.byteLength(serialized) + 1;
      if (bytes > DATASET_MAX_BYTES || keys.has(key)) throw Error();
      keys.add(key); hash.update(serialized + '\n');
      const group = currencies.get(facts.currency) ?? { currency: facts.currency, rows: 0, lifecycle: { succeeded: 0, failed: 0, unknown: 0 } };
      group.rows++; group.lifecycle[facts.transaction_status]++; currencies.set(facts.currency, group);
      for (const [i, entry] of RISK_CATALOG.entries()) {
        const pattern = patterns[i]!, rule = policy?.rules.find(rule => rule.code === entry.code);
        let status: Status, reasons: string[];
        if (!policy || policy.currency !== facts.currency) {
          status = 'waiting_policy'; reasons = ['CURRENCY_POLICY_UNAVAILABLE'];
        } else if (!rule?.enabled) {
          status = 'disabled'; reasons = ['RULE_DISABLED'];
        } else if (facts.transaction_status === 'unknown') {
          status = 'unavailable'; reasons = ['LIFECYCLE_CODE_UNMAPPED'];
        } else if (facts.transaction_status === 'failed' || BigInt(facts.amount.replace('.', '')) === 0n) {
          status = 'not_applicable'; reasons = ['TRANSACTION_NOT_EXECUTED'];
        } else if (entry.requires.length) {
          status = 'unavailable'; reasons = ['SOURCE_TIME_SEMANTICS_UNVERIFIED',
            ...entry.requires.map(key => requirements[key] ?? 'REQUIRED_CONTEXT_UNAVAILABLE')];
        } else {
          status = 'eligible_for_test'; reasons = ['OPERATOR_INTAKE_TEST_MAPPING_ONLY'];
        }
        pattern.counts[status]++;
        for (const reason of reasons) pattern.reason_codes.add(reason);
      }
    }
    return {
      format: 'lmps-intake-source-contract-1' as const, execution_mode: 'test' as const,
      source_kind: 'user_supplied_file' as const, mapping: INTAKE_SOURCE_MAPPING,
      source_semantics: 'unverified' as const, account_identity: 'unverified' as const,
      source_rows: input.length, rows_sha256: hash.digest('hex'), catalog_version: RISK_CATALOG_VERSION,
      policy: policy ? { currency: policy.currency, sha256: riskHash(policy), authority: 'caller_supplied_test_only' as const } : null,
      currencies: [...currencies.values()].sort((a, b) => a.currency.localeCompare(b.currency)),
      patterns: patterns.map(pattern => ({ ...pattern, reason_codes: [...pattern.reason_codes].sort() })),
      production_ready_patterns: 0, assessment_performed: false, operational_alerts_created: false, enforcement: false,
    };
  } catch { throw Error('INTAKE_SOURCE_CONTRACT_INVALID; source values withheld.'); }
}
