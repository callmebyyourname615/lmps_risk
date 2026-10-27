import { dirname, isAbsolute, join } from 'node:path';
import { readSnapshot } from './spool.mjs';
import { localMode } from '../dist/snapshot.js';
import { privateDirectory, readPrivateJson, savePrivateReport } from './private-json.mjs';
import { MAX_EVIDENCE_BYTES, MAX_NORMALIZATION_REPORT_BYTES, normalizeSnapshot } from '../dist/normalization-pipeline.js';

export async function readEvidence(base, id) {
  if (!isAbsolute(base)) throw new Error();
  await privateDirectory(dirname(base));
  for (const path of [base, join(base, 'v1'), join(base, 'v1', id)]) {
    try { await privateDirectory(path); }
    catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
  }
  // An existing capture directory without its final file is partial, not absent evidence.
  return readPrivateJson(join(base, 'v1', id, 'evidence.json'), MAX_EVIDENCE_BYTES);
}
export async function saveNormalization(base, snapshot, evidence) {
  try {
    const report = normalizeSnapshot(snapshot, evidence);
    const created = await savePrivateReport(base, 'v1', report.capture_id, 'normalization.json', report, MAX_NORMALIZATION_REPORT_BYTES);
    return { status: created ? 'normalized' : 'duplicate', capture_id: report.capture_id, evidence_status: report.evidence_status, counts: report.counts };
  } catch { throw new Error('Local snapshot normalization failed; source, evidence, report and path diagnostics withheld.'); }
}
export async function normalizeCapture(spoolBase, evidenceBase, reportBase, id) {
  try {
    localMode();
    const snapshot = await readSnapshot(spoolBase, id);
    return await saveNormalization(reportBase, snapshot, await readEvidence(evidenceBase, id));
  } catch { throw new Error('Local snapshot normalization failed; source, evidence, report and path diagnostics withheld.'); }
}
