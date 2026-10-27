import { randomUUID, createHash } from 'node:crypto';
import { datasetRowsHash } from '@lmps/database';
import { OFFLINE_REPLAY_VERSION } from '@lmps/contracts/offline-replay';
import { datasetFixture } from '../../../../packages/database/test/fixtures/offline-dataset.mjs';

export function replayFixture(count=3, table='transfer', mutate) {
  const snapshot=datasetFixture(count,table);if(mutate)mutate(snapshot.rows);
  const content=JSON.stringify(snapshot.rows);
  Object.assign(snapshot.manifest,{rows_sha256:datasetRowsHash(snapshot.rows),dataset_sha256:createHash('sha256').update(content).digest('hex'),input_bytes:Buffer.byteLength(content)});
  const m=snapshot.manifest;
  return {snapshot,input:{format:1,execution_mode:'offline_analysis',evaluator_version:OFFLINE_REPLAY_VERSION,run_id:randomUUID(),workspace_key:m.workspace_key,
    batch_ref:m.batch_ref,dataset_sha256:m.dataset_sha256,
    policy:{version:'simulation_fixture_v1',purpose:'simulation_only',amount_semantics:'raw_recorded_amount',amount_unit:'as_recorded',
      lifecycle_scope:'all_recorded_rows',thresholds:[{source_ccy:'SYNTHETIC_CCY',amount_gte:'100.00'}]}}};
}
