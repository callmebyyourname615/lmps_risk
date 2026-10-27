import { FEATURE_STREAM_VERSION, FeatureStreamError, featureStreamPlanIdentity, validateFeatureStreamPlan,
  validateFeatureStreamDelivery, validateFeatureStreamState, validateFeatureStreamSnapshot,
  type FeatureStreamState, type FeatureStreamQuery, type FeatureStreamSnapshot, type FeatureStreamEvent } from '@lmps/contracts/feature-stream';

const canonical = (value: unknown): string => JSON.stringify(value, (_key, item: unknown) =>
  item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item);
const minor = (value: string): bigint => BigInt(value.replace('.', ''));
const utc = (value: number): string => new Date(value).toISOString().replace('.000Z', 'Z');

/** IO-free initialization; supplied metadata is the only coverage authority. */
export function initializeFeatureStream(config: unknown): FeatureStreamState {
  const plan = validateFeatureStreamPlan(config);
  return validateFeatureStreamState({ version: FEATURE_STREAM_VERSION, plan, next_offset: 0, deliveries: [], snapshots: [] }, plan);
}

function calculate(state: FeatureStreamState, query: FeatureStreamQuery, position: number): FeatureStreamSnapshot {
  const latest = new Map<string, FeatureStreamEvent>();
  for (const { event } of state.deliveries.slice(0, position)) {
    if (event.available_at > query.as_of) continue;
    const previous = latest.get(event.transaction_id);
    if (!previous || event.revision_number > previous.revision_number) latest.set(event.transaction_id, event);
  }
  const target = latest.get(query.target);
  // US-601 requires window endpoints: absent target cannot provide an honest endpoint.
  if (!target) throw new FeatureStreamError();
  const end = Date.parse(target.occurred_at), start = end - 3600000;
  const reason = query.evidence === 'missing' ? 'INPUT_MISSING'
    : !query.coverage_complete || Date.parse(state.plan.coverage_start) > start ? 'HISTORY_INCOMPLETE' : null;
  let count = 0, amount = 0n;
  for (const event of latest.values()) {
    const net = event.status === 'succeeded' || event.status === 'partially_reversed'
      ? minor(event.amount) - minor(event.reversed_amount) : 0n;
    const occurred = Date.parse(event.occurred_at);
    if (event.sender === target.sender && event.currency === query.currency && occurred > start && occurred <= end && net > 0n) {
      count++; amount += net;
    }
  }
  return validateFeatureStreamSnapshot({ version: FEATURE_STREAM_VERSION, plan_identity: featureStreamPlanIdentity(state.plan),
    query, namespace: state.plan.namespace, topic: state.plan.topic, partition: 0, next_offset: position,
    coverage_start: state.plan.coverage_start, window_start: utc(start), window_end: utc(end),
    count: reason ? null : String(count), amount: reason ? null : `${amount / 100n}.${String(amount % 100n).padStart(2, '0')}`, reason }, state.plan);
}

/** Detached restore recomputes frozen arithmetic at its original source prefix. */
export function restoreFeatureStream(input: unknown, config: unknown): FeatureStreamState {
  const state = validateFeatureStreamState(input, config);
  for (const snapshot of state.snapshots) {
    if (canonical(snapshot) !== canonical(calculate(state, snapshot.query, snapshot.next_offset))) throw new FeatureStreamError();
  }
  return state;
}

/** Copy-on-success; identical offset replay has no additional effect. */
export function applyFeatureStreamDelivery(input: FeatureStreamState, delivery: unknown): FeatureStreamState {
  const state = restoreFeatureStream(input, input.plan);
  const next = validateFeatureStreamDelivery(delivery, state.plan);
  if (next.offset < state.next_offset) {
    if (canonical(next) !== canonical(state.deliveries[next.offset])) throw new FeatureStreamError();
    return state;
  }
  if (next.offset !== state.next_offset) throw new FeatureStreamError();
  state.deliveries.push(next);
  state.next_offset++;
  return validateFeatureStreamState(state, state.plan);
}

/** Freeze a configured query once; later deliveries preserve previously frozen evidence. */
export function materializeFeatureStreamSnapshot(input: FeatureStreamState, queryId: string): { state: FeatureStreamState; snapshot: FeatureStreamSnapshot } {
  const state = restoreFeatureStream(input, input.plan);
  const query = state.plan.queries.find(q => q.id === queryId);
  if (!query) throw new FeatureStreamError();
  let snapshot = state.snapshots.find(s => s.query.id === queryId);
  if (!snapshot) { snapshot = calculate(state, query, state.next_offset); state.snapshots.push(snapshot); }
  return { state: validateFeatureStreamState(state, state.plan), snapshot: validateFeatureStreamSnapshot(snapshot, state.plan) };
}
