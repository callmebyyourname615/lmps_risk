-- Draft synthetic observations only; not the production canonical transaction schema.
CREATE TABLE platform.local_transaction_revisions (
  workspace_key text COLLATE "C" NOT NULL CHECK (workspace_key ~ '^synthetic_[a-z0-9_]{1,40}$'),
  namespace text COLLATE "C" NOT NULL CHECK (namespace ~ '^synthetic_[a-z0-9_]{1,40}$'),
  transaction_id text COLLATE "C" NOT NULL CHECK (transaction_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  revision_number integer NOT NULL CHECK (revision_number > 0),
  previous_revision integer GENERATED ALWAYS AS (CASE WHEN revision_number>1 THEN revision_number-1 END) STORED,
  transaction_revision text COLLATE "C" GENERATED ALWAYS AS (payload->>'transaction_revision') STORED NOT NULL,
  provenance text NOT NULL DEFAULT 'local_synthetic' CHECK (provenance='local_synthetic'),
  execution_mode text NOT NULL DEFAULT 'test' CHECK (execution_mode='test'),
  payload jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  recorded_by text NOT NULL DEFAULT session_user::text,
  PRIMARY KEY (workspace_key,namespace,transaction_id,revision_number),
  UNIQUE (workspace_key,namespace,transaction_id,transaction_revision),
  FOREIGN KEY (workspace_key,namespace,transaction_id,previous_revision)
    REFERENCES platform.local_transaction_revisions(workspace_key,namespace,transaction_id,revision_number),
  CHECK ((jsonb_typeof(payload)='object' AND octet_length(payload::text)<=8192
    AND payload ?& ARRAY['schema_version','execution_mode','run_id','correlation_id','transaction_id','transaction_revision',
      'source_reference','occurred_at','observed_at','sender','receiver','source_bank_id','destination_bank_id',
      'amount','currency','transaction_type','channel','transaction_status']
    AND payload-ARRAY['schema_version','execution_mode','run_id','correlation_id','transaction_id','transaction_revision',
      'source_reference','occurred_at','observed_at','sender','receiver','source_bank_id','destination_bank_id',
      'amount','currency','transaction_type','channel','transaction_status']='{}'::jsonb
    AND payload->>'schema_version'='0.1.0-draft.1' AND payload->>'execution_mode'='test'
    AND payload->>'transaction_id'=transaction_id AND payload->>'transaction_status'='unknown'
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
    AND jsonb_typeof(payload->'observed_at')='string') IS TRUE)
);
--> statement-breakpoint
REVOKE ALL ON platform.local_transaction_revisions FROM PUBLIC,lmps_app,lmps_intake,lmps_outbox;
--> statement-breakpoint
GRANT SELECT ON platform.local_transaction_revisions TO lmps_app,lmps_intake;
--> statement-breakpoint
GRANT INSERT (workspace_key,namespace,transaction_id,revision_number,payload)
  ON platform.local_transaction_revisions TO lmps_intake;
