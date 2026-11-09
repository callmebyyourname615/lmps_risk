import assert from 'node:assert/strict';
import test from 'node:test';
import { configurePortalIntakePolicy } from './portal-intake-policy.mjs';
import * as source from '../packages/risk/fixtures/portal-policy.mjs';

test('injected synthetic policy still rejects ambiguous, unapproved, wrong-currency and changed-hash evidence before database access', async () => {
  for (const mutate of [
    workspace => workspace.bindings.push({ policyId: 'OTHER' }),
    workspace => workspace.policies[0].state = 'draft',
    workspace => workspace.policies[0].currency = 'THB',
    workspace => workspace.policies[0].condition.fraudThreshold = '1.00',
    workspace => workspace.policies.splice(0),
  ]) {
    const workspace = source.createPolicyWorkspace();
    mutate(workspace);
    await assert.rejects(configurePortalIntakePolicy(null, { ...source, createPolicyWorkspace: () => workspace }), /Portal policy/);
  }
});
