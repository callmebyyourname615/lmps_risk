import { validateGraphCorpus, graphIdentity, graphQueryIdentity } from './graph-benchmark-contract.js';

/** Fixed expansions of the frozen burst/skew/dense recipes, shared input only. */
export function graphSqlProfiles(input: unknown) {
  const base = validateGraphCorpus(input), seed = base.deliveries[0]?.event, query = base.queries[0];
  if (!seed || !query) throw new Error('GRAPH_CONTRACT_INVALID');
  return Object.freeze(['burst', 'skew', 'dense'].map(name => {
    const count = name === 'skew' ? 2000 : name === 'burst' ? 128 : 64;
    const deliveries = Array.from({ length: count }, (_, i) => ({ source_position: i + 1, event: {
      ...seed, transaction_id: name === 'skew' ? 'skew_0' : `${name}_${i}`,
      sender: name === 'burst' ? `synthetic_Burst_${i}` : name === 'dense' ? `synthetic_Left_${Math.floor(i / 8)}` : 'synthetic_Replay_A',
      receiver: name === 'burst' ? 'synthetic_Hub' : name === 'dense' ? `synthetic_Right_${i % 8}` : 'synthetic_Replay_B'
    } }));
    return validateGraphCorpus({ ...base, corpus_id: `${name}_v1`, deliveries, queries: [{ ...query, id: `${name}_q1`, source_prefix: count, max_hops: name === 'skew' ? 4 : 2,
      target: { namespace: seed.namespace, transaction_id: deliveries[0]!.event.transaction_id, revision_number: seed.revision_number } }] });
  }));
}

/** Parameterized raw deliveries only; no oracle or candidate observations. */
export function graphSqlPlan(input: unknown) {
  const corpus = validateGraphCorpus(input);
  return Object.freeze({ corpus_sha256: graphIdentity(corpus),
    setup: 'CREATE TEMP TABLE graph_raw(delivery jsonb) ON COMMIT PRESERVE ROWS',
    load: Object.freeze({ text: 'INSERT INTO graph_raw SELECT d FROM jsonb_array_elements($1::jsonb) d', values: Object.freeze([JSON.stringify(corpus.deliveries)]) }),
    queries: Object.freeze(corpus.queries.map(query => Object.freeze({
    id: query.id, query_sha256: graphQueryIdentity(corpus, query.id),
    text: `WITH RECURSIVE latest AS MATERIALIZED (
      SELECT DISTINCT ON (d->'event'->>'transaction_id') d->'event' AS event
      FROM graph_raw CROSS JOIN LATERAL (SELECT delivery AS d) raw
      WHERE (d->>'source_position')::integer <= ($1::jsonb->>'source_prefix')::integer
        AND d->'event'->>'namespace' = $1::jsonb->>'namespace'
        AND (d->'event'->>'available_at')::timestamptz <= ($1::jsonb->>'as_of')::timestamptz
      ORDER BY d->'event'->>'transaction_id', (d->'event'->>'revision_number')::integer DESC
    ), edges AS MATERIALIZED (
      SELECT event e,event->>'sender' s,event->>'receiver' d,(event->>'occurred_at')::timestamptz t,
        ((event->>'amount')::numeric-(event->>'reversed_amount')::numeric)*100 cents,
        row_number() OVER(ORDER BY event->>'occurred_at',event->>'transaction_id' COLLATE "C",(event->>'revision_number')::integer)::integer ord
      FROM latest WHERE event->>'currency'=$1::jsonb->>'currency'
        AND (event->>'occurred_at')::timestamptz > ($1::jsonb->>'anchor_at')::timestamptz-interval '3600 seconds'
        AND (event->>'occurred_at')::timestamptz <= ($1::jsonb->>'anchor_at')::timestamptz
        AND event->>'status' IN ('succeeded','partially_reversed')
        AND (event->>'amount')::numeric>(event->>'reversed_amount')::numeric
    ), nodes AS MATERIALIZED (SELECT s n FROM edges UNION SELECT d FROM edges),
    gate AS (SELECT CASE WHEN $1::jsonb->>'identity_status'<>'synthetic_declared' THEN 'identity_unverified'
      WHEN NOT ($1::jsonb->'coverage'->>'complete')::boolean OR ($1::jsonb->'coverage'->>'start')::timestamptz > ($1::jsonb->>'anchor_at')::timestamptz-interval '3600 seconds' THEN 'history_incomplete'
      WHEN NOT EXISTS(SELECT 1 FROM latest WHERE event->>'transaction_id'=$1::jsonb->'target'->>'transaction_id' AND event->>'revision_number'=$1::jsonb->'target'->>'revision_number' AND event->>'currency'=$1::jsonb->>'currency') THEN 'target_unavailable'
      WHEN (SELECT count(*) FROM nodes)>256 OR (SELECT count(*) FROM edges)>1024 THEN 'budget_exceeded' END reason),
    walk(origin,d,visited,t,ords,witness,closed) AS (
      SELECT s,d,ARRAY[s,d],t,ARRAY[ord],jsonb_build_array(jsonb_build_object('namespace',e->>'namespace','transaction_id',e->>'transaction_id','revision_number',(e->>'revision_number')::integer)),s=d
      FROM edges WHERE (SELECT reason FROM gate) IS NULL
      UNION ALL
      SELECT w.origin,e.d,w.visited||e.d,e.t,w.ords||e.ord,w.witness||jsonb_build_array(jsonb_build_object('namespace',e.e->>'namespace','transaction_id',e.e->>'transaction_id','revision_number',(e.e->>'revision_number')::integer)),e.d=w.origin
      FROM walk w JOIN edges e ON e.s=w.d
      WHERE NOT w.closed AND cardinality(w.ords)<($1::jsonb->>'max_hops')::integer AND e.t>w.t AND (e.d=w.origin OR NOT e.d=ANY(w.visited))
    ), bounded AS MATERIALIZED (SELECT * FROM walk LIMIT 5001),
    status AS (SELECT coalesce(reason,CASE WHEN (SELECT count(*) FROM bounded)>5000 THEN 'budget_exceeded' END) reason FROM gate)
    SELECT jsonb_build_object('availability',CASE WHEN reason IS NULL THEN jsonb_build_object('status','available') ELSE jsonb_build_object('status','unavailable','reason',reason) END,
      'truncated',coalesce(reason='budget_exceeded',false),'metrics',CASE WHEN reason IS NOT NULL THEN NULL ELSE jsonb_build_object(
      'nodes',(SELECT count(*) FROM nodes),'edges',(SELECT count(*) FROM edges),'emitted_path_states',(SELECT count(*) FROM bounded),
      'net_cents',(SELECT coalesce(sum(cents),0)::numeric(30,0)::text FROM edges),
      'fan_in',(SELECT coalesce(jsonb_agg(jsonb_build_object('handle',n,'count',(SELECT count(DISTINCT s) FROM edges WHERE d=n)) ORDER BY n COLLATE "C"),'[]') FROM nodes),
      'fan_out',(SELECT coalesce(jsonb_agg(jsonb_build_object('handle',n,'count',(SELECT count(DISTINCT d) FROM edges WHERE s=n)) ORDER BY n COLLATE "C"),'[]') FROM nodes),
      'paths',(SELECT coalesce(jsonb_agg(jsonb_build_object('edges',witness) ORDER BY origin COLLATE "C",ords),'[]') FROM bounded WHERE NOT closed),
      'cycles',(SELECT coalesce(jsonb_agg(jsonb_build_object('edges',witness) ORDER BY origin COLLATE "C",ords),'[]') FROM bounded WHERE closed)) END) observation,
      (SELECT count(*) FROM latest) selected_rows,(SELECT count(*) FROM graph_raw) loaded_rows FROM status`,
    values: Object.freeze([JSON.stringify(query)])
  }))) });
}
