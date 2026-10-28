import { createHash } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import type { MonitoringReadSnapshot, MonitoringSession } from '@lmps/contracts/monitoring';
import type { NetworkAmount, NetworkEdge, NetworkNode, NetworkQuery, NetworkTransfer, MonitoringNetwork } from '@lmps/contracts/monitoring-network';

const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const key = (prefix: string, values: string[]) => prefix + createHash('sha256').update(JSON.stringify(values)).digest('hex');
function amounts(transfers: NetworkTransfer[]): NetworkAmount[] {
  const totals = new Map<string, { amount: bigint; transactions: number }>();
  for (const transfer of transfers) {
    const prior = totals.get(transfer.currency) ?? { amount: 0n, transactions: 0 };
    prior.amount += BigInt(transfer.net_amount.replace('.', '')); prior.transactions++;
    totals.set(transfer.currency, prior);
  }
  return [...totals].sort(([left], [right]) => compare(left, right)).map(([currency, total]) => ({ currency,
    net_amount: `${total.amount / 100n}.${String(total.amount % 100n).padStart(2, '0')}`, transactions: total.transactions }));
}
export function selectMonitoringNetwork(payload: MonitoringReadSnapshot, session: MonitoringSession, query: NetworkQuery): MonitoringNetwork {
  const transfers = payload.network ?? payload.transactions.map(record => ({ record_key: record.record_key, namespace: record.namespace,
    transaction_id: record.transaction_id, revision_number: record.revision_number, currency: record.currency, net_amount: '0.00',
    occurred_at: null, sender: null, receiver: null, reason: 'IDENTITY_UNVERIFIED' as const }));
  const eligible = transfers.filter(transfer => transfer.reason === null && transfer.sender !== null && transfer.receiver !== null);
  const excluded = transfers.filter(transfer => transfer.reason !== null);
  const nodes = new Map<string, NetworkNode>(), grouped = new Map<string, { source: string; target: string; transfers: NetworkTransfer[] }>();
  for (const transfer of eligible) {
    const source = key('node_', [transfer.namespace, transfer.sender!]), target = key('node_', [transfer.namespace, transfer.receiver!]);
    for (const [id, label] of [[source, transfer.sender!], [target, transfer.receiver!]]) nodes.set(id!, { id: id!, label: label!, namespace: transfer.namespace, identity: 'synthetic_declared' });
    const id = key('edge_', [source, target]), group = grouped.get(id) ?? { source, target, transfers: [] };
    group.transfers.push(transfer); grouped.set(id, group);
  }
  const roots = [...nodes.values()].sort((left, right) => compare(left.namespace, right.namespace) || compare(left.label, right.label));
  if (query.root && !nodes.has(query.root)) throw new BadRequestException({ code: 'MONITORING_INVALID_QUERY' });
  const allEdges: NetworkEdge[] = [...grouped].map(([id, group]) => ({ id, source: group.source, target: group.target,
    transactions: group.transfers.length, amounts: amounts(group.transfers), record_keys: group.transfers.map(transfer => transfer.record_key).sort(compare) }))
    .sort((left, right) => compare(left.id, right.id));
  const neighbor = (edge: NetworkEdge, node: string) => edge.source === node && query.direction !== 'inbound' ? edge.target
    : edge.target === node && query.direction !== 'outbound' ? edge.source : null;
  const distance = new Map<string, number>(), queue: string[] = [];
  if (query.root) { distance.set(query.root, 0); queue.push(query.root); }
  else for (const node of roots) { distance.set(node.id, 0); queue.push(node.id); }
  let hopLimited = false;
  if (query.root) for (let index = 0; index < queue.length; index++) {
    const current = queue[index]!, depth = distance.get(current)!;
    for (const edge of allEdges) {
      const next = neighbor(edge, current);
      if (!next || distance.has(next)) continue;
      if (depth >= query.max_hops) continue;
      distance.set(next, depth + 1); queue.push(next);
    }
  }
  if (query.root) hopLimited = queue.some(node => distance.get(node) === query.max_hops && allEdges.some(edge => {
    const next = neighbor(edge, node); return next !== null && !distance.has(next);
  }));
  const reachableEdges = allEdges.filter(edge => distance.has(edge.source) && distance.has(edge.target) && (!query.root
    || query.direction !== 'inbound' && distance.get(edge.source)! < query.max_hops
    || query.direction !== 'outbound' && distance.get(edge.target)! < query.max_hops));
  const selectedNodes = new Set(queue.slice(0, query.max_nodes));
  const boundedEdges = reachableEdges.filter(edge => selectedNodes.has(edge.source) && selectedNodes.has(edge.target));
  const edges = boundedEdges.slice(0, query.max_edges), records = new Set(edges.flatMap(edge => edge.record_keys));
  const displayed = eligible.filter(transfer => records.has(transfer.record_key));
  return { ...session, network_version: 'local-network-1', query, roots, nodes: queue.slice(0, query.max_nodes).map(id => nodes.get(id)!), edges,
    transfers: displayed, excluded, amounts: amounts(displayed),
    counts: { scope_transactions: transfers.length, eligible_transactions: eligible.length, unresolved: excluded.filter(transfer => transfer.reason !== 'NO_EXECUTED_VALUE').length,
      non_flow: excluded.filter(transfer => transfer.reason === 'NO_EXECUTED_VALUE').length, displayed_transactions: displayed.length,
      reachable_nodes: distance.size, reachable_edges: reachableEdges.length },
    limits: { node_limited: distance.size > query.max_nodes, edge_limited: boundedEdges.length > query.max_edges, hop_limited: hopLimited } };
}
