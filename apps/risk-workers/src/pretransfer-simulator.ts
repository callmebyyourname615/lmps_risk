import { isSimulationCaller, isSimulationScenario, SIMULATION_BOUNDARY, PRETRANSFER_SIMULATION_VERSION,
  type SimulationResult } from '@lmps/contracts/pretransfer-simulation';
import { PretransferReservationRegistry, PretransferSimulationRegistry, riskHash } from '@lmps/risk';

/** Fresh-state replay with a separately supplied trusted synthetic caller fixture. */
export async function simulatePretransfer(input: unknown, callerInput: unknown, codeVersion: string) {
  if (!isSimulationScenario(input) || !isSimulationCaller(callerInput) || !/^[a-f0-9]{64}$/.test(codeVersion)) throw new Error('SIMULATION_INVALID_INPUT');
  const scenario = structuredClone(input), caller = structuredClone(callerInput);
  const ledger = new PretransferReservationRegistry(scenario.capacities);
  const registry = new PretransferSimulationRegistry();
  const accepted = new Map<string, SimulationResult>();
  const statuses: Record<string, number> = {}, reasons: Record<string, number> = {};
  let now = scenario.now, advances = 0;
  for (const command of scenario.commands) {
    let result: SimulationResult;
    if (command.kind === 'advance_clock') {
      now = command.now; advances++;
      for (const reference of accepted.keys()) await ledger.reconcile(caller, { ...SIMULATION_BOUNDARY, reference, outcome: 'expired' }, now);
      continue;
    }
    if (command.kind === 'request') {
      result = await ledger.reserve(caller, command.request, now);
      if (result.status === 'reserved' && result.reference) {
        registry.register(caller, command.request, now);
        accepted.set(result.reference, result);
      }
    } else if (command.kind === 'lookup') result = registry.lookup(caller, command.reference, command.binding, now);
    else result = await ledger.reconcile(caller, command.outcome, now);
    statuses[result.status] = (statuses[result.status] ?? 0) + 1;
    reasons[result.reason_code] = (reasons[result.reason_code] ?? 0) + 1;
  }
  let pending = 0, executed = 0;
  const scopes = new Set<string>();
  for (const result of accepted.values()) {
    const request = result.binding!.request;
    const key = JSON.stringify([request.namespace, request.sender, request.currency]);
    if (scopes.has(key)) continue;
    scopes.add(key);
    const usage = ledger.usage(caller, request)!;
    pending += usage.pending_count; executed += usage.executed_count;
  }
  const counts = { commands: scenario.commands.length, clock_advances: advances,
    unique_reservations: ledger.size, pending, executed, released: ledger.size - pending - executed };
  if (counts.released < 0 || Object.values(statuses).reduce((a, b) => a + b, 0) + advances !== counts.commands) throw new Error('SIMULATION_INVARIANT_FAILED');
  return { ...SIMULATION_BOUNDARY, report_version: 'synthetic-pretransfer-report-1',
    contract_version: PRETRANSFER_SIMULATION_VERSION, code_version: codeVersion,
    scenario_version: riskHash(scenario), config_version: riskHash({ caller, capacities: scenario.capacities }),
    counts, statuses, reasons, invariants: { command_accounting: true, reservation_accounting: true } };
}
