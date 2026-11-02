import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { riskHash } from '@lmps/risk';
import { overviewFixture } from './fixtures/overview.mjs';
let f;
before(async () => { f = await overviewFixture(); });
after(async () => { await f?.close(); });
async function request(path, {method='GET', payload, ...claims}={}) {
  return f.app.inject({method,url:'/v1/local/'+path,headers:{authorization:'Bearer '+await f.token({scope:'transactions:read risk:read alerts:read',...claims})},...(payload===undefined?{}:{payload})});
}
async function ok(path, options) {const r=await request(path,options);assert.equal(r.statusCode,200,r.body);return r.json();}
test('overview metrics use the same immutable capture and require its owner/scopes', async()=>{
  const capture=await ok('monitoring/snapshots');
  const path='monitoring/snapshots/'+capture.snapshot_id+'/overview', view=await ok(path);
  assert.deepEqual(view.summary,capture.summary);
  assert.deepEqual(view.overview.alert_states,{open:5,acknowledged:1,reviewed:0});
  assert.equal(view.overview.review_queue.pending,6);
  assert.ok(view.overview.review_queue.urgent<=6);
  assert.equal(view.overview.assessment_runs.reduce((sum,r)=>sum+r.count,0),7);
  assert.deepEqual(await ok(path),view);
  assert.equal((await request(path,{sub:'synthetic_other'})).statusCode,410);
  assert.equal((await request(path,{scope:'alerts:read'})).statusCode,403);
});
test('Alert amount reads its original immutable revision and does not disclose foreign records',async()=>{
  const e=f.entries[0],value=await ok('alerts/'+e.alert_id+'/transaction');
  assert.equal(value.alert_id,e.alert_id);assert.deepEqual(value.target,e.request.target);
  assert.equal(value.amount,e.revision.transaction.amount);assert.equal(value.currency,e.revision.transaction.currency);
  assert.equal(value.revision_sha256,riskHash(e.revision));
  assert.equal((await request('alerts/'+e.alert_id+'/transaction',{workspace_key:'synthetic_other'})).statusCode,404);
  assert.equal((await request('alerts/'+e.alert_id+'/transaction',{scope:'alerts:read'})).statusCode,403);
});
test('personal preferences persist, enforce optimistic concurrency and cannot replace another identity',async()=>{
  const path='user-notification-preferences',initial=await ok(path);
  assert.equal(initial.version,0);assert.equal(initial.push.configured,false);
  const settings={...initial.settings,enabled:false,quiet_hours:{...initial.settings.quiet_hours,enabled:true,start:'23:30'}};
  const saved=await ok(path,{method:'POST',payload:{expected_version:0,settings}});
  assert.equal(saved.version,1);assert.deepEqual((await ok(path)).settings,settings);
  assert.equal((await request(path,{method:'POST',payload:{expected_version:0,settings}})).statusCode,409);
  assert.equal((await ok(path,{sub:'synthetic_other'})).version,0);
  assert.equal((await request(path,{method:'POST',payload:{expected_version:1,settings,subject:'synthetic_other'}})).statusCode,400);
  assert.equal((await request(path,{method:'POST',payload:{expected_version:1,settings:{...settings,severities:['high','high']}}})).statusCode,400);
  assert.equal((await request(path,{scope:'operations:read'})).statusCode,403);
});
test('keyset pages cover more than 200 notifications with coherent totals and bound clocks/identities',async()=>{
  const source=(await f.owner.pool.query('SELECT * FROM platform.local_alerts WHERE alert_id=$1',[f.entries[0].alert_id])).rows[0],ids=[];
  try{
    for(let i=0;i<201;i++){
      const policy={...source.snapshot.policy,version:'synthetic_mobile_'+i},snapshot={...source.snapshot,policy},id=randomUUID();ids.push(id);
      await f.owner.pool.query('INSERT INTO platform.local_alert_policies(workspace_key,policy_id,policy_version,policy,policy_sha256) VALUES($1,$2,$3,$4,$5)',[source.workspace_key,policy.policy_id,policy.version,policy,riskHash(policy)]);
      await f.owner.pool.query('INSERT INTO platform.local_alerts(workspace_key,alert_id,assessment_run_id,policy_id,policy_version,policy_sha256,snapshot,snapshot_sha256) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[source.workspace_key,id,source.assessment_run_id,policy.policy_id,policy.version,riskHash(policy),snapshot,riskHash(snapshot)]);
    }
    const first=await ok('user-notifications/page');assert.equal(first.total,208);assert.equal(first.unread_total,208);assert.equal(first.items.length,50);
    assert.equal((await request('user-notifications/page?after='+first.next_cursor,{sub:'synthetic_other'})).statusCode,400);
    const rows=[...first.items];let cursor=first.next_cursor;
    await ok('user-notifications/'+first.items[0].id+'/read',{method:'POST',payload:{}});
    while(cursor){const page=await ok('user-notifications/page?after='+cursor);assert.equal(page.as_of,first.as_of);assert.equal(page.total,208);assert.equal(page.unread_total,208);rows.push(...page.items);cursor=page.next_cursor;}
    assert.equal(rows.length,208);assert.equal(new Set(rows.map(r=>r.id)).size,208);
    assert.deepEqual(rows.map(r=>r.id),rows.map(r=>r.id).toSorted());
    assert.equal((await ok('user-notifications/page')).unread_total,207);
    for(const query of ['?after=bad','?subject=synthetic_other','?after=x&after=y'])assert.equal((await request('user-notifications/page'+query)).statusCode,400);
  } finally {
    await f.owner.pool.query('DELETE FROM platform.local_user_notification_reads WHERE alert_id=ANY($1::uuid[])',[ids]);
    await f.owner.pool.query('DELETE FROM platform.local_alerts WHERE alert_id=ANY($1::uuid[])',[ids]);
    await f.owner.pool.query("DELETE FROM platform.local_alert_policies WHERE policy_version LIKE 'synthetic_mobile_%'");
  }
});
