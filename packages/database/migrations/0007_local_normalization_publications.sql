-- Preserve old unknown observations; known synthetic states require attached publication evidence.
ALTER TABLE platform.local_transaction_revisions ADD COLUMN publication jsonb;
--> statement-breakpoint
DO $$
DECLARE old_check text;
BEGIN
  SELECT conname INTO STRICT old_check FROM pg_constraint
    WHERE conrelid='platform.local_transaction_revisions'::regclass AND contype='c'
      AND pg_get_constraintdef(oid) LIKE '%transaction_status%';
  EXECUTE format('ALTER TABLE platform.local_transaction_revisions DROP CONSTRAINT %I',old_check);
END $$;
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
        AND publication->>'publisher_version'='synthetic-publisher-0.1.0-draft.1'
        AND publication->>'provenance'='local_synthetic' AND publication->>'execution_mode'='test'
        AND publication->'source'->>'workspace_key'=workspace_key
        AND publication->'source'->>'source_namespace'=namespace
        AND publication->'binding'->>'transaction_id'=transaction_id
        AND publication->'binding'->>'transaction_revision'=transaction_revision
        AND publication->'binding'->>'expected_revision'=(revision_number-1)::text
        AND publication->'binding'->'currency'->>'code'=payload->>'currency'
        AND publication->'normalization_input'->>'amount'=payload->>'amount'
        AND payload->>'transaction_status' IN ('pending','succeeded','failed','partially_reversed','reversed')))
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
GRANT INSERT (publication) ON platform.local_transaction_revisions TO lmps_intake;
