import { createHash } from 'node:crypto';

export function policyHash(policy) {
  const payload = { id: policy.id, version: policy.version, namespace: policy.namespace, currency: policy.currency,
    condition: { operator: policy.condition.operator, fraudThreshold: policy.condition.fraudThreshold,
      amlThreshold: policy.condition.amlThreshold, lifecycle: policy.condition.lifecycle },
    catalogVersion: policy.catalogVersion, engineVersion: policy.engineVersion };
  return 'sha256:' + createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export function createPolicyWorkspace() {
  const policy = { id: 'POL-SYN-03', version: 3, namespace: 'risk-demo', currency: 'LAK', state: 'approved',
    condition: { operator: 'amount_gte', fraudThreshold: '1000000.00', amlThreshold: '200000.00', lifecycle: 'completed' },
    catalogVersion: 'DEMO-CATALOG-01', engineVersion: 'DEMO-TYPED-EVALUATOR-01' };
  return { policies: [{ ...policy, hash: policyHash(policy) }], bindings: [{ policyId: policy.id }] };
}
