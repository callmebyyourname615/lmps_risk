import { isAlertPolicy, isAlertGenerationRequest, isAlertReviewCommand, type AlertPolicy, type AlertGenerationRequest, type AlertReviewCommand, type AlertReviewEvent } from '@lmps/contracts/local-alert';
import { RISK_CODES, type RiskCode, type Severity, type Locale, type TransactionRiskResult } from '@lmps/contracts/transaction-risk';
import { riskHash } from './index.js';

export { ALERT_UUID, alertReviewSchema } from '@lmps/contracts/local-alert';
export type { AlertPolicy, AlertGenerationRequest, AlertReviewCommand, AlertReviewEvent } from '@lmps/contracts/local-alert';
export const ALERT_SEVERITIES: Severity[] = ['low', 'medium', 'high', 'critical'];
export type AlertErrorCode = 'INVALID_ALERT_INPUT' | 'ALERT_POLICY_CONFLICT' | 'ALERT_REVIEW_CONFLICT' | 'ALERT_NOT_FOUND' | 'ALERT_ASSESSMENT_NOT_FOUND' | 'ALERT_STORAGE_UNAVAILABLE' | 'ALERT_REVIEW_NOT_CONFIGURED';
export class AlertError extends Error {
  constructor(readonly code: AlertErrorCode) { super(code); this.name = 'AlertError'; }
}
export function alertLocalMode() {
  if (process.env.NODE_ENV === 'production' || !['local', 'test'].includes(process.env.LMPS_ENVIRONMENT ?? 'local')
    || (process.env.LMPS_EXECUTION_MODE ?? 'test') !== 'test') throw new AlertError('INVALID_ALERT_INPUT');
}
export function validateAlertPolicy(input: unknown): AlertPolicy {
  if (!isAlertPolicy(input)) throw new AlertError('INVALID_ALERT_INPUT');
  return { ...structuredClone(input), included_codes: RISK_CODES.filter(code => input.included_codes.includes(code)) };
}
export function validateAlertGeneration(input: unknown): AlertGenerationRequest {
  alertLocalMode();
  if (!isAlertGenerationRequest(input)) throw new AlertError('INVALID_ALERT_INPUT');
  return { ...structuredClone(input), policy: validateAlertPolicy(input.policy) };
}
export function validateAlertReview(input: unknown): AlertReviewCommand {
  alertLocalMode();
  if (!isAlertReviewCommand(input) || (input.action === 'acknowledge' ? input.expected_version !== 0 || input.outcome !== null
    : input.expected_version !== 1 || input.outcome === null || input.note === null)
    || (input.note !== null && (!input.note.trim() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ud800-\udfff]/u.test(input.note)))) throw new AlertError('INVALID_ALERT_INPUT');
  return structuredClone(input);
}
export interface AlertSnapshot {
  format: 1; provenance: 'local_synthetic'; execution_mode: 'test'; workspace_key: 'synthetic_local';
  assessment_run_id: string; assessment_sha256: string; policy: AlertPolicy; selected_risk_types: RiskCode[]; severity: Severity;
}
// Only validated, frozen assessment results may reach this projection. A null score never becomes zero.
export function projectAlert(result: TransactionRiskResult, input: unknown): { reason_code: 'ALERT_CREATED'; snapshot: AlertSnapshot } | { reason_code: 'ALERT_NO_MATCH' | 'ALERT_PARTIAL_EXCLUDED' | 'ALERT_ASSESSMENT_INELIGIBLE'; snapshot: null } {
  const policy = validateAlertPolicy(input);
  if (!['complete', 'partial'].includes(result.assessment_status)) return { reason_code: 'ALERT_ASSESSMENT_INELIGIBLE', snapshot: null };
  if (result.assessment_status === 'partial' && !policy.include_partial) return { reason_code: 'ALERT_PARTIAL_EXCLUDED', snapshot: null };
  const findings = result.findings.filter(f => f.status === 'triggered' && policy.included_codes.includes(f.code)
    && f.severity !== null && ALERT_SEVERITIES.indexOf(f.severity) >= ALERT_SEVERITIES.indexOf(policy.minimum_severity));
  if (!findings.length) return { reason_code: 'ALERT_NO_MATCH', snapshot: null };
  return { reason_code: 'ALERT_CREATED', snapshot: { format: 1, provenance: 'local_synthetic', execution_mode: 'test', workspace_key: result.workspace_key,
    assessment_run_id: result.run_id, assessment_sha256: riskHash(result), policy,
    selected_risk_types: RISK_CODES.filter(code => findings.some(f => f.code === code)),
    severity: ALERT_SEVERITIES[Math.max(...findings.map(f => ALERT_SEVERITIES.indexOf(f.severity!)))]! } };
}
export function reviewState(events: AlertReviewEvent[]) {
  try {
    if (!Array.isArray(events) || events.length > 2) throw new Error();
    const ids = new Set<string>();
    for (const [index, event] of events.entries()) {
      if (!event || Object.keys(event).sort().join(',') !== 'action,actor_role,actor_subject,expected_version,note,occurred_at,outcome,request_id,version') throw new Error();
      validateAlertReview({ request_id: event.request_id, expected_version: event.expected_version, action: event.action, outcome: event.outcome, note: event.note });
      if (event.version !== index + 1 || event.expected_version !== index || event.action !== (index === 0 ? 'acknowledge' : 'review')
        || event.actor_role !== 'lmps_reviewer' || !/^synthetic_[a-z0-9_]{1,40}$/.test(event.actor_subject) || ids.has(event.request_id)
        || typeof event.occurred_at !== 'string' || new Date(event.occurred_at).toISOString() !== event.occurred_at) throw new Error();
      ids.add(event.request_id);
    }
    return { state: events.length === 0 ? 'open' as const : events.length === 1 ? 'acknowledged' as const : 'reviewed' as const,
      version: events.length, outcome: events.at(-1)?.outcome ?? null };
  } catch { throw new AlertError('ALERT_STORAGE_UNAVAILABLE'); }
}
const text: Record<string, [string, string]> = {
  low: ['Low alert severity', 'ຄວາມຮຸນແຮງຂອງການແຈ້ງເຕືອນຕ່ຳ'], medium: ['Medium alert severity', 'ຄວາມຮຸນແຮງຂອງການແຈ້ງເຕືອນປານກາງ'],
  high: ['High alert severity', 'ຄວາມຮຸນແຮງຂອງການແຈ້ງເຕືອນສູງ'], critical: ['Critical alert severity', 'ຄວາມຮຸນແຮງຂອງການແຈ້ງເຕືອນສູງຫຼາຍ'],
  open: ['Open', 'ເປີດ'], acknowledged: ['Acknowledged', 'ຮັບຊາບແລ້ວ'], reviewed: ['Reviewed', 'ກວດສອບແລ້ວ'],
  acknowledge: ['Acknowledge alert', 'ຮັບຊາບການແຈ້ງເຕືອນ'], review: ['Record review', 'ບັນທຶກຜົນກວດສອບ'],
  suspicious: ['Reviewer considers suspicious', 'ຜູ້ກວດສອບເຫັນວ່າໜ້າສົງໄສ'], legitimate: ['Reviewer considers legitimate', 'ຜູ້ກວດສອບເຫັນວ່າຖືກຕ້ອງ'], unknown: ['Insufficient evidence', 'ຫຼັກຖານບໍ່ພຽງພໍ'],
  ALERT_CREATED: ['Alert policy matched triggered findings.', 'ຜົນກວດພົບເຂົ້າເງື່ອນໄຂແຈ້ງເຕືອນ.'],
  ALERT_NO_MATCH: ['No triggered finding meets this alert policy.', 'ບໍ່ມີຜົນກວດພົບທີ່ເຂົ້າເງື່ອນໄຂແຈ້ງເຕືອນນີ້.'],
  ALERT_PARTIAL_EXCLUDED: ['This alert policy excludes partial assessments.', 'ນະໂຍບາຍນີ້ບໍ່ລວມຜົນປະເມີນທີ່ບໍ່ຄົບຖ້ວນ.'],
  ALERT_ASSESSMENT_INELIGIBLE: ['Assessment is unavailable, not evaluated or not applicable.', 'ຜົນປະເມີນບໍ່ພ້ອມ, ຍັງບໍ່ໄດ້ປະເມີນ ຫຼື ບໍ່ນຳໃຊ້.'],
  INVALID_ALERT_INPUT: ['Invalid alert request.', 'ຄຳຂໍແຈ້ງເຕືອນບໍ່ຖືກຕ້ອງ.'],
  ALERT_POLICY_CONFLICT: ['Alert policy version conflicts with saved evidence.', 'ເວີຊັນນະໂຍບາຍແຈ້ງເຕືອນຂັດກັບຫຼັກຖານທີ່ບັນທຶກ.'],
  ALERT_REVIEW_CONFLICT: ['Review changed or this request ID was reused with different content; reload the alert.', 'ຜົນກວດປ່ຽນແລ້ວ ຫຼື ໃຊ້ລະຫັດຄຳຂໍຊ້ຳກັບເນື້ອຫາຕ່າງກັນ; ກະລຸນາໂຫຼດໃໝ່.'],
  ALERT_NOT_FOUND: ['Alert not found in this workspace.', 'ບໍ່ພົບການແຈ້ງເຕືອນໃນພື້ນທີ່ນີ້.'],
  ALERT_ASSESSMENT_NOT_FOUND: ['Assessment not found in this workspace.', 'ບໍ່ພົບຜົນປະເມີນໃນພື້ນທີ່ນີ້.'],
  ALERT_STORAGE_UNAVAILABLE: ['Alert evidence is unavailable; diagnostics withheld.', 'ຫຼັກຖານແຈ້ງເຕືອນບໍ່ພ້ອມ; ບໍ່ສະແດງລາຍລະອຽດພາຍໃນ.'],
  ALERT_REVIEW_NOT_CONFIGURED: ['Review storage is not configured.', 'ຍັງບໍ່ຕັ້ງຄ່າບ່ອນບັນທຶກຜົນກວດ.'],
};
export const alertText = (code: string, locale: Locale) => (text[code] ?? text.ALERT_STORAGE_UNAVAILABLE)![locale === 'en' ? 0 : 1];
export function localizedAlertCatalog(locale: Locale) {
  return { locale, version: 'synthetic-alert-0.1.0-draft.1', codes: Object.keys(text).map(code => ({ code, message: alertText(code, locale) })),
    review_semantics: locale === 'en' ? 'Recorded reviewer opinions, not verified crime labels or payment decisions. Unknown is not a negative label.'
      : 'ຜົນນີ້ແມ່ນຄວາມເຫັນຜູ້ກວດສອບ, ບໍ່ແມ່ນການຢືນຢັນອາຊະຍາກຳ ຫຼື ຄຳສັ່ງຊຳລະເງິນ. ຜົນບໍ່ຮູ້ບໍ່ແມ່ນປ້າຍກຳກັບທາງລົບ.' };
}
