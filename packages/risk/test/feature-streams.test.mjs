import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { evaluateTransactionRisk } from '../dist/index.js';
import { riskFixture } from '../fixtures/request.mjs';

const raw = readFileSync(new URL('./fixtures/feature-streams/golden.json', import.meta.url));
const corpus = JSON.parse(raw);
function bounded(input, bytes) {
  assert.ok(bytes <= 32768);
  assert.ok(input.events.length <= 32);
  assert.ok(input.snapshots.length <= 8);
}

// Test-only oracle: no risk arithmetic, key, revision or window helpers imported.
function independentlyExpected(snapshot, events) {
  const target = events.find(e => e.transaction_id === snapshot.target);
  const end = Date.parse(target.occurred_at);
  const start = end - corpus.window_seconds * 1000;
  const reason = snapshot.evidence === 'missing' ? 'INPUT_MISSING'
    : !snapshot.coverage_complete ? 'HISTORY_INCOMPLETE' : null;
  const selected = events.filter(e => e.available_at <= snapshot.as_of)
    .filter((e, _, all) => !all.some(other => other.namespace === e.namespace
      && other.transaction_id === e.transaction_id && other.revision_number > e.revision_number))
    .filter((e, index, all) => all.findIndex(other => other.namespace === e.namespace
      && other.transaction_id === e.transaction_id && other.revision_number === e.revision_number) === index);
  const minor = text => { const [whole, fraction] = text.split('.'); return BigInt(whole) * 100n + BigInt(fraction); };
  const net = e => ['succeeded', 'partially_reversed'].includes(e.status) ? minor(e.amount) - minor(e.reversed_amount) : 0n;
  const outgoing = selected.filter(e => e.currency === snapshot.currency && e.sender === target.sender
    && Date.parse(e.occurred_at) > start && Date.parse(e.occurred_at) <= end && net(e) > 0n);
  const total = outgoing.reduce((sum, e) => sum + net(e), 0n);
  return { count: reason ? null : String(outgoing.length),
    amount: reason ? null : `${total / 100n}.${String(total % 100n).padStart(2, '0')}`,
    window_start: new Date(start).toISOString().replace('.000Z', 'Z'),
    window_end: new Date(end).toISOString().replace('.000Z', 'Z'), reason };
}

test('finite local corpus limits accept exact bounds and reject one over without truncation', () => {
  bounded(corpus, raw.length);
  const exact = { events: Array(32).fill(null), snapshots: Array(8).fill(null) };
  bounded(exact, 32768);
  assert.throws(() => bounded(exact, 32769));
  assert.throws(() => bounded({ ...exact, events: Array(33).fill(null) }, 32768));
  assert.throws(() => bounded({ ...exact, snapshots: Array(9).fill(null) }, 32768));
  assert.deepEqual(corpus.limits, { bytes: 32768, events: 32, snapshots: 8 });
  assert.equal(corpus.online_engine_status, 'pending');
});

for (const snapshot of corpus.snapshots) test(`golden stream: ${snapshot.id}`, () => {
  assert.deepEqual(independentlyExpected(snapshot, corpus.events), snapshot.expected);
  assert.deepEqual(independentlyExpected(snapshot, [...corpus.events].reverse()), snapshot.expected);
  const { request, observation } = riskFixture();
  const target = corpus.events.find(e => e.transaction_id === snapshot.target);
  request.run_id = '00000000-0000-4000-8000-000000000303';
  request.target = { namespace: target.namespace, transaction_id: target.transaction_id, revision_number: target.revision_number };
  request.policy.currency = snapshot.currency;
  request.policy.window_seconds = corpus.window_seconds;
  Object.assign(request.context, { binding: { ...request.target, revision_sha256: observation.revision_sha256 },
    as_of: snapshot.as_of, coverage_start: corpus.coverage_start, coverage_complete: snapshot.coverage_complete,
    events: structuredClone(corpus.events), flagged_accounts: snapshot.flags_available ? [] : null,
    flagged_accounts_version: snapshot.flags_available ? 'synthetic_empty_v1' : null });
  Object.assign(observation, { amount: target.amount, reversed_amount: target.reversed_amount, currency: target.currency,
    transaction_status: target.status, observed_at: snapshot.as_of });
  if (snapshot.evidence === 'missing') for (const key of Object.keys(observation)) observation[key] = key === 'status' ? 'missing' : null;
  const result = evaluateTransactionRisk(request, observation);
  const find = code => result.findings.find(f => f.code === code);
  for (const [code, expected] of [['FRAUD_COUNT_VELOCITY', snapshot.expected.count], ['FRAUD_AMOUNT_VELOCITY', snapshot.expected.amount]]) {
    const finding = find(code);
    assert.equal(finding.metric?.value ?? null, expected);
    if (snapshot.expected.reason) { assert.equal(finding.status, 'unavailable'); assert.equal(finding.reason_code, snapshot.expected.reason); }
    else assert.ok(['triggered', 'not_triggered'].includes(finding.status));
  }
  if (!snapshot.flags_available) { assert.equal(find('MULE_FLAGGED_NEIGHBOR').status, 'unavailable'); assert.equal(find('MULE_FLAGGED_NEIGHBOR').reason_code, 'FLAGS_UNAVAILABLE'); }
  if (snapshot.evidence === 'missing') assert.ok(result.findings.every(f => f.status === 'unavailable' && f.metric === null));
  request.context.events.reverse();
  assert.deepEqual(evaluateTransactionRisk(request, observation), result);
});
