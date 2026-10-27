import { isDeepStrictEqual } from 'node:util';
import { isSimulationBinding, isSimulationCaller, isSimulationRequest, isSimulationTimestamp,
  MAX_SIMULATION_COMMANDS, PRETRANSFER_SIMULATION_VERSION, SIMULATION_BOUNDARY,
  type SimulationBinding, type SimulationResult } from '@lmps/contracts/pretransfer-simulation';
import { cents, riskHash } from './index.js';

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}
function result(reason_code: SimulationResult['reason_code'], binding: SimulationBinding | null = null,
  reference: string | null = null): SimulationResult {
  // A valid reference is not a reservation, risk score, or permission to pay.
  return freeze({ ...SIMULATION_BOUNDARY, contract_version: PRETRANSFER_SIMULATION_VERSION,
    status: reason_code === 'EXPIRED' ? 'expired' : reason_code === 'IDEMPOTENCY_CONFLICT' ? 'rejected' : 'unavailable',
    reason_code, reference, binding });
}
function snapshot(value: unknown): unknown {
  try {
    const copy: unknown = structuredClone(value);
    return isDeepStrictEqual(copy, JSON.parse(JSON.stringify(copy))) ? copy : null;
  } catch { return null; }
}

/** Synthetic lookup only; hashes confer no production authorization.
 * Synchronous calls have no asynchronous mutation gap. Clock is supplied explicitly.
 */
export class PretransferSimulationRegistry {
  readonly #requests = new Map<string, SimulationResult>();
  readonly #references = new Map<string, SimulationResult>();
  #now: string | undefined;

  get size(): number { return this.#requests.size; }

  #clock(now: unknown): now is string {
    return isSimulationTimestamp(now) && (this.#now === undefined || now >= this.#now);
  }

  register(callerInput: unknown, requestInput: unknown, now: unknown): SimulationResult {
    const caller = snapshot(callerInput), request = snapshot(requestInput);
    if (!isSimulationCaller(caller) || !isSimulationRequest(request) || !this.#clock(now)) return result('CONTEXT_MISSING');
    const binding: SimulationBinding = { ...SIMULATION_BOUNDARY, caller, request };
    const key = JSON.stringify([caller.workspace_id, caller.client_id, request.namespace, request.idempotency_key]);
    const previous = this.#requests.get(key);
    if (previous) {
      if (!isDeepStrictEqual(previous.binding, binding)) return result('IDEMPOTENCY_CONFLICT');
      this.#now = now;
      // Retry returns the original receipt, not a renewed reference.
      return previous;
    }
    if (request.expires_at <= now) return result('EXPIRED');
    if (cents(request.amount) === 0n) return result('UNSUPPORTED_STATE');
    if (this.#requests.size >= MAX_SIMULATION_COMMANDS) return result('RESOURCE_LIMIT');
    const reference = `synthetic_${riskHash({ contract_version: PRETRANSFER_SIMULATION_VERSION, binding })}`;
    if (this.#references.has(reference)) return result('RESOURCE_LIMIT');
    const receipt = result('REFERENCE_VALID', binding, reference);
    this.#requests.set(key, receipt);
    this.#references.set(reference, receipt);
    this.#now = now;
    return receipt;
  }

  lookup(callerInput: unknown, reference: unknown, bindingInput: unknown, now: unknown): SimulationResult {
    const caller = snapshot(callerInput), binding = snapshot(bindingInput);
    const denied = () => result('REFERENCE_UNAVAILABLE');
    if (!isSimulationCaller(caller) || !isSimulationBinding(binding) || !this.#clock(now)
      || typeof reference !== 'string' || !/^synthetic_[a-f0-9]{64}$/.test(reference)
      || !isDeepStrictEqual(caller, binding.caller)) return denied();
    const stored = this.#references.get(reference);
    if (!stored || !isDeepStrictEqual(stored.binding, binding) || binding.request.expires_at <= now) return denied();
    this.#now = now;
    return stored;
  }
}
