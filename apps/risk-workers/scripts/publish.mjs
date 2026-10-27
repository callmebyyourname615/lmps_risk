import { dirname, isAbsolute, join } from 'node:path';
import { readSnapshot } from './spool.mjs';
import { privateDirectory, readPrivateJson } from './private-json.mjs';
import { readEvidence } from './normalize.mjs';
import { MAX_PUBLICATION_MANIFEST_BYTES, publishSnapshot } from '../dist/normalization-publisher.js';

export async function publishCapture(spoolBase, evidenceBase, manifestBase, id, dsn) {
  try {
    if (!isAbsolute(manifestBase)) throw new Error();
    await privateDirectory(dirname(manifestBase));
    const snapshot = await readSnapshot(spoolBase, id);
    for (const directory of [manifestBase, join(manifestBase, 'v1'), join(manifestBase, 'v1', id)]) await privateDirectory(directory);
    const manifest = await readPrivateJson(join(manifestBase, 'v1', id, 'publication.json'), MAX_PUBLICATION_MANIFEST_BYTES);
    const evidence = await readEvidence(evidenceBase, id);
    return await publishSnapshot(snapshot, evidence, manifest, dsn);
  } catch { throw new Error('Local synthetic publication failed; source/configuration/payload diagnostics withheld.'); }
}
