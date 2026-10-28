import { MonitoringInputError, type MonitoringSession } from './monitoring.js';

export interface NetworkQuery {
  root: string | null; direction: 'both' | 'outbound' | 'inbound'; max_hops: number; max_nodes: number; max_edges: number;
}
export interface NetworkTransfer {
  record_key: string; namespace: string; transaction_id: string; revision_number: number;
  currency: string; net_amount: string; occurred_at: string | null;
  sender: string | null; receiver: string | null;
  reason: 'NO_BOUND_ASSESSMENT' | 'IDENTITY_UNVERIFIED' | 'TARGET_NOT_IN_HISTORY' | 'CONTEXT_CONFLICT' | 'NO_EXECUTED_VALUE' | null;
}
export interface NetworkNode { id: string; namespace: string; label: string; identity: 'synthetic_declared' }
export interface NetworkAmount { currency: string; net_amount: string; transactions: number }
export interface NetworkEdge { id: string; source: string; target: string; transactions: number; amounts: NetworkAmount[]; record_keys: string[] }
export interface MonitoringNetwork extends MonitoringSession {
  network_version: 'local-network-1'; query: NetworkQuery;
  roots: NetworkNode[]; nodes: NetworkNode[]; edges: NetworkEdge[]; transfers: NetworkTransfer[]; excluded: NetworkTransfer[];
  counts: { scope_transactions: number; eligible_transactions: number; unresolved: number; non_flow: number; displayed_transactions: number; reachable_nodes: number; reachable_edges: number };
  amounts: NetworkAmount[];
  limits: { node_limited: boolean; edge_limited: boolean; hop_limited: boolean };
}
export function parseNetworkQuery(input: unknown): NetworkQuery {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new MonitoringInputError();
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some(key => !['root', 'direction', 'max_hops', 'max_nodes', 'max_edges'].includes(key))
    || Object.values(value).some(item => typeof item !== 'string' || !item || item.trim() !== item)) throw new MonitoringInputError();
  const root = value.root ?? null, direction = value.direction ?? 'both';
  const integer = (key: string, fallback: number, minimum: number, maximum: number) => {
    const raw = value[key] ?? String(fallback);
    if (typeof raw !== 'string' || !/^[1-9][0-9]*$/.test(raw) || Number(raw) < minimum || Number(raw) > maximum) throw new MonitoringInputError();
    return Number(raw);
  };
  if (root !== null && (typeof root !== 'string' || !/^node_[a-f0-9]{64}$/.test(root))
    || !['both', 'outbound', 'inbound'].includes(direction as string)) throw new MonitoringInputError();
  return { root: root as string | null, direction: direction as NetworkQuery['direction'], max_hops: integer('max_hops', 2, 1, 3),
    max_nodes: integer('max_nodes', 24, 2, 40), max_edges: integer('max_edges', 40, 1, 80) };
}
