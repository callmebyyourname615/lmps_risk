import type { RiskCode, RiskEvent, RiskObservation, RiskTarget, TransactionRiskRequest } from '@lmps/contracts/transaction-risk';
import { RISK_CATALOG } from './catalog.js';
import { cents, netAmount, paymentKey, revisionKey, riskTarget, RiskError } from './index.js';

interface Feature { value?: bigint; refs: RiskTarget[]; reason?: string; notApplicable?: boolean }
export function calculateRiskFeatures(request: TransactionRiskRequest, observation: RiskObservation): Record<RiskCode, Feature> {
  const result = RISK_CATALOG.reduce((values, entry) => { values[entry.code] = { refs: [] }; return values; }, {} as Record<RiskCode, Feature>);
  const all = (reason: string, notApplicable = false) => { for (const entry of RISK_CATALOG) result[entry.code] = { refs: [], reason, notApplicable }; return result; };
  if (observation.status !== 'available') return all({ missing: 'INPUT_MISSING', invalid: 'INPUT_INVALID', not_normalized: 'INPUT_NOT_NORMALIZED' }[observation.status]);
  const policy = request.policy; if (!policy) return result;
  if (observation.currency !== policy.currency) return all('CURRENCY_OUT_OF_SCOPE', true);
  const net = netAmount({ amount: observation.amount!, reversed_amount: observation.reversed_amount!, status: observation.transaction_status! });
  if (net <= 0n) return all('TRANSACTION_NOT_EXECUTED', true);
  const set = (code: RiskCode, value: bigint, events: RiskEvent[] = []) => { result[code] = { value, refs: events.length ? events.map(riskTarget) : [request.target] }; };
  set('FRAUD_HIGH_AMOUNT', net);
  const context = request.context;
  const rest = (reason: string) => { for (const entry of RISK_CATALOG.filter(e => e.requires.length)) result[entry.code] = { refs: [], reason }; return result; };
  if (!context) return rest('CONTEXT_NOT_PROVIDED');
  if (context.identity_status !== 'synthetic_declared') return rest('IDENTITY_UNVERIFIED');
  const available = context.events.filter(e => Date.parse(e.available_at) <= Date.parse(context.as_of));
  const latest = new Map<string, RiskEvent>();
  for (const event of available) {
    const key = paymentKey(event), previous = latest.get(key);
    if (!previous || previous.revision_number < event.revision_number) latest.set(key, event);
  }
  const target = latest.get(paymentKey(request.target));
  if (!target) return rest('TARGET_NOT_IN_HISTORY');
  if (revisionKey(target) !== revisionKey(request.target) || target.amount !== observation.amount || target.reversed_amount !== observation.reversed_amount
    || target.currency !== observation.currency || target.status !== observation.transaction_status) throw new RiskError('RISK_CONTEXT_CONFLICT');
  const end = Date.parse(target.occurred_at), window = policy.window_seconds * 1000, start = end - window;
  const baselineStart = start - window * policy.baseline_windows;
  if (!context.coverage_complete || Date.parse(context.coverage_start) > start) return rest('HISTORY_INCOMPLETE');
  const active = [...latest.values()].filter(e => e.currency === policy.currency && Date.parse(e.occurred_at) <= end && netAmount(e) > 0n)
    .sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at) || (revisionKey(a) < revisionKey(b) ? -1 : 1));
  const current = active.filter(e => Date.parse(e.occurred_at) > start);
  const outgoing = current.filter(e => e.sender === target.sender), incoming = current.filter(e => e.receiver === target.sender && Date.parse(e.occurred_at) < end && e.sender !== target.sender);
  const receiverIncoming = current.filter(e => e.receiver === target.receiver);
  const sum = (events: RiskEvent[]) => events.reduce((total, e) => total + netAmount(e), 0n);
  const count = (values: string[]) => BigInt(new Set(values).size);
  set('FRAUD_COUNT_VELOCITY', BigInt(outgoing.length), outgoing);
  set('FRAUD_AMOUNT_VELOCITY', sum(outgoing), outgoing);
  set('MULE_FAN_IN', count(receiverIncoming.map(e => e.sender)), receiverIncoming);
  set('MULE_FAN_OUT', count(outgoing.map(e => e.receiver)), outgoing);
  const received = sum(incoming);
  if (received >= cents(policy.minimum_amount) && incoming.length) {
    const forwarded = outgoing.filter(e => Date.parse(e.occurred_at) > Date.parse(incoming[0]!.occurred_at));
    set('MULE_RAPID_PASS_THROUGH', sum(forwarded) * 10000n / received, [...incoming, ...forwarded]);
  } else result.MULE_RAPID_PASS_THROUGH = { refs: [], reason: 'PATTERN_OUT_OF_SCOPE', notApplicable: true };
  const ceiling = cents(policy.structuring_ceiling), floor = ceiling * BigInt(policy.near_threshold_bps) / 10000n;
  const clustered = outgoing.filter(e => netAmount(e) >= floor && netAmount(e) < ceiling);
  if (net >= floor && net < ceiling) set('AML_STRUCTURING_PATTERN', sum(clustered) >= ceiling ? BigInt(clustered.length) : 0n, clustered);
  else result.AML_STRUCTURING_PATTERN = { refs: [], reason: 'PATTERN_OUT_OF_SCOPE', notApplicable: true };
  const large = outgoing.filter(e => netAmount(e) >= cents(policy.minimum_amount));
  if (net >= cents(policy.minimum_amount)) set('AML_REPEATED_HIGH_VALUE', BigInt(large.length), large);
  else result.AML_REPEATED_HIGH_VALUE = { refs: [], reason: 'PATTERN_OUT_OF_SCOPE', notApplicable: true };
  if (context.flagged_accounts) {
    const neighbors = current.filter(e => e.sender === target.sender || e.receiver === target.sender || e.sender === target.receiver || e.receiver === target.receiver);
    const flags = new Set(context.flagged_accounts), accounts = neighbors.flatMap(e => [e.sender, e.receiver]).filter(a => a !== target.sender && a !== target.receiver);
    // The target's counterparties themselves also count when explicitly flagged.
    accounts.push(target.sender, target.receiver);
    set('MULE_FLAGGED_NEIGHBOR', count(accounts.filter(a => flags.has(a))), neighbors);
  } else result.MULE_FLAGGED_NEIGHBOR = { refs: [], reason: 'FLAGS_UNAVAILABLE' };
  if (Date.parse(context.coverage_start) <= baselineStart) {
    const baseline = active.filter(e => e.sender === target.sender && Date.parse(e.occurred_at) > baselineStart && Date.parse(e.occurred_at) <= start);
    const prior = active.filter(e => e.sender === target.sender && e.receiver === target.receiver && Date.parse(e.occurred_at) > baselineStart && Date.parse(e.occurred_at) < end && paymentKey(e) !== paymentKey(target));
    set('FRAUD_NEW_COUNTERPARTY', prior.length ? 0n : 1n, prior.length ? [...prior, target] : [target]);
    const total = sum(baseline);
    if (total > 0n) set('FRAUD_AMOUNT_DEVIATION', net * BigInt(baseline.length) * 10000n / total, [...baseline, target]);
    else result.FRAUD_AMOUNT_DEVIATION = { refs: [], reason: 'BASELINE_UNAVAILABLE' };
    if (baseline.length) set('FRAUD_FREQUENCY_DEVIATION', BigInt(outgoing.length * policy.baseline_windows) * 10000n / BigInt(baseline.length), [...baseline, ...outgoing]);
    else result.FRAUD_FREQUENCY_DEVIATION = { refs: [], reason: 'BASELINE_UNAVAILABLE' };
    let breadth = 0;
    for (let i = 0; i < policy.baseline_windows; i++) breadth += new Set(baseline.filter(e => Date.parse(e.occurred_at) > start - window * (i + 1) && Date.parse(e.occurred_at) <= start - window * i).map(e => e.receiver)).size;
    if (breadth) set('AML_NETWORK_DEVIATION', count(outgoing.map(e => e.receiver)) * BigInt(policy.baseline_windows) * 10000n / BigInt(breadth), [...baseline, ...outgoing]);
    else result.AML_NETWORK_DEVIATION = { refs: [], reason: 'BASELINE_UNAVAILABLE' };
  } else for (const code of ['FRAUD_NEW_COUNTERPARTY', 'FRAUD_AMOUNT_DEVIATION', 'FRAUD_FREQUENCY_DEVIATION', 'AML_NETWORK_DEVIATION'] as const) result[code] = { refs: [], reason: 'HISTORY_INCOMPLETE' };
  // shortcut: bounded reference graph, not a stream processor; benchmark/select an engine before online deployment.
  const edges = current.filter(e => paymentKey(e) !== paymentKey(target) && e.sender !== e.receiver && Date.parse(e.occurred_at) < end);
  const search = (cycle: boolean): Feature => {
    let work = 0, best: RiskEvent[] = [target];
    const visit = (node: string, before: number, path: RiskEvent[], seen: Set<string>) => {
      for (const edge of edges) {
        if (++work > 5000) throw new Error();
        if (edge.receiver !== node || Date.parse(edge.occurred_at) >= before) continue;
        const next = [edge, ...path];
        if (cycle && edge.sender === target.receiver) { if (next.length > best.length) best = next; continue; }
        if (seen.has(edge.sender)) continue;
        if (!cycle && next.length > best.length) best = next;
        if (next.length < policy.graph_depth) visit(edge.sender, Date.parse(edge.occurred_at), next, new Set([...seen, edge.sender]));
      }
    };
    try {
      if (target.sender !== target.receiver) visit(target.sender, end, [target], new Set([target.sender, target.receiver]));
      return { value: cycle && best.length === 1 ? 0n : BigInt(best.length), refs: best.map(riskTarget) };
    } catch { return { reason: 'GRAPH_LIMIT_EXCEEDED', refs: [] }; }
  };
  result.MULE_NETWORK_CYCLE = search(true); result.AML_MULTI_HOP_FLOW = search(false);
  return result;
}
