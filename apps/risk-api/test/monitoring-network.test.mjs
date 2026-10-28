import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { overviewFixture } from './fixtures/overview.mjs';
import { parseNetworkQuery } from '@lmps/contracts/monitoring-network';
import { parseMonitoringFilters } from '@lmps/contracts/monitoring';
import { readMonitoringSnapshot } from '@lmps/database';
import { selectMonitoringNetwork } from '../dist/monitoring-network.js';
import { MonitoringSnapshots } from '../dist/monitoring-snapshots.js';
import { transactionRiskFixture } from '../../../packages/database/test/fixtures/transaction-risk.mjs';
import { publicationTransaction } from '@lmps/contracts/synthetic-publication';
import { riskHash } from '@lmps/risk';

let fixture;
const scopes = 'transactions:read risk:read alerts:read';
before(async () => { fixture = await overviewFixture(); });
after(async () => { await fixture?.close(); });
const get = async (path, claims = {}) => fixture.app.inject({ method: 'GET', url: '/v1/local/monitoring/' + path,
  headers: { authorization: 'Bearer ' + await fixture.token({ scope: scopes, ...claims }) } });
async function capture() { const response = await get('snapshots'); assert.equal(response.statusCode, 200, response.body); return response.json(); }
async function graph(id, query = '') { const response = await get(`snapshots/${id}/network${query}`); assert.equal(response.statusCode, 200, response.body); return response.json(); }
test('network uses six current bound targets, not all history or duplicate assessment runs; every transfer opens the pinned evidence', async () => {
  const session = await capture(), network = await graph(session.snapshot_id);
  assert.deepEqual(network.summary, session.summary);
  assert.deepEqual(network.counts, { scope_transactions: 48, eligible_transactions: 6, unresolved: 42, non_flow: 0, displayed_transactions: 6, reachable_nodes: 2, reachable_edges: 1 });
  assert.equal(network.edges[0].transactions, 6);
  assert.deepEqual(network.amounts, [{ currency: 'SYN', net_amount: '5400.00', transactions: 6 }]);
  assert.ok(network.nodes.every(node => node.identity === 'synthetic_declared'));
  assert.ok(!JSON.stringify(network).includes('flagged_accounts'));
  for (const transfer of network.transfers) {
    const response = await get(`snapshots/${session.snapshot_id}/evidence?record=${transfer.record_key}`);
    assert.equal(response.statusCode, 200, response.body);
    const evidence = response.json().evidence;
    assert.equal(evidence.record.namespace, transfer.namespace); assert.equal(evidence.record.transaction_id, transfer.transaction_id);
    assert.equal(evidence.record.revision_number, transfer.revision_number); assert.ok(evidence.record.risk.run_id);
    assert.equal(transfer.occurred_at, '2026-01-01T12:00:00.000Z'); assert.equal(evidence.occurred_at, null);
  }
  assert.ok(network.excluded.some(transfer => transfer.transaction_id === fixture.entries[0].id && transfer.revision_number === 2));
});
test('same labels in separate namespaces never join; directed traversal, self-loops, exact currency sums and every graph bound are deterministic', async () => {
  const payload = await readMonitoringSnapshot(fixture.owner.pool, 'synthetic_local', parseMonitoringFilters({}));
  const transfer = (id, sender, receiver, namespace = 'synthetic_one', currency = 'USD', net_amount = '0.10') => ({ record_key: id, namespace, transaction_id: id,
    revision_number: 1, currency, net_amount, occurred_at: null, sender: 'synthetic_' + sender, receiver: 'synthetic_' + receiver, reason: null });
  payload.network = [transfer('001', 'A', 'B'), transfer('002', 'A', 'B', 'synthetic_one', 'USD', '0.20'),
    transfer('003', 'A', 'B', 'synthetic_one', 'LAK', '9999999999999999999999.99'), transfer('004', 'B', 'C'), transfer('005', 'C', 'D'),
    transfer('006', 'D', 'E'), transfer('007', 'B', 'B'), transfer('008', 'A', 'B', 'synthetic_two')];
  const session = { snapshot_id: randomUUID(), summary: payload.summary }, all = selectMonitoringNetwork(payload, session, parseNetworkQuery({}));
  assert.equal(all.nodes.length, 7); assert.equal(all.edges.length, 6); assert.equal(all.transfers.length, 8);
  const edge = all.edges.find(edge => edge.transactions === 3);
  assert.deepEqual(edge.amounts, [{ currency: 'LAK', net_amount: '9999999999999999999999.99', transactions: 1 }, { currency: 'USD', net_amount: '0.30', transactions: 2 }]);
  const root = all.nodes.find(node => node.label === 'synthetic_A' && node.namespace === 'synthetic_one').id;
  const outbound = selectMonitoringNetwork(payload, session, parseNetworkQuery({ root, direction: 'outbound', max_hops: '1' }));
  assert.equal(outbound.nodes.length, 2); assert.equal(outbound.edges.length, 1); assert.equal(outbound.transfers.length, 3); assert.equal(outbound.limits.hop_limited, true);
  const inbound = selectMonitoringNetwork(payload, session, parseNetworkQuery({ root, direction: 'inbound' }));
  assert.equal(inbound.nodes.length, 1); assert.equal(inbound.transfers.length, 0);
  const bounded = selectMonitoringNetwork(payload, session, parseNetworkQuery({ root, max_hops: '3', max_nodes: '2', max_edges: '1' }));
  assert.equal(bounded.nodes[0].id, root); assert.equal(bounded.nodes.length, 2); assert.equal(bounded.edges.length, 1);
  assert.equal(bounded.limits.node_limited, true); assert.equal(bounded.limits.edge_limited, true);
  assert.deepEqual(selectMonitoringNetwork(payload, session, parseNetworkQuery({})), all);
  assert.ok(bounded.edges.every(edge => bounded.nodes.some(node => node.id === edge.source) && bounded.nodes.some(node => node.id === edge.target)));
});
test('all graph queries reject malformed, duplicate, excessive and tenant-supplied coordinates', async () => {
  const session = await capture();
  for (const query of ['?max_hops=0', '?max_hops=4', '?max_hops=01', '?max_hops=1&max_hops=2', '?max_nodes=41', '?max_nodes=1', '?max_edges=81', '?max_edges=0', '?direction=sideways', '?root=__proto__', '?workspace_key=synthetic_other', '?as_of=2026-01-01']) {
    const response = await get(`snapshots/${session.snapshot_id}/network${query}`); assert.equal(response.statusCode, 400, query);
  }
  assert.equal((await get(`snapshots/${session.snapshot_id}/network?root=node_${'a'.repeat(64)}`)).statusCode, 400);
});
test('network rechecks scopes and owner; foreign principals and expiry reveal no graph', async () => {
  const session = await capture();
  for (const missing of scopes.split(' ')) assert.equal((await get(`snapshots/${session.snapshot_id}/network`, { scope: scopes.split(' ').filter(scope => scope !== missing).join(' ') })).statusCode, 403);
  for (const claims of [{ sub: 'synthetic_other_reader' }, { workspace_key: 'synthetic_other' }]) {
    const response = await get(`snapshots/${session.snapshot_id}/network`, claims); assert.equal(response.statusCode, 410); assert.equal(response.json().nodes, undefined);
  }
  assert.equal((await fixture.app.inject({ method: 'GET', url: `/v1/local/monitoring/snapshots/${session.snapshot_id}/network` })).statusCode, 401);
  let now = Date.now(); const cache = new MonitoringSnapshots(() => now, 1000), principal = { workspace: 'synthetic_local', subject: 'synthetic_reader' };
  const payload = await readMonitoringSnapshot(fixture.owner.pool, principal.workspace, parseMonitoringFilters({})), saved = cache.create(principal, payload);
  now += 1001; assert.throws(() => cache.network(principal, saved.snapshot_id, parseNetworkQuery({})), error => error.getStatus() === 410);
});
test('new unverified history cannot mutate an existing graph or leak account handles; filtered and missing histories remain unresolved', async () => {
  const saved = await capture(), original = await graph(saved.snapshot_id);
  const request = structuredClone(fixture.entries[1].request); request.run_id = randomUUID(); request.context.identity_status = 'unverified';
  request.context.events.forEach(event => { event.sender = 'synthetic_private_unverified'; event.receiver = 'synthetic_private_receiver'; });
  try {
    await fixture.risks.evaluate(request);
    assert.deepEqual(await graph(saved.snapshot_id), original);
    const next = await graph((await capture()).snapshot_id);
    assert.equal(next.counts.eligible_transactions, 5); assert.equal(next.counts.unresolved, 43);
    assert.ok(!JSON.stringify(next).includes('synthetic_private_'));
    const response = await get('snapshots?currency=EUR'), euro = await graph(response.json().snapshot_id);
    assert.equal(euro.counts.scope_transactions, 1); assert.equal(euro.nodes.length, 0); assert.equal(euro.counts.unresolved, 1);
  } finally { await fixture.owner.pool.query('DELETE FROM platform.local_transaction_risks WHERE workspace_key=$1 AND run_id=$2', ['synthetic_local', request.run_id]); }
});
test('partial reversals use only remaining value; failed, pending and fully reversed revisions never add flow; later corrections do not resurrect old edges', async () => {
  const ids = [];
  for (const [suffix, status, reversal, reversed] of [
    ['partial', 'SYNTH_SUCCEEDED', 'SYNTH_REVERSAL_PARTIAL_COMPLETED', '100.00'],
    ['full', 'SYNTH_SUCCEEDED', 'SYNTH_REVERSAL_FULL_COMPLETED', '900.00'],
    ['failed', 'SYNTH_FAILED', 'SYNTH_REVERSAL_NONE', '0.00'],
    ['pending', 'SYNTH_PENDING', 'SYNTH_REVERSAL_NONE', '0.00'],
  ]) {
    const entry = transactionRiskFixture(), id = 'synthetic_network_' + suffix, publication = entry.revision.publication, input = publication.normalization_input;
    ids.push(id); publication.binding.transaction_id = id; input.status_code = status; input.reversal_code = reversal;
    if (reversed !== '0.00') {
      input.synthetic_payment_ref = id;
      input.reversal_evidence = { original_payment_ref: input.synthetic_payment_ref, events: [{ event_ref: 'synthetic_refund_' + suffix, amount: reversed, currency: input.currency, completed: true }] };
    }
    entry.revision.transaction = publicationTransaction(publication).transaction;
    const originalId = entry.request.target.transaction_id;
    entry.request.run_id = randomUUID(); entry.request.target.transaction_id = id; entry.request.context.binding.transaction_id = id;
    entry.request.context.binding.revision_sha256 = riskHash(entry.revision);
    entry.request.context.events = entry.request.context.events.map(event => event.transaction_id === originalId ? { ...event, transaction_id: id,
      status: entry.revision.transaction.transaction_status, reversed_amount: reversed, sender: 'synthetic_reversal_sender', receiver: 'synthetic_reversal_receiver' } : event);
    await fixture.writer.append(entry.revision); await fixture.risks.evaluate(entry.request);
  }
  const captured = await capture(), original = await graph(captured.snapshot_id), partial = original.transfers.find(transfer => transfer.transaction_id === ids[0]);
  assert.equal(partial.net_amount, '800.00');
  assert.ok(ids.slice(1).every(id => original.excluded.some(transfer => transfer.transaction_id === id && transfer.reason === 'NO_EXECUTED_VALUE')));
  const partialRow = (await fixture.owner.pool.query('SELECT payload,publication FROM platform.local_transaction_revisions WHERE workspace_key=$1 AND transaction_id=$2', ['synthetic_local', ids[0]])).rows[0];
  const publication = structuredClone(partialRow.publication); publication.binding.expected_revision = 1; publication.binding.transaction_revision = 'synthetic_network_revision_2';
  const correction = { format: 1, provenance: 'local_synthetic', execution_mode: 'test', workspace_key: 'synthetic_local', expected_revision: 1, publication, transaction: publicationTransaction(publication).transaction };
  await fixture.writer.append(correction);
  assert.deepEqual(await graph(captured.snapshot_id), original);
  const next = await graph((await capture()).snapshot_id);
  assert.ok(!next.transfers.some(transfer => transfer.transaction_id === ids[0]));
  assert.ok(next.excluded.some(transfer => transfer.transaction_id === ids[0] && transfer.revision_number === 2 && transfer.reason === 'NO_BOUND_ASSESSMENT'));
});
