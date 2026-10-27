import { readSnapshot } from './spool.mjs';
import { savePrivateReport } from './private-json.mjs';
import { MAX_PROFILE_BYTES, PROFILE_VERSION, profileSnapshot } from '../dist/profile.js';

export async function saveProfile(base, input) {
  try {
    const profile = profileSnapshot(input);
    const created = await savePrivateReport(base, 'v' + PROFILE_VERSION, profile.capture_id, 'profile.json', profile, MAX_PROFILE_BYTES);
    return { status: created ? 'profiled' : 'duplicate', capture_id: profile.capture_id, observed_rows: profile.observed_rows };
  } catch { throw new Error('Local snapshot profiling failed; source, report and path diagnostics withheld.'); }
}


export async function profileCapture(spoolBase, profileBase, id) {
  try { return await saveProfile(profileBase, await readSnapshot(spoolBase, id)); }
  catch { throw new Error('Local snapshot profiling failed; source, report and path diagnostics withheld.'); }
}
