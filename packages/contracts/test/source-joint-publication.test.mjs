import assert from 'node:assert/strict';
import test from 'node:test';
import {makeSourcePublication,makeJointSourcePublication,sourceEvidenceHash,sourcePublicationTransaction} from '../dist/source-publication.js';
import {publicationTransaction,publicationIdentity} from '../dist/synthetic-publication.js';

function fixture(result='ERROR',shouldrevert='1') {
  const prior=makeSourcePublication({workspace:'synthetic_local',namespace:'synthetic_csv',generation:'11111111-1111-4111-8111-111111111111',
    batch:'22222222-2222-4222-8222-222222222222',dataset_sha256:'a'.repeat(64),rows_sha256:'b'.repeat(64),source_namespace:'lmps_transfer',row_number:1,
    values:['1','2026-11-03 00:00:00','1000000.00','LAK',result,'2026-11-03 00:00:01'],observed_at:'2026-11-04T00:00:00.000Z',expected_revision:0});
  const review={manifest_sha256:'c'.repeat(64),review_sha256:'d'.repeat(64),review_row_sha256:'e'.repeat(64),binding_sha256:'f'.repeat(64),
    previous_publication_sha256:sourceEvidenceHash(prior.publication),previous_payload_sha256:sourceEvidenceHash(prior.transaction),review_row_number:1,shouldrevert};
  return {prior,review};
}

test('v2 publication pins joint review evidence and preserves immutable predecessor, unknown clock and identity',()=>{
  for(const [result,flag,status] of [['OK','0','succeeded'],['ERROR','1','failed'],['LMPS PAYMENT TIME IS EXPIRE','1','failed'],['OK',null,'unknown']]) {
    const {prior,review}=fixture(result,flag),before=structuredClone(prior);
    const next=makeJointSourcePublication(prior.publication,review);
    assert.equal(next.transaction.transaction_status,status);assert.equal(next.publication.binding.expected_revision,1);
    assert.equal(next.transaction.transaction_id,prior.transaction.transaction_id);
    assert.equal(next.transaction.occurred_at,null);assert.equal(next.transaction.sender.status,'unresolved');
    assert.equal(next.publication.normalization_input.reversal_code,'SYNTH_REVERSAL_NONE');
    assert.notEqual(next.transaction.transaction_revision,prior.transaction.transaction_revision);
    assert.deepEqual(publicationTransaction(next.publication),next);assert.deepEqual(prior,before);
    const reorder=value=>Array.isArray(value)?value.map(reorder):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).reverse().map(([k,v])=>[k,reorder(v)])):value;
    assert.deepEqual(publicationTransaction(reorder(next.publication)),next);
  }
});

test('v2 rejects missing commitments, forged projection, numeric flags and wrong predecessor',()=>{
  const {prior,review}=fixture();
  assert.throws(()=>makeJointSourcePublication(prior.publication,{...review,previous_payload_sha256:'0'.repeat(64)}));
  for(const mutate of [p=>delete p.origin.review,p=>p.origin.review.shouldrevert=1,p=>p.origin.review.review_row_sha256='bad',
    p=>p.origin.review.previous_publication_sha256='0'.repeat(64),p=>p.normalization_input.status_code='SYNTH_SUCCEEDED',
    p=>p.origin.mapping='operator_intake_test_ok_failed_v1',p=>p.binding.expected_revision=0,p=>p.origin.review.account='forbidden']) {
    const next=makeJointSourcePublication(prior.publication,review).publication; mutate(next);
    assert.throws(()=>sourcePublicationTransaction(next));
  }
});

test('review changes affect both revision and replay identity, including equal-status outcomes',()=>{
  const {prior,review}=fixture();const first=makeJointSourcePublication(prior.publication,review).publication;
  const second=makeJointSourcePublication(prior.publication,{...review,review_row_sha256:'0'.repeat(64)}).publication;
  assert.notEqual(first.binding.transaction_revision,second.binding.transaction_revision);
  assert.notDeepEqual(publicationIdentity(first),publicationIdentity(second));
});
