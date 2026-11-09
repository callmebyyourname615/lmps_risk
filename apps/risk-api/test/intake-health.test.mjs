import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { createDatabase, readIntakeHealth, analyzeIntakeRevisionHistory } from '@lmps/database';
import { dsn } from '../../../packages/database/scripts/local.mjs';
import { intakeHealthFixture, INTAKE_HEALTH_SCOPES } from './fixtures/intake-health.mjs';
import { createApp } from '../dist/app.js';

let fixture;
const path = '/v1/local/source/health';
before(async () => { fixture = await intakeHealthFixture(); });
after(async () => { await fixture?.close(); });
const request = async (changes = {}, suffix = '', method = 'GET') => fixture.app.inject({ method, url: path + suffix, headers: { authorization: 'Bearer ' + await fixture.token(changes) } });
test('aggregate audit uses the configured namespace and exposes no private rows or demo results', async () => {
  const response = await request(); assert.equal(response.statusCode, 200, response.body);
  const health = response.json(), audit = analyzeIntakeRevisionHistory(fixture.rows, 'synthetic_local', 'synthetic_csv');
  for (const key of Object.keys(audit).filter(key => key !== 'format')) assert.deepEqual(health[key], audit[key], key);
  assert.equal(health.format, 'lmps-intake-health-1'); assert.equal(health.consistency, 'request_repeatable_read');
  assert.equal(health.demo_results_included, false); assert.equal(health.transactions, 4); assert.equal(health.stored_revisions, 6);
  assert.equal(health.waiting_policy, 1); assert.deepEqual(health.currency_policies, [{ currency: 'LAK', state: 'configured' }, { currency: 'THB', state: 'waiting_policy' }]);
  assert.equal(response.headers['cache-control'], 'no-store'); assert.equal(new Date(health.as_of).toISOString(), health.as_of);
  for (const row of fixture.rows) { assert.ok(!response.body.includes(row.transaction_id)); assert.ok(!response.body.includes(row.publication.origin.values[2])); }
  for (const field of ['payload', 'publication', 'transaction_id', 'approved_by', 'raw', 'threshold']) assert.ok(!Object.hasOwn(health, field));
  const schema = (await fixture.app.inject({ method: 'GET', url: '/openapi.json' })).json();
  assert.ok(schema.paths[path].get.responses['200'].content['application/json'].schema.required.includes('demo_results_included'));
});
test('all three scopes, signed workspace and fixed query boundaries are enforced', async () => {
  for (const missing of ['source:read', 'transactions:read', 'policies:read']) {
    assert.equal((await request({ scope: INTAKE_HEALTH_SCOPES.split(' ').filter(scope => scope !== missing).join(' ') })).statusCode, 403);
  }
  assert.equal((await fixture.app.inject({ method: 'GET', url: path })).statusCode, 401);
  assert.equal((await request({ exp: Math.floor(Date.now() / 1000) - 1 })).statusCode, 401);
  const foreign = (await request({ workspace_key: 'synthetic_other' })).json();
  assert.equal(foreign.workspace, 'synthetic_other'); assert.equal(foreign.transactions, 0); assert.deepEqual(foreign.currency_policies, []);
  for (const suffix of ['?namespace=synthetic_other', '?workspace=synthetic_other', '?path=/tmp/private', '?namespace=a&namespace=b', '?limit=1']) assert.equal((await request({}, suffix)).statusCode, 400);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal((await request({}, '', method)).statusCode, 404);
  const scoped = createDatabase(dsn(fixture.state), 'app', 'synthetic_other');
  try { const health = await readIntakeHealth(scoped.pool, 'synthetic_local'); assert.equal(health.namespace, 'synthetic_other'); assert.equal(health.transactions, 0); }
  finally { await scoped.close(); }
  const automated = createDatabase(dsn(fixture.state), 'app', 'synthetic_automated');
  try { const health = await readIntakeHealth(automated.pool, 'synthetic_local'); assert.equal(health.namespace, 'synthetic_automated'); assert.equal(health.transactions, 1); }
  finally { await automated.close(); }
});
test('missing storage and oversized scopes return fixed unavailability without partial evidence', async () => {
  await assert.rejects(createApp({ LMPS_ENVIRONMENT: 'test', LMPS_LOCAL_AUTH_CONFIG: fixture.authPath }), /requires an absolute private config path and app database/);
  for (const metadata of [{ revisions: 10_001, bytes: '1' }, { revisions: 1, bytes: String(64 * 1024 * 1024 + 1) }]) {
    const statements = []; let released = false;
    const pool = { async connect() { return { release() { released = true; }, async query(query) {
      statements.push(query);
      if (query.startsWith('SELECT transaction_timestamp')) return { rows: [{ at: new Date(), namespace: 'synthetic_csv' }] };
      if (query.startsWith('SELECT count(*)')) return { rows: [metadata] };
      if (query.startsWith('SELECT workspace_key')) assert.fail('must not fetch oversized private rows');
      return { rows: [] };
    } }; } };
    await assert.rejects(readIntakeHealth(pool, 'synthetic_local'), error => error.code === 'INTAKE_HEALTH_SCOPE_TOO_LARGE');
    assert.equal(statements.at(-1), 'ROLLBACK'); assert.ok(released);
  }
});
test('corrupt policy evidence fails closed and the approved binding recovers', async () => {
  const original = (await fixture.owner.pool.query('SELECT policy_id,policy_version,policy FROM platform.local_risk_policy_versions')).rows[0];
  try {
    await fixture.owner.pool.query("UPDATE platform.local_risk_policy_versions SET policy=jsonb_set(policy,'{currency}','\"THB\"') WHERE policy_id=$1 AND policy_version=$2", [original.policy_id, original.policy_version]);
    const response = await request(); assert.equal(response.statusCode, 503); assert.equal(response.json().code, 'INTAKE_HEALTH_UNAVAILABLE');
  } finally { await fixture.owner.pool.query('UPDATE platform.local_risk_policy_versions SET policy=$1 WHERE policy_id=$2 AND policy_version=$3', [original.policy, original.policy_id, original.policy_version]); }
  assert.equal((await request()).json().waiting_policy, 1);
});
test('a mixed-provenance latest revision cannot silently reveal older successful totals', async () => {
  const row = fixture.rows.find(value => value.revision_number === 2);
  const parameters = [row.workspace_key, row.namespace, row.transaction_id, row.revision_number];
  try {
    await fixture.owner.pool.query("UPDATE platform.local_transaction_revisions SET provenance='local_synthetic',publication=NULL,payload=jsonb_set(payload,'{transaction_status}','\"unknown\"') WHERE workspace_key=$1 AND namespace=$2 AND transaction_id=$3 AND revision_number=$4", parameters);
    const response = await request(); assert.equal(response.statusCode, 503); assert.equal(response.json().code, 'INTAKE_HEALTH_UNAVAILABLE');
  } finally { await fixture.owner.pool.query("UPDATE platform.local_transaction_revisions SET provenance='user_supplied_file',publication=$5,payload=$6 WHERE workspace_key=$1 AND namespace=$2 AND transaction_id=$3 AND revision_number=$4", [...parameters, row.publication, row.payload]); }
  assert.equal((await request()).json().transactions, 4);
});
test('repeatable read keeps revisions and policy selection in the same read-only snapshot', async () => {
  const database = createDatabase(dsn(fixture.state), 'app', 'synthetic_csv');
  let snapshotTaken = false;
  const pool = { async connect() {
    const client = await database.pool.connect();
    return { release: discard => client.release(discard), async query(query, parameters) {
      const result = await client.query(query, parameters);
      if (typeof query === 'string' && query.startsWith('SELECT transaction_timestamp')) {
        assert.equal((await client.query('SHOW transaction_read_only')).rows[0].transaction_read_only, 'on');
        await fixture.owner.pool.query("DELETE FROM platform.local_risk_policy_bindings WHERE workspace_key='synthetic_local' AND namespace='synthetic_csv'");
        snapshotTaken = true;
      }
      return result;
    } };
  } };
  try {
    const health = await readIntakeHealth(pool, 'synthetic_local'); assert.ok(snapshotTaken); assert.equal(health.waiting_policy, 1);
    assert.equal((await readIntakeHealth(database.pool, 'synthetic_local')).waiting_policy, 4);
  } finally { await database.close(); }
});
test('database outage recovers without healthy zeroes; corrupt evidence is withheld', async () => {
  await fixture.stopDatabase();
  const unavailable = await request(); assert.equal(unavailable.statusCode, 503); assert.equal(unavailable.json().code, 'INTAKE_HEALTH_UNAVAILABLE'); assert.ok(!unavailable.body.includes('transactions'));
  await fixture.startDatabase(); assert.equal((await request()).statusCode, 200);
  const row = fixture.rows[0];
  await fixture.owner.pool.query("UPDATE platform.local_transaction_revisions SET publication=jsonb_set(publication,'{origin,values,0}',to_jsonb('9999999999'::text)) WHERE workspace_key=$1 AND namespace=$2 AND transaction_id=$3 AND revision_number=1", [row.workspace_key, row.namespace, row.transaction_id]);
  const corrupt = await request(); assert.equal(corrupt.statusCode, 503); assert.equal(corrupt.json().code, 'INTAKE_HEALTH_UNAVAILABLE'); assert.ok(!corrupt.body.includes(row.transaction_id));
});
