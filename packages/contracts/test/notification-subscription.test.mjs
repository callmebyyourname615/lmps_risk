import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalSyntheticSubscriptionLifecycle as Model, SUBSCRIPTION_LIMITS as limits } from '../dist/notification-subscription.js';

const caller = { provenance: 'local_synthetic', execution_mode: 'test', owner_id: 'synthetic_owner', environment_id: 'synthetic_env' };
const register = (key = 'synthetic_register') => ({ action: 'register', idempotency_key: key, expected_version: 0, synthetic_reference: 'synthetic_ref' });
const change = (view, action = 'rotate', key = 'synthetic_change') => ({ action, idempotency_key: key, expected_version: view.version, subscription_id: view.subscription_id, ...(action === 'rotate' ? { synthetic_reference: 'synthetic_next' } : {}) });

test('register, rotate, revoke, exact retry and detached original snapshots', () => {
  const m = new Model(), body = register(), a = m.execute(caller, body);
  assert.match(a.subscription_id, /^sub_[0-9a-f-]{36}$/);
  assert.equal(a.authorization_grant, false);
  const b = m.execute(caller, change(a));
  assert.equal(b.version, 2);
  assert.deepEqual(m.execute(caller, body), a);
  const revoked = m.execute(caller, change(b, 'revoke', 'synthetic_revoke'));
  assert.equal(revoked.status, 'revoked');
  assert.equal(revoked.version, 3);
  assert.deepEqual(m.execute(caller, change(b, 'revoke', 'synthetic_revoke')), revoked);
  assert.throws(() => m.execute(caller, change(revoked, 'rotate', 'synthetic_later')));
  assert.throws(() => m.execute(caller, change(revoked, 'revoke', 'synthetic_again')));
  assert.throws(() => m.execute(caller, { ...body, synthetic_reference: 'synthetic_changed' }));
  assert.throws(() => m.execute(caller, change(a, 'rotate', 'synthetic_stale')));
  a.version = 999; body.synthetic_reference = 'synthetic_mutated'; revoked.status = 'active';
  assert.equal(m.project(caller, b.subscription_id).status, 'revoked');
  assert.equal(m.project(caller, b.subscription_id).version, 3);
});

test('owner/environment binding on mutations, reads and receipts; opaque IDs', () => {
  const m = new Model(), a = m.execute(caller, register());
  for (const other of [{ ...caller, owner_id: 'synthetic_other' }, { ...caller, environment_id: 'synthetic_other' }]) {
    assert.throws(() => m.project(other, a.subscription_id));
    assert.throws(() => m.execute(other, change(a)));
    const separate = m.execute(other, register());
    assert.notEqual(separate.subscription_id, a.subscription_id);
    assert.equal(separate.version, 1);
  }
  const view = JSON.stringify(m.project(caller, a.subscription_id));
  assert.equal(view.includes(caller.owner_id), false);
  assert.equal(view.includes('synthetic_ref'), false);
});

test('strict fields, no coercion, oversized input, credentials and redacted errors', () => {
  const m = new Model();
  for (const body of [null, [], { ...register(), owner_id: 'synthetic_other' },
    { ...register(), endpoint: 'https://secret.invalid' }, { ...register(), token: 'secret_value' },
    { ...register(), expected_version: '0' }, { ...register(), expected_version: NaN },
    { ...register(), synthetic_reference: 'https://secret.invalid' },
    { ...register(), synthetic_reference: 'synthetic_' + 'a'.repeat(65) },
    { ...register(), idempotency_key: 'synthetic_x\n' }, { ...register(), action: 'logout' }]) {
    assert.throws(() => m.execute(caller, body), { message: 'Local subscription rejected; details withheld.' });
  }
  for (const c of [{ ...caller, extra: true }, { ...caller, execution_mode: 'production' }, { ...caller, owner_id: 1 }]) {
    assert.throws(() => m.execute(c, register()));
  }
  let invoked = false;
  const body = register(); Object.defineProperty(body, 'action', { get() { invoked = true; return 'register'; } });
  assert.throws(() => m.execute(caller, body));
  const c = { ...caller }; Object.defineProperty(c, 'owner_id', { get() { invoked = true; return 'synthetic_owner'; } });
  assert.throws(() => m.execute(c, register()));
  assert.equal(invoked, false);
  assert.throws(() => m.execute(caller, { ...register(), [Symbol('unknown')]: true }));
  const exact = m.execute(caller, { ...register(), synthetic_reference: 'synthetic_' + 'a'.repeat(64) });
  assert.equal(exact.version, 1);
});

test('idempotency binds action, target, expected version and reference', () => {
  const m = new Model(), a = m.execute(caller, register()), b = m.execute(caller, register('synthetic_second'));
  const command = change(a); m.execute(caller, command);
  for (const changed of [{ ...command, subscription_id: b.subscription_id }, { ...command, expected_version: 2 },
    { ...command, synthetic_reference: 'synthetic_different' }, change(a, 'revoke')]) {
    assert.throws(() => m.execute(caller, changed));
  }
  assert.equal(m.project(caller, b.subscription_id).version, 1);
});

test('finite exact capacities and one-over reject atomically without evicting receipts', () => {
  const m = new Model();
  let a;
  for (let i = 0; i < limits.subscriptions; i++) a = m.execute(caller, register(`synthetic_${i}`));
  assert.throws(() => m.execute(caller, register('synthetic_over')));
  assert.equal(m.execute(caller, register('synthetic_0')).version, 1);
  for (let i = limits.subscriptions; i < limits.operations; i++) a = m.execute(caller, change(a, 'rotate', `synthetic_${i}`));
  assert.throws(() => m.execute(caller, change(a, 'rotate', 'synthetic_over')));
  assert.deepEqual(m.project(caller, a.subscription_id), a);
  assert.equal(m.execute(caller, register('synthetic_0')).version, 1);
});
