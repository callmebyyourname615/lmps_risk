import { selectQaSampling } from '@lmps/risk';

/** Pure fixture selection; private publication belongs to the CLI. */
export function sampleQa(caller: unknown, pool: unknown, policy: unknown) {
  return selectQaSampling(caller, pool, policy);
}
