import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { makeSourcePublication } from '../packages/contracts/dist/source-publication.js';
import { matchReviewBindings } from './bind-intake-review.mjs';

function fixture() {
  const values = [['1','2026-11-03 00:00:00','9007199254740993.01','LAK','OK','2026-11-03 00:00:01'],
    ['1','2026-11-03 00:00:01','1.00','LAK','ERROR','2026-11-03 00:00:02']];
  const batch = randomUUID(), generation = randomUUID();
  const stored = values.map((v,i) => {
    const p = makeSourcePublication({workspace:'synthetic_local',namespace:'synthetic_csv',generation,batch,
      dataset_sha256:'a'.repeat(64),rows_sha256:'b'.repeat(64),source_namespace:'lmps_transfer',row_number:i+1,
      values:v,observed_at:'2026-11-04T00:00:00.000Z',expected_revision:0});
    return {workspace_key:'synthetic_local',namespace:'synthetic_csv',transaction_id:p.transaction.transaction_id,
      revision_number:1,payload:p.transaction,publication:p.publication};
  });
  const snapshot = {manifest:{source_table:'transfer',dataset_sha256:'a'.repeat(64),rows_sha256:'b'.repeat(64),batch_ref:batch},rows:values};
  const review = {format:'lmps-review-binding-input-1',manifest_sha256:'c'.repeat(64),review_sha256:'d'.repeat(64),
    import_sha256:'a'.repeat(64),review_file:'review/transfer-0000.csv',import_file:'import/transfer-0000.csv',
    rows:values.map((v,i)=>({values:v,review_row_number:i+1,review_row_sha256:String(i+1).repeat(64)}))};
  return {review,snapshot,stored};
}

test('rich commitments bind exact latest revisions by composite key independent of read order without remapping', () => {
  const {review,snapshot,stored}=fixture();
  const report=matchReviewBindings(review,snapshot,stored.toReversed());
  assert.equal(report.rows.length,2);
  assert.notEqual(report.rows[0].transaction_id,report.rows[1].transaction_id);
  assert.equal(report.mapping_applied,false);assert.equal(report.revisions_created,false);
  assert.equal(stored[1].payload.transaction_status,'unknown');
  assert.deepEqual(report,matchReviewBindings(review,snapshot,stored));
  for(const r of report.rows) assert.ok(!Object.hasOwn(r,'values')&&!Object.hasOwn(r,'payload'));
});

test('foreign scope, stale revisions, altered source or payload, missing and duplicate rows fail', () => {
  const changes=[
    f=>f.review.import_sha256='e'.repeat(64),
    f=>f.review.rows[0].values[2]='9007199254740993.02',
    f=>f.stored[0].namespace='synthetic_other',
    f=>f.stored[0].revision_number=2,
    f=>f.stored[0].payload.transaction_status='failed',
    f=>f.stored[0].publication.origin.values[4]='ERROR',
    f=>f.stored.pop(),
    f=>f.review.rows[1]=structuredClone(f.review.rows[0]),
    f=>f.review.rows[1].review_row_number=1,
    f=>f.review.rows[0].review_row_sha256='invalid',
    f=>f.stored[0].workspace_key='synthetic_other',
  ];
  for(const change of changes){const f=fixture();change(f);assert.throws(()=>matchReviewBindings(f.review,f.snapshot,f.stored));}
});
