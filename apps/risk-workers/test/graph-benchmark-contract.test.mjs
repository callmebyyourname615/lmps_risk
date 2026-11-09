import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { GRAPH_CAPS as caps, GRAPH_SEMANTICS, validateGraphCorpus as validate, parseGraphCorpus, graphIdentity, graphQueryIdentity, graphSemanticsIdentity, graphNodeIdentity, graphBudget, graphCents, selectGraph } from '../dist/graph-benchmark-contract.js';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/graph-benchmark.json', import.meta.url)));
const fresh = () => structuredClone(fixture.cases[0].corpus);
const event = (id, sender = 'synthetic_A', receiver = 'synthetic_B') => ({ ...fresh().deliveries[0].event, transaction_id: id, sender, receiver });
function generated(events) { const c = fresh(); c.deliveries = events.map((event, i) => ({ source_position: i + 1, event })); c.queries[0].source_prefix = events.length; c.queries[0].target.transaction_id = events[0].transaction_id; return c; }

// Deliberately independent miniature test oracle, not a candidate implementation.
// Literal fixture expectations below are never passed into selectGraph.
function manualObservations(edges) {
  const paths = [], cycles = [];
  function walk(chain, nodes) {
    const last = chain.at(-1);
    for (const e of edges) {
      if (e.sender !== last.receiver || Date.parse(e.occurred_at) <= Date.parse(last.occurred_at)) continue;
      const next = [...chain, e], ids = next.map(e => e.transaction_id);
      if (e.receiver === nodes[0]) { cycles.push(ids); continue; }
      if (nodes.includes(e.receiver)) continue;
      if (next.length === 2) paths.push(ids);
      if (next.length < 4) walk(next, [...nodes, e.receiver]);
    }
  }
  for (const e of edges) walk([e], [e.sender, e.receiver]);
  return { paths, cycles };
}

test('fixed hand-computed oracle assertions, separated from observed inputs', () => {
  assert.equal(fixture.cases.length, 12);
  for (const { name, corpus, oracle } of fixture.cases) {
    assert(!Object.hasOwn(corpus, 'oracle'));
    const result = selectGraph(corpus, corpus.queries[0].id);
    assert.equal(result.status, oracle.status, name);
    if (oracle.status === 'unavailable') { assert.equal(result.reason, oracle.reason, name); assert.deepEqual(result.edges, []); continue; }
    assert.deepEqual(result.edges.map(e => e.transaction_id), oracle.edge_ids, name);
    // Independent arithmetic, deliberately no graphCents call.
    const net = result.edges.reduce((n, e) => n + BigInt(e.amount.replace('.', '')) - BigInt(e.reversed_amount.replace('.', '')), 0n);
    assert.equal(net.toString(), oracle.net_cents, name);
    const { paths, cycles } = manualObservations(result.edges);
    assert.deepEqual(paths, oracle.paths_2, name); assert.deepEqual(cycles, oracle.cycles, name);
    if (name === 'fan') {
      assert.equal(new Set(result.edges.filter(e => e.receiver === 'synthetic_H').map(e => e.sender)).size, 2);
      assert.equal(new Set(result.edges.filter(e => e.sender === 'synthetic_H').map(e => e.receiver)).size, 2);
    }
  }
  assert.deepEqual(fixture.cases.filter(c => c.ts_overlap).map(c => c.name), ['fan', 'chain_cycle']);
  assert.match(GRAPH_SEMANTICS.comparison, /separate.*edge-inspection/);
});

test('frozen detached input, canonical identities and revision/prefix binding', () => {
  const c = fresh(), before = structuredClone(c), frozen = validate(c);
  assert.deepEqual(c, before); assert.notEqual(frozen.deliveries[0].event, c.deliveries[0].event);
  assert(Object.isFrozen(frozen.deliveries[0].event)); assert(Object.isFrozen(frozen.queries[0].coverage));
  assert.throws(() => { frozen.queries[0].currency = 'EUR'; });
  const reordered = Object.fromEntries(Object.entries(c).reverse());
  assert.equal(graphIdentity(c), graphIdentity(reordered));
  assert.equal(graphQueryIdentity(c, c.queries[0].id), graphQueryIdentity(reordered, c.queries[0].id));
  assert.match(graphSemanticsIdentity(), /^[0-9a-f]{64}$/);
  const queryHash = graphQueryIdentity(c, c.queries[0].id);
  assert.equal(graphIdentity(c), graphIdentity(JSON.parse(JSON.stringify(frozen))));
  c.queries[0].source_prefix--; assert.notEqual(graphIdentity(c), graphIdentity(before));
  assert.notEqual(graphQueryIdentity(c, c.queries[0].id), queryHash);
  assert.notEqual(graphNodeIdentity('synthetic_graph', 'synthetic_A'), graphNodeIdentity('synthetic_other', 'synthetic_A'));
  c.deliveries[0].event.amount = '99.00'; assert.equal(frozen.deliveries[0].event.amount, '10.00');
  const replay = generated([event('a'), event('a')]); assert.equal(selectGraph(replay, replay.queries[0].id).edges.length, 1);
  replay.deliveries[1].event.amount = '11.00'; assert.throws(() => validate(replay));
  const correction = structuredClone(fixture.cases.find(c => c.name === 'lifecycle').corpus);
  correction.queries[0].target.revision_number = 1;
  assert.equal(selectGraph(correction, correction.queries[0].id).reason, 'target_unavailable');
});

test('strict hostile input rejection without accessor execution', () => {
  let invoked = false;
  for (const mutate of [
    c => Object.defineProperty(c, 'mode', { get() { invoked = true; throw Error('getter'); }, enumerable: true }),
    c => { c[Symbol('hidden')] = 1; },
    c => { Object.setPrototypeOf(c, { exotic: true }); },
    c => { c.unknown = c; },
    c => { c.queries[0].coverage = new Date(); },
    c => { c.mode = 'production'; },
    c => { c.observed = {}; },
    c => { c.queries[0].expected = {}; },
    c => { c.queries[0].target.extra = true; },
    c => { c.deliveries[0].event.occurred_at = '2026-02-30T11:00:00.000Z'; },
    c => { c.deliveries[0].event.available_at = '2026-01-01T11:00:00+00:00'; },
    c => { c.deliveries[0].event.amount = 1; },
    c => { c.deliveries[0].event.amount = '1e2'; },
    c => { c.deliveries[0].event.reversed_amount = '11.00'; },
    c => { c.deliveries[0].event.status = 'succeeded'; c.deliveries[0].event.reversed_amount = '1.00'; },
    c => { c.queries[0].max_hops = 0; },
    c => { c.queries[0].window_seconds = 60; },
    c => { c.deliveries[1].source_position = 1; },
    c => { delete c.deliveries[0]; },
    c => { c.deliveries.extra = 1; },
    c => Object.defineProperty(c, 'secret', { value: 'hidden' }),
  ]) { const c = fresh(); mutate(c); assert.throws(() => validate(c)); }
  assert.equal(invoked, false);
  const hostileCounts = { nodes: 1, edges: 1, hops: 1, get paths() { invoked = true; return 1; } };
  assert.throws(() => graphBudget(hostileCounts));
  assert.throws(() => graphNodeIdentity('synthetic_graph', { toString() { invoked = true; return 'synthetic_A'; } }));
  assert.equal(invoked, false);
  assert.throws(() => parseGraphCorpus(JSON.stringify(fresh()) + '{}'));
  assert.equal(graphCents('9999999999999999999999.99'), 999999999999999999999999n);
  for (const bad of ['-1.00', '01.00', '1.0', 'NaN', '10000000000000000000000.00']) assert.throws(() => graphCents(bad));
});

test('stable equal-time ties, four-hop distinct chain, and supported empty evidence', () => {
  const tied = generated([event('z'), event('a'), event('m')]);
  assert.deepEqual(selectGraph(tied, tied.queries[0].id).edges.map(e => e.transaction_id), ['a', 'm', 'z']);
  const chain = generated(Array.from({ length: 4 }, (_, i) => ({ ...event(`e${i}`, `synthetic_n${i}`, `synthetic_n${i + 1}`), occurred_at: `2026-01-01T11:0${i + 1}:00.000Z` })));
  const r = selectGraph(chain, chain.queries[0].id);
  assert.deepEqual(r.edges.map(e => [e.sender, e.receiver]), [['synthetic_n0', 'synthetic_n1'], ['synthetic_n1', 'synthetic_n2'], ['synthetic_n2', 'synthetic_n3'], ['synthetic_n3', 'synthetic_n4']]);
  assert.deepEqual(manualObservations(r.edges).paths, [['e0', 'e1'], ['e1', 'e2'], ['e2', 'e3']]);
  for (const status of ['pending', 'failed', 'succeeded']) {
    const c = generated([{ ...event('empty'), status, amount: '0.00' }]);
    assert.equal(selectGraph(c, c.queries[0].id).status, 'available'); assert.deepEqual(selectGraph(c, c.queries[0].id).edges, []);
    c.queries[0].identity_status = 'unverified'; assert.equal(selectGraph(c, c.queries[0].id).status, 'unavailable');
  }
});

test('exact and one-over records, queries, hops and decoded UTF-8 bytes', () => {
  const c = generated(Array.from({ length: caps.records }, () => event('a')));
  assert.equal(validate(c).deliveries.length, 2000);
  c.deliveries.push({ source_position: 2001, event: event('a') }); assert.throws(() => validate(c));
  const q = fresh(); q.queries = Array.from({ length: 8 }, (_, i) => ({ ...structuredClone(q.queries[0]), id: `q${i}` })); assert.equal(validate(q).queries.length, 8);
  q.queries.push({ ...q.queries[0], id: 'q8' }); assert.throws(() => validate(q));
  const h = fresh(); h.queries[0].max_hops = 4; validate(h); h.queries[0].max_hops = 5; assert.throws(() => validate(h));
  const raw = JSON.stringify(fresh()), exact = raw + ' '.repeat(caps.bytes - Buffer.byteLength(raw));
  parseGraphCorpus(exact); assert.throws(() => parseGraphCorpus(exact + ' '));
  assert.throws(() => parseGraphCorpus(raw + 'é'.repeat(caps.bytes / 2)));
});

test('exact and one-over selected node/edge and emitted path-state budgets', () => {
  const counts = { nodes: 256, edges: 1024, hops: 4, paths: 5000 };
  assert.deepEqual(graphBudget(counts), { status: 'available' });
  for (const k of Object.keys(counts)) assert.deepEqual(graphBudget({ ...counts, [k]: counts[k] + 1 }), { status: 'unavailable', reason: 'budget_exceeded' });
  assert.throws(() => graphBudget({ ...counts, paths: -1 }));
  const nodes = generated(Array.from({ length: 255 }, (_, i) => event(`n${i}`, 'synthetic_hub', `synthetic_n${i}`)));
  assert.equal(selectGraph(nodes, nodes.queries[0].id).status, 'available');
  nodes.deliveries.push({ source_position: 256, event: event('over', 'synthetic_hub', 'synthetic_over') }); nodes.queries[0].source_prefix = 256;
  assert.deepEqual(selectGraph(nodes, nodes.queries[0].id).edges, []);
  assert.equal(selectGraph(nodes, nodes.queries[0].id).reason, 'budget_exceeded');
  const edges = generated(Array.from({ length: 1024 }, (_, i) => event(`e${i}`)));
  assert.equal(selectGraph(edges, edges.queries[0].id).edges.length, 1024);
  edges.deliveries.push({ source_position: 1025, event: event('over') }); edges.queries[0].source_prefix = 1025;
  assert.equal(selectGraph(edges, edges.queries[0].id).reason, 'budget_exceeded');
});

test('finite burst, skew and dense recipes stay inside approved caps', () => {
  const profiles = [
    generated(Array.from({ length: 128 }, (_, i) => event(`b${i}`, `synthetic_b${i}`, 'synthetic_hub'))),
    generated(Array.from({ length: 2000 }, () => event('replay'))),
    generated(Array.from({ length: 64 }, (_, i) => event(`d${i}`, `synthetic_l${Math.floor(i / 8)}`, `synthetic_r${i % 8}`))),
  ];
  for (let i = 0; i < profiles.length; i++) {
    profiles[i].queries[0].max_hops = fixture.profiles[i].hops;
    const r = selectGraph(profiles[i], profiles[i].queries[0].id), p = fixture.profiles[i];
    assert.equal(r.status, 'available'); assert.equal(r.edges.length, p.edges);
    assert.equal(new Set(r.edges.flatMap(e => [e.sender, e.receiver])).size, p.nodes);
    assert.deepEqual(manualObservations(r.edges), { paths: [], cycles: [] });
    assert.equal(r.edges.length, p.paths_upper_bound);
  }
});

test('hand-counted 5000 and 5001 emitted states on a bounded strict-time graph', () => {
  // 50 incoming + 97 outgoing + 50*97 two-edge paths + 3 isolated = 5000.
  const incoming = Array.from({ length: 50 }, (_, i) => event(`i${i}`, `synthetic_i${i}`, 'synthetic_hub'));
  const outgoing = Array.from({ length: 97 }, (_, i) => ({ ...event(`o${i}`, 'synthetic_hub', `synthetic_o${i}`), occurred_at: '2026-01-01T11:02:00.000Z' }));
  const isolated = Array.from({ length: 3 }, (_, i) => event(`x${i}`, `synthetic_x${i}`, `synthetic_y${i}`));
  const edges = [...incoming, ...outgoing, ...isolated];
  const counts = { nodes: new Set(edges.flatMap(e => [e.sender, e.receiver])).size, edges: edges.length, hops: 2, paths: edges.length + manualObservations(edges).paths.length };
  assert.equal(counts.paths, 5000); assert.equal(graphBudget(counts).status, 'available');
  edges.push(event('extra', 'synthetic_extra', 'synthetic_last'));
  const over = { nodes: counts.nodes + 2, edges: edges.length, hops: 2, paths: edges.length + manualObservations(edges).paths.length };
  assert.equal(over.paths, 5001); assert.deepEqual(graphBudget(over), { status: 'unavailable', reason: 'budget_exceeded' });
});

test('import is inert with no fixture reads, process launch or output', () => {
  const url = new URL('../dist/graph-benchmark-contract.js', import.meta.url).href;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(url)})`], { encoding: 'utf8', timeout: 10000, maxBuffer: 4096 });
  assert.equal(result.status, 0); assert.equal(result.stdout, ''); assert.equal(result.stderr, '');
});
