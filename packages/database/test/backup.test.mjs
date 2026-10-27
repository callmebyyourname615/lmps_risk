import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { after, before, test } from 'node:test';
import { chmod, cp, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createDatabase, createLocalOutbox, createSourceIntake, createSyncJobs, createTransactionRevisions, createRuleAssessments, createTransactionRisks, createLocalAlerts, createAlertReviews, createRiskJobs } from '../dist/index.js';
import { alertFixture } from './fixtures/alert.mjs';
import { transactionRiskFixture } from './fixtures/transaction-risk.mjs';
import { assessmentFixture } from './fixtures/rule-assessment.mjs';
import { revision } from './fixtures/transaction-revision.mjs';
import { publicationFixture } from '../../contracts/fixtures/synthetic-publication.mjs';
import { availablePort, dsn, initializeCluster, loadState, running, startCluster, stopCluster } from '../scripts/local.mjs';
import { createBackup, restoreDrill, verifyBackup } from '../scripts/backup.mjs';
import { migrations } from '../scripts/migrations.mjs';

let scratch, source, intake, queue, app, owner, backup, legacyBackup, auditBackup, jobBackup, revisionBackup, publicationBackup, assessmentBackup, riskBackup, alertBackup, riskJobBackup, offlineBackup, policyBackup, caseBackup, modelBackup;
const event = JSON.parse(await readFile(new URL('../fixtures/source-event.json', import.meta.url), 'utf8'));
before(async () => {
  scratch = await mkdtemp('/tmp/lmps-bkp-'); source = await initializeCluster(join(scratch, 'source'), await availablePort()); await startCluster(source);
  const legacyFolder = join(scratch, 'legacy-migrations');
  await cp(new URL('../migrations/', import.meta.url), legacyFolder, { recursive: true });
  const journalPath = join(legacyFolder, 'meta/_journal.json'); const journal = JSON.parse(await readFile(journalPath, 'utf8')); journal.entries = journal.entries.slice(0, 4);
  await writeFile(journalPath, JSON.stringify(journal));
  await migrations(dsn(source, 'migration'), true, legacyFolder);
  legacyBackup = await createBackup(source, join(scratch, 'legacy-backups'));
  journal.entries.push(JSON.parse(await readFile(new URL('../migrations/meta/_journal.json', import.meta.url), 'utf8')).entries[4]);
  await writeFile(journalPath, JSON.stringify(journal)); await migrations(dsn(source, 'migration'), true, legacyFolder);
  auditBackup = await createBackup(source, join(scratch, 'audit-backups'));
  journal.entries.push(JSON.parse(await readFile(new URL('../migrations/meta/_journal.json', import.meta.url), 'utf8')).entries[5]);
  await writeFile(journalPath, JSON.stringify(journal)); await migrations(dsn(source, 'migration'), true, legacyFolder);
  jobBackup = await createBackup(source, join(scratch, 'job-backups'));
  journal.entries.push(JSON.parse(await readFile(new URL('../migrations/meta/_journal.json', import.meta.url), 'utf8')).entries[6]);
  await writeFile(journalPath, JSON.stringify(journal)); await migrations(dsn(source, 'migration'), true, legacyFolder);
  const oldWriter = createDatabase(dsn(source, 'intake'), 'intake'); const old = revision();
  try { await oldWriter.pool.query('INSERT INTO platform.local_transaction_revisions(workspace_key,namespace,transaction_id,revision_number,payload) VALUES ($1,$2,$3,1,$4)',
    [old.workspace_key, old.transaction.source_reference.namespace, old.transaction.transaction_id, old.transaction]); } finally { await oldWriter.close(); }
  revisionBackup = await createBackup(source, join(scratch, 'revision-backups'));
  journal.entries.push(JSON.parse(await readFile(new URL('../migrations/meta/_journal.json', import.meta.url), 'utf8')).entries[7]);
  await writeFile(journalPath, JSON.stringify(journal)); await migrations(dsn(source, 'migration'), true, legacyFolder);
  publicationBackup = await createBackup(source, join(scratch, 'publication-backups'));
  journal.entries.push(JSON.parse(await readFile(new URL('../migrations/meta/_journal.json', import.meta.url), 'utf8')).entries[8]);
  await writeFile(journalPath, JSON.stringify(journal)); await migrations(dsn(source, 'migration'), true, legacyFolder);
  assessmentBackup = await createBackup(source, join(scratch, 'assessment-backups'));
  journal.entries.push(JSON.parse(await readFile(new URL('../migrations/meta/_journal.json', import.meta.url), 'utf8')).entries[9]);
  await writeFile(journalPath, JSON.stringify(journal)); await migrations(dsn(source, 'migration'), true, legacyFolder);
  riskBackup = await createBackup(source, join(scratch, 'risk-backups'));
  journal.entries.push(JSON.parse(await readFile(new URL('../migrations/meta/_journal.json', import.meta.url), 'utf8')).entries[10]);
  await writeFile(journalPath, JSON.stringify(journal)); await migrations(dsn(source, 'migration'), true, legacyFolder);
  alertBackup = await createBackup(source, join(scratch, 'alert-backups'));
  journal.entries.push(JSON.parse(await readFile(new URL('../migrations/meta/_journal.json', import.meta.url), 'utf8')).entries[11]);
  await writeFile(journalPath, JSON.stringify(journal)); await migrations(dsn(source, 'migration'), true, legacyFolder);
  riskJobBackup = await createBackup(source, join(scratch, 'risk-job-backups'));
  journal.entries.push(JSON.parse(await readFile(new URL('../migrations/meta/_journal.json', import.meta.url), 'utf8')).entries[12]);
  await writeFile(journalPath, JSON.stringify(journal)); await migrations(dsn(source, 'migration'), true, legacyFolder);
  offlineBackup = await createBackup(source, join(scratch, 'offline-backups'));
  journal.entries.push(JSON.parse(await readFile(new URL('../migrations/meta/_journal.json', import.meta.url), 'utf8')).entries[13]);
  await writeFile(journalPath, JSON.stringify(journal)); await migrations(dsn(source, 'migration'), true, legacyFolder);
  policyBackup = await createBackup(source, join(scratch, 'policy-backups'));
  journal.entries.push(JSON.parse(await readFile(new URL('../migrations/meta/_journal.json', import.meta.url), 'utf8')).entries[14]);
  await writeFile(journalPath, JSON.stringify(journal)); await migrations(dsn(source, 'migration'), true, legacyFolder);
  caseBackup = await createBackup(source, join(scratch, 'case-backups'));
  journal.entries.push(JSON.parse(await readFile(new URL('../migrations/meta/_journal.json', import.meta.url), 'utf8')).entries[15]);
  await writeFile(journalPath, JSON.stringify(journal)); await migrations(dsn(source, 'migration'), true, legacyFolder);
  modelBackup = await createBackup(source, join(scratch, 'model-backups'));
  await migrations(dsn(source, 'migration'), true); intake = createSourceIntake(dsn(source, 'intake')); queue = createLocalOutbox(dsn(source, 'outbox'));
  app = createDatabase(dsn(source)); owner = createDatabase(dsn(source, 'migration'), 'migration');
  const jobs = createSyncJobs(dsn(source, 'intake'));
  try { await jobs.register({ workspace_key: 'synthetic_local', capture_id: randomUUID(), snapshot_sha256: 'a'.repeat(64), total: 0 }); } finally { await jobs.close(); }
  const revisions = createTransactionRevisions(dsn(source, 'intake'));
  try { await revisions.append(revision()); await revisions.append(revision(1)); await revisions.append(publicationFixture()); } finally { await revisions.close(); }
  const risks = createTransactionRisks(dsn(source, 'intake'));
  // A missing explicit target intentionally persists an unavailable assessment; it must also survive restore.
  const riskRequest = transactionRiskFixture().request; riskRequest.target.transaction_id = 'synthetic_missing'; riskRequest.context = null;
  try { await risks.evaluate(riskRequest); } finally { await risks.close(); }
  const positive = transactionRiskFixture(), positiveWriter = createTransactionRevisions(dsn(source, 'intake')), positiveRisks = createTransactionRisks(dsn(source, 'intake'));
  const alerts = createLocalAlerts(dsn(source, 'intake')), reviews = createAlertReviews(dsn(source, 'reviewer')), af = alertFixture();
  try {
    await positiveWriter.append(positive.revision); await positiveRisks.evaluate(positive.request);
    const generated = await alerts.generate({ ...af.generation, assessment_run_id: positive.request.run_id });
    await reviews.review('synthetic_local', generated.alert_id, 'synthetic_reviewer', af.ack);
    await reviews.review('synthetic_local', generated.alert_id, 'synthetic_reviewer', af.review);
  } finally { await positiveWriter.close(); await positiveRisks.close(); await alerts.close(); await reviews.close(); }
  const riskJobs = createRiskJobs(dsn(source, 'intake'));
  try {
    const id = randomUUID(), request = { ...riskRequest, run_id: id };
    const input = { format: 1, provenance: 'local_synthetic', execution_mode: 'test', workspace_key: 'synthetic_local', job_ref: id, risk_request: request, alert_policy: af.policy };
    await riskJobs.enqueue(input); const claimed = await riskJobs.claim(id);
    await riskJobs.advance(claimed.claim); await riskJobs.fail(claimed.claim, 'JOB_STORAGE_UNAVAILABLE');
    const pending = randomUUID(); await riskJobs.enqueue({ ...input, job_ref: pending, risk_request: { ...request, run_id: pending, target: { ...request.target, transaction_id: 'synthetic_pending_backup' } } });
  } finally { await riskJobs.close(); }
  const assessments = createRuleAssessments(dsn(source, 'intake'));
  try { await assessments.evaluate(assessmentFixture().manifest); } finally { await assessments.close(); }
  await intake.append(event); await queue.enqueue({ workspace_key: 'synthetic_local', semantic_key: 'synthetic_backup', notification_ref: randomUUID(), expires_at: '2030-01-01T00:00:00.000Z' });
});
after(async () => {
  await queue?.close(); await intake?.close(); await app?.close(); await owner?.close();
  if (scratch && !source) { try { source = await loadState(join(scratch, 'source')); } catch { return; } }
  if (source) await stopCluster(source);
  if (scratch) await rm(scratch, { recursive: true, force: true });
});

test('native backup exports a consistent owned snapshot, writes only private artifacts and removes password file', async () => {
  backup = await createBackup(source, join(scratch, 'backups'));
  const manifest = await verifyBackup(backup.directory);
  assert.equal(manifest.tables['platform.audit_events'].rows, 2); assert.equal(manifest.tables['platform.source_events'].rows, 1); assert.equal(manifest.tables['platform.local_outbox_intents'].rows, 1);
  assert.equal(manifest.tables['platform.local_transaction_revisions'].rows, 4);
  assert.equal(manifest.tables['platform.local_transaction_risks'].rows, 3); assert.equal(manifest.tables['platform.local_risk_policies'].rows, 1);
  assert.equal(manifest.tables['platform.local_rule_versions'].rows, 2); assert.equal(manifest.tables['platform.local_assessment_runs'].rows, 1);
  assert.equal(manifest.tables['platform.local_alerts'].rows, 1); assert.equal(manifest.tables['platform.local_alert_policies'].rows, 1);
  assert.equal(manifest.tables['platform.local_alert_reviews'].rows, 2);
  assert.equal(manifest.tables['platform.local_risk_jobs'].rows, 2); assert.equal(manifest.tables['platform.local_risk_job_attempts'].rows, 1);
  for (const name of ['manifest.json', 'database.dump']) assert.equal((await lstat(join(backup.directory, name))).mode & 0o077, 0);
  await assert.rejects(lstat(join(backup.directory, 'temporary.pgpass')), { code: 'ENOENT' });
  assert.ok(!(await readFile(join(backup.directory, 'manifest.json'), 'utf8')).includes(source.passwords.bootstrap));
});

test('actual restore into a separate disposable cluster matches frozen evidence/ACLs after source changes and never overwrites source', async () => {
  await intake.append({ ...event, event_key: 'post-backup', source_key: { ...event.source_key, id: '2' } });
  const work = await queue.claim('synthetic_local'); assert.equal(work.status, 'claimed'); await queue.finish(work.claim, 'accepted');
  const result = await restoreDrill(backup.directory);
  assert.equal(result.status, 'PASS'); assert.equal(result.table_counts['platform.local_sync_jobs'], 1); assert.equal(result.table_counts['platform.audit_events'], 2); assert.equal(result.table_counts['platform.source_events'], 1);
  assert.equal(result.table_counts['platform.local_outbox_attempts'], 0); assert.equal(result.app_read_only_checked, true); assert.equal(result.workers_started, false);
  assert.equal(result.table_counts['platform.local_transaction_revisions'], 4);
  assert.equal(result.table_counts['platform.local_transaction_risks'], 3); assert.equal(result.table_counts['platform.local_risk_policies'], 1);
  assert.equal(result.table_counts['platform.local_rule_versions'], 2); assert.equal(result.table_counts['platform.local_assessment_runs'], 1);
  assert.equal(result.table_counts['platform.local_risk_jobs'], 2); assert.equal(result.table_counts['platform.local_risk_job_attempts'], 1);
  assert.equal(result.table_counts['platform.local_alerts'], 1); assert.equal(result.table_counts['platform.local_alert_reviews'], 2);
  assert.equal(running(source), true);
  assert.equal((await app.pool.query('SELECT count(*)::int AS n FROM platform.source_events')).rows[0].n, 2);
  assert.equal((await app.pool.query('SELECT state FROM platform.local_outbox_intents')).rows[0].state, 'accepted');
});

test('pre-offline12-migration backup preserves v1 provenance and restores without creating staging', async () => {
  const manifest = await verifyBackup(riskJobBackup.directory);
  assert.equal(manifest.format, 'local_pg_backup_v1'); assert.equal(manifest.provenance, 'local_synthetic');
  assert.equal(manifest.tables['platform.offline_dataset_batches'], undefined);
  const result = await restoreDrill(riskJobBackup.directory);
  assert.equal(result.status, 'PASS'); assert.equal(result.table_counts['platform.offline_dataset_rows'], undefined);
});

test('tampered/corrupt/insecure/symlink artifacts fail before restore; source remains available', async () => {
  const manifestPath = join(backup.directory, 'manifest.json'); const original = await readFile(manifestPath);
  const changed = JSON.parse(original); changed.sha256 = '0'.repeat(64); await writeFile(manifestPath, JSON.stringify(changed), { mode: 0o600 });
  await assert.rejects(restoreDrill(backup.directory), /diagnostics withheld/);
  await writeFile(manifestPath, original, { mode: 0o600 });
  await chmod(manifestPath, 0o644);
  try { await assert.rejects(verifyBackup(backup.directory), /diagnostics withheld/); } finally { await chmod(manifestPath, 0o600); }
  const bad = join(scratch, 'linked'); await symlink(backup.directory, bad); await assert.rejects(verifyBackup(bad), /diagnostics withheld/);
  const fifoDirectory = join(scratch, randomUUID()); await mkdir(fifoDirectory, { mode: 0o700 });
  execFileSync('mkfifo', ['-m', '600', join(fifoDirectory, 'manifest.json')]);
  await assert.rejects(verifyBackup(fifoDirectory), /diagnostics withheld/);
  assert.equal(await app.health(), 'available');
});

test('unsupported source tables and stopped source refuse backup without source mutations or raw credentials', async () => {
  await owner.pool.query('CREATE TABLE platform.synthetic_extra(id int)');
  try { await assert.rejects(createBackup(source, join(scratch, 'backups')), /diagnostics withheld/); }
  finally { await owner.pool.query('DROP TABLE platform.synthetic_extra'); }
  await owner.pool.query("INSERT INTO platform.local_outbox_intents(workspace_key,semantic_key,notification_ref,expires_at) SELECT 'synthetic_overflow','synthetic_overflow_'||n,gen_random_uuid(),now() FROM generate_series(1,1001) n");
  try { await assert.rejects(createBackup(source, join(scratch, 'backups')), /diagnostics withheld/); }
  finally { await owner.pool.query("DELETE FROM platform.local_outbox_intents WHERE workspace_key='synthetic_overflow'"); }
  await stopCluster(source);
  try { await assert.rejects(createBackup(source, join(scratch, 'backups')), /diagnostics withheld/); }
  finally { await startCluster(source); }
  assert.equal((await app.pool.query('SELECT count(*)::int AS n FROM platform.source_events')).rows[0].n, 2);
});


test('pre-audit backups still restore their original schema and migration prefix without invented historical evidence', async () => {
  const legacy = await verifyBackup(legacyBackup.directory); assert.equal(legacy.tables['platform.audit_events'], undefined);
  const result = await restoreDrill(legacyBackup.directory); assert.equal(result.status, 'PASS');
  assert.equal(result.table_counts['platform.audit_events'], undefined); assert.equal(result.table_counts['lmps_migrations.__drizzle_migrations'], 4);
  assert.equal((await owner.pool.query('SELECT count(*)::int AS n FROM lmps_migrations.__drizzle_migrations')).rows[0].n, 17);
});


test('pre-job audit backups restore the original five migrations and audit schema without adding jobs', async () => {
  const manifest = await verifyBackup(auditBackup.directory); assert.equal(manifest.tables['platform.local_sync_jobs'], undefined);
  const result = await restoreDrill(auditBackup.directory); assert.equal(result.status, 'PASS');
  assert.equal(result.table_counts['lmps_migrations.__drizzle_migrations'], 5); assert.equal(result.table_counts['platform.local_sync_jobs'], undefined);
});

test('pre-revision job backups restore the original six migrations without creating transaction observations', async () => {
  const result = await restoreDrill(jobBackup.directory);
  assert.equal(result.status, 'PASS'); assert.equal(result.table_counts['lmps_migrations.__drizzle_migrations'], 6);
  assert.equal(result.table_counts['platform.local_transaction_revisions'], undefined);
});


test('pre-publication seven-migration backup restores unknown history without adding proof columns or upgrading the ledger', async () => {
  const result = await restoreDrill(revisionBackup.directory);
  assert.equal(result.status, 'PASS'); assert.equal(result.table_counts['lmps_migrations.__drizzle_migrations'], 7);
  assert.equal(result.table_counts['platform.local_transaction_revisions'], 1);
});


test('pre-assessment eight-migration backups restore without new rule or assessment tables', async () => {
  const result = await restoreDrill(publicationBackup.directory);
  assert.equal(result.status, 'PASS'); assert.equal(result.table_counts['lmps_migrations.__drizzle_migrations'], 8);
  assert.equal(result.table_counts['platform.local_rule_versions'], undefined); assert.equal(result.table_counts['platform.local_assessment_runs'], undefined);
});


test('pre-scoring nine-migration backup restores without creating policy or transaction-risk tables', async () => {
  const result = await restoreDrill(assessmentBackup.directory);
  assert.equal(result.status, 'PASS'); assert.equal(result.table_counts['lmps_migrations.__drizzle_migrations'], 9);
  assert.equal(result.table_counts['platform.local_risk_policies'], undefined); assert.equal(result.table_counts['platform.local_transaction_risks'], undefined);
});

test('pre-alert ten-migration backups restore risk storage without creating alert or review evidence', async () => {
  const result = await restoreDrill(riskBackup.directory); assert.equal(result.status, 'PASS');
  assert.equal(result.table_counts['lmps_migrations.__drizzle_migrations'], 10);
  assert.equal(result.table_counts['platform.local_alerts'], undefined); assert.equal(result.table_counts['platform.local_alert_reviews'], undefined);
});


test('pre-job-flow eleven-migration backups restore alert evidence without inventing risk jobs', async () => {
  const result = await restoreDrill(alertBackup.directory);
  assert.equal(result.status, 'PASS'); assert.equal(result.table_counts['lmps_migrations.__drizzle_migrations'], 11);
  assert.equal(result.table_counts['platform.local_alerts'], 0); assert.equal(result.table_counts['platform.local_risk_jobs'], undefined);
});

test('pre-policy thirteen-migration backup restores original offline inventory without governance tables or history upgrade', async () => {
  const result = await restoreDrill(offlineBackup.directory);
  assert.equal(result.status, 'PASS'); assert.equal(result.table_counts['lmps_migrations.__drizzle_migrations'], 13);
  assert.equal(result.table_counts['platform.offline_dataset_rows'], 0); assert.equal(result.table_counts['platform.local_risk_policy_versions'], undefined);
});

test('pre-case fourteen-migration backup restores original policy inventory without case tables or ledger upgrade', async () => {
 const result = await restoreDrill(policyBackup.directory);assert.equal(result.status,'PASS');assert.equal(result.table_counts['lmps_migrations.__drizzle_migrations'],14);assert.equal(result.table_counts['platform.local_case_events'],undefined);assert.equal(result.table_counts['platform.local_risk_policy_versions'],0);
});

test('pre-model fifteen-migration backup retains the original28-table inventory and never invents model receipts',async()=>{
 const result=await restoreDrill(caseBackup.directory);assert.equal(result.status,'PASS');assert.equal(result.table_counts['lmps_migrations.__drizzle_migrations'],15);assert.equal(Object.keys(result.table_counts).length,28);assert.equal(result.table_counts['platform.local_model_receipts'],undefined);
});

test('pre-label sixteen-migration backup retains30 tables and never invents adjudication evidence',async()=>{
 const result=await restoreDrill(modelBackup.directory);assert.equal(result.status,'PASS');assert.equal(result.table_counts['lmps_migrations.__drizzle_migrations'],16);assert.equal(Object.keys(result.table_counts).length,30);assert.equal(result.table_counts['platform.local_label_adjudications'],undefined);
});
