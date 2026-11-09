import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, symlink, lstat } from 'node:fs/promises';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { graphSqlPlan, graphSqlProfiles } from '../dist/graph-sql.js';
import { graphIdentity } from '../dist/graph-benchmark-contract.js';
import { parseArguments, runGraphSqlBaseline, encodeGraphSqlEvidence } from '../scripts/graph-sql-baseline.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const script = fileURLToPath(new URL('../scripts/graph-sql-baseline.mjs', import.meta.url));
const fixture = JSON.parse(readFileSync(new URL('../fixtures/graph-benchmark.json', import.meta.url)));
const fresh = () => structuredClone(fixture.cases[0].corpus);

test('SQL unit: inert import, strict CLI and no public injected runner', () => {
  assert.equal(runGraphSqlBaseline.length, 1);
  for (const args of [[], ['--output'], ['--output','/tmp/x'], ['--output',join(root,'.local/postgres-copy')], ['--output',join(root,'.local/x'),'--sql','SELECT 1'], ['--dsn','postgres://localhost']]) {
    assert.throws(() => parseArguments(args), /GRAPH_SQL_INVALID/);
  }
  assert.equal(parseArguments(['--output',join(root,'.local/graph-unit-unused')]), join(root,'.local/graph-unit-unused'));
});

test('SQL unit: plans detach/freeze and bind only raw input/query, never expected results', () => {
  for (const entry of fixture.cases) {
    const before = JSON.stringify(entry.corpus), plan = graphSqlPlan(entry.corpus);
    assert.equal(plan.corpus_sha256, graphIdentity(entry.corpus));
    assert.equal(JSON.stringify(entry.corpus), before);
    assert.deepEqual(JSON.parse(plan.load.values[0]), entry.corpus.deliveries);
    assert.match(plan.setup, /^CREATE TEMP TABLE/);
    for (let i = 0; i < plan.queries.length; i++) {
      const p = plan.queries[i];
      assert.deepEqual(p.values, [JSON.stringify(entry.corpus.queries[i])]);
      assert.match(p.text, /WITH RECURSIVE/);
      assert.match(p.text, /LIMIT 5001/);
      assert.match(p.text, /e\.t>w\.t/);
      assert.match(p.text, /numeric\(30,0\)::text/);
      assert.match(p.text, /budget_exceeded/);
      assert.ok(!p.text.includes(entry.corpus.queries[i].id));
      assert.ok(Object.isFrozen(p) && Object.isFrozen(p.values));
    }
  }
  const c = fresh(), plan = graphSqlPlan(c);
  c.deliveries[0].event.amount = '999.00';
  assert.notEqual(plan.load.values[0], JSON.stringify(c.deliveries));
});

test('SQL unit: invalid, forged, changed replay and hard byte bounds reject before native import', () => {
  const invalid = [];
  let c = fresh(); c.expected = {}; invalid.push(c);
  c = fresh(); c.mode = 'production'; invalid.push(c);
  c = fresh(); c.queries[0].max_hops = 5; invalid.push(c);
  c = fresh(); c.deliveries.push({ source_position: 2001, event: {...c.deliveries[0].event, amount:'999.00'} }); invalid.push(c);
  c = fresh(); c.corpus_id = 'x'.repeat(2097153); invalid.push(c);
  c = fresh(); Object.defineProperty(c,'deliveries',{ enumerable:true,get(){ throw Error('getter executed'); } }); invalid.push(c);
  for (const input of invalid) assert.throws(() => graphSqlPlan(input), /GRAPH_CONTRACT_INVALID/);
});

test('SQL unit: frozen finite profile expansion supplies raw inputs with reproducible identities', () => {
  const profiles = graphSqlProfiles(fresh());
  assert.deepEqual(profiles.map(c => c.deliveries.length),[128,2000,64]);
  assert.deepEqual(profiles.map(graphIdentity),graphSqlProfiles(fresh()).map(graphIdentity));
  assert.equal(new Set(profiles[1].deliveries.map(d => JSON.stringify(d.event))).size,1);
  assert.equal(new Set(profiles[2].deliveries.flatMap(d => [d.event.sender,d.event.receiver])).size,16);
  for (const corpus of profiles) assert.ok(Object.isFrozen(corpus) && graphSqlPlan(corpus).load.values[0].length <= 2097152);
});

test('SQL subprocess: malformed CLI emits only sanitized fixed error, no database command', () => {
  const child = spawnSync(process.execPath,[script,'--output','/tmp/forbidden'], { encoding:'utf8', timeout:5000, maxBuffer:4096 });
  assert.equal(child.status, 1);
  assert.equal(child.stdout, '');
  assert.equal(child.stderr.trim(), 'GRAPH_SQL_UNAVAILABLE');
  const imported = spawnSync(process.execPath,['--input-type=module','-e',`await import(${JSON.stringify(new URL('../scripts/graph-sql-baseline.mjs',import.meta.url).href)})`], { encoding:'utf8', timeout:5000,maxBuffer:4096 });
  assert.equal(imported.status, 0);
  assert.equal(imported.stdout + imported.stderr, '');
});

test('SQL unit: publication fails closed for wrong scope, timeout, uncertain cleanup and oversized output', () => {
  const report = { scope:'local_synthetic',production_ready:false,cleanup:'confirmed',elapsed_ms:1 };
  assert.equal(JSON.parse(encodeGraphSqlEvidence(report)).cleanup,'confirmed');
  for (const change of [{scope:'production'}, {production_ready:true}, {cleanup:'unknown'}, {elapsed_ms:180001}, {elapsed_ms:NaN}, {payload:'x'.repeat(16777216)}]) {
    assert.throws(() => encodeGraphSqlEvidence({...report,...change}),/GRAPH_SQL_INVALID/);
  }
});

test('SQL path guards: existing destination and symlink ancestors reject before native discovery', async () => {
  await mkdir(join(root,'.local'),{recursive:true,mode:0o700});
  const privateRoot = await mkdtemp(join(root,'.local/graph-path-unit-'));
  try {
    await assert.rejects(runGraphSqlBaseline(privateRoot),/GRAPH_SQL_INVALID/);
    await symlink(privateRoot,join(privateRoot,'link'));
    await assert.rejects(runGraphSqlBaseline(join(privateRoot,'link','output')),/GRAPH_SQL_INVALID/);
  } finally { await rm(privateRoot,{recursive:true,force:true}); }
});

test('parent-host native: actual default PostgreSQL runner; pending in coding sandbox', { skip: process.env.LMPS_GRAPH_PARENT_NATIVE !== '1', timeout:185000 }, async () => {
  const output = join(root,'.local',`graph-native-${process.pid}-${Date.now()}`);
  const report = await runGraphSqlBaseline(output);
  assert.equal(report.cleanup,'confirmed');
  assert.equal(report.scope,'local_synthetic');
  assert.equal(report.production_ready,false);
  assert.ok(report.elapsed_ms <= 180000);
  assert.equal(report.observations.length,fixture.cases.length+3);
  for (const row of report.observations) for (const q of row.queries) {
    assert.ok(q.query_ms >= 0 && q.explain.length > 0);
    const entry = fixture.cases.find(c => c.name === row.name);
    if (!entry) {
      const expected = {burst:[129,128,128,'128000'],skew:[2,1,1,'1000'],dense:[16,64,64,'64000']}[row.name];
      assert.deepEqual(q.observation.availability,{status:'available'});
      const m = q.observation.metrics;
      assert.deepEqual([m.nodes,m.edges,m.emitted_path_states,m.net_cents],expected);
      continue;
    }
    const oracle = entry.oracle;
    assert.equal(q.observation.availability.status,oracle.status);
    if (oracle.status === 'unavailable') {
      assert.equal(q.observation.availability.reason,oracle.reason);
      assert.equal(q.observation.metrics,null);
    } else {
      const metrics = q.observation.metrics;
      assert.equal(metrics.net_cents,oracle.net_cents);
      assert.equal(metrics.edges,oracle.edge_ids.length);
      assert.deepEqual(metrics.paths.filter(p => p.edges.length === 2).map(p => p.edges.map(e => e.transaction_id)).sort(),[...oracle.paths_2].sort());
      assert.deepEqual(metrics.cycles.map(p => p.edges.map(e => e.transaction_id)).sort(),[...oracle.cycles].sort());
      if (row.name === 'fan') {
        assert.equal(metrics.fan_in.find(n => n.handle === 'synthetic_H').count,2);
        assert.equal(metrics.fan_out.find(n => n.handle === 'synthetic_H').count,2);
      }
    }
  }
});

test('parent-host native failure: missing installed runtime publishes no SQL proof', { skip:process.env.LMPS_GRAPH_PARENT_NATIVE !== '1',timeout:20000 }, async () => {
  const output = join(root,'.local',`graph-missing-runtime-${process.pid}-${Date.now()}`);
  const env = {...process.env,PATH:''};
  for (const key of Object.keys(env)) if (key.startsWith('PG') || key === 'LMPS_PG_BIN' || key.includes('POSTGRES_DSN')) delete env[key];
  const child = spawnSync(process.execPath,[script,'--output',output],{env,encoding:'utf8',timeout:15000,maxBuffer:4096});
  assert.equal(child.status,1);
  assert.equal(child.stderr.trim(),'GRAPH_SQL_UNAVAILABLE');
  assert.throws(() => readFileSync(join(output,'sql.json')));
  await rm(output,{recursive:true,force:true});
});

test('parent-host native interruption: default runner uses the deadline abort path and confirms teardown', { skip:process.env.LMPS_GRAPH_PARENT_NATIVE !== '1',timeout:180000 }, async () => {
  const output = join(root,'.local',`graph-interrupt-${process.pid}-${Date.now()}`);
  const child = spawn(process.execPath,[script,'--output',output],{stdio:['ignore','pipe','pipe']});
  let bytes = 0, closed = false, interrupted = false;
  child.stdout.on('data',b => { bytes += b.length; });
  child.stderr.on('data',b => { bytes += b.length; });
  const done = new Promise((accept,reject) => { child.once('error',reject); child.once('close',code => { closed = true; accept(code); }); });
  const start = performance.now();
  try {
    while (!closed && performance.now()-start < 145000) {
      try {
        await lstat(join(output,'cluster','data','postmaster.pid'));
        interrupted = true; child.kill('SIGTERM'); break;
      } catch (e) { if (e.code !== 'ENOENT') throw e; }
      await new Promise(accept => setTimeout(accept,10));
    }
    assert.ok(interrupted,'must interrupt the actual owned PostgreSQL lifecycle');
    assert.equal(await done,1);
    assert.ok(bytes <= 4096);
    await assert.rejects(lstat(join(output,'cluster')),e => e.code === 'ENOENT');
    await assert.rejects(lstat(join(output,'sql.json')),e => e.code === 'ENOENT');
  } finally {
    if (!closed) { child.kill('SIGTERM'); await done; }
    // A failed cleanup is deliberately retained for parent inspection.
    try { await lstat(join(output,'cluster')); } catch (e) { if (e.code === 'ENOENT') await rm(output,{recursive:true,force:true}); }
  }
});
