import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { transactionListFixture } from './fixtures/transaction-list.mjs';
let f;
before(async () => { f = await transactionListFixture(); });
after(async () => { await f?.close(); });
const get = async (query = '', changes) => f.app.inject({ method: 'GET', url: '/v1/local/transactions' + query, headers: { authorization: 'Bearer ' + await f.token(changes) } });
test('list returns one latest revision per namespace/opaque ID in scoped C order and preserves exact amount/time', async () => {
  const response = await get('?limit=100'), body = response.json();
  assert.equal(response.statusCode, 200); assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(body.items.length, f.expected.length); assert.equal(body.next_cursor, null);
  assert.deepEqual(body.items.map(({ namespace, transaction_id, revision_number, amount }) => ({ namespace, transaction_id, revision_number, amount })), f.expected);
  const exact = body.items.find(row => row.transaction_id === '0009007199254740993');
  assert.equal(exact.amount, '9999999999999999999999.99'); assert.equal(exact.revision_number, 3); assert.equal(exact.observed_at, '2026-10-18T10:00:00Z');
  assert.equal(body.canonical_emission, false); assert.equal(body.source_semantics, 'unverified');
  assert.ok(body.items.every(row => Object.keys(row).length === 8));
  assert.ok(!JSON.stringify(body).includes('sender') && !JSON.stringify(body).includes('foreign_secret'));
});
test('tuple keyset pagination traverses every latest transaction exactly once with limit+1 lookahead', async () => {
  const rows = []; let after;
  do {
    const body = (await get('?' + new URLSearchParams({ limit: '7', ...(after ? { after } : {}) }))).json();
    assert.ok(body.items.length <= 7); rows.push(...body.items); after = body.next_cursor;
  } while (after);
  assert.deepEqual(rows.map(row => [row.namespace, row.transaction_id]), f.expected.map(row => [row.namespace, row.transaction_id]));
  assert.equal(new Set(rows.map(row => JSON.stringify([row.namespace, row.transaction_id]))).size, rows.length);
});
test('mutable status and currency filters apply to latest revisions; ID prefixes treat underscores literally and preserve case/zeros', async () => {
  assert.deepEqual((await get('?status=succeeded')).json().items, []);
  const failed = (await get('?status=failed')).json().items;
  assert.equal(failed.length, 1); assert.equal(failed[0].revision_number, 2);
  assert.equal((await get('?currency=USD&q=currency_changes')).json().items.length, 0);
  assert.equal((await get('?currency=EUR&q=currency_changes')).json().items[0].revision_number, 2);
  assert.deepEqual((await get('?q=literal_')).json().items.map(row => row.transaction_id), ['literal_1']);
  assert.deepEqual((await get('?q=Alpha')).json().items.map(row => row.transaction_id), ['Alpha_1']);
  assert.deepEqual((await get('?namespace=synthetic_transactions&q=001')).json().items.map(row => row.transaction_id), ['001']);
});
test('cursor is bound to verified workspace and applied filters; invalid/duplicated/unbounded queries are redacted', async () => {
  const after = (await get('?limit=1')).json().next_cursor;
  assert.equal((await get('?' + new URLSearchParams({ after, currency: 'USD' }))).statusCode, 400);
  assert.equal((await get('?' + new URLSearchParams({ after }), { workspace_key: 'synthetic_other' })).statusCode, 400);
  for (const query of ['limit=0','limit=101','limit=01','namespace=real_bank','q=%25','currency=usd','status=verified','after=bad','after=','q=one&q=two','workspace_key=synthetic_other','order=desc']) {
    const response = await get('?' + query); assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json(), { code: 'INVALID_QUERY', message: 'Invalid local transaction list query.' });
  }
});
test('independent scope and workspace isolate list reads; OpenAPI describes the new read without path-only parameters', async () => {
  assert.equal((await f.app.inject('/v1/local/transactions')).statusCode, 401);
  assert.equal((await get('', { scope: 'alerts:read' })).statusCode, 403);
  const other = (await get('', { workspace_key: 'synthetic_other' })).json();
  assert.deepEqual(other.items.map(row => row.transaction_id), ['foreign_secret']);
  assert.deepEqual((await get('', { workspace_key: 'synthetic_empty' })).json().items, []);
  const spec = (await f.app.inject('/openapi.json')).json(), operation = spec.paths['/v1/local/transactions'].get;
  assert.equal(operation.responses['200'].content['application/json'].schema.$ref, '#/components/schemas/TransactionListPage');
  assert.ok(operation.security); assert.ok(operation.parameters.every(parameter => parameter.in === 'query'));
  assert.equal((await f.app.inject({ method: 'POST', url: '/v1/local/transactions', headers: { authorization: 'Bearer ' + await f.token() } })).statusCode, 404);
});
test('invalid stored latest revision and real database outage fail closed without fixture fallback', async () => {
  const sql = "SELECT payload FROM platform.local_transaction_revisions WHERE workspace_key='synthetic_local' AND namespace='synthetic_transactions' AND transaction_id='001' AND revision_number=1";
  const original = (await f.owner.pool.query(sql)).rows[0].payload;
  try {
    await f.owner.pool.query("UPDATE platform.local_transaction_revisions SET payload=jsonb_set(payload,'{observed_at}',to_jsonb('PRIVATE_CANARY'::text)) WHERE workspace_key='synthetic_local' AND namespace='synthetic_transactions' AND transaction_id='001' AND revision_number=1");
    const response = await get('?namespace=synthetic_transactions&q=001'); assert.equal(response.statusCode, 503); assert.ok(!response.body.includes('PRIVATE_CANARY'));
  } finally { await f.owner.pool.query("UPDATE platform.local_transaction_revisions SET payload=$1 WHERE workspace_key='synthetic_local' AND namespace='synthetic_transactions' AND transaction_id='001' AND revision_number=1", [original]); }
  await f.stopDatabase();
  try { assert.equal((await get()).statusCode, 503); }
  finally { await f.startDatabase(); }
  assert.equal((await get()).statusCode, 200);
});
