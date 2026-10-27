import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateBacktest, ruleEvidenceHash, validateAssessmentReport, validateRuleVersion } from '../dist/index.js';
import { assessmentFixture } from './fixtures/rule-assessment.mjs';

test('frozen complete and unavailable reports validate without current transaction reads or precision changes', () => {
  const f = assessmentFixture();
  for (const revision of [f.revision, null, {}, { ...f.revision, publication: undefined }]) {
    const report = evaluateBacktest(f.manifest, [{ target: f.manifest.targets[0], revision }]);
    assert.deepEqual(validateAssessmentReport(report, ruleEvidenceHash(report)), report);
    assert.notEqual(validateAssessmentReport(report, ruleEvidenceHash(report)), report);
  }
  const report = evaluateBacktest(f.manifest, f.observations);
  assert.deepEqual(validateRuleVersion(report.rules[0], ruleEvidenceHash(report.rules[0])), report.rules[0]);
  assert.throws(() => validateRuleVersion({ ...report.rules[0], threshold: '2.00' }, ruleEvidenceHash(report.rules[0])));
});

test('corrupt digest and structurally inconsistent rehashed evidence fail closed', () => {
  const f = assessmentFixture(); const report = evaluateBacktest(f.manifest, f.observations);
  assert.throws(() => validateAssessmentReport(report, '0'.repeat(64)), /INVALID_ASSESSMENT/);
  for (const change of [
    r => { r.extra = 'SYNTHETIC_PRIVATE_VALUE'; },
    r => { r.counts.rule_matches++; },
    r => { r.rules[0].threshold = '777.00'; },
    r => { r.rows[0].results[0].outcome = 'unavailable'; },
    r => { r.rows[0].results[0].evidence.threshold = '777.00'; },
    r => { r.rows[0].source.extra = 'SYNTHETIC_PRIVATE_VALUE'; },
    r => { r.rows[0].source.source_reference.mapping_version = 'fabricated'; },
    r => { r.rows[0].input_sha256 = 'not-a-hash'; },
    r => { r.rows[0].results[1].evidence.amount = '1.00'; },
    r => { r.enforcement = true; },
    r => { r.status = 'partial'; },
  ]) {
    const bad = structuredClone(report); change(bad);
    assert.throws(() => validateAssessmentReport(bad, ruleEvidenceHash(bad)), error => error.message.includes('INVALID_ASSESSMENT') && !error.message.includes('PRIVATE'));
  }
});

test('unavailable outcomes cannot gain evidence, a negative result or an invented source', () => {
  const f = assessmentFixture(); const report = evaluateBacktest(f.manifest, [{ target: f.manifest.targets[0], revision: null }]);
  for (const change of [
    r => { r.rows[0].source = {}; },
    r => { r.rows[0].results[0].outcome = 'no_match'; },
    r => { r.rows[0].results[0].reason_code = 'INPUT_INVALID'; },
    r => { r.rows[0].input_sha256 = 'a'.repeat(64); },
  ]) {
    const bad = structuredClone(report); change(bad);
    assert.throws(() => validateAssessmentReport(bad, ruleEvidenceHash(bad)));
  }
});
