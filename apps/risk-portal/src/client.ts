import type { AlertPolicy, AlertReviewCommand, AlertReviewEvent, AlertState, ReviewOutcome } from '@lmps/contracts/local-alert';
import type { DimensionScore, Locale, RiskCode, RiskFinding, RiskTarget, Severity, TransactionRiskResult } from '@lmps/contracts/transaction-risk';

export type { Locale, AlertReviewCommand, RiskCode, Severity };
export interface RiskText { code: RiskCode; title: string; definition: string; condition: string; limitation: string; dimension: string; unit: string }
export interface Catalog { locale: Locale; review_semantics: string; codes: { code: string; message: string }[]; risk_types: RiskText[]; statuses: { code: string; label: string }[]; units: { code: string; label: string }[] }
export interface AlertSummary {
  alert_id: string; target: RiskTarget; assessment_run_id: string; assessment_sha256: string; alert_snapshot_sha256: string;
  alert_policy: { policy_id: string; version: string; sha256: string }; severity: Severity; severity_message: string;
  selected_risk_types: RiskCode[]; state: AlertState; state_message: string; version: number; outcome: ReviewOutcome | null;
  outcome_message: string | null; created_at: string; assessment_status: TransactionRiskResult['assessment_status']; response_code: string; response_message: string;
  fraud_score: DimensionScore; mule_network_score: DimensionScore; aml_suspicion_score: DimensionScore;
}
export interface AlertDetail extends AlertSummary {
  core_sha256: string; policy: AlertPolicy; recorded_by: string;
  assessment: Omit<TransactionRiskResult, 'findings'> & { response_message: string; score_messages: Record<string, string>; findings: Array<RiskFinding & Omit<RiskText, 'unit'> & { reason: string }> };
  history: Array<AlertReviewEvent & { action_message: string; outcome_message: string | null }>;
}
export interface InboxQuery { state?: string; severity?: string; risk_code?: string; after?: string }
export interface InboxPage { locale: Locale; items: AlertSummary[]; next_cursor: string | null; pagination: 'live_committed_view_uuid_order' }
export interface Identity { subject: string; workspace: string; expires: number; canReview: boolean }
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
const ERROR_CODES = new Set(['UNAUTHORIZED', 'FORBIDDEN', 'INVALID_ALERT_INPUT', 'ALERT_NOT_FOUND', 'ALERT_REVIEW_CONFLICT', 'ALERT_STORAGE_UNAVAILABLE', 'ALERT_REVIEW_NOT_CONFIGURED']);
export class PortalError extends Error {
  code: string; status: number;
  constructor(code: string, status = 0) { super(code); this.name = 'PortalError'; this.code = code; this.status = status; }
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max = 4000): v is string => typeof v === 'string' && v.length <= max;
const oneOf = (v: unknown, values: readonly string[]) => typeof v === 'string' && values.includes(v);
const code = (v: unknown): v is RiskCode => text(v, 80) && /^(FRAUD|MULE|AML)_[A-Z_]+$/.test(v);
const date = (v: unknown) => text(v, 24) && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v));
const target = (v: unknown) => object(v) && text(v.namespace, 50) && /^synthetic_[a-z0-9_]{1,40}$/.test(v.namespace)
  && text(v.transaction_id, 128) && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(v.transaction_id) && Number.isInteger(v.revision_number) && Number(v.revision_number) > 0;
function score(v: unknown) {
  return object(v) && oneOf(v.status, ['available', 'unavailable', 'not_evaluated']) && v.meaning === 'risk_index'
    && (v.status === 'available' ? typeof v.value === 'number' && Number.isFinite(v.value) && v.value >= 0 && v.value <= 1 : v.value === null)
    && object(v.coverage) && ['configured', 'evaluated', 'triggered', 'unavailable', 'not_applicable', 'not_evaluated'].every(k => Number.isInteger((v.coverage as Record<string, unknown>)[k])
      && Number((v.coverage as Record<string, unknown>)[k]) >= 0 && Number((v.coverage as Record<string, unknown>)[k]) <= 15);
}
function summary(v: unknown): v is AlertSummary {
  return object(v) && text(v.alert_id) && UUID.test(v.alert_id) && target(v.target) && text(v.assessment_run_id) && UUID.test(v.assessment_run_id)
    && text(v.assessment_sha256) && HASH.test(v.assessment_sha256) && text(v.alert_snapshot_sha256) && HASH.test(v.alert_snapshot_sha256)
    && object(v.alert_policy) && text(v.alert_policy.policy_id) && text(v.alert_policy.version) && text(v.alert_policy.sha256) && HASH.test(v.alert_policy.sha256)
    && oneOf(v.severity, ['low', 'medium', 'high', 'critical']) && text(v.severity_message) && text(v.state_message)
    && Number.isInteger(v.version) && Number(v.version) >= 0 && Number(v.version) <= 2 && v.state === ['open', 'acknowledged', 'reviewed'][Number(v.version)]
    && (v.state === 'reviewed' ? oneOf(v.outcome, ['suspicious', 'legitimate', 'unknown']) : v.outcome === null)
    && Array.isArray(v.selected_risk_types) && v.selected_risk_types.length > 0 && v.selected_risk_types.length <= 15 && v.selected_risk_types.every(code)
    && new Set(v.selected_risk_types).size === v.selected_risk_types.length && date(v.created_at)
    && oneOf(v.assessment_status, ['complete', 'partial', 'unavailable', 'not_evaluated', 'not_applicable'])
    && (v.outcome_message === null || text(v.outcome_message)) && text(v.response_code) && text(v.response_message) && score(v.fraud_score) && score(v.mule_network_score) && score(v.aml_suspicion_score);
}
function detail(v: unknown): v is AlertDetail {
  if (!summary(v)) return false;
  const d = v as unknown as Record<string, unknown>, a = d.assessment;
  return text(d.core_sha256) && HASH.test(d.core_sha256) && object(d.policy) && object(a) && a.run_id === v.assessment_run_id && target(a.target)
    && (a.target as Record<string, unknown>).namespace === v.target.namespace && (a.target as Record<string, unknown>).transaction_id === v.target.transaction_id && (a.target as Record<string, unknown>).revision_number === v.target.revision_number && a.provenance === 'local_synthetic' && a.execution_mode === 'test' && a.enforcement === false
    && object(a.decision) && a.decision.status === 'not_decided' && a.decision.action === null && object(a.score_messages)
    && Array.isArray(a.findings) && a.findings.length === 15 && a.findings.every(f => object(f) && code(f.code)
      && oneOf(f.status, ['triggered', 'not_triggered', 'unavailable', 'not_applicable', 'not_evaluated'])
      && ['title', 'definition', 'condition', 'limitation', 'reason'].every(k => text(f[k]))
      && (f.metric === null || (object(f.metric) && text(f.metric.value, 50) && text(f.metric.threshold, 50) && text(f.metric.unit, 30)))
      && Array.isArray(f.evidence_refs) && f.evidence_refs.length <= 200 && f.evidence_refs.every(target))
    && new Set(a.findings.map(f => (f as Record<string, unknown>).code)).size === 15
    && Array.isArray(d.history) && d.history.length === v.version && d.history.every((e, i) => object(e) && e.version === i + 1 && e.expected_version === i
      && e.action === (i === 0 ? 'acknowledge' : 'review') && text(e.request_id) && UUID.test(e.request_id) && text(e.actor_subject, 50)
      && (e.outcome_message === null || text(e.outcome_message)) && e.actor_role === 'lmps_reviewer' && date(e.occurred_at) && (e.note === null || text(e.note, 2000))
      && (i === 0 ? e.outcome === null : oneOf(e.outcome, ['suspicious', 'legitimate', 'unknown'])) && text(e.action_message));
}
function catalog(v: unknown): v is Catalog {
  return object(v) && text(v.review_semantics) && Array.isArray(v.codes) && v.codes.length <= 100
    && v.codes.every(c => object(c) && text(c.code) && text(c.message))
    && Array.isArray(v.risk_types) && v.risk_types.length === 15 && v.risk_types.every(r => object(r) && code(r.code)
      && ['title', 'definition', 'condition', 'limitation', 'dimension', 'unit'].every(k => text(r[k])))
    && new Set(v.risk_types.map(r => (r as Record<string, unknown>).code)).size === 15
    && ['statuses', 'units'].every(k => Array.isArray(v[k]) && (v[k] as unknown[]).length <= 100
      && (v[k] as unknown[]).every(row => object(row) && text(row.code) && text(row.label)));
}
// Claims only drive presentation after the API verifies this exact token; every API request still enforces authorization.
export function tokenIdentity(raw: string, now = Date.now()): { token: string; identity: Identity } {
  try {
    const token = raw.trim().replace(/^Bearer\s+/i, '');
    if (token.length > 4000 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw new Error();
    const part = token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(part + '='.repeat((4 - part.length % 4) % 4)), c => c.charCodeAt(0)))) as unknown;
    if (!object(claims) || !text(claims.sub, 50) || !/^synthetic_[a-z0-9_]{1,40}$/.test(claims.sub)
      || !text(claims.workspace_key, 50) || !/^synthetic_[a-z0-9_]{1,40}$/.test(claims.workspace_key)
      || !Number.isSafeInteger(claims.exp) || Number(claims.exp) * 1000 <= now || !text(claims.scope, 256)) throw new Error();
    return { token, identity: { subject: claims.sub, workspace: claims.workspace_key, expires: Number(claims.exp) * 1000, canReview: claims.scope.split(' ').includes('alerts:review') } };
  } catch { throw new PortalError('UNAUTHORIZED', 401); }
}
async function readJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader(); if (!reader) throw new PortalError('PORTAL_BAD_RESPONSE');
  const decoder = new TextDecoder(); let length = 0, result = '';
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > 2 * 1024 * 1024) { await reader.cancel(); throw new Error(); }
      result += decoder.decode(value, { stream: true });
    }
    return JSON.parse(result + decoder.decode()) as unknown;
  } catch { throw new PortalError('PORTAL_BAD_RESPONSE'); }
  finally { reader.releaseLock(); }
}
export function createPortalClient(token: string, fetcher: typeof fetch = globalThis.fetch) {
  let bearer = token; const active = new Set<AbortController>();
  async function request(path: string, locale: Locale, command?: AlertReviewCommand, signal?: AbortSignal) {
    if (!bearer) throw new PortalError('UNAUTHORIZED', 401);
    const controller = new AbortController(); active.add(controller); let timedOut = false;
    const cancel = () => controller.abort(); signal?.addEventListener('abort', cancel, { once: true }); if (signal?.aborted) cancel();
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 10000);
    try {
      const response = await fetcher('/v1/local/alerts' + path, { method: command ? 'POST' : 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer',
        signal: controller.signal, headers: { Authorization: 'Bearer ' + bearer, Accept: 'application/json', 'Accept-Language': locale, ...(command ? { 'Content-Type': 'application/json' } : {}) },
        ...(command ? { body: JSON.stringify(command) } : {}) });
      const body = await readJson(response);
      if (!response.ok) throw new PortalError(object(body) && text(body.code) && ERROR_CODES.has(body.code) ? body.code
        : response.status === 401 ? 'UNAUTHORIZED' : response.status === 403 ? 'FORBIDDEN' : 'PORTAL_NETWORK', response.status);
      if (!object(body) || body.locale !== locale) throw new PortalError('PORTAL_BAD_RESPONSE');
      return body;
    } catch (error) {
      if (error instanceof PortalError) throw error;
      throw new PortalError(timedOut ? 'PORTAL_TIMEOUT' : controller.signal.aborted ? 'PORTAL_CANCELLED' : 'PORTAL_NETWORK');
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); active.delete(controller); }
  }
  return {
    renewToken(next: string) {
      if (!bearer) throw new PortalError('UNAUTHORIZED', 401);
      const previous = tokenIdentity(bearer, 0).identity, parsed = tokenIdentity(next);
      if (previous.subject !== parsed.identity.subject || previous.workspace !== parsed.identity.workspace || previous.canReview !== parsed.identity.canReview) throw new PortalError('FORBIDDEN', 403);
      bearer = parsed.token;
    },
    close() { bearer = ''; for (const controller of active) controller.abort(); active.clear(); },
    async catalog(locale: Locale, signal?: AbortSignal) {
      const value = await request('/catalog', locale, undefined, signal); if (!catalog(value)) throw new PortalError('PORTAL_BAD_RESPONSE'); return value;
    },
    async inbox(query: InboxQuery, locale: Locale, signal?: AbortSignal): Promise<InboxPage> {
      const params = new URLSearchParams({ limit: '5' });
      for (const key of ['state', 'severity', 'risk_code', 'after'] as const) if (query[key]) params.set(key, query[key]!);
      const body = await request('?' + params, locale, undefined, signal);
      if (!Array.isArray(body.items) || body.items.length > 5 || !body.items.every(summary)
        || new Set(body.items.map(v => v.alert_id)).size !== body.items.length
        || (body.next_cursor !== null && (!text(body.next_cursor) || !UUID.test(body.next_cursor))) || body.pagination !== 'live_committed_view_uuid_order') throw new PortalError('PORTAL_BAD_RESPONSE');
      return body as unknown as InboxPage;
    },
    async detail(id: string, locale: Locale, signal?: AbortSignal): Promise<AlertDetail | null> {
      if (!UUID.test(id)) throw new PortalError('INVALID_ALERT_INPUT', 400);
      const body = await request('/' + id, locale, undefined, signal);
      if (body.alert === null) return null;
      if (!detail(body.alert) || body.alert.alert_id !== id) throw new PortalError('PORTAL_BAD_RESPONSE'); return body.alert;
    },
    async review(id: string, command: AlertReviewCommand, locale: Locale): Promise<{ status: 'inserted' | 'duplicate'; alert: AlertDetail }> {
      if (!UUID.test(id)) throw new PortalError('INVALID_ALERT_INPUT', 400);
      const body = await request('/' + id + '/reviews', locale, command);
      if (!oneOf(body.status, ['inserted', 'duplicate']) || !detail(body.alert) || body.alert.alert_id !== id) throw new PortalError('PORTAL_BAD_RESPONSE');
      return body as unknown as { status: 'inserted' | 'duplicate'; alert: AlertDetail };
    },
  };
}
export type PortalClient = ReturnType<typeof createPortalClient>;
