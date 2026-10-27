import assert from 'node:assert/strict';
import { test } from 'node:test';
import { datasetRowsHash } from '@lmps/database';
import { evaluateOfflineReplay, replayCsv } from '../dist/offline-replay.js';
import { replayFixture } from './fixtures/offline-replay.mjs';

test('raw amount screening handles exact thresholds, maximum decimals, signed zero and negative amounts',()=>{
  const amounts=['99.99','100.00','100.01','9999999999999999999999.99','-1.00','-0.00','0.00'];
  const f=replayFixture(amounts.length,'transfer',rows=>rows.forEach((r,i)=>r[2]=amounts[i]));const before=structuredClone(f);
  const r=evaluateOfflineReplay(f.input,f.snapshot);assert.deepEqual(r.counts,{rows:7,matched:3,not_matched:4,unavailable:0});
  assert.deepEqual(r.rows.map(row=>row.amount),amounts);assert.equal(r.rows[1].reason_code,'AMOUNT_AT_OR_ABOVE_THRESHOLD');assert.deepEqual(f,before);
  f.input.policy.thresholds[0].amount_gte='9999999999999999999999.99';assert.equal(evaluateOfflineReplay(f.input,f.snapshot).counts.matched,1);
});
test('currency policies do not trim/casefold/convert and missing policies are unavailable',()=>{
  const f=replayFixture(4,'transfer',rows=>{['SYNTHETIC_CCY','synthetic_ccy',' SYNTHETIC_CCY','OTHER'].forEach((c,i)=>rows[i][3]=c);});
  f.input.policy.thresholds.push({source_ccy:'OTHER',amount_gte:'9999999999999999999999.99'});
  const r=evaluateOfflineReplay(f.input,f.snapshot);assert.deepEqual(r.counts,{rows:4,matched:2,not_matched:0,unavailable:2});assert.equal(r.status,'partial');
  assert.equal(r.rows[1].reason_code,'CURRENCY_POLICY_MISSING');assert.equal(r.rows[1].threshold,null);
});
test('all three transfer profiles screen recorded amounts without interpreting result or naive time',()=>{
  for(const table of ['transfer','transfer_hist','transfer_old']){
    const f=replayFixture(3,table,rows=>{const index=table==='transfer_old'?3:4;rows[0][index]=null;rows[1][index]='FAILED?';rows[2][index]='';});
    const r=evaluateOfflineReplay(f.input,f.snapshot);assert.equal(r.counts.matched,3);assert.equal(r.source_kind,'user_supplied_file');
    assert.equal(r.canonical_emission,false);assert.equal(r.operational_alerts,false);assert.equal(r.enforcement,false);assert.equal(r.source_semantics,'unverified');
    assert.equal(r.policy.amount_unit,'as_recorded');assert.equal(r.purpose,'simulation_only');
  }
});
test('member input lacks transaction amounts and yields explicit unavailable rows',()=>{
  const f=replayFixture(2,'member'),r=evaluateOfflineReplay(f.input,f.snapshot);assert.equal(r.status,'partial');
  assert.deepEqual(r.counts,{rows:2,matched:0,not_matched:0,unavailable:2});
  for(const row of r.rows){assert.equal(row.reason_code,'AMOUNT_FIELDS_UNAVAILABLE');assert.equal(row.amount,null);assert.equal(row.source_ccy,null);}
});
test('evaluation binds workspace/batch/file/rowset and revalidates complete source evidence',()=>{
  const f=replayFixture();
  for(const change of [{workspace_key:'offline_other'},{batch_ref:'00000000-0000-4000-8000-000000000000'},{dataset_sha256:'0'.repeat(64)}])
    assert.throws(()=>evaluateOfflineReplay({...f.input,...change},f.snapshot),e=>e.code==='REPLAY_INPUT_CONFLICT');
  const changed=structuredClone(f.snapshot);changed.rows[0][2]='1.00';assert.throws(()=>evaluateOfflineReplay(f.input,changed));
  changed.rows[1]=[...changed.rows[0]];changed.manifest.rows_sha256=datasetRowsHash(changed.rows);assert.throws(()=>evaluateOfflineReplay(f.input,changed));
});
test('same frozen input and policy order produce deterministic evidence and complete row references',()=>{
  const f=replayFixture();f.input.policy.thresholds.push({source_ccy:'AAA',amount_gte:'1.00'});
  const a=evaluateOfflineReplay(f.input,f.snapshot);f.input.policy.thresholds.reverse();const b=evaluateOfflineReplay(f.input,f.snapshot);
  assert.deepEqual(a,b);assert.equal(a.rows[0].row_number,1);assert.match(a.rows[0].row_sha256,/^[a-f0-9]{64}$/);
  assert.equal(a.dataset.profile_version,'offline-dataset-profile-1');
});
test('CSV quotes raw codes and prefixes literal money/currency to prevent formulas and precision loss',()=>{
  const currency=' =HYPERLINK("SYNTHETIC_URL")',f=replayFixture(1,'transfer',rows=>rows[0][3]=currency);
  f.input.policy.thresholds[0].source_ccy=currency;const r=evaluateOfflineReplay(f.input,f.snapshot),csv=replayCsv(r);
  assert.ok(csv.includes('"\' =HYPERLINK(""SYNTHETIC_URL"")"'));assert.ok(csv.includes('"\'9999999999999999999999.99"'));
  assert.equal(csv.split('\r\n').length,3);assert.equal(r.rows[0].source_ccy,currency);assert.equal(r.rows[0].amount,'9999999999999999999999.99');
});
