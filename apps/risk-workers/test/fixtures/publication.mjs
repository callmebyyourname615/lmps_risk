import { normalizeSnapshot } from '../../dist/normalization-pipeline.js';
import { PUBLISHER_VERSION } from '@lmps/contracts/synthetic-publication';
import { normalizationFixture } from './normalization-pipeline.mjs';

export function publisherFixture() {
  const { snapshot, evidence } = normalizationFixture(); const report = normalizeSnapshot(snapshot, evidence);
  const binding = (event_key, id) => ({ event_key, transaction_id: id, transaction_revision: 'synthetic_revision_1', expected_revision: 0,
    currency: { raw: 'SYNTH_CCY_A', code: 'SYN', decimal_places: 2 } });
  const manifest = { format: 1, provenance: 'local_synthetic', execution_mode: 'test', publisher_version: PUBLISHER_VERSION,
    capture_id: report.capture_id, snapshot_sha256: report.snapshot_sha256, evidence_sha256: report.evidence_sha256,
    bindings: [binding('transfer:1', 'synthetic_payment_001'), binding('transfer:3', 'synthetic_original_003'), binding('transfer_old:1', 'synthetic_pending_001')] };
  return { snapshot, evidence, manifest };
}

export function rebindFixture(fixture) {
  const report = normalizeSnapshot(fixture.snapshot, fixture.evidence);
  Object.assign(fixture.manifest, { capture_id: report.capture_id, snapshot_sha256: report.snapshot_sha256, evidence_sha256: report.evidence_sha256 });
  return fixture;
}
