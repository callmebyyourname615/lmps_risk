import { isDeepStrictEqual } from 'node:util';
import { isSimulationCaller, isSimulationRequest, isSimulationCapacity, isSimulationOutcome,
  isSimulationTimestamp, MAX_SIMULATION_COMMANDS, SIMULATION_BOUNDARY, PRETRANSFER_SIMULATION_VERSION,
  type SimulationResult, type SimulationCapacity, type SimulationBinding } from '@lmps/contracts/pretransfer-simulation';
import { PretransferSimulationRegistry } from './pretransfer-simulation.js';

const money = (value: string) => BigInt(value.replace('.', ''));
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function copy(value: unknown): unknown {
  try { const clone: unknown = structuredClone(value); return isDeepStrictEqual(clone, JSON.parse(JSON.stringify(clone))) ? clone : null; }
  catch { return null; }
}
function receipt(reason_code: SimulationResult['reason_code'], status: SimulationResult['status'] = 'unavailable',
  binding: SimulationBinding | null = null, reference: string | null = null): SimulationResult {
  return freeze({ ...SIMULATION_BOUNDARY, contract_version: PRETRANSFER_SIMULATION_VERSION, status, reason_code, binding, reference });
}

/** Bounded FIFO critical section. Aborted waiters never execute; all paths release the tail.
 * A ledger queue also serializes independent scopes, making the shared test clock atomic.
 */
export class SyntheticReservationQueue {
  #tail: Promise<unknown> = Promise.resolve();
  #pending = 0;
  run<T>(task: () => T | Promise<T>, signal?: AbortSignal): Promise<T> {
    if (this.#pending >= MAX_SIMULATION_COMMANDS) return Promise.reject(new Error('RESOURCE_LIMIT'));
    this.#pending++;
    const next = this.#tail.then(() => {
      if (signal?.aborted) throw new Error('CANCELLED');
      return task();
    }).finally(() => { this.#pending--; });
    this.#tail = next.catch(() => undefined);
    return next;
  }
}
interface Entry { original: SimulationResult; current: SimulationResult; scope: string }
const scope = (caller: { workspace_id: string; client_id: string }, request: { namespace: string; sender: string; currency: string }) =>
  JSON.stringify([caller.workspace_id, caller.client_id, request.namespace, request.sender, request.currency]);

/** In-flight synthetic request capacity only. No bank balance, payment execution or reversal. */
export class PretransferReservationRegistry {
  readonly #queue = new SyntheticReservationQueue();
  readonly #registry = new PretransferSimulationRegistry();
  readonly #policies = new Map<string, SimulationCapacity>();
  readonly #entries = new Map<string, Entry>();
  #valid = false;
  #now: string | undefined;
  constructor(capacities: unknown) {
    const input = copy(capacities);
    if (!Array.isArray(input) || input.length > MAX_SIMULATION_COMMANDS || !input.every(isSimulationCapacity)) return;
    for (const policy of input) {
      const key = scope(policy.caller, policy);
      if (this.#policies.has(key)) { this.#policies.clear(); return; }
      this.#policies.set(key, freeze(policy));
    }
    this.#valid = true;
  }
  get size(): number { return this.#entries.size; }
  #advance(now: unknown): now is string {
    if (!isSimulationTimestamp(now) || (this.#now !== undefined && now < this.#now)) return false;
    this.#now = now;
    for (const entry of this.#entries.values()) {
      if (entry.current.status === 'reserved' && entry.original.binding!.request.expires_at <= now) {
        entry.current = receipt('EXPIRED', 'expired', entry.original.binding, entry.original.reference);
      }
    }
    return true;
  }
  #usage(key: string) {
    let pending_count = 0, pending_cents = 0n, executed_count = 0, executed_cents = 0n;
    for (const entry of this.#entries.values()) {
      if (entry.scope !== key) continue;
      const amount = money(entry.original.binding!.request.amount);
      if (entry.current.status === 'reserved') { pending_count++; pending_cents += amount; }
      if (entry.current.status === 'executed') { executed_count++; executed_cents += amount; }
    }
    return { pending_count, pending_cents, executed_count, executed_cents };
  }
  /** Exact integer cents; supplied fixture context only, not corporate authentication. */
  usage(callerInput: unknown, requestInput: unknown) {
    const caller = copy(callerInput), request = copy(requestInput);
    if (!isSimulationCaller(caller) || !isSimulationRequest(request)) return null;
    return Object.freeze(this.#usage(scope(caller, request)));
  }
  reserve(callerInput: unknown, requestInput: unknown, now: unknown, signal?: AbortSignal): Promise<SimulationResult> {
    const caller = copy(callerInput), request = copy(requestInput);
    return this.#queue.run(() => {
      if (!this.#valid || !isSimulationCaller(caller) || !isSimulationRequest(request)) return receipt('CONTEXT_MISSING');
      const key = scope(caller, request), policy = this.#policies.get(key);
      if (!this.#advance(now)) return receipt('CONTEXT_MISSING');
      for (const entry of this.#entries.values()) {
        const binding = entry.original.binding!;
        if (isDeepStrictEqual(binding.caller, caller) && binding.request.namespace === request.namespace
          && binding.request.idempotency_key === request.idempotency_key) {
          return isDeepStrictEqual(binding.request, request) ? entry.original : receipt('IDEMPOTENCY_CONFLICT', 'rejected');
        }
      }
      if (!policy) return receipt('CONTEXT_MISSING');
      if (request.expires_at <= now) return receipt('EXPIRED', 'expired');
      if (money(request.amount) === 0n) return receipt('UNSUPPORTED_STATE', 'rejected');
      if (this.#entries.size >= MAX_SIMULATION_COMMANDS) return receipt('RESOURCE_LIMIT');
      const usage = this.#usage(key);
      if (usage.pending_count >= policy.max_in_flight_count || usage.pending_cents + money(request.amount) > money(policy.max_in_flight_amount)) {
        return receipt('CAPACITY_EXCEEDED', 'rejected');
      }
      const registered = this.#registry.register(caller, request, now);
      if (!registered.binding || !registered.reference) return registered;
      const original = receipt('RESERVED', 'reserved', registered.binding, registered.reference);
      this.#entries.set(registered.reference, { original, current: original, scope: key });
      return original;
    }, signal).catch(() => receipt(signal?.aborted ? 'UNSUPPORTED_STATE' : 'RESOURCE_LIMIT', signal?.aborted ? 'rejected' : 'unavailable'));
  }
  reconcile(callerInput: unknown, outcomeInput: unknown, now: unknown, signal?: AbortSignal): Promise<SimulationResult> {
    const caller = copy(callerInput), outcome = copy(outcomeInput);
    return this.#queue.run(() => {
      if (!this.#valid || !isSimulationCaller(caller)) return receipt('CONTEXT_MISSING');
      if (!isSimulationOutcome(outcome)) return receipt('UNSUPPORTED_STATE', 'rejected');
      const entry = this.#entries.get(outcome.reference);
      if (!entry || !isDeepStrictEqual(entry.original.binding!.caller, caller)) return receipt('REFERENCE_UNAVAILABLE');
      if (!this.#advance(now)) return receipt('CONTEXT_MISSING');
      if (entry.current.status !== 'reserved') return entry.current.status === outcome.outcome
        ? entry.current : receipt('OUTCOME_CONFLICT', 'rejected');
      if (outcome.outcome === 'expired') return receipt('UNSUPPORTED_STATE', 'rejected');
      entry.current = receipt('OUTCOME_RECORDED', outcome.outcome, entry.original.binding, entry.original.reference);
      return entry.current;
    }, signal).catch(() => receipt(signal?.aborted ? 'UNSUPPORTED_STATE' : 'RESOURCE_LIMIT', signal?.aborted ? 'rejected' : 'unavailable'));
  }
}
