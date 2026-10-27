import { performance } from 'node:perf_hooks';
import { arch, cpus, platform, release, tmpdir, totalmem } from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { availablePort, dsn, initializeCluster, loadState, localMode, startCluster, stopCluster } from './local.mjs';

export const SHAPES = ['current', 'partitioned'];
const ROWS = 10000;
const SAMPLES = 50;

// Experimental DDL lives only in a newly created disposable cluster, never in the migration ledger.
async function createTables(pool) {
  await pool.query(`
    CREATE SCHEMA design_current;
    CREATE SCHEMA design_partitioned;
    CREATE TABLE design_current.body (
      id bigint PRIMARY KEY,
      workspace text NOT NULL,
      synthetic_namespace text NOT NULL,
      synthetic_key text NOT NULL,
      routing_day date NOT NULL,
      occurred_at timestamptz NOT NULL,
      amount numeric(24,2) NOT NULL CHECK (amount >= 0),
      currency text NOT NULL,
      UNIQUE (workspace, synthetic_namespace, synthetic_key)
    );
    CREATE INDEX ON design_current.body (workspace, occurred_at DESC, id DESC);
    CREATE TABLE design_partitioned.registry (
      id bigint PRIMARY KEY,
      routing_day date NOT NULL,
      workspace text NOT NULL,
      synthetic_namespace text NOT NULL,
      synthetic_key text NOT NULL,
      UNIQUE (workspace, synthetic_namespace, synthetic_key),
      UNIQUE (id, routing_day, workspace)
    );
    CREATE TABLE design_partitioned.body (
      id bigint NOT NULL,
      routing_day date NOT NULL,
      workspace text NOT NULL,
      occurred_at timestamptz NOT NULL,
      amount numeric(24,2) NOT NULL CHECK (amount >= 0),
      currency text NOT NULL,
      PRIMARY KEY (routing_day, id),
      FOREIGN KEY (id, routing_day, workspace)
        REFERENCES design_partitioned.registry (id, routing_day, workspace)
    ) PARTITION BY RANGE (routing_day);
    CREATE TABLE design_partitioned.body_jan PARTITION OF design_partitioned.body
      FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
    CREATE TABLE design_partitioned.body_feb PARTITION OF design_partitioned.body
      FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
    CREATE TABLE design_partitioned.body_mar PARTITION OF design_partitioned.body
      FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
    CREATE INDEX ON design_partitioned.body (workspace, occurred_at DESC, id DESC);
  `);
}

export async function withDesignCluster(work) {
  localMode();
  const temporary = await mkdtemp(join(tmpdir(), 'lmps-transaction-design-'));
  let state, pool;
  try {
    state = await initializeCluster(join(temporary, 'cluster'), await availablePort());
    await startCluster(state);
    pool = new pg.Pool({ connectionString: dsn(state, 'migration'), ssl: false, max: 2,
      connectionTimeoutMillis: 1000, statement_timeout: 3000, lock_timeout: 1000,
      idle_in_transaction_session_timeout: 5000, query_timeout: 4000,
      options: '-c timezone=UTC -c search_path=pg_catalog' });
    pool.on('error', () => {});
    await createTables(pool);
    return await work(pool, state.base);
  } finally {
    await pool?.end();
    if (!state) {
      try { state = await loadState(join(temporary, 'cluster')); }
      catch { throw new Error('Scratch cluster state could not be verified; retained for inspection.'); }
    }
    await stopCluster(state);
    await rm(temporary, { recursive: true, force: true });
  }
}

export function designQueries(shape) {
  if (!SHAPES.includes(shape)) throw new Error('Unknown experimental design.');
  const body = `design_${shape}.body`;
  const fields = 'b.id, b.workspace, b.routing_day::text, b.occurred_at, b.amount, b.currency';
  return {
    lookup: shape === 'current'
      ? `SELECT ${fields} FROM ${body} b WHERE workspace=$1 AND synthetic_namespace=$2 AND synthetic_key=$3`
      : `SELECT ${fields} FROM design_partitioned.registry r JOIN ${body} b
          ON (b.id,b.routing_day,b.workspace)=(r.id,r.routing_day,r.workspace)
          WHERE r.workspace=$1 AND r.synthetic_namespace=$2 AND r.synthetic_key=$3`,
    timeline: `SELECT ${fields} FROM ${body} b WHERE workspace=$1 ORDER BY occurred_at DESC,id DESC LIMIT 25`,
    next: `SELECT ${fields} FROM ${body} b WHERE workspace=$1
      AND (occurred_at,id)<($2::timestamptz,$3::bigint) ORDER BY occurred_at DESC,id DESC LIMIT 25`,
    routed: `SELECT ${fields} FROM ${body} b WHERE workspace=$1 AND routing_day=$2::date
      ORDER BY occurred_at DESC,id DESC LIMIT 25`,
  };
}

const seed = `SELECT 9007199254740992::bigint+g AS id,
  CASE WHEN g%10=0 THEN 'synthetic_beta' ELSE 'synthetic_alpha' END AS workspace,
  'synthetic_fixture'::text AS synthetic_namespace, lpad(g::text,8,'0') AS synthetic_key,
  DATE '2026-01-01'+((g-1)%90) AS routing_day,
  TIMESTAMPTZ '2026-01-01T00:00:00Z'+((g-1)%90)*INTERVAL '1 day'+(g/90)*INTERVAL '1 second' AS occurred_at,
  (g::numeric/100)::numeric(24,2) AS amount, 'SYN'::text AS currency
  FROM generate_series(1,${ROWS}) g`;

async function loadRows(pool, shape) {
  const client = await pool.connect();
  try {
    const before = (await client.query('SELECT pg_current_wal_insert_lsn()::text AS lsn')).rows[0].lsn;
    const start = performance.now();
    await client.query('BEGIN');
    if (shape === 'current') await client.query(`INSERT INTO design_current.body SELECT * FROM (${seed}) s`);
    else {
      await client.query(`INSERT INTO design_partitioned.registry (id,workspace,synthetic_namespace,synthetic_key,routing_day)
        SELECT id,workspace,synthetic_namespace,synthetic_key,routing_day FROM (${seed}) s`);
      await client.query(`INSERT INTO design_partitioned.body (id,workspace,routing_day,occurred_at,amount,currency)
        SELECT id,workspace,routing_day,occurred_at,amount,currency FROM (${seed}) s`);
    }
    await client.query('COMMIT');
    const elapsed_ms = performance.now() - start;
    const wal_bytes = (await client.query('SELECT pg_wal_lsn_diff(pg_current_wal_insert_lsn(),$1)::text AS bytes', [before])).rows[0].bytes;
    return { elapsed_ms, wal_bytes, insert_statements: shape === 'current' ? 1 : 2 };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

async function measure(pool, text, values) {
  for (let i = 0; i < 3; i++) await pool.query(text, values);
  const samples = [];
  for (let i = 0; i < SAMPLES; i++) {
    const start = performance.now();
    await pool.query(text, values);
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  const plan = (await pool.query('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' + text, values)).rows[0]['QUERY PLAN'][0];
  return { samples: SAMPLES, p50_ms: samples[Math.ceil(SAMPLES * 0.5) - 1],
    p95_ms: samples[Math.ceil(SAMPLES * 0.95) - 1], p99_ms: samples[Math.ceil(SAMPLES * 0.99) - 1], plan };
}

export async function benchmarkDesigns(pool) {
  localMode();
  const settings = {};
  for (const name of ['server_version', 'shared_buffers', 'work_mem', 'max_connections', 'fsync', 'synchronous_commit', 'enable_partition_pruning', 'jit']) {
    settings[name] = (await pool.query('SELECT current_setting($1) AS value', [name])).rows[0].value;
  }
  const report = { format: 1, provenance: 'local_synthetic', execution_mode: 'test',
    decision_status: 'experimental', canonical_emission: false, measured_at: new Date().toISOString(),
    environment: { os: platform(), release: release(), arch: arch(), cpu: cpus()[0]?.model,
      logical_cpus: cpus().length, host_memory_bytes: String(totalmem()), node: process.version, settings, pool_max: 2 },
    workload: { rows_per_design: ROWS, routing_days: 90, monthly_partitions: 3,
      hot_workspace_percent: 90, currency: 'SYN', warmups: 3, samples: SAMPLES,
      order: SHAPES, concurrency: 1, paging: 'live keyset; fixed data during measurement' },
    limitations: ['Invented keys, scope, money, currency and UTC times; no LMPS mapping or account identity.',
      'Warm sequential local samples in fixed order; p99 of 50 samples is the maximum, not a production tail estimate.',
      'Seed timing is one bulk transaction per design; no online mixed load, per-event ingest, steady state or recovery.',
      'WAL is a cluster-wide insert-LSN delta during load, not isolated durable/retained WAL attribution.',
      'Local results do not establish target hardware capacity, SLO acceptance or a physical schema decision.'],
    designs: {} };
  for (const shape of SHAPES) {
    const load = await loadRows(pool, shape);
    await pool.query(`ANALYZE design_${shape}.body`);
    if (shape === 'partitioned') await pool.query('ANALYZE design_partitioned.registry');
    const q = designQueries(shape);
    const first = await pool.query(q.timeline, ['synthetic_alpha']);
    const cursor = first.rows.at(-1);
    const queries = {};
    for (const [name, text, values] of [
      ['lookup', q.lookup, ['synthetic_beta', 'synthetic_fixture', '00010000']],
      ['hot_first', q.timeline, ['synthetic_alpha']],
      ['hot_next', q.next, ['synthetic_alpha', cursor.occurred_at.toISOString(), cursor.id]],
      ['cold_first', q.timeline, ['synthetic_beta']],
      ['routed', q.routed, ['synthetic_alpha', '2026-02-15']],
    ]) queries[name] = await measure(pool, text, values);
    const relations = shape === 'current' ? "SELECT 'design_current.body'::regclass AS relid"
      : "SELECT relid FROM pg_partition_tree('design_partitioned.body'::regclass) UNION ALL SELECT 'design_partitioned.registry'::regclass";
    const storage = (await pool.query(`SELECT sum(pg_table_size(relid))::text AS table_bytes,
      sum(pg_indexes_size(relid))::text AS index_bytes, sum(pg_total_relation_size(relid))::text AS total_bytes
      FROM (${relations}) r`)).rows[0];
    const dataset = (await pool.query(`SELECT count(*)::int AS rows,
      md5(string_agg(concat_ws('|',id,workspace,routing_day,occurred_at,amount,currency),'\n' ORDER BY id)) AS fingerprint
      FROM design_${shape}.body`)).rows[0];
    report.designs[shape] = { dataset, load, storage, queries };
  }
  if (report.designs.current.dataset.rows !== ROWS
    || JSON.stringify(report.designs.current.dataset) !== JSON.stringify(report.designs.partitioned.dataset)) {
    throw new Error('Experimental datasets differ; comparison rejected.');
  }
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  (async () => {
    localMode();
    if (process.argv.length !== 2) throw new Error('No arguments accepted.');
    const report = await withDesignCluster(benchmarkDesigns);
    console.info(JSON.stringify(report, null, 2));
  })().catch(() => {
    console.error('Transaction design experiment failed; no credentials or database diagnostics printed.');
    process.exitCode = 1;
  });
}
