import { createHash } from 'node:crypto';
import { createDatabase, createOfflineDatasets, createSourceIntake, createTransactionRevisions } from '@lmps/database';
import { DATASET_UUID, DATASET_DIGEST } from '@lmps/contracts/offline-dataset';
import { makeSourcePublication, sourceTransactionId, sourceContentHash } from '@lmps/contracts/source-publication';

export interface OfflinePublicationInput {
  format:1; source_workspace:string; batch_ref:string; dataset_sha256:string;
  workspace:string; namespace:string; generation:string; observed_at:string;
  mapping:'operator_intake_test_ok_failed_v1';
}
export async function publishOfflineBatch(dsn:string,input:OfflinePublicationInput) {
  if(!input||Object.keys(input).sort().join(',')!=='batch_ref,dataset_sha256,format,generation,mapping,namespace,observed_at,source_workspace,workspace'
    ||input.format!==1||input.mapping!=='operator_intake_test_ok_failed_v1'||!/^offline_[a-z0-9_]{1,40}$/.test(input.source_workspace)
    ||![input.batch_ref,input.generation].every(v=>DATASET_UUID.test(v))||!DATASET_DIGEST.test(input.dataset_sha256)
    ||![input.workspace,input.namespace].every(v=>/^synthetic_[a-z0-9_]{1,40}$/.test(v))
    ||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(input.observed_at)||!Number.isFinite(Date.parse(input.observed_at))||new Date(input.observed_at).toISOString()!==input.observed_at)throw Error('CSV_PUBLICATION_INVALID; values withheld.');
  const staging=createOfflineDatasets(dsn),database=createDatabase(dsn,'intake'),writer=createTransactionRevisions(dsn),source=createSourceIntake(dsn);
  const counts={source_rows:0,inserted:0,corrected:0,duplicates:0,quarantined:0};
  const quarantined:Array<{row_number:number;reason:string}>=[];
  let lock,stage='verify';
  try{
    const snapshot=await staging.readComplete(input.source_workspace,input.batch_ref,input.dataset_sha256);
    if(snapshot.manifest.source_table!=='transfer')throw Error();
    lock=await database.pool.connect();await lock.query('SELECT pg_advisory_lock(hashtextextended($1,72))',[input.workspace+':'+input.namespace]);
    for(const [index,values] of snapshot.rows.entries()){
      counts.source_rows++;
      const id=sourceTransactionId(values);
      const latest=(await database.pool.query('SELECT revision_number,publication FROM platform.local_transaction_revisions WHERE workspace_key=$1 AND namespace=$2 AND transaction_id=$3 ORDER BY revision_number DESC LIMIT 1',[input.workspace,input.namespace,id])).rows[0];
      const event={schema_version:1,provenance:'user_supplied_file',execution_mode:'test',workspace_key:input.workspace,source_namespace:input.namespace,
        source_generation:input.generation,capture_epoch:input.batch_ref,event_key:`transfer:${index+1}`,source_table:'transfer',source_key:{id:values[0],requesttime:values[1]},operation:'snapshot',
        observed_at:input.observed_at,fields:{amount:values[2],ccy:values[3],result:values[4],txtime:values[5]}};
      stage='source';await source.append(event);
      if(latest){
        if(latest.publication?.provenance!=='user_supplied_file')throw Error();
        if(sourceContentHash(latest.publication.origin.values)===sourceContentHash(values)){counts.duplicates++;continue;}
        if(Date.parse(input.observed_at)<=Date.parse(latest.publication.source.observed_at)){stage='stale';throw Error();}
      }
      let projected;
      try{projected=makeSourcePublication({workspace:input.workspace,namespace:input.namespace,generation:input.generation,batch:input.batch_ref,
        dataset_sha256:input.dataset_sha256,rows_sha256:snapshot.manifest.rows_sha256,source_namespace:snapshot.manifest.source_namespace,row_number:index+1,values,
        observed_at:input.observed_at,expected_revision:latest?.revision_number??0});}
      catch{counts.quarantined++;quarantined.push({row_number:index+1,reason:'SOURCE_MAPPING_UNSUPPORTED'});continue;}
      stage='revision';const result=await writer.append({format:1,provenance:'user_supplied_file',execution_mode:'test',workspace_key:input.workspace,
        expected_revision:latest?.revision_number??0,...projected});
      if(result.status==='duplicate')counts.duplicates++;else if(latest)counts.corrected++;else counts.inserted++;
    }
    return {format:1,status:quarantined.length?'partial':'complete',source_kind:'user_supplied_file',execution_mode:'test',canonical_emission:false,
      batch_ref:input.batch_ref,namespace:input.namespace,mapping:input.mapping,counts,quarantined,
      input_sha256:createHash('sha256').update(JSON.stringify(input)).digest('hex')};
  }catch(error){const code=error&&typeof error==='object'&&'code'in error&&typeof error.code==='string'&&/^[A-Z0-9_]{3,64}$/.test(error.code)?error.code:'WITHHELD';throw Error(`CSV_PUBLICATION_FAILED at ${stage} (${code}); committed source/revisions retained for exact retry; values withheld.`);}
  finally{lock?.release(true);await staging.close();await writer.close();await source.close();await database.close();}
}
