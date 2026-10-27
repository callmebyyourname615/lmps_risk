import { randomUUID } from 'node:crypto';

/** Disposable fixture limits, not business capacity. No provider, credential
 * storage, persistence, delivery or session actions. Never an authorization grant. */
export const SUBSCRIPTION_LIMITS = Object.freeze({ subscriptions: 64, operations: 256, version: 1024 });
export interface SubscriptionView {
  subscription_id: string; environment_id: string; version: number; status: 'active' | 'revoked';
  provenance: 'local_synthetic'; execution_mode: 'test'; authorization_grant: false;
}
function fail(): never { throw new Error('Local subscription rejected; details withheld.'); }
function exact(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Reflect.ownKeys(value).length !== keys.length || keys.some(k => !Object.hasOwn(value, k)) ||
      Object.values(Object.getOwnPropertyDescriptors(value)).some(d => !('value' in d))) fail();
}
function synthetic(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^synthetic_[A-Za-z0-9_-]{1,64}$/.test(value) || value.includes('\n')) fail();
}
interface Entry { owner: string; environment: string; reference: string; view: SubscriptionView }
/** Trusted adapter supplies authenticated caller context separately from bodies.
 * Caller: {provenance:'local_synthetic', execution_mode:'test', owner_id,
 * environment_id}. Commands require action, idempotency_key, expected_version;
 * register requires synthetic_reference and version 0; rotate requires
 * subscription_id and synthetic_reference; revoke requires subscription_id.
 * IDs/references/keys are invented fixture values only. Opaque random subscription
 * IDs are bound to one environment and owner. Rotation replaces the reference;
 * revocation is terminal. Exact retries return the original snapshot. Receipts
 * bind all fields, owner and environment; capacity never evicts replay protection.
 * Synchronous atomic in-memory model only; no logging or recipient authorization. */
export class LocalSyntheticSubscriptionLifecycle {
  #entries = new Map<string, Entry>();
  #receipts = new Map<string, { binding: string; view: SubscriptionView }>();
  #caller(value: unknown): { owner: string; environment: string } {
    exact(value, ['provenance', 'execution_mode', 'owner_id', 'environment_id']);
    if (value.provenance !== 'local_synthetic' || value.execution_mode !== 'test') fail();
    synthetic(value.owner_id); synthetic(value.environment_id);
    return { owner: value.owner_id, environment: value.environment_id };
  }
  execute(trustedCaller: unknown, body: unknown): SubscriptionView {
    const c = this.#caller(trustedCaller);
    if (!body || typeof body !== 'object') fail();
    const descriptor = Object.getOwnPropertyDescriptor(body, 'action');
    if (!descriptor || !('value' in descriptor)) fail();
    const action: unknown = descriptor.value;
    if (action !== 'register' && action !== 'rotate' && action !== 'revoke') fail();
    exact(body, ['action', 'idempotency_key', 'expected_version',
      ...(action !== 'register' ? ['subscription_id'] : []), ...(action !== 'revoke' ? ['synthetic_reference'] : [])]);
    synthetic(body.idempotency_key);
    if (!Number.isSafeInteger(body.expected_version) || (body.expected_version as number) < (action === 'register' ? 0 : 1) ||
        (body.expected_version as number) > SUBSCRIPTION_LIMITS.version || (action === 'register' && body.expected_version !== 0)) fail();
    if (action !== 'register' && (typeof body.subscription_id !== 'string' || !/^sub_[0-9a-f-]{36}$/.test(body.subscription_id) || body.subscription_id.includes('\n'))) fail();
    if (action !== 'revoke') synthetic(body.synthetic_reference);
    const key = JSON.stringify([c.owner, c.environment, body.idempotency_key]);
    const binding = JSON.stringify([action, body.expected_version, body.subscription_id ?? null, body.synthetic_reference ?? null]);
    const receipt = this.#receipts.get(key);
    if (receipt) {
      if (receipt.binding !== binding) fail();
      return { ...receipt.view };
    }
    if (this.#receipts.size >= SUBSCRIPTION_LIMITS.operations) fail();
    let entry: Entry;
    if (action === 'register') {
      if (this.#entries.size >= SUBSCRIPTION_LIMITS.subscriptions) fail();
      const subscription_id = `sub_${randomUUID()}`;
      entry = { ...c, reference: body.synthetic_reference as string,
        view: { subscription_id, environment_id: c.environment, version: 1, status: 'active',
          provenance: 'local_synthetic', execution_mode: 'test', authorization_grant: false } };
    } else {
      const prior = this.#entries.get(body.subscription_id as string);
      if (!prior || prior.owner !== c.owner || prior.environment !== c.environment || prior.view.version !== body.expected_version ||
          prior.view.status !== 'active' || prior.view.version >= SUBSCRIPTION_LIMITS.version) fail();
      entry = { ...prior, reference: action === 'rotate' ? body.synthetic_reference as string : '',
        view: { ...prior.view, version: prior.view.version + 1, status: action === 'revoke' ? 'revoked' : 'active' } };
    }
    this.#entries.set(entry.view.subscription_id, entry);
    this.#receipts.set(key, { binding, view: { ...entry.view } });
    return { ...entry.view };
  }
  /** No enumeration. Public views contain neither owner nor synthetic reference. */
  project(trustedCaller: unknown, subscriptionId: unknown): SubscriptionView {
    const c = this.#caller(trustedCaller);
    if (typeof subscriptionId !== 'string' || subscriptionId.length !== 40) fail();
    const entry = this.#entries.get(subscriptionId);
    if (!entry || entry.owner !== c.owner || entry.environment !== c.environment) fail();
    return { ...entry.view };
  }
}
