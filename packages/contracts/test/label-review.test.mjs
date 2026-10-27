import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { isLabelCommand } from '../dist/label-review.js';
test('label contracts keep unknown distinct and reject coercion, invalid dates and caller authority fields without mutation',()=>{
  const command={request_id:randomUUID(),expected_version:0,outcome_version:4,alert_id:randomUUID(),task:'fraud',outcome:null,action:'adjudicate',mature_at:'2026-10-25T00:00:00.000Z',evidence:{kind:'external_resolution_unverified',reference:'owner-resolution/1',sha256:'b'.repeat(64)}};
  assert.equal(isLabelCommand(command),true);
  for(const changes of [{outcome:false},{outcome:'0'},{expected_version:'0'},{mature_at:'2026-02-30T00:00:00.000Z'},{actor_subject:'synthetic_forged'},{evidence:{...command.evidence,kind:'verified'}},{task:'all'}]){
    const input={...command,...changes},before=structuredClone(input);assert.equal(isLabelCommand(input),false);assert.deepEqual(input,before);
  }
});
