import assert from 'node:assert/strict';
import test from 'node:test';
import { makeSourcePublication, sourcePublicationTransaction, sourceEvidenceHash } from '@lmps/contracts/source-publication';
import { auditFixture } from '../../../packages/contracts/fixtures/intake-audit.mjs';
import { analyzeIntakeRevisionHistory as analyze, INTAKE_AUDIT_MAX_REVISIONS } from '../dist/intake-revision-audit.js';

const workspace = 'synthetic_local', namespace = 'synthetic_csv';

test('audit uses verified latest v1/v2 lifecycle once per source key and retains unavailable identity/time/history', () => {
  const rows = auditFixture(), before = structuredClone(rows), report = analyze(rows, workspace, namespace);
  assert.equal(report.stored_revisions, 6); assert.equal(report.transactions, 4); assert.equal(report.revised_transactions, 2);
  assert.deepEqual(report.currencies, [
    { currency: 'LAK', transactions: 3, succeeded: 1, failed: 1, unknown: 1 },
    { currency: 'THB', transactions: 1, succeeded: 1, failed: 0, unknown: 0 },
  ]);
  assert.deepEqual(report.mappings, { operator_intake_test_ok_failed_v1: 2, operator_intake_test_result_revert_v2: 2 });
  assert.deepEqual(report.refund_instruction, { required: 1, not_indicated: 0, unknown: 3 });
  assert.equal(report.refund_completion, 'unverified');
  assert.deepEqual(report.identity, { verified_transactions: 0, unresolved_sender_slots: 4, unresolved_receiver_slots: 4 });
  for (const key of ['source_semantics', 'business_payment_identity', 'payment_time', 'source_history_coverage']) assert.equal(report[key], 'unverified');
  for (const key of ['account_linkage_performed', 'assessment_performed', 'connection_authorized', 'production_ready']) assert.equal(report[key], false);
  assert.deepEqual(analyze([...rows].reverse(), workspace, namespace), report); assert.deepEqual(rows, before);
  const output = JSON.stringify(report);
  for (const value of [rows[0].transaction_id, rows[0].payload.amount, '2026-11-03', 'ERROR']) assert.ok(!output.includes(value));
});

test('foreign scope, forged payload/identity, duplicate/gapped history and rehashed wrong predecessor cannot yield a report', () => {
  for (const mutate of [
    rows => rows[0].workspace_key = 'synthetic_other',
    rows => rows[0].namespace = 'synthetic_other',
    rows => rows[0].provenance = 'local_synthetic',
    rows => rows[0].payload.amount = '1.00',
    rows => rows[0].payload.sender = { status: 'resolved', account_token: 'synthetic_forged' },
    rows => rows.push(structuredClone(rows[0])),
    rows => rows.splice(1, 1),
    rows => rows[0].transaction_id = rows[1].transaction_id,
    rows => {
      const publication = rows[2].publication;
      publication.origin.review.previous_publication_sha256 = '0'.repeat(64);
      publication.evidence_sha256 = sourceEvidenceHash(publication.origin.review);
      publication.binding.transaction_revision = 'synthetic_joint_2_' + sourceEvidenceHash(publication.origin).slice(0, 48);
      rows[2].payload = sourcePublicationTransaction(publication).transaction;
    },
  ]) {
    const rows = auditFixture(); mutate(rows);
    assert.throws(() => analyze(rows, workspace, namespace), /^Error: INTAKE_REVISION_AUDIT_INVALID; private values withheld\.$/);
  }
});

test('strict bounded JSON refuses getters/proxies/production; valid long Unicode source results remain unknown', () => {
  let calls = 0;
  const rows = auditFixture();
  Object.defineProperty(rows[0].publication.origin, 'values', { enumerable: true, get() { calls++; throw Error('private'); } });
  assert.throws(() => analyze(rows, workspace, namespace)); assert.equal(calls, 0);
  const sparse = new Array(1); assert.throws(() => analyze(sparse, workspace, namespace));
  const accessor = []; Object.defineProperty(accessor, '0', { enumerable: true, get() { calls++; } });
  assert.throws(() => analyze(accessor, workspace, namespace)); assert.equal(calls, 0);
  assert.throws(() => analyze(new Proxy([], { get() { calls++; } }), workspace, namespace)); assert.equal(calls, 0);
  assert.throws(() => analyze(new Array(INTAKE_AUDIT_MAX_REVISIONS + 1), workspace, namespace));
  const empty = analyze([], workspace, namespace); assert.equal(empty.transactions, 0); assert.equal(empty.production_ready, false);
  const row = auditFixture()[0], publication = row.publication, values = [...publication.origin.values];
  values[4] = '😀'.repeat(200);
  const projected = makeSourcePublication({ workspace, namespace, generation: publication.source.source_generation, batch: publication.capture_id,
    dataset_sha256: publication.snapshot_sha256, rows_sha256: publication.evidence_sha256, source_namespace: publication.origin.source_namespace,
    row_number: publication.origin.row_number, values, observed_at: publication.source.observed_at, expected_revision: 0 });
  assert.equal(analyze([{ ...row, payload: projected.transaction, publication: projected.publication }], workspace, namespace).currencies[0].unknown, 1);
  const originalMode = process.env.NODE_ENV;
  try { process.env.NODE_ENV = 'production'; assert.throws(() => analyze([], workspace, namespace)); }
  finally { if (originalMode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = originalMode; }
});
