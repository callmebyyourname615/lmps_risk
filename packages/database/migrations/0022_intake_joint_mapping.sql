-- Versioned joint result/revert interpretation. Existing revisions remain immutable.
ALTER TABLE platform.local_transaction_revisions DROP CONSTRAINT local_transaction_publication_profile;
--> statement-breakpoint
ALTER TABLE platform.local_transaction_revisions
  ADD CONSTRAINT local_transaction_publication_profile CHECK ((jsonb_typeof(payload)='object' AND octet_length(payload::text)<=8192
    AND payload ?& ARRAY['schema_version','execution_mode','run_id','correlation_id','transaction_id','transaction_revision',
      'source_reference','occurred_at','observed_at','sender','receiver','source_bank_id','destination_bank_id',
      'amount','currency','transaction_type','channel','transaction_status']
    AND payload-ARRAY['schema_version','execution_mode','run_id','correlation_id','transaction_id','transaction_revision',
      'source_reference','occurred_at','observed_at','sender','receiver','source_bank_id','destination_bank_id',
      'amount','currency','transaction_type','channel','transaction_status']='{}'::jsonb
    AND payload->>'schema_version'='0.1.0-draft.1' AND payload->>'execution_mode'='test'
    AND payload->>'transaction_id'=transaction_id AND ((publication IS NULL AND payload->>'transaction_status'='unknown') OR
      (publication IS NOT NULL AND jsonb_typeof(publication)='object' AND octet_length(publication::text)<=49152
        AND publication->>'publisher_version' IN ('synthetic-publisher-0.1.0-draft.1','source-intake-publisher-1','source-intake-publisher-2')
        AND publication->>'provenance'=provenance AND publication->>'execution_mode'='test'
        AND publication->'source'->>'workspace_key'=workspace_key
        AND publication->'source'->>'source_namespace'=namespace
        AND publication->'binding'->>'transaction_id'=transaction_id
        AND publication->'binding'->>'transaction_revision'=transaction_revision
        AND publication->'binding'->>'expected_revision'=(revision_number-1)::text
        AND publication->'binding'->'currency'->>'code'=payload->>'currency'
        AND publication->'normalization_input'->>'amount'=payload->>'amount'
        AND (payload->>'transaction_status' IN ('pending','succeeded','failed','partially_reversed','reversed') OR (publication->>'publisher_version' IN ('source-intake-publisher-1','source-intake-publisher-2') AND payload->>'transaction_status'='unknown'))))
    AND payload->'occurred_at'='null'::jsonb AND payload->'source_bank_id'='null'::jsonb
    AND payload->'destination_bank_id'='null'::jsonb AND payload->'transaction_type'='null'::jsonb AND payload->'channel'='null'::jsonb
    AND payload->'sender'='{"status":"unresolved","source_representation":"unknown","reason_code":"STABLE_IDENTITY_UNVERIFIED"}'::jsonb
    AND payload->'receiver'=payload->'sender'
    AND payload->'source_reference'->>'namespace'=namespace
    AND payload->'source_reference'->'mapping_version'='null'::jsonb
    AND (payload->'source_reference')-ARRAY['namespace','record_ref','mapping_version']='{}'::jsonb
    AND payload->'source_reference'->>'record_ref' ~ '^synthetic[_-][A-Za-z0-9._:-]{1,117}$'
    AND payload->>'run_id' ~ '^synthetic[_-][A-Za-z0-9._:-]{1,117}$'
    AND payload->>'correlation_id' ~ '^synthetic[_-][A-Za-z0-9._:-]{1,117}$'
    AND transaction_revision ~ '^synthetic[_-][A-Za-z0-9._:-]{1,117}$'
    AND jsonb_typeof(payload->'amount')='string' AND length(payload->>'amount')<=80
    AND payload->>'amount' ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'
    AND payload->>'currency' ~ '^[A-Z]{3}$'
    AND jsonb_typeof(payload->'observed_at')='string') IS TRUE);

--> statement-breakpoint
ALTER TABLE platform.local_transaction_revisions DROP CONSTRAINT source_publication_origin;
--> statement-breakpoint

ALTER TABLE platform.local_transaction_revisions ADD CONSTRAINT source_publication_origin CHECK ((provenance<>'user_supplied_file' OR
 (publication->'origin'->>'amount_semantics'='raw_recorded_for_test'
 AND publication->'origin'->>'batch_ref'=publication->>'capture_id'
 AND jsonb_typeof(publication->'origin'->'values')='array' AND jsonb_array_length(publication->'origin'->'values')=6
 AND publication->'origin'->'values'->>2=payload->>'amount' AND publication->'origin'->'values'->>3=payload->>'currency'
 AND ((publication->>'publisher_version'='source-intake-publisher-1'
       AND publication->'origin'->>'mapping'='operator_intake_test_ok_failed_v1'
       AND NOT (publication->'origin' ? 'review')
       AND payload->>'transaction_status'=CASE publication->'origin'->'values'->>4 WHEN 'OK' THEN 'succeeded' WHEN 'TRANSACTION_FAILED' THEN 'failed' ELSE 'unknown' END)
   OR (publication->>'publisher_version'='source-intake-publisher-2'
       AND publication->'origin'->>'mapping'='operator_intake_test_result_revert_v2'
       AND revision_number>1
       AND jsonb_typeof(publication->'origin'->'review')='object'
       AND (publication->'origin'->'review') ?& ARRAY['manifest_sha256','review_sha256','review_row_sha256','binding_sha256','previous_publication_sha256','previous_payload_sha256','review_row_number','shouldrevert']
       AND (publication->'origin'->'review')-ARRAY['manifest_sha256','review_sha256','review_row_sha256','binding_sha256','previous_publication_sha256','previous_payload_sha256','review_row_number','shouldrevert']='{}'::jsonb
       AND publication->'origin'->'review'->>'manifest_sha256' ~ '^[a-f0-9]{64}$'
       AND publication->'origin'->'review'->>'review_sha256' ~ '^[a-f0-9]{64}$'
       AND publication->'origin'->'review'->>'review_row_sha256' ~ '^[a-f0-9]{64}$'
       AND publication->'origin'->'review'->>'binding_sha256' ~ '^[a-f0-9]{64}$'
       AND publication->'origin'->'review'->>'previous_publication_sha256' ~ '^[a-f0-9]{64}$'
       AND publication->'origin'->'review'->>'previous_payload_sha256' ~ '^[a-f0-9]{64}$'
       AND jsonb_typeof(publication->'origin'->'review'->'review_row_number')='number'
       AND publication->'origin'->'review'->>'review_row_number' ~ '^[1-9][0-9]{0,2}$|^1000$'
       AND (publication->'origin'->'review'->'shouldrevert'='null'::jsonb
            OR (jsonb_typeof(publication->'origin'->'review'->'shouldrevert')='string'
                AND publication->'origin'->'review'->>'shouldrevert' ~ '^(0|-?[1-9][0-9]{0,9})$'))
       AND payload->>'transaction_status'=CASE
         WHEN publication->'origin'->'values'->>4='OK' AND publication->'origin'->'review'->>'shouldrevert'='0' THEN 'succeeded'
         WHEN length(publication->'origin'->'values'->>4)>0
          AND btrim(publication->'origin'->'values'->>4)=publication->'origin'->'values'->>4
          AND publication->'origin'->'values'->>4<>'OK' AND publication->'origin'->'review'->>'shouldrevert'='1' THEN 'failed'
         ELSE 'unknown' END)))) IS TRUE);
