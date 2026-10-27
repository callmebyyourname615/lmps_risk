import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { benchmarkDesigns, designQueries, SHAPES, withDesignCluster } from '../scripts/transaction-design.mjs';

const script = fileURLToPath(new URL('../scripts/transaction-design.mjs', import.meta.url));
const example = ['9007199254740993', 'synthetic_alpha', 'synthetic_fixture', '000001',
  '2026-01-01', '2026-01-01T00:00:00.000Z', '9999999999999999999999.99', 'SYN'];

async function insert(pool, shape, values = example) {
  if (shape === 'current') return pool.query('INSERT INTO design_current.body VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', values);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('INSERT INTO design_partitioned.registry (id,workspace,synthetic_namespace,synthetic_key,routing_day) VALUES ($1,$2,$3,$4,$5)', values.slice(0, 5));
    await client.query('INSERT INTO design_partitioned.body (id,workspace,routing_day,occurred_at,amount,currency) VALUES ($1,$2,$3,$4,$5,$6)',
      [values[0], values[1], ...values.slice(4)]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

function relations(plan) {
  return [plan['Relation Name'], ...(plan.Plans ?? []).flatMap(relations)].filter(Boolean);
}

test('CLI rejects production, live mode and arguments before creating a cluster; diagnostics are fixed', () => {
  for (const [env, args] of [
    [{ NODE_ENV: 'production' }, []],
    [{ LMPS_ENVIRONMENT: 'production' }, []],
    [{ LMPS_EXECUTION_MODE: 'live' }, []],
    [{}, ['SYNTHETIC_PRIVATE_ARGUMENT']],
  ]) {
    const result = spawnSync(process.execPath, [script, ...args], {
      env: { ...process.env, NODE_ENV: 'test', LMPS_ENVIRONMENT: 'test', LMPS_EXECUTION_MODE: 'test', ...env },
      encoding: 'utf8', timeout: 5000,
    });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, 'Transaction design experiment failed; no credentials or database diagnostics printed.\n');
  }
  assert.throws(() => designQueries('current; DROP SCHEMA public'), /Unknown experimental design/);
});

test('native transaction design comparison and key correctness', async t => {
  let base;
  await withDesignCluster(async (pool, directory) => {
    base = directory;
    await t.test('matched datasets, bounded measurements, exact scoped lookup, pruning and complete keyset pagination', async () => {
      const report = await benchmarkDesigns(pool);
      assert.equal(report.canonical_emission, false);
      assert.equal(report.decision_status, 'experimental');
      assert.equal(report.workload.rows_per_design, 10000);
      assert.deepEqual(report.designs.current.dataset, report.designs.partitioned.dataset);
      for (const shape of SHAPES) {
        const measured = report.designs[shape];
        assert.ok(BigInt(measured.storage.total_bytes) > 0n);
        assert.ok(BigInt(measured.load.wal_bytes) > 0n);
        for (const metric of Object.values(measured.queries)) {
          assert.equal(metric.samples, 50);
          assert.ok(Number.isFinite(metric.p99_ms) && metric.p99_ms >= metric.p95_ms && metric.p95_ms >= metric.p50_ms);
          assert.ok(metric.plan.Plan);
        }
        const q = designQueries(shape);
        const result = await pool.query(q.lookup, ['synthetic_beta', 'synthetic_fixture', '00010000']);
        assert.equal(result.rows[0].id, '9007199254750992');
        assert.equal((await pool.query(q.lookup, ['synthetic_alpha', 'synthetic_fixture', '00010000'])).rowCount, 0);
        for (const workspace of ['synthetic_alpha', 'synthetic_beta']) {
          const actual = [];
          let page = await pool.query(q.timeline, [workspace]);
          while (page.rowCount) {
            actual.push(...page.rows.map(row => row.id));
            assert.ok(actual.length <= 10000, 'cursor must advance');
            const last = page.rows.at(-1);
            page = await pool.query(q.next, [workspace, last.occurred_at.toISOString(), last.id]);
          }
          const expected = await pool.query(`SELECT id FROM design_${shape}.body WHERE workspace=$1 ORDER BY occurred_at DESC,id DESC`, [workspace]);
          assert.deepEqual(actual, expected.rows.map(row => row.id));
          assert.equal(new Set(actual).size, workspace === 'synthetic_alpha' ? 9000 : 1000);
        }
      }
      assert.deepEqual(relations(report.designs.partitioned.queries.routed.plan.Plan), ['body_feb']);
      assert.deepEqual(new Set(relations(report.designs.partitioned.queries.hot_first.plan.Plan)), new Set(['body_jan', 'body_feb', 'body_mar']));
    });

    t.beforeEach(async () => {
      await pool.query('TRUNCATE design_current.body, design_partitioned.body, design_partitioned.registry');
    });

    await t.test('complete synthetic business keys remain unique across dates; scope and namespace are separate', async () => {
      for (const shape of SHAPES) {
        await insert(pool, shape);
        await assert.rejects(insert(pool, shape, ['2', ...example.slice(1, 4), '2026-02-01', ...example.slice(5)]), { code: '23505' });
        await insert(pool, shape, ['2', 'synthetic_beta', ...example.slice(2)]);
        await insert(pool, shape, ['3', example[1], 'synthetic_other', ...example.slice(3)]);
        await assert.rejects(insert(pool, shape, ['4', ...example.slice(1, 3), null, ...example.slice(4)]), { code: '23502' });
        assert.equal((await pool.query(`SELECT count(*)::int AS n FROM design_${shape}.body`)).rows[0].n, 3);
      }
    });

    await t.test('bigint, maximum exact money and leading-zero keys survive lookup and JSON round-trip', async () => {
      for (const shape of SHAPES) {
        await insert(pool, shape);
        const q = designQueries(shape);
        const row = JSON.parse(JSON.stringify((await pool.query(q.lookup, example.slice(1, 4))).rows[0]));
        assert.equal(row.id, example[0]);
        assert.equal(row.amount, example[6]);
        assert.equal((await pool.query(q.lookup, [example[1], example[2], '1'])).rowCount, 0);
        await assert.rejects(insert(pool, shape, ['2', ...example.slice(1, 3), 'overflow', ...example.slice(4, 6), '10000000000000000000000.00', 'SYN']), { code: '22003' });
      }
    });

    await t.test('global IDs, routing date and workspace cannot bypass the registry foreign key', async () => {
      await insert(pool, 'current');
      await assert.rejects(insert(pool, 'current', [example[0], ...example.slice(1, 3), 'other', ...example.slice(4)]), { code: '23505' });
      await insert(pool, 'partitioned');
      await assert.rejects(insert(pool, 'partitioned', [example[0], ...example.slice(1, 3), 'other', '2026-02-01', ...example.slice(5)]), { code: '23505' });
      for (const values of [[example[0], '2026-02-01', example[1]], ['2', example[4], example[1]]]) {
        await assert.rejects(pool.query('INSERT INTO design_partitioned.body VALUES ($1,$2,$3,$4,$5,$6)',
          [...values, ...example.slice(5)]), { code: '23503' });
      }
      await assert.rejects(pool.query("UPDATE design_partitioned.body SET workspace='synthetic_beta' WHERE id=$1", [example[0]]), { code: '23503' });
    });

    await t.test('failed body writes roll back the registry; missing partitions reject instead of losing rows', async () => {
      for (const shape of SHAPES) {
        await assert.rejects(insert(pool, shape, [...example.slice(0, 6), '-1.00', 'SYN']), { code: '23514' });
        assert.equal((await pool.query(`SELECT count(*)::int AS n FROM design_${shape}.body`)).rows[0].n, 0);
      }
      await assert.rejects(insert(pool, 'partitioned', [...example.slice(0, 4), '2026-04-01', ...example.slice(5)]), { code: '23514' });
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM design_partitioned.registry')).rows[0].n, 0);
    });

    await t.test('two competing inserts produce one complete row and one uniqueness rejection in both designs', async () => {
      for (const shape of SHAPES) {
        const results = await Promise.allSettled([insert(pool, shape), insert(pool, shape, ['2', ...example.slice(1)])]);
        assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
        assert.equal(results.find(result => result.status === 'rejected').reason.code, '23505');
        assert.equal((await pool.query(`SELECT count(*)::int AS n FROM design_${shape}.body`)).rows[0].n, 1);
      }
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM design_partitioned.registry')).rows[0].n, 1);
    });

    await t.test('cursor preserves BIGINT ordering when identical timestamps cross a page boundary', async () => {
      for (const shape of SHAPES) {
        const expected = [];
        for (let i = 0; i < 30; i++) {
          const id = String(BigInt(example[0]) + BigInt(i));
          expected.unshift(id);
          await insert(pool, shape, [id, ...example.slice(1, 3), String(i).padStart(6, '0'), ...example.slice(4)]);
        }
        const q = designQueries(shape);
        const first = await pool.query(q.timeline, [example[1]]);
        const last = first.rows.at(-1);
        const next = await pool.query(q.next, [example[1], last.occurred_at.toISOString(), last.id]);
        assert.equal(first.rowCount, 25);
        assert.equal(next.rowCount, 5);
        assert.deepEqual([...first.rows, ...next.rows].map(row => row.id), expected);
      }
    });

    await t.test('late corrected occurrence time remains discoverable without guessing the routing day', async () => {
      for (const shape of SHAPES) {
        await insert(pool, shape);
        await pool.query(`UPDATE design_${shape}.body SET occurred_at='2026-04-10T00:00:00Z' WHERE id=$1`, [example[0]]);
        const q = designQueries(shape);
        const row = (await pool.query(q.timeline, [example[1]])).rows[0];
        assert.equal(row.routing_day, '2026-01-01');
        assert.equal(row.occurred_at.toISOString(), '2026-04-10T00:00:00.000Z');
        assert.equal((await pool.query(q.lookup, example.slice(1, 4))).rows[0].id, example[0]);
      }
    });
  });
  await assert.rejects(lstat(base), { code: 'ENOENT' });
});

test('a failed experiment stops and removes its disposable cluster before propagating failure', async () => {
  let base;
  await assert.rejects(withDesignCluster(async (_pool, directory) => {
    base = directory;
    throw new Error('synthetic experiment failure');
  }), /synthetic experiment failure/);
  await assert.rejects(lstat(base), { code: 'ENOENT' });
});
