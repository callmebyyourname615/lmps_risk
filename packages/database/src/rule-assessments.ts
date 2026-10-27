import { PUBLISHER_VERSION } from '@lmps/contracts/synthetic-publication';
import { isDeepStrictEqual } from 'node:util';
import type { PoolClient } from 'pg';
import { createDatabase } from './index.js';
import { evaluateBacktest, readBacktest, ruleEvidenceHash, validateBacktestManifest, MAX_BACKTEST_REPORT_BYTES, RULE_EVALUATOR_VERSION, assessmentRuleResult,
  type BacktestManifest, type BacktestReport, type SyntheticRule } from './rule-backtest.js';

export class RuleAssessmentError extends Error {
  constructor(readonly code: 'INVALID_ASSESSMENT' | 'RULE_VERSION_CONFLICT' | 'ASSESSMENT_CONFLICT' | 'STORAGE_FAILED') {
    super(`Local synthetic assessment: ${code}; details withheld.`);
  }
}

export function validateRuleVersion(input: unknown, digest: string): SyntheticRule {
  const manifest = validateBacktestManifest({ format: 1, provenance: 'local_synthetic', execution_mode: 'test',
    evaluator_version: RULE_EVALUATOR_VERSION, run_id: '11111111-1111-4111-8111-111111111111', workspace_key: 'synthetic_local',
    rules: [input], targets: [{ namespace: 'synthetic_validation', transaction_id: 'validation', revision_number: 1 }] });
  const rule = manifest.rules[0]!;
  if (!isDeepStrictEqual(rule, input) || ruleEvidenceHash(rule) !== digest) throw new RuleAssessmentError('INVALID_ASSESSMENT');
  return rule;
}

// Validate only frozen evidence; later source changes must never rewrite a historical assessment.
export function validateAssessmentReport(input: unknown, digest: string): BacktestReport {
  try {
    const report = structuredClone(input) as BacktestReport;
    if (!report || Buffer.byteLength(JSON.stringify(report)) > MAX_BACKTEST_REPORT_BYTES || ruleEvidenceHash(report) !== digest
      || !Array.isArray(report.rows) || report.rows.length > 100) throw new Error();
    const manifest = validateBacktestManifest({ format: report.format, provenance: report.provenance, execution_mode: report.execution_mode,
      evaluator_version: report.evaluator_version, workspace_key: report.workspace_key, run_id: report.run_id,
      rules: report.rules, targets: report.rows.map(row => row.target) });
    const expected = evaluateBacktest(manifest, manifest.targets.map(target => ({ target, revision: null })));
    const counts = expected.counts; counts.unavailable_inputs = 0; counts.unavailable = 0;
    const hex = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
    const exact = (value: unknown, keys: string[]) => value && typeof value === 'object' && !Array.isArray(value)
      && Object.keys(value).sort().join(',') === keys.sort().join(',');
    for (const [index, row] of report.rows.entries()) {
      if (!exact(row, ['target', 'availability', 'input_sha256', 'source', 'results']) || !isDeepStrictEqual(row.target, manifest.targets[index])
        || !['available', 'missing', 'invalid', 'not_normalized'].includes(row.availability)
        || (row.availability === 'missing' ? row.input_sha256 !== null : !hex(row.input_sha256))
        || !Array.isArray(row.results) || row.results.length !== manifest.rules.length) throw new Error();
      const available = row.availability === 'available';
      counts[available ? 'available_inputs' : 'unavailable_inputs']++;
      if (available) {
        const src = row.source;
        if (!exact(src, ['source_reference', 'observed_at', 'publisher_version', 'capture_id', 'snapshot_sha256', 'evidence_sha256']) || !src
          || !exact(src.source_reference, ['namespace', 'record_ref', 'mapping_version'])
          || src.source_reference.namespace !== row.target.namespace || src.source_reference.mapping_version !== null
          || !/^synthetic[_-][A-Za-z0-9._:-]{1,117}$/.test(src.source_reference.record_ref)
          || typeof src.observed_at !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(src.observed_at)
          || !Number.isFinite(Date.parse(src.observed_at)) || src.publisher_version !== PUBLISHER_VERSION
          || typeof src.capture_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(src.capture_id)
          || !hex(src.snapshot_sha256) || !hex(src.evidence_sha256)) throw new Error();
      } else if (row.source !== null) throw new Error();
      for (const [ruleIndex, result] of row.results.entries()) {
        const rule = manifest.rules[ruleIndex]!;
        // Reuse the evaluator's rule-result calculation, without loading current transaction data.
        const evidence = result.evidence;
        if (available && (!exact(evidence, ['amount', 'currency', 'transaction_status', 'threshold', 'threshold_currency', 'amount_semantics']) || !evidence
          || typeof evidence.amount !== 'string' || !/^(0|[1-9]\d{0,21})\.\d{2}$/.test(evidence.amount)
          || typeof evidence.currency !== 'string' || !/^[A-Z]{3}$/.test(evidence.currency)
          || !['pending', 'succeeded', 'failed', 'partially_reversed', 'reversed'].includes(evidence.transaction_status))) throw new Error();
        const wanted = assessmentRuleResult(rule, available ? evidence : null, row.availability);
        if (!isDeepStrictEqual(result, wanted)) throw new Error();
        if (available && !isDeepStrictEqual(evidence && [evidence.amount, evidence.currency, evidence.transaction_status],
          row.results[0]!.evidence && [row.results[0]!.evidence!.amount, row.results[0]!.evidence!.currency, row.results[0]!.evidence!.transaction_status])) throw new Error();
        counts[result.outcome === 'match' ? 'rule_matches' : result.outcome === 'no_match' ? 'no_matches' : result.outcome]++;
      }
      if (row.results.some(result => result.outcome === 'match')) counts.matched_observations++;
    }
    expected.rows = report.rows;
    expected.status = counts.unavailable_inputs ? 'partial' : 'complete';
    expected.input_set_sha256 = ruleEvidenceHash(report.rows.map(row => ({ target: row.target, availability: row.availability, sha256: row.input_sha256 })));
    if (!isDeepStrictEqual(report, expected)) throw new Error();
    return report;
  } catch { throw new RuleAssessmentError('INVALID_ASSESSMENT'); }
}

export function createRuleAssessments(dsn: string) {
  const database = createDatabase(dsn, 'intake');
  return {
    close: database.close,
    async evaluate(input: unknown): Promise<{ status: 'inserted' | 'duplicate'; report: BacktestReport }> {
      let manifest: BacktestManifest;
      try { manifest = validateBacktestManifest(input); } catch { throw new RuleAssessmentError('INVALID_ASSESSMENT'); }
      let client: PoolClient | undefined, active = false;
      try {
        client = await database.pool.connect(); await client.query('BEGIN'); active = true;
        // Serializes same-run retries before reading inputs, including an earlier partial result.
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,30))', [manifest.workspace_key + ':' + manifest.run_id]);
        const existing = (await client.query('SELECT report,report_sha256 FROM platform.local_assessment_runs WHERE workspace_key=$1 AND run_id=$2',
          [manifest.workspace_key, manifest.run_id])).rows[0];
        if (existing) {
          const report = validateAssessmentReport(existing.report, existing.report_sha256);
          if (report.manifest_sha256 !== ruleEvidenceHash(manifest)) throw new RuleAssessmentError('ASSESSMENT_CONFLICT');
          await client.query('COMMIT'); active = false;
          return { status: 'duplicate', report };
        }
        const report = await readBacktest(manifest, client);
        validateAssessmentReport(report, ruleEvidenceHash(report));
        for (const rule of manifest.rules) {
          const args = [manifest.workspace_key, rule.rule_id, rule.rule_version];
          await client.query(`INSERT INTO platform.local_rule_versions(workspace_key,rule_id,rule_version,definition,rule_sha256)
            VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [...args, JSON.stringify(rule), ruleEvidenceHash(rule)]);
          const stored = (await client.query('SELECT definition,rule_sha256 FROM platform.local_rule_versions WHERE workspace_key=$1 AND rule_id=$2 AND rule_version=$3', args)).rows[0];
          const checked = validateRuleVersion(stored.definition, stored.rule_sha256);
          if (!isDeepStrictEqual(checked, rule)) throw new RuleAssessmentError('RULE_VERSION_CONFLICT');
        }
        // shortcut: store one bounded report per run; normalize per-rule rows when investigation queries need them.
        await client.query(`INSERT INTO platform.local_assessment_runs(workspace_key,run_id,report,report_sha256)
          VALUES ($1,$2,$3,$4)`, [manifest.workspace_key, manifest.run_id, JSON.stringify(report), ruleEvidenceHash(report)]);
        await client.query('COMMIT'); active = false;
        return { status: 'inserted', report };
      } catch (error) {
        if (active && client) { try { await client.query('ROLLBACK'); } catch { /* Discard this session below. */ } }
        if (error instanceof RuleAssessmentError) throw error;
        throw new RuleAssessmentError('STORAGE_FAILED');
      } finally { client?.release(true); }
    },
  };
}
