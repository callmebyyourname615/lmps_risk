-- Source-backed Intake publications keep real provenance and use operator-confirmed test mapping.
DO $$
DECLARE c text;
BEGIN
 SELECT conname INTO STRICT c FROM pg_constraint WHERE conrelid='platform.source_records'::regclass AND contype='c'
 AND conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid='platform.source_records'::regclass AND attname='provenance')]::smallint[];
 EXECUTE format('ALTER TABLE platform.source_records DROP CONSTRAINT %I',c);
END $$;
--> statement-breakpoint
ALTER TABLE platform.source_records ADD CONSTRAINT source_record_origin CHECK (provenance IN ('local_synthetic','user_supplied_file'));
--> statement-breakpoint
CREATE FUNCTION platform.intake_file_record(p_workspace text,p_namespace text,p_generation text,p_table text,p_key jsonb) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result bigint;
BEGIN
 IF session_user::text<>'lmps_intake' OR p_workspace IS NULL OR p_workspace!~'^synthetic_[a-z0-9_]{1,40}$'
 OR p_namespace IS NULL OR p_namespace!~'^synthetic_[a-z0-9_]{1,40}$' OR p_generation IS NULL
 OR p_generation!~'^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,79}$' OR p_table NOT IN ('transfer','transfer_hist','transfer_old','member') THEN
  RAISE EXCEPTION 'Invalid Intake source context' USING ERRCODE='22023';
 END IF;
 INSERT INTO platform.source_records(workspace_key,source_namespace,source_generation,source_table,source_key,provenance)
 VALUES(p_workspace,p_namespace,p_generation,p_table,p_key,'user_supplied_file') ON CONFLICT DO NOTHING RETURNING record_id INTO result;
 IF result IS NULL THEN SELECT record_id INTO result FROM platform.source_records WHERE workspace_key=p_workspace AND source_namespace=p_namespace
 AND source_generation=p_generation AND source_table=p_table AND source_key=p_key AND provenance='user_supplied_file'; END IF;
 IF result IS NULL THEN RAISE EXCEPTION 'Intake source conflict' USING ERRCODE='22023'; END IF;
 RETURN result;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION platform.intake_file_record(text,text,text,text,jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform.intake_file_record(text,text,text,text,jsonb) TO lmps_intake;
--> statement-breakpoint
ALTER TABLE platform.local_transaction_revisions DROP CONSTRAINT local_transaction_publication_profile;
--> statement-breakpoint
DO $$
DECLARE c text;
BEGIN
 SELECT conname INTO STRICT c FROM pg_constraint WHERE conrelid='platform.local_transaction_revisions'::regclass AND contype='c'
 AND conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid='platform.local_transaction_revisions'::regclass AND attname='provenance')]::smallint[];
 EXECUTE format('ALTER TABLE platform.local_transaction_revisions DROP CONSTRAINT %I',c);
END $$;
--> statement-breakpoint
ALTER TABLE platform.local_transaction_revisions ADD CONSTRAINT local_transaction_origin CHECK (provenance IN ('local_synthetic','user_supplied_file'));
--> statement-breakpoint
GRANT INSERT(provenance) ON platform.local_transaction_revisions TO lmps_intake;
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
        AND publication->>'publisher_version' IN ('synthetic-publisher-0.1.0-draft.1','source-intake-publisher-1')
        AND publication->>'provenance'=provenance AND publication->>'execution_mode'='test'
        AND publication->'source'->>'workspace_key'=workspace_key
        AND publication->'source'->>'source_namespace'=namespace
        AND publication->'binding'->>'transaction_id'=transaction_id
        AND publication->'binding'->>'transaction_revision'=transaction_revision
        AND publication->'binding'->>'expected_revision'=(revision_number-1)::text
        AND publication->'binding'->'currency'->>'code'=payload->>'currency'
        AND publication->'normalization_input'->>'amount'=payload->>'amount'
        AND (payload->>'transaction_status' IN ('pending','succeeded','failed','partially_reversed','reversed') OR (publication->>'publisher_version'='source-intake-publisher-1' AND payload->>'transaction_status'='unknown'))))
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
ALTER TABLE platform.local_transaction_revisions ADD CONSTRAINT source_publication_origin CHECK ((provenance<>'user_supplied_file' OR
 (publication->>'publisher_version'='source-intake-publisher-1' AND publication->'origin'->>'mapping'='operator_intake_test_ok_failed_v1'
 AND publication->'origin'->>'amount_semantics'='raw_recorded_for_test'
 AND publication->'origin'->>'batch_ref'=publication->>'capture_id'
 AND jsonb_typeof(publication->'origin'->'values')='array' AND jsonb_array_length(publication->'origin'->'values')=6
 AND publication->'origin'->'values'->>2=payload->>'amount' AND publication->'origin'->'values'->>3=payload->>'currency'
 AND payload->>'transaction_status'=CASE publication->'origin'->'values'->>4 WHEN 'OK' THEN 'succeeded' WHEN 'TRANSACTION_FAILED' THEN 'failed' ELSE 'unknown' END)) IS TRUE);
--> statement-breakpoint
-- Optional per-environment display scope. Workspace authorization remains independently enforced.
DO $$
DECLARE t text; ns text;
BEGIN
 FOREACH t IN ARRAY ARRAY['local_transaction_revisions','local_transaction_risks','local_risk_jobs','local_risk_policy_bindings','source_records','source_events','local_alerts'] LOOP
  ns:=CASE WHEN t IN ('source_records','source_events') THEN 'source_namespace' WHEN t='local_alerts' THEN '(SELECT r.namespace FROM platform.local_transaction_risks r WHERE (r.workspace_key,r.run_id)=(local_alerts.workspace_key,local_alerts.assessment_run_id))' ELSE 'namespace' END;
  EXECUTE format('ALTER TABLE platform.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY app_source_scope ON platform.%I FOR SELECT TO lmps_app USING (nullif(current_setting(''lmps.read_namespace'',true),'''') IS NULL OR %s=current_setting(''lmps.read_namespace'',true))',t,ns);
  EXECUTE format('CREATE POLICY service_source_access ON platform.%I FOR ALL TO lmps_intake,lmps_reviewer,lmps_policy,lmps_case,lmps_outbox USING (true) WITH CHECK (true)',t);
 END LOOP;
END $$;
--> statement-breakpoint
DO $$
DECLARE c record; definition text;
BEGIN
 FOR c IN SELECT conrelid::regclass AS relation,conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint
 WHERE conrelid IN ('platform.local_transaction_risks'::regclass,'platform.local_alerts'::regclass,'platform.local_assessment_runs'::regclass) AND contype='c' AND pg_get_constraintdef(oid) LIKE '%local_synthetic%' LOOP
  definition:=replace(c.definition,'= ''local_synthetic''::text','= ANY (ARRAY[''local_synthetic''::text,''user_supplied_file''::text])');
  definition:=replace(definition,'= ''synthetic_stateless_backtest''::text','= ANY (ARRAY[''synthetic_stateless_backtest''::text,''intake_stateless_backtest''::text])');
  EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',c.relation,c.conname);
  EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s',c.relation,c.conname,definition);
 END LOOP;
END $$;
