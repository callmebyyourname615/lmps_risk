import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureSnapshot, localMode } from '../dist/snapshot.js';
import { runSyncJob } from '../dist/sync-job.js';
import { SyncJobError } from '@lmps/database';
import { reconcileSnapshot } from '../dist/reconcile.js';
import { ROOT, loadState as sourceState } from '../../../packages/source-preflight/scripts/local.mjs';
import { dsn, loadState as postgresState } from '../../../packages/database/scripts/local.mjs';
import { readerConfig } from '../../../infrastructure/mariadb/snapshot-fixture.mjs';
import { readSnapshot, saveSnapshot } from './spool.mjs';
import { profileCapture } from './profile.mjs';
import { normalizeCapture } from './normalize.mjs';
import { publishCapture } from './publish.mjs';

export async function main(args = process.argv.slice(2)) {
  try {
    localMode();
    const base = join(ROOT, '.local/snapshots');
    if (args.length === 1 && args[0] === 'capture') {
      const snapshot = await captureSnapshot(readerConfig(await sourceState()));
      await saveSnapshot(base, snapshot);
      console.info(JSON.stringify({ provenance: 'local_synthetic', execution_mode: 'test', status: 'captured', capture_id: snapshot.capture_id, rows: snapshot.events.length }));
      return 0;
    }
    if (args.length === 2 && args[0] === 'profile') {
      const report = await profileCapture(base, join(ROOT, '.local/profiles'), args[1]);
      console.info(JSON.stringify({ provenance: 'local_synthetic', execution_mode: 'test', ...report }));
      return 0;
    }
    if (args.length === 2 && args[0] === 'normalize') {
      const report = await normalizeCapture(base, join(ROOT, '.local/normalization-evidence'), join(ROOT, '.local/normalization'), args[1]);
      console.info(JSON.stringify({ provenance: 'local_synthetic', execution_mode: 'test', ...report }));
      return report.counts.invalid ? 2 : 0;
    }
    if (args.length === 2 && args[0] === 'publish') {
      const report = await publishCapture(base, join(ROOT, '.local/normalization-evidence'), join(ROOT, '.local/publication-bindings'), args[1], dsn(await postgresState(), 'intake'));
      console.info(JSON.stringify({ provenance: 'local_synthetic', execution_mode: 'test', ...report }));
      return report.status === 'complete' ? 0 : 2;
    }
    if (args.length === 2 && args[0] === 'import') {
      const snapshot = await readSnapshot(base, args[1]);
      const state = await postgresState();
      const report = await runSyncJob(snapshot, dsn(state, 'intake'), dsn(state));
      console.info(JSON.stringify({ provenance: 'local_synthetic', execution_mode: 'test', capture_id: snapshot.capture_id, ...report }));
      return ['reconciled', 'already_reconciled'].includes(report.status) ? 0 : 2;
    }
    if (args.length === 2 && args[0] === 'reconcile') {
      const snapshot = await readSnapshot(base, args[1]);
      const report = await reconcileSnapshot(snapshot, dsn(await postgresState()));
      console.info(JSON.stringify({ provenance: 'local_synthetic', execution_mode: 'test', capture_id: snapshot.capture_id, ...report }));
      return report.status === 'PASS' ? 0 : report.status === 'FAIL' ? 2 : 1;
    }
    throw new Error();
  } catch (error) {
    if (error instanceof SyncJobError) { console.error(JSON.stringify({ status: 'rejected', code: error.code })); return 1; }
    console.error('Local snapshot command failed; source/configuration/payload diagnostics withheld.');
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main();
