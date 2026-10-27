import { createHash, createPublicKey, verify } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { ALERT_UUID } from '@lmps/contracts/local-alert';
import { isShadowRequest, isShadowResult, ML_FEATURE_SPEC, type ModelGateRequest, type ModelTrust, type ShadowResult, type ShadowRequest, type ModelGateDecision } from '@lmps/contracts/model-signal';
import { localRiskMode, riskHash, paymentKey, netAmount, validateRiskRequest, validateRiskObservation, type RiskEvent, type TransactionRiskRequest, type RiskObservation, type TransactionRiskResult } from './index.js';
import { projectAlert, validateAlertPolicy } from './alerts.js';
import { RISK_CATALOG } from './catalog.js';
export type { ModelGateRequest, ModelGatePolicy, ModelTrust, ModelReceiptView, ShadowRequest, ShadowResult } from '@lmps/contracts/model-signal';

export class ModelSignalError extends Error {
  constructor(readonly code: 'ML_INVALID_INPUT' | 'ML_PROOF_INVALID' | 'ML_REQUEST_CONFLICT' | 'ML_POLICY_CONFLICT' | 'ML_STORAGE_UNAVAILABLE' | 'ML_ASSESSMENT_NOT_FOUND') { super(code); }
}
export async function readModelPrivateFile(path: string, maximum: number): Promise<string> {
  if (!isAbsolute(path)) throw new ModelSignalError('ML_INVALID_INPUT');
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const s = await file.stat();
    if (!s.isFile() || s.nlink !== 1 || (s.mode & 0o077) || s.uid !== process.getuid?.() || s.size > maximum) throw new Error();
    const bytes = Buffer.alloc(maximum + 1); let length = 0;
    while (length < bytes.length) { const r = await file.read(bytes,length,bytes.length-length,length); if (!r.bytesRead) break; length += r.bytesRead; }
    if (length > maximum) throw new Error();
    return new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,length));
  } finally { await file.close(); }
}
export async function readModelTrustFile(path: string): Promise<ModelTrust> {
  try { return validateModelTrust(JSON.parse(await readModelPrivateFile(path,512))); }
  catch { throw new ModelSignalError('ML_PROOF_INVALID'); }
}
export function validateModelTrust(input: unknown): ModelTrust {
  const t = input as ModelTrust;
  if (!t || Object.keys(t).sort().join(',') !== 'key_id,public_key' || typeof t.public_key !== 'string' || !/^[0-9a-f]{64}$/.test(t.public_key)
    || t.key_id !== 'ml_' + createHash('sha256').update(Buffer.from(t.public_key, 'hex')).digest('hex').slice(0, 16)) throw new ModelSignalError('ML_PROOF_INVALID');
  return structuredClone(t);
}
export function validateModelGateRequest(input: unknown): ModelGateRequest {
  try {
    localRiskMode(); const r = structuredClone(input) as ModelGateRequest, p = r.policy;
    if (!r || Object.keys(r).sort().join(',') !== 'assessment_run_id,execution_mode,format,policy,request_id,workspace_key'
      || r.format !== 1 || r.execution_mode !== 'shadow' || r.workspace_key !== 'synthetic_local'
      || ![r.request_id,r.assessment_run_id].every(v => typeof v==='string' && ALERT_UUID.test(v))
      || !p || Object.keys(p).sort().join(',') !== 'alert_policy,missing_model,model,policy_id,probability_threshold,task,version'
      || ![p.policy_id, p.version].every(v => typeof v === 'string' && /^synthetic_[a-z0-9_]{1,60}$/.test(v))
      || !['fraud','mule_network','aml'].includes(p.task) || !['skip','rules_only'].includes(p.missing_model)
      || typeof p.probability_threshold!=='string' || !/^(0\.[0-9]{9}|1\.000000000)$/.test(p.probability_threshold)
      || !p.model || Object.keys(p.model).sort().join(',') !== 'artifact_sha256,name,version'
      || ![p.model.name,p.model.version,p.model.artifact_sha256].every(v=>typeof v==='string')
      || !/^synthetic_[a-z0-9_]{1,60}$/.test(p.model.name) || !/^[1-9][0-9]{0,8}$/.test(p.model.version) || !/^[0-9a-f]{64}$/.test(p.model.artifact_sha256)) throw new Error();
    p.alert_policy = validateAlertPolicy(p.alert_policy);
    if (!p.alert_policy.included_codes.every(code => RISK_CATALOG.some(e => e.code === code && e.dimension === p.task))) throw new Error();
    return r;
  } catch { throw new ModelSignalError('ML_INVALID_INPUT'); }
}

// Rebuild from frozen rule evidence; callers cannot substitute arbitrary ML vectors.
export function modelFeatureRequest(input: TransactionRiskRequest, source: RiskObservation): ShadowRequest {
  const request = validateRiskRequest(input), observation = validateRiskObservation(source), context = request.context;
  const asOf = context?.as_of ?? observation.observed_at, time = asOf === null ? NaN : Date.parse(asOf);
  let reason: string | null = null, values: [string,string,string,string,string,string] | null = null, exact: string | null = null;
  if (!context || context.identity_status !== 'synthetic_declared') reason = 'IDENTITY_UNVERIFIED';
  else if (observation.status !== 'available' || context.binding.revision_sha256 !== observation.revision_sha256 || context.as_of !== observation.observed_at) reason = 'TIME_OR_BINDING_UNAVAILABLE';
  else if (!context.coverage_complete || Date.parse(context.coverage_start) > time - 3600000) reason = 'HISTORY_INCOMPLETE';
  else if (!['succeeded','partially_reversed'].includes(observation.transaction_status!)) reason = 'EXECUTION_OR_CURRENCY_UNAVAILABLE';
  if (reason === null && context) {
    const latest = new Map<string, RiskEvent>();
    for (const e of context.events) if (Date.parse(e.available_at) <= time && Date.parse(e.occurred_at) <= time) {
      const key = paymentKey(e), prior = latest.get(key); if (!prior || e.revision_number > prior.revision_number) latest.set(key, e);
    }
    const target = latest.get(paymentKey(request.target));
    if (!target || target.revision_number !== request.target.revision_number || target.amount !== observation.amount
      || target.reversed_amount !== observation.reversed_amount || target.status !== observation.transaction_status || target.currency !== observation.currency) reason = 'TARGET_NOT_IN_HISTORY';
    else {
      const history = [...latest.values()].filter(e => paymentKey(e) !== paymentKey(target) && e.sender === target.sender && e.currency === target.currency
        && Date.parse(e.occurred_at) >= time - 3600000 && Date.parse(e.occurred_at) < time && netAmount(e) > 0n);
      const net = netAmount(target), total = history.reduce((sum, e) => sum + netAmount(e), 0n), date = new Date(time), hour = date.getUTCHours() + date.getUTCMinutes() / 60;
      exact = String(net);
      values = [Math.log1p(Number(net) / 100), Math.sin(hour / 24 * 2 * Math.PI), Math.cos(hour / 24 * 2 * Math.PI), history.length,
        Math.log1p(Number(total) / 100), Number(!history.some(e => e.receiver === target.receiver))].map(v => v.toFixed(9)) as [string,string,string,string,string,string];
    }
  }
  const core = { target: request.target, revision_sha256: observation.revision_sha256, as_of: asOf, currency: observation.currency,
    feature_version: 'lmps-features-1' as const, feature_spec_sha256: riskHash(ML_FEATURE_SPEC), status: reason === null ? 'available' as const : 'unavailable' as const,
    reason_code: reason, values, net_amount_cents: exact };
  const result: ShadowRequest = { format: 1, execution_mode: 'shadow', provenance: 'local_synthetic', source_semantics: 'synthetic_declared', snapshot: { ...core, feature_sha256: riskHash(core) } };
  if (!isShadowRequest(result)) throw new ModelSignalError('ML_INVALID_INPUT');
  return result;
}
export function verifyShadowResult(input: unknown, request: ShadowRequest, trusted: ModelTrust): ShadowResult {
  try {
    const trust = validateModelTrust(trusted), r = structuredClone(input);
    if (Buffer.byteLength(JSON.stringify(r)) > 16384 || !isShadowResult(r)) throw new Error();
    const { signature, ...body } = r, encoded = Buffer.from(signature, 'base64');
    if (r.key_id !== trust.key_id || encoded.length !== 64 || encoded.toString('base64') !== signature) throw new Error();
    const key = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(trust.public_key, 'hex')]), format: 'der', type: 'spki' });
    // Same sorted JSON canonicalization as Python; no floating point numbers in the signed wire body.
    const canonical = JSON.stringify(body, (_k, v: unknown) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0)) : v);
    if (!verify(null, Buffer.from(canonical), key, encoded) || r.provenance !== request.provenance || !isDeepStrictEqual(r.target, request.snapshot.target)
      || r.revision_sha256 !== request.snapshot.revision_sha256 || r.as_of !== request.snapshot.as_of || r.feature_sha256 !== request.snapshot.feature_sha256) throw new Error();
    if (r.status === 'available') {
      if (r.reason_code !== 'MODEL_SCORED' || !r.model || request.snapshot.status !== 'available' || request.provenance !== 'local_synthetic'
        || r.model.currency !== request.snapshot.currency || (r.model.algorithm === 'baseline' ? Object.keys(r.probabilities).length !== 0 || r.novelty_score === null
          : Object.keys(r.probabilities).sort().join(',') !== 'aml,fraud,mule_network' || r.novelty_score !== null
            || !Object.values(r.probabilities).every(v => /^(0\.[0-9]{9}|1\.000000000)$/.test(v)))) throw new Error();
      if (r.novelty_score!==null && (!Number.isFinite(Number(r.novelty_score)) || Number(r.novelty_score)<0)) throw new Error();
    } else if (r.reason_code === 'MODEL_SCORED' || Object.keys(r.probabilities).length || r.novelty_score !== null) throw new Error();
    return r;
  } catch { throw new ModelSignalError('ML_PROOF_INVALID'); }
}
export function modelGateDecision(result: TransactionRiskResult, request: ModelGateRequest, signal: ShadowResult | null): ModelGateDecision {
  const policy = request.policy;
  if (signal?.model && !isDeepStrictEqual({ name: signal.model.name, version: signal.model.version, artifact_sha256: signal.model.artifact_sha256 }, policy.model)) throw new ModelSignalError('ML_PROOF_INVALID');
  const probability = signal?.status === 'available' ? signal.probabilities[policy.task] ?? null : null;
  const eligible = probability === null ? policy.missing_model === 'rules_only' : probability >= policy.probability_threshold;
  const reason = !projectAlert(result, policy.alert_policy).snapshot ? 'RULES_NO_MATCH' : probability === null
    ? eligible ? 'EXPLICIT_RULES_FALLBACK' : 'MODEL_UNAVAILABLE' : eligible ? 'MODEL_CONFIRMED' : 'MODEL_BELOW_THRESHOLD';
  return { status: eligible && reason !== 'RULES_NO_MATCH' ? 'eligible' : 'skipped', reason_code: reason, task: policy.task, probability, enforcement: false };
}
