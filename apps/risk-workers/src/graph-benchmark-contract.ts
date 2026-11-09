import { createHash } from 'node:crypto';
import type { RiskEvent, RiskTarget } from '@lmps/contracts/transaction-risk';

export const GRAPH_VERSION = 'local_synthetic_graph_v1' as const;
export const GRAPH_CAPS = Object.freeze({ records: 2000, queries: 8, nodes: 256, edges: 1024, hops: 4, paths: 5000, bytes: 2097152 });
export const GRAPH_SEMANTICS = Object.freeze({
  revision: 'Select highest revision per namespace/transaction at source_position <= prefix and available_at <= as_of, before window filtering. Exact revision replay deduplicates; changed payload at the same revision rejects globally.',
  lifecycle: 'Only succeeded and partially_reversed positive amount-minus-reversed_amount contribute. Revisions replace rather than add.',
  window: '(anchor_at minus 3600 seconds, anchor_at]; availability independently bounded by as_of and prefix.',
  identity: 'Identity is (namespace, declared handle), never masked-string linkage. Unverified identity or incomplete history is unavailable, never fabricated zero.',
  traversal: 'Enumerate from every selected node, not just the target sender. Fan-in/out count distinct positive-net counterparties per node. Strictly increasing occurred_at; paths have distinct nodes; cycles repeat only the starting node on the last edge. Count each emitted prefix including cycle closure as one path state. Exceeding any bound returns unavailable with no partial observations.',
  witness: 'Depth-first enumeration over edges sorted by occurred_at, namespace, transaction_id, revision_number using code-point ordering. Witness is an ordered list of edge targets; never evidence of the same funds.',
  comparison: 'Existing TS overlap only: small complete single-revision succeeded fan-in/out and strict-time chain/cycle fixtures. Equal-time, corrections, lifecycle, identity/history and budget-divergent cases unsupported. Emitted path-state budget is separate from existing TS edge-inspection budget; no reference or threshold changes.',
  scope: 'Finite synthetic evidence only; no production capacity, accuracy, enforcement or P05-05/P05-06 completion. Source/identity/masking, history, policy/legal, workload/SLO and adoption gates open. Neo4j/GDS untested.'
});
export interface Delivery { source_position: number; event: RiskEvent }
export interface GraphQuery { id: string; namespace: string; target: RiskTarget; currency: string; as_of: string; anchor_at: string; source_prefix: number; window_seconds: 3600; max_hops: number; identity_status: 'synthetic_declared' | 'unverified'; coverage: { start: string; complete: boolean } }
export interface GraphCorpus { version: typeof GRAPH_VERSION; mode: 'local_synthetic'; corpus_id: string; workspace_key: 'synthetic_local'; deliveries: Delivery[]; queries: GraphQuery[] }
export interface GraphWitness { edges: RiskTarget[] }
export interface GraphObservation {
  corpus_sha256: string; query_sha256: string; semantics_sha256: string;
  availability: GraphAvailability; currency: string; namespace: string; source_prefix: number;
  coverage: GraphQuery['coverage']; truncated: boolean;
  /** Null when unavailable; an available empty graph has explicit zero counts. */
  metrics: null | { nodes: number; edges: number; emitted_path_states: number; net_cents: string; fan_in: { handle: string; count: number }[]; fan_out: { handle: string; count: number }[]; paths: GraphWitness[]; cycles: GraphWitness[] };
}
export type GraphAvailability = { status: 'available' } | { status: 'unavailable'; reason: 'identity_unverified' | 'history_incomplete' | 'target_unavailable' | 'budget_exceeded' };
function check(v: unknown): asserts v { if (!v) throw new Error('GRAPH_CONTRACT_INVALID'); }
function keys(x: object, expected: string) { check(x && typeof x === 'object' && !Array.isArray(x)); check(Object.keys(x).sort().join(',') === expected.split(',').sort().join(',')); }
function int(x: number, min: number, max: number) { check(Number.isSafeInteger(x) && x >= min && x <= max); }
function id(x: string) { check(typeof x === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(x)); }
function ns(x: string) { check(typeof x === 'string' && /^synthetic_[a-z0-9_]{1,40}$/.test(x)); }
function time(x: string) { check(typeof x === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.000Z$/.test(x) && Number.isFinite(Date.parse(x)) && new Date(x).toISOString() === x); }
export function graphCents(x: string): bigint { check(typeof x === 'string' && /^(0|[1-9][0-9]{0,21})\.[0-9]{2}$/.test(x)); return BigInt(x.replace('.', '')); }
/** Descriptor detach never invokes getters/toJSON. Limits apply before native IO. */
function detach(value: unknown): unknown {
  const active = new Set<object>(); let size = 0;
  function walk(x: unknown, depth: number): unknown {
    check(depth <= 16);
    if (x === null || typeof x !== 'object') { check(x === null || typeof x === 'string' || typeof x === 'boolean' || typeof x === 'number' && Number.isFinite(x)); size += Buffer.byteLength(JSON.stringify(x)); check(size <= GRAPH_CAPS.bytes); return x; }
    check(!active.has(x)); active.add(x); const array = Array.isArray(x);
    check(Object.getPrototypeOf(x) === (array ? Array.prototype : Object.prototype)); check(Reflect.ownKeys(x).every(k => typeof k === 'string'));
    if (array) check((x as unknown[]).length <= GRAPH_CAPS.records);
    const out: Record<string, unknown> | unknown[] = array ? [] : {};
    for (const [k, d] of Object.entries(Object.getOwnPropertyDescriptors(x))) {
      if (array && k === 'length') continue; check('value' in d && d.enumerable);
      if (array) check(/^(0|[1-9][0-9]*)$/.test(k) && Number(k) < (x as unknown[]).length);
      size += Buffer.byteLength(JSON.stringify(k)) + 2; check(size <= GRAPH_CAPS.bytes);
      Object.defineProperty(out, k, { value: walk(d.value, depth + 1), enumerable: true, writable: true, configurable: true });
    }
    if (array) check(Object.keys(out).length === (x as unknown[]).length); active.delete(x); return out;
  }
  return walk(value, 0);
}
function canonical(x: unknown): string { return JSON.stringify(x, (_k, v: unknown) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : v); }
function freeze<T>(x: T): T { if (x && typeof x === 'object') { Object.values(x).forEach(freeze); Object.freeze(x); } return x; }
function target(x: RiskTarget) { keys(x, 'namespace,transaction_id,revision_number'); ns(x.namespace); id(x.transaction_id); int(x.revision_number, 1, 2147483647); }
// Reuse RiskEvent/RiskTarget types and compatible lexical domains. The existing
// runtime validator accepts only full detector requests (200 events), not this
// positioned 2000-delivery protocol, and initializes AJV at import time.
export function validateGraphCorpus(input: unknown): Readonly<GraphCorpus> {
  const x = detach(input) as GraphCorpus; keys(x, 'version,mode,corpus_id,workspace_key,deliveries,queries');
  check(x.version === GRAPH_VERSION && x.mode === 'local_synthetic' && x.workspace_key === 'synthetic_local'); id(x.corpus_id);
  check(Array.isArray(x.deliveries) && Array.isArray(x.queries)); int(x.deliveries.length, 0, GRAPH_CAPS.records); int(x.queries.length, 1, GRAPH_CAPS.queries);
  const revisions = new Map<string, string>(); let position = 0;
  for (const d of x.deliveries) {
    keys(d, 'source_position,event'); int(d.source_position, position + 1, 2147483647); position = d.source_position;
    const e = d.event; keys(e, 'namespace,transaction_id,revision_number,sender,receiver,occurred_at,available_at,currency,amount,status,reversed_amount');
    target({ namespace: e.namespace, transaction_id: e.transaction_id, revision_number: e.revision_number });
    for (const h of [e.sender, e.receiver]) check(typeof h === 'string' && /^synthetic_[A-Za-z0-9_.:-]{1,70}$/.test(h));
    time(e.occurred_at); time(e.available_at); check(typeof e.currency === 'string' && /^[A-Z]{3}$/.test(e.currency));
    const amount = graphCents(e.amount), reversed = graphCents(e.reversed_amount); check(reversed <= amount);
    check(['pending', 'succeeded', 'failed', 'partially_reversed', 'reversed'].includes(e.status));
    check(e.status === 'partially_reversed' ? reversed > 0n && reversed < amount : e.status === 'reversed' ? reversed === amount : reversed === 0n);
    const key = canonical([e.namespace, e.transaction_id, e.revision_number]), payload = canonical(e); check(!revisions.has(key) || revisions.get(key) === payload); revisions.set(key, payload);
  }
  const ids = new Set<string>();
  for (const q of x.queries) {
    keys(q, 'id,namespace,target,currency,as_of,anchor_at,source_prefix,window_seconds,max_hops,identity_status,coverage'); id(q.id); check(!ids.has(q.id)); ids.add(q.id); ns(q.namespace); target(q.target); check(q.namespace === q.target.namespace);
    check(typeof q.currency === 'string' && /^[A-Z]{3}$/.test(q.currency)); time(q.as_of); time(q.anchor_at); check(q.anchor_at <= q.as_of); int(q.source_prefix, 0, 2147483647); check(q.window_seconds === 3600); int(q.max_hops, 1, GRAPH_CAPS.hops);
    check(['synthetic_declared', 'unverified'].includes(q.identity_status)); keys(q.coverage, 'start,complete'); time(q.coverage.start); check(typeof q.coverage.complete === 'boolean');
  }
  check(Buffer.byteLength(canonical(x)) <= GRAPH_CAPS.bytes); return freeze(x);
}
export function parseGraphCorpus(text: string): Readonly<GraphCorpus> { check(typeof text === 'string' && Buffer.byteLength(text) <= GRAPH_CAPS.bytes); return validateGraphCorpus(JSON.parse(text)); }
export function graphIdentity(input: unknown): string { return createHash('sha256').update(canonical(validateGraphCorpus(input))).digest('hex'); }
export function graphQueryIdentity(input: unknown, queryId: string): string {
  const corpus = validateGraphCorpus(input), query = corpus.queries.find(q => q.id === queryId); check(query);
  return createHash('sha256').update(canonical({ corpus_sha256: graphIdentity(corpus), query, semantics: GRAPH_SEMANTICS })).digest('hex');
}
export function graphSemanticsIdentity(): string { return createHash('sha256').update(canonical(GRAPH_SEMANTICS)).digest('hex'); }
export function graphNodeIdentity(namespace: string, handle: string): string { ns(namespace); check(typeof handle === 'string' && /^synthetic_[A-Za-z0-9_.:-]{1,70}$/.test(handle)); return canonical([namespace, handle]); }
export function graphBudget(counts: { nodes: number; edges: number; hops: number; paths: number }): GraphAvailability {
  counts = detach(counts) as typeof counts;
  keys(counts, 'nodes,edges,hops,paths'); for (const k of ['nodes', 'edges', 'hops', 'paths'] as const) int(counts[k], 0, Number.MAX_SAFE_INTEGER);
  return Object.entries(counts).some(([k, n]) => n > GRAPH_CAPS[k as keyof typeof counts]) ? { status: 'unavailable', reason: 'budget_exceeded' } : { status: 'available' };
}
/** Eligibility selection only. Candidate observations must be independently computed. */
export function selectGraph(input: unknown, queryId: string) {
  const corpus = validateGraphCorpus(input), q = corpus.queries.find(q => q.id === queryId); check(q);
  const unavailable = (reason: Exclude<GraphAvailability, { status: 'available' }>['reason']) => freeze({ status: 'unavailable' as const, reason, query: q, edges: [] as RiskEvent[] });
  if (q.identity_status !== 'synthetic_declared') return unavailable('identity_unverified');
  const start = Date.parse(q.anchor_at) - 3600000;
  if (!q.coverage.complete || Date.parse(q.coverage.start) > start) return unavailable('history_incomplete');
  const latest = new Map<string, RiskEvent>();
  for (const d of corpus.deliveries) { const e = d.event; if (d.source_position > q.source_prefix || e.available_at > q.as_of || e.namespace !== q.namespace) continue; const previous = latest.get(e.transaction_id); if (!previous || previous.revision_number < e.revision_number) latest.set(e.transaction_id, e); }
  const t = latest.get(q.target.transaction_id); if (!t || t.revision_number !== q.target.revision_number || t.currency !== q.currency) return unavailable('target_unavailable');
  const edges = [...latest.values()].filter(e => e.currency === q.currency && Date.parse(e.occurred_at) > start && e.occurred_at <= q.anchor_at && ['succeeded', 'partially_reversed'].includes(e.status) && graphCents(e.amount) > graphCents(e.reversed_amount)).sort((a, b) => a.occurred_at < b.occurred_at ? -1 : a.occurred_at > b.occurred_at ? 1 : a.transaction_id < b.transaction_id ? -1 : a.transaction_id > b.transaction_id ? 1 : a.revision_number - b.revision_number);
  const nodes = new Set(edges.flatMap(e => [e.sender, e.receiver])); if (graphBudget({ nodes: nodes.size, edges: edges.length, hops: q.max_hops, paths: 0 }).status !== 'available') return unavailable('budget_exceeded');
  return freeze({ status: 'available' as const, query: q, edges });
}
