import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual, parseArgs, promisify } from 'node:util';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, localMode, loadState, identify, dsn } from '../packages/database/scripts/local.mjs';
import { createBackup, verifyBackup } from '../packages/database/scripts/backup.mjs';
import { runtimeProfile } from './runtime-profile.mjs';
import { readPrivateJson, savePrivateReport } from '../apps/risk-workers/scripts/private-json.mjs';
import { createDatabase, createOfflineDatasets, validateTransactionRevision } from '../packages/database/dist/index.js';
import { sourcePublicationTransaction, makeJointSourcePublication, sourceEvidenceHash } from '../packages/contracts/dist/source-publication.js';
import { buildJointMappingPreview } from './preview-intake-joint-mapping.mjs';
import { matchReviewBindings } from './bind-intake-review.mjs';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const check = ok => { if (!ok) throw Error('JOINT_APPLICATION_CONFLICT'); };

/** Recheck every predecessor and latest revision, including rows whose status will not change. */
export function planJointApplication(input, bound, snapshot, stored) {
  localMode();
  const preview = buildJointMappingPreview(input, bound);
  const originals = bound.rows.map(row => stored.find(s => s.transaction_id === row.transaction_id && s.revision_number === row.revision_number));
  check(originals.every(Boolean));
  check(isDeepStrictEqual(matchReviewBindings(input.binding, snapshot, originals), bound));
  const latest = new Map();
  for (const row of stored) {
    check(row.workspace_key === bound.workspace && row.namespace === bound.namespace);
    if (!latest.has(row.transaction_id) || latest.get(row.transaction_id).revision_number < row.revision_number) latest.set(row.transaction_id, row);
  }
  check(latest.size === bound.rows.length);
  const revisions = [], decisions = [];
  let already_applied = 0;
  for (let i = 0; i < preview.rows.length; i++) {
    const outcome = preview.rows[i], binding = bound.rows.find(row => row.transaction_id === outcome.transaction_id);
    const original = originals.find(row => row.transaction_id === outcome.transaction_id), current = latest.get(outcome.transaction_id);
    const checked = sourcePublicationTransaction(original.publication);
    const changed = checked.transaction.transaction_status !== outcome.proposed_status;
    let expected = original;
    if (changed) {
      const projected = makeJointSourcePublication(original.publication, {
        manifest_sha256: bound.manifest_sha256, review_sha256: bound.review_sha256,
        review_row_sha256: binding.review_row_sha256, review_row_number: binding.review_row_number,
        binding_sha256: preview.binding_sha256, shouldrevert: input.pairs[i].shouldrevert,
        previous_publication_sha256: sourceEvidenceHash(original.publication), previous_payload_sha256: sourceEvidenceHash(original.payload),
      });
      const envelope = validateTransactionRevision({format:1,provenance:'user_supplied_file',execution_mode:'test',
        workspace_key:bound.workspace,expected_revision:binding.revision_number,...projected});
      check(envelope.transaction.transaction_status === outcome.proposed_status);
      expected = {revision_number:binding.revision_number+1,payload:envelope.transaction,publication:envelope.publication};
      if (current.revision_number === original.revision_number) revisions.push(envelope);
      else already_applied++;
    }
    const comparison = changed && current.revision_number === original.revision_number ? original : expected;
    check(current.revision_number === comparison.revision_number && isDeepStrictEqual(current.payload, comparison.payload)
      && isDeepStrictEqual(current.publication, comparison.publication));
    decisions.push({...outcome,action:changed?'append_joint_revision':'retain_unchanged_revision',
      resulting_revision:expected.revision_number,publication_sha256:sourceEvidenceHash(expected.publication)});
  }
  return {revisions,already_applied,report:{format:'lmps-intake-joint-application-1',workspace:bound.workspace,namespace:bound.namespace,
    mapping:preview.mapping,binding_sha256:preview.binding_sha256,manifest_sha256:bound.manifest_sha256,
    counts:preview.counts,transitions:preview.transitions,matched_rows:preview.rows.length,
    changed_revisions:decisions.filter(d=>d.action==='append_joint_revision').length,
    retained_v1_revisions:decisions.filter(d=>d.action==='retain_unchanged_revision').length,
    rows:decisions,mapping_applied:true,authority:'operator_declared_test_only',refund_completion_verified:false,
    account_identity:'unverified',occurred_at:null,production_ready:false}};
}

/** Atomic append under the restricted Intake role; exact retry never adds another revision. */
export async function applyJointApplication(database, input, bound, snapshot) {
  localMode();
  for (let attempt = 0; attempt < 3; attempt++) {
    const client = await database.pool.connect();
    let active = false, discard = false;
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE'); active = true;
      await client.query('SELECT pg_advisory_xact_lock(18513,22)');
      const ids = bound.rows.map(row=>row.transaction_id);
      const stored = (await client.query(`SELECT workspace_key,namespace,transaction_id,revision_number,payload,publication
        FROM platform.local_transaction_revisions WHERE workspace_key=$1 AND namespace=$2 AND transaction_id=ANY($3)
        ORDER BY transaction_id,revision_number`, [bound.workspace,bound.namespace,ids])).rows;
      const plan = planJointApplication(input,bound,snapshot,stored);
      for (const value of plan.revisions) {
        const tx = value.transaction;
        await client.query(`INSERT INTO platform.local_transaction_revisions
          (workspace_key,namespace,transaction_id,revision_number,payload,publication,provenance) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)`,
          [value.workspace_key,tx.source_reference.namespace,tx.transaction_id,value.expected_revision+1,
            JSON.stringify(tx),JSON.stringify(value.publication),value.provenance]);
      }
      await client.query('COMMIT'); active = false;
      return {status:plan.revisions.length?'applied':'duplicate',inserted:plan.revisions.length,already_applied:plan.already_applied,report:plan.report};
    } catch (error) {
      if (active) { try { await client.query('ROLLBACK'); } catch { discard = true; } }
      if (['40001','23505'].includes(error.code) && attempt < 2) continue;
      throw Error('JOINT_APPLICATION_FAILED; existing evidence retained; diagnostics withheld.');
    } finally { client.release(discard); }
  }
}

async function main() {
  localMode();
  const profile = runtimeProfile(); check(profile.profile === 'intake');
  const {values} = parseArgs({options:{bundle:{type:'string'},binding:{type:'string'}}});
  check(values.bundle && values.binding);
  const bound = await readPrivateJson(resolve(values.binding),2*1024*1024);
  const bridge = 'import json,sys;from verify_csv_export import review_mapping_rows;print(json.dumps(review_mapping_rows(sys.argv[1])))';
  const {stdout} = await promisify(execFile)(join(ROOT,'.venv/bin/python'),['-B','-c',bridge,resolve(values.bundle)],
    {cwd:join(ROOT,'../Data_Requirement'),timeout:30000,maxBuffer:4*1024*1024});
  const input = JSON.parse(stdout); buildJointMappingPreview(input,bound);
  const state = await loadState(profile.stateDirectory); check(state.port === 18513);
  const probe = await identify(state,'lmps_risk_local'); await probe.end();
  const staging = createOfflineDatasets(dsn(state,'intake'));
  let snapshot;
  try { snapshot = await staging.readComplete('offline_intake',bound.batch_ref,bound.import_sha256); }
  finally { await staging.close(); }
  const backup = await createBackup(state);
  await verifyBackup(backup.directory);
  const database = createDatabase(dsn(state,'intake'),'intake');
  let result;
  try { result = await applyJointApplication(database,input,bound,snapshot); }
  finally { await database.close(); }
  const sha = digest(result.report), id = sha.slice(0,8)+'-'+sha.slice(8,12)+'-'+sha.slice(12,16)+'-'+sha.slice(16,20)+'-'+sha.slice(20,32);
  const base = join(ROOT,'.local/intake-mapping-applications');
  await savePrivateReport(base,'v2',id,'application.json',result.report,2*1024*1024);
  console.log(JSON.stringify({status:result.status,matched_rows:result.report.matched_rows,inserted:result.inserted,
    already_applied:result.already_applied,retained_v1_revisions:result.report.retained_v1_revisions,counts:result.report.counts,
    backup_id:backup.backup_id,receipt:join(base,'v2',id,'application.json'),production_ready:false}));
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(()=>{console.error('JOINT_APPLICATION_FAILED; source values and credentials withheld.');process.exitCode=1;});
