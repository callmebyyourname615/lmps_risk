import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATASET_MAX_BYTES } from '../packages/contracts/dist/offline-dataset.js';
import { createDatabase } from '../packages/database/dist/index.js';
import { localMode, loadState, identify, dsn } from '../packages/database/scripts/local.mjs';
import { analyzeIntakeRevisionHistory, INTAKE_AUDIT_MAX_REVISIONS } from '../apps/risk-workers/dist/intake-revision-audit.js';
import { runtimeProfile } from './runtime-profile.mjs';

export async function inspectIntakeSource(database) {
  localMode();
  let client, active = false, discard = false;
  try {
    client = await database.pool.connect();
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'); active = true;
    const scope = ['synthetic_local', 'synthetic_csv'];
    const metadata = (await client.query(`SELECT count(*)::int AS revisions,
      coalesce(sum(octet_length(payload::text)+coalesce(octet_length(publication::text),0)),0)::text AS bytes
      FROM platform.local_transaction_revisions WHERE workspace_key=$1 AND namespace=$2`, scope)).rows[0];
    if (metadata.revisions > INTAKE_AUDIT_MAX_REVISIONS || BigInt(metadata.bytes) > BigInt(DATASET_MAX_BYTES)) throw Error();
    const rows = (await client.query(`SELECT workspace_key,namespace,transaction_id,revision_number,provenance,payload,publication
      FROM platform.local_transaction_revisions WHERE workspace_key=$1 AND namespace=$2
      ORDER BY transaction_id,revision_number LIMIT $3`, [...scope, INTAKE_AUDIT_MAX_REVISIONS + 1])).rows;
    if (rows.length !== metadata.revisions) throw Error();
    const report = analyzeIntakeRevisionHistory(rows, ...scope);
    await client.query('COMMIT'); active = false;
    return report;
  } catch {
    if (active) { try { await client.query('ROLLBACK'); } catch { discard = true; } }
    throw Error('INTAKE_REVISION_AUDIT_INVALID; private values withheld.');
  } finally { client?.release(discard); }
}

async function main() {
  localMode();
  if (process.argv.length !== 2) throw Error();
  const profile = runtimeProfile();
  if (profile.profile !== 'intake') throw Error();
  const state = await loadState(profile.stateDirectory);
  if (state.port !== 18513) throw Error();
  const probe = await identify(state, 'lmps_risk_local'); await probe.end();
  const database = createDatabase(dsn(state), 'app', 'synthetic_csv');
  try { console.log(JSON.stringify(await inspectIntakeSource(database), null, 2)); }
  finally { await database.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(() => { console.error('INTAKE_REVISION_AUDIT_INVALID; private values withheld.'); process.exitCode = 1; });
