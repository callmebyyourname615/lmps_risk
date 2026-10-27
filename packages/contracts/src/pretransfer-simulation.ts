import { Ajv2020 } from 'ajv/dist/2020.js';
import formats from 'ajv-formats';

/** Local fixture contracts. Validation grants no production or payment authority. */
export const PRETRANSFER_SIMULATION_VERSION = 'synthetic-pretransfer-1';
export const MAX_SIMULATION_INPUT_BYTES = 64 * 1024;
export const MAX_SIMULATION_COMMANDS = 200;
export const SIMULATION_BOUNDARY = Object.freeze({ provenance: 'local_synthetic', execution_mode: 'test',
  simulation_only: true, enforcement: false, production_ready: false } as const);
export type SimulationBoundary = typeof SIMULATION_BOUNDARY;
/** Trusted fixture context is supplied separately from the request body. */
export interface SimulationCaller extends SimulationBoundary { workspace_id: string; client_id: string }
export interface SimulationRequest extends SimulationBoundary {
  namespace: string; payment_id: string; attempt_id: string; idempotency_key: string;
  sender: string; receiver: string; amount: string; currency: string; product: string; expires_at: string;
}
export interface SimulationBinding extends SimulationBoundary { caller: SimulationCaller; request: SimulationRequest }
export interface SimulationOutcome extends SimulationBoundary {
  reference: string; outcome: 'executed' | 'failed' | 'cancelled' | 'expired';
}
export type SimulationCommand =
  | { kind: 'request'; request: SimulationRequest }
  | { kind: 'lookup'; reference: string; binding: SimulationBinding }
  | { kind: 'outcome'; outcome: SimulationOutcome }
  | { kind: 'advance_clock'; now: string };
export interface SimulationCapacity extends SimulationBoundary {
  caller: SimulationCaller; namespace: string; sender: string; currency: string;
  max_in_flight_count: number; max_in_flight_amount: string;
}
export interface SimulationScenario extends SimulationBoundary {
  contract_version: typeof PRETRANSFER_SIMULATION_VERSION; scenario_id: string; run_id: string;
  now: string; capacities: SimulationCapacity[]; commands: SimulationCommand[];
}
export interface SimulationResult extends SimulationBoundary {
  contract_version: typeof PRETRANSFER_SIMULATION_VERSION;
  status: 'reserved' | 'executed' | 'failed' | 'cancelled' | 'expired' | 'rejected' | 'unavailable';
  reason_code: 'RESERVED' | 'OUTCOME_RECORDED' | 'REFERENCE_VALID' | 'IDEMPOTENCY_CONFLICT' |
    'REFERENCE_UNAVAILABLE' | 'EXPIRED' | 'CAPACITY_EXCEEDED' | 'CONTEXT_MISSING' |
    'UNSUPPORTED_STATE' | 'OUTCOME_CONFLICT' | 'RESOURCE_LIMIT';
  reference: string | null; binding: SimulationBinding | null;
}
const object = (properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false,
  required: Object.keys(properties), properties });
const text = (pattern: string, maxLength: number) => ({ type: 'string', pattern, maxLength });
const id = text('^synthetic_[A-Za-z0-9_.:-]{1,70}$', 80);
const namespace = text('^synthetic_[a-z0-9_]{1,40}$', 50);
const amount = text('^(0|[1-9][0-9]{0,21})\\.[0-9]{2}$', 25);
const currency = text('^[A-Z]{3}$', 3);
// Canonical UTC milliseconds permit exact deterministic timestamp comparisons.
const timestamp = { ...text('^[0-9]{4}-[0-9]{2}-[0-9]{2}T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\\.[0-9]{3}Z$', 24), format: 'date-time' };
const boundary = Object.fromEntries(Object.entries(SIMULATION_BOUNDARY).map(([k, v]) => [k, { const: v }]));
export const simulationCallerSchema = object({ ...boundary, workspace_id: id, client_id: id });
export const simulationRequestSchema = object({ ...boundary, namespace, payment_id: id, attempt_id: id,
  idempotency_key: id, sender: id, receiver: id, amount, currency, product: id, expires_at: timestamp });
export const simulationBindingSchema = object({ ...boundary, caller: simulationCallerSchema, request: simulationRequestSchema });
export const simulationOutcomeSchema = object({ ...boundary, reference: id, outcome: { enum: ['executed', 'failed', 'cancelled', 'expired'] } });
export const simulationCommandSchema = { oneOf: [
  object({ kind: { const: 'request' }, request: simulationRequestSchema }),
  object({ kind: { const: 'lookup' }, reference: id, binding: simulationBindingSchema }),
  object({ kind: { const: 'outcome' }, outcome: simulationOutcomeSchema }),
  object({ kind: { const: 'advance_clock' }, now: timestamp }),
] };
export const simulationCapacitySchema = object({ ...boundary, caller: simulationCallerSchema, namespace, sender: id, currency,
  max_in_flight_count: { type: 'integer', minimum: 0, maximum: MAX_SIMULATION_COMMANDS }, max_in_flight_amount: amount });
export const simulationScenarioSchema = object({ ...boundary, contract_version: { const: PRETRANSFER_SIMULATION_VERSION },
  scenario_id: id, run_id: id, now: timestamp,
  capacities: { type: 'array', maxItems: MAX_SIMULATION_COMMANDS, items: simulationCapacitySchema },
  commands: { type: 'array', maxItems: MAX_SIMULATION_COMMANDS, items: simulationCommandSchema } });
export const simulationResultSchema = object({ ...boundary, contract_version: { const: PRETRANSFER_SIMULATION_VERSION },
  status: { enum: ['reserved', 'executed', 'failed', 'cancelled', 'expired', 'rejected', 'unavailable'] },
  reason_code: { enum: ['RESERVED', 'OUTCOME_RECORDED', 'REFERENCE_VALID', 'IDEMPOTENCY_CONFLICT', 'REFERENCE_UNAVAILABLE',
    'EXPIRED', 'CAPACITY_EXCEEDED', 'CONTEXT_MISSING', 'UNSUPPORTED_STATE', 'OUTCOME_CONFLICT', 'RESOURCE_LIMIT'] },
  reference: { anyOf: [id, { type: 'null' }] }, binding: { anyOf: [simulationBindingSchema, { type: 'null' }] } });
const ajv = new Ajv2020({ strict: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
formats.default(ajv, { mode: 'full', formats: ['date-time'] });
function validator<T>(schema: object): (value: unknown) => value is T {
  const check = ajv.compile<T>(schema);
  return (value: unknown): value is T => {
    try {
      const json = JSON.stringify(value);
      return typeof json === 'string' && Buffer.byteLength(json, 'utf8') <= MAX_SIMULATION_INPUT_BYTES && check(value) === true;
    } catch { return false; }
  };
}
export const isSimulationCaller = validator<SimulationCaller>(simulationCallerSchema);
export const isSimulationRequest = validator<SimulationRequest>(simulationRequestSchema);
export const isSimulationBinding = validator<SimulationBinding>(simulationBindingSchema);
export const isSimulationOutcome = validator<SimulationOutcome>(simulationOutcomeSchema);
export const isSimulationCapacity = validator<SimulationCapacity>(simulationCapacitySchema);
export const isSimulationCommand = validator<SimulationCommand>(simulationCommandSchema);
export const isSimulationResult = validator<SimulationResult>(simulationResultSchema);
const scenarioCheck = validator<SimulationScenario>(simulationScenarioSchema);
export const isSimulationTimestamp = validator<string>(timestamp);
export function isSimulationScenario(value: unknown): value is SimulationScenario {
  if (!scenarioCheck(value)) return false;
  let now = value.now;
  for (const command of value.commands) {
    if (command.kind === 'advance_clock') {
      if (command.now <= now) return false;
      now = command.now;
    } else if (command.kind === 'request' && command.request.expires_at <= now) return false;
  }
  return true;
}
export class SimulationContractError extends Error {
  readonly code = 'SIMULATION_INVALID_INPUT';
  constructor() { super('SIMULATION_INVALID_INPUT; private diagnostics withheld.'); this.name = 'SimulationContractError'; }
}
/** Measure the original JSON, including whitespace, before parsing. */
export function parseSimulationScenario(json: string): SimulationScenario {
  try {
    if (typeof json !== 'string' || Buffer.byteLength(json, 'utf8') > MAX_SIMULATION_INPUT_BYTES) throw new Error();
    const value: unknown = JSON.parse(json);
    if (!isSimulationScenario(value)) throw new Error();
    return value;
  } catch { throw new SimulationContractError(); }
}
export function isSimulationRequestAt(value: unknown, now: unknown): value is SimulationRequest {
  return isSimulationTimestamp(now) && isSimulationRequest(value) && value.expires_at > now;
}
