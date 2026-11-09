import { createHmac } from 'node:crypto';
import { OBSERVED_MASK_SOURCE_PROFILE, type ObservedMaskEvent } from '@lmps/contracts/observed-mask';
import { localRiskMode } from './index.js';

export { OBSERVED_MASK_SOURCE_PROFILE };

function record(input: unknown, names: string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype
    || Reflect.ownKeys(input).length !== names.length) throw Error();
  return Object.fromEntries(names.map(name => {
    const d = Object.getOwnPropertyDescriptor(input, name);
    if (!d?.enumerable || !('value' in d)) throw Error();
    return [name, d.value];
  }));
}

/** Run-private grouping commitment. Never a resolved account or a canonical token. */
export function observedMaskKey(input: unknown, key: Uint8Array) {
  try {
    localRiskMode();
    const r = record(input, ['bank', 'representation']);
    if (!(key instanceof Uint8Array) || key.byteLength !== 32) throw Error();
    if (typeof r.bank !== 'string' || typeof r.representation !== 'string') throw Error();
    for (const [value, width] of [[r.bank, 200], [r.representation, 5000]] as const) {
      if (!value || !value.trim() || value.length > width * 2 || [...value].length > width
        || /[\u0000-\u001f\u007f\ud800-\udfff]/u.test(value)) throw Error();
    }
    return { observed_key: createHmac('sha256', key).update(JSON.stringify(['observed-mask-1', r.bank, r.representation])).digest('hex'),
      identity_status: 'unverified' as const, real_account_claim: false as const };
  } catch { throw Error('OBSERVED_MASK_INVALID; source values withheld.'); }
}

/** Converts the user's fixed UTC+7 declaration, not an independently verified source clock. */
export function observedMaskTime(value: unknown): number {
  try {
    localRiskMode();
    if (typeof value !== 'string' || !/^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$/.test(value)) throw Error();
    const [y, m, d, h, minute, second] = value.split(/[- :]/).map(Number) as [number, number, number, number, number, number];
    const ms = Date.UTC(y, m - 1, d, h, minute, second), dt = new Date(ms);
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d
      || dt.getUTCHours() !== h || dt.getUTCMinutes() !== minute || dt.getUTCSeconds() !== second) throw Error();
    return ms / 1000 - 420 * 60;
  } catch { throw Error('OBSERVED_TIME_INVALID; source values withheld.'); }
}

/** Small independent reference reducer. Full-month execution lives in the bounded worker. */
export function referenceObservedWindow(input: unknown) {
  try {
    localRiskMode();
    const r = record(input, ['events', 'anchor', 'window_seconds', 'scope_start']);
    if (!Array.isArray(r.events) || Object.getPrototypeOf(r.events) !== Array.prototype || r.events.length > 1024
      || Reflect.ownKeys(r.events).length !== r.events.length + 1 || !Number.isSafeInteger(r.anchor)
      || !Number.isSafeInteger(r.scope_start) || ![300, 900, 3600].includes(r.window_seconds as number)) throw Error();
    const events: ObservedMaskEvent[] = [], seen = new Set<number>();
    for (let i = 0; i < r.events.length; i++) {
      const descriptor = Object.getOwnPropertyDescriptor(r.events, String(i));
      if (!descriptor?.enumerable || !('value' in descriptor)) throw Error();
      const raw: unknown = descriptor.value;
      const e = record(raw, ['ordinal', 'occurred_unix', 'sender', 'receiver', 'amount']);
      if (!Number.isSafeInteger(e.ordinal) || (e.ordinal as number) < 0 || seen.has(e.ordinal as number)
        || !Number.isSafeInteger(e.occurred_unix) || typeof e.sender !== 'string' || typeof e.receiver !== 'string'
        || !/^[a-f0-9]{64}$/.test(e.sender) || !/^[a-f0-9]{64}$/.test(e.receiver)
        || typeof e.amount !== 'string' || !/^(0|[1-9][0-9]{0,21})\.[0-9]{2}$/.test(e.amount)) throw Error();
      const cents = BigInt(e.amount.replace('.', ''));
      if (cents <= 0n || cents > 20000000000n) throw Error();
      seen.add(e.ordinal as number); events.push(e as unknown as ObservedMaskEvent);
    }
    const target = events.find(e => e.ordinal === r.anchor);
    if (!target) throw Error();
    if (target.occurred_unix < (r.scope_start as number) + (r.window_seconds as number)) {
      return { status: 'warmup_withheld' as const, metrics: null, identity_status: 'unverified' as const };
    }
    const current = events.filter(e => e.occurred_unix > target.occurred_unix - (r.window_seconds as number) && e.occurred_unix <= target.occurred_unix);
    const outgoing = current.filter(e => e.sender === target.sender), incoming = current.filter(e => e.receiver === target.receiver);
    const amount = outgoing.reduce((s, e) => s + BigInt(e.amount.replace('.', '')), 0n);
    return { status: 'snapshot_proxy' as const, identity_status: 'unverified' as const,
      metrics: { FRAUD_COUNT_VELOCITY: String(outgoing.length),
        FRAUD_AMOUNT_VELOCITY: `${amount / 100n}.${String(amount % 100n).padStart(2, '0')}`,
        MULE_FAN_OUT: String(new Set(outgoing.map(e => e.receiver)).size),
        MULE_FAN_IN: String(new Set(incoming.map(e => e.sender)).size) } };
  } catch { throw Error('OBSERVED_WINDOW_INVALID; source values withheld.'); }
}
