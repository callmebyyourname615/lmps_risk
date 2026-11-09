import { validateRiskReferenceRequest, type RiskReferenceEntry } from '@lmps/contracts/risk-reference';
import { localRiskMode, riskHash } from './index.js';

export function evaluateRiskReferences(input: unknown) {
  localRiskMode(); const request = validateRiskReferenceRequest(input), latest = new Map<string, RiskReferenceEntry>();
  for (const entry of request.entries) {
    if (entry.known_at > request.as_of) continue;
    const prior = latest.get(entry.reference_id);
    if (!prior || entry.version > prior.version) latest.set(entry.reference_id, entry);
  }
  const entries = [...latest.values()].sort((a, b) => a.reference_id.localeCompare(b.reference_id, 'en')).map(entry => {
    const reason = entry.revoked_at !== null && entry.revoked_at <= request.as_of ? 'revoked'
      : request.as_of < entry.valid_from ? 'not_yet_valid' : request.as_of >= entry.valid_to ? 'expired'
      : request.subject.match_level === 'unresolved' || entry.subject.match_level === 'unresolved' ? 'unresolved'
      : request.subject.namespace !== entry.subject.namespace || request.subject.subject_id !== entry.subject.subject_id ? 'no_match'
      : request.subject.match_level === 'partial' || entry.subject.match_level === 'partial' ? 'partial' : 'exact';
    return { reference_id: entry.reference_id, version: entry.version, task: entry.task, reason, evidence_sha256: entry.evidence_sha256 };
  });
  const status = !request.source.complete ? 'unavailable' : request.subject.match_level === 'unresolved' ? 'unresolved'
    : entries.some(e => e.reason === 'exact') ? 'exact' : entries.some(e => e.reason === 'partial') ? 'partial'
    : entries.some(e => e.reason === 'unresolved') ? 'unresolved' : 'no_match';
  return { version: request.version, status, as_of: request.as_of, source: request.source, entries,
    request_sha256: riskHash(request), identity_attestation: 'synthetic_declared_only' as const, safe_claim: false as const, training_eligible: false as const, enforcement: false as const };
}
