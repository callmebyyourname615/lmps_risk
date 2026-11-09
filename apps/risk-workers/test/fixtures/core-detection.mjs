import { randomBytes,createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { publicationFixture } from '../../../../packages/contracts/fixtures/synthetic-publication.mjs';
import { publicationTransaction } from '@lmps/contracts/synthetic-publication';
import { riskFixture } from '../../../../packages/risk/fixtures/request.mjs';
import { identityMapping,identityInput } from '../../../../packages/risk/fixtures/account-identity.mjs';
import { riskHash } from '@lmps/risk';

let fixtureKey;
export async function coreConfig(directory,changes={}) {
  fixtureKey??=randomBytes(32);
  const key=Buffer.from(fixtureKey),keyPath=join(directory,'identity.key');await writeFile(keyPath,key,{mode:0o600});
  const config={format:1,runtime_id:'synthetic_core_trial',mappings:[identityMapping()],
    key_files:[{...identityMapping().key,path:keyPath,sha256:createHash('sha256').update(key).digest('hex')}],policy:riskFixture().request.policy,
    alert_policy:{policy_id:'synthetic_core_alerts',version:'synthetic_v1',minimum_severity:'high',included_codes:riskFixture().request.policy.rules.map(r=>r.code),include_partial:true},
    feature_plan:{version:'synthetic-feature-stream-1',identity:'synthetic_declared',run_id:'synthetic_core_stream',input_identity:'synthetic_core_fixture',namespace:'synthetic_snapshot',
      topic:'synthetic_snapshot.synthetic_core_stream',window_seconds:3600,coverage_start:'2026-01-01T08:00:00Z',
      queries:[{id:'synthetic_initial',target:'synthetic_payment_001',as_of:'2026-01-01T12:00:00Z',currency:'SYN',evidence:'available',coverage_complete:true,flags_available:false}],
      limits:{records:64,revisions:64,snapshots:8,capture_bytes:2097152,state_bytes:1048576}},freshness_seconds:60,maximum_inputs:64,...changes};
  key.fill(0);const path=join(directory,'config.json');await writeFile(path,JSON.stringify(config),{mode:0o600});return{config,path};
}
export function coreDelivery(offset,id,options={}) {
  const {publication}=publicationFixture(), revision=options.revision??1;
  const occurred_at=options.occurred_at??'2026-01-01T11:30:00Z',available_at=options.available_at??'2026-01-01T11:30:01Z';
  publication.source.observed_at=available_at.replace('Z','.000Z');publication.normalization_input.observed_at=publication.source.observed_at;
  publication.normalization_input.source_time=occurred_at.replace('T',' ').replace('Z','');
  publication.binding.transaction_id='synthetic_'+id;publication.binding.transaction_revision='synthetic_revision_'+revision;publication.binding.expected_revision=revision-1;
  publication.normalization_input.amount=options.amount??'400.00';publication.binding.currency.code=options.currency??'SYN';
  if(options.failed)publication.normalization_input.status_code='SYNTH_FAILED';
  if(options.reversed_amount) {
    const full=options.reversed_amount===publication.normalization_input.amount;
    publication.normalization_input.reversal_code=full?'SYNTH_REVERSAL_FULL_COMPLETED':'SYNTH_REVERSAL_PARTIAL_COMPLETED';
    publication.normalization_input.synthetic_payment_ref=publication.binding.transaction_id;
    publication.normalization_input.reversal_evidence={original_payment_ref:publication.binding.transaction_id,
      events:[{event_ref:'synthetic_reverse_'+revision,amount:options.reversed_amount,currency:publication.binding.currency.raw,completed:true}]};
  }
  const {transaction}=publicationTransaction(publication);
  const account=account_value=>({...identityInput(),account_value});
  return {format:1,offset,publication,identity_evidence:{binding:{transaction_id:transaction.transaction_id,transaction_revision:transaction.transaction_revision,
    source_namespace:transaction.source_reference.namespace,record_ref:transaction.source_reference.record_ref,publication_sha256:riskHash(publication)},
    sender:account(options.sender??'synthetic_raw_private_A'),receiver:account(options.receiver??'synthetic_raw_private_B')},
    time:{occurred_at,available_at,now:options.now??available_at,coverage_complete:options.coverage_complete??true}};
}
