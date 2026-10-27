-- Restricted unverified file staging; not canonical/synthetic payment observations.
CREATE TABLE platform.offline_dataset_batches (
  batch_ref uuid PRIMARY KEY,
  workspace_key text COLLATE "C" NOT NULL CHECK (workspace_key ~ '^offline_[a-z0-9_]{1,40}$'),
  source_namespace text COLLATE "C" NOT NULL CHECK (source_namespace ~ '^offline_[a-z0-9_]{1,40}$'),
  source_table text NOT NULL CHECK (source_table IN ('transfer','transfer_hist','transfer_old','member')),
  identity_sha256 text NOT NULL CHECK (identity_sha256 ~ '^[0-9a-f]{64}$'),
  manifest jsonb NOT NULL CHECK (jsonb_typeof(manifest)='object' AND octet_length(manifest::text)<=4096),
  manifest_sha256 text NOT NULL CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  expected_rows integer NOT NULL CHECK (expected_rows BETWEEN 1 AND 100000),
  loaded_rows integer NOT NULL DEFAULT 0 CHECK (loaded_rows BETWEEN 0 AND expected_rows),
  status text NOT NULL DEFAULT 'importing' CHECK (status IN ('importing','complete','blocked')),
  reconciliation_status text NOT NULL DEFAULT 'not_checked' CHECK (reconciliation_status IN ('not_checked','incomplete','matched','mismatch')),
  source_kind text NOT NULL DEFAULT 'user_supplied_file' CHECK (source_kind='user_supplied_file'),
  execution_mode text NOT NULL DEFAULT 'offline_analysis' CHECK (execution_mode='offline_analysis'),
  source_semantics text NOT NULL DEFAULT 'unverified' CHECK (source_semantics='unverified'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  reconciled_at timestamptz,
  recorded_by text NOT NULL DEFAULT session_user::text,
  UNIQUE (workspace_key,identity_sha256),
  UNIQUE (workspace_key,batch_ref,source_table),
  CHECK ((manifest ?& ARRAY['format','execution_mode','batch_ref','workspace_key','source_namespace','source_table','profile_version','dataset_sha256','input_bytes','expected_rows','rows_sha256']
    AND manifest->>'batch_ref'=batch_ref::text AND manifest->>'workspace_key'=workspace_key
    AND manifest->>'source_namespace'=source_namespace AND manifest->>'source_table'=source_table
    AND manifest->>'expected_rows'=expected_rows::text AND manifest->>'execution_mode'='offline_analysis'
    AND manifest->>'profile_version'='offline-dataset-profile-1' AND manifest->>'format'='1'
    AND jsonb_typeof(manifest->'dataset_sha256')='string' AND manifest->>'dataset_sha256' ~ '^[0-9a-f]{64}$'
    AND jsonb_typeof(manifest->'rows_sha256')='string' AND manifest->>'rows_sha256' ~ '^[0-9a-f]{64}$'
    AND CASE WHEN jsonb_typeof(manifest->'input_bytes')='number' AND manifest->>'input_bytes' ~ '^[0-9]{1,8}$'
      THEN (manifest->>'input_bytes')::bigint BETWEEN 1 AND 67108864 ELSE false END
    AND (manifest-ARRAY['format','execution_mode','batch_ref','workspace_key','source_namespace','source_table','profile_version','dataset_sha256','input_bytes','expected_rows','rows_sha256'])='{}'::jsonb) IS TRUE),
  CHECK (status<>'complete' OR (loaded_rows=expected_rows AND reconciliation_status='matched' AND reconciled_at IS NOT NULL)),
  CHECK ((status='blocked')=(reconciliation_status='mismatch'))
);
--> statement-breakpoint
CREATE TABLE platform.offline_dataset_rows (
  workspace_key text COLLATE "C" NOT NULL,
  batch_ref uuid NOT NULL,
  source_table text NOT NULL,
  row_number integer NOT NULL CHECK (row_number BETWEEN 1 AND 100000),
  source_key jsonb NOT NULL CHECK (jsonb_typeof(source_key)='object' AND octet_length(source_key::text)<=1024),
  fields jsonb NOT NULL CHECK (jsonb_typeof(fields)='object' AND octet_length(fields::text)<=4096),
  row_sha256 text NOT NULL CHECK (row_sha256 ~ '^[0-9a-f]{64}$'),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (workspace_key,batch_ref,row_number),
  UNIQUE (workspace_key,batch_ref,source_key),
  FOREIGN KEY (workspace_key,batch_ref,source_table) REFERENCES platform.offline_dataset_batches(workspace_key,batch_ref,source_table),
  CHECK ((CASE WHEN source_table='member' THEN
    source_key ?& ARRAY['code'] AND source_key-'code'='{}'::jsonb AND jsonb_typeof(source_key->'code')='string'
    AND length(source_key->>'code') BETWEEN 1 AND 100
    AND fields ?& ARRAY['status','member_type'] AND fields-ARRAY['status','member_type']='{}'::jsonb
    AND jsonb_typeof(fields->'status') IN ('string','null') AND jsonb_typeof(fields->'member_type') IN ('string','null')
    AND COALESCE(length(fields->>'status'),0)<=16 AND COALESCE(length(fields->>'member_type'),0)<=20
  ELSE
    source_key ? 'id' AND jsonb_typeof(source_key->'id')='string'
    AND source_key->>'id' ~ '^(0|-?[1-9][0-9]{0,9})$'
    AND CASE WHEN source_table='transfer_old' THEN source_key-'id'='{}'::jsonb
      ELSE source_key ? 'requesttime' AND jsonb_typeof(source_key->'requesttime')='string'
        AND source_key-ARRAY['id','requesttime']='{}'::jsonb END
    AND fields ?& ARRAY['amount','ccy','result','txtime'] AND fields-ARRAY['amount','ccy','result','txtime']='{}'::jsonb
    AND jsonb_typeof(fields->'amount')='string' AND fields->>'amount' ~ '^-?(0|[1-9][0-9]{0,21})\.[0-9]{2}$'
    AND jsonb_typeof(fields->'ccy')='string' AND length(fields->>'ccy') BETWEEN 1 AND 200
    AND jsonb_typeof(fields->'result') IN ('string','null') AND COALESCE(length(fields->>'result'),0)<=200
    AND jsonb_typeof(fields->'txtime')='string' AND fields->>'txtime' ~ '^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$'
  END) IS TRUE)
);
--> statement-breakpoint
REVOKE ALL ON platform.offline_dataset_batches,platform.offline_dataset_rows FROM PUBLIC,lmps_app,lmps_outbox,lmps_reviewer;
--> statement-breakpoint
GRANT SELECT ON platform.offline_dataset_batches,platform.offline_dataset_rows TO lmps_intake;
--> statement-breakpoint
GRANT INSERT (batch_ref,workspace_key,source_namespace,source_table,identity_sha256,manifest,manifest_sha256,expected_rows)
  ON platform.offline_dataset_batches TO lmps_intake;
--> statement-breakpoint
GRANT UPDATE (loaded_rows,status,reconciliation_status,updated_at,reconciled_at) ON platform.offline_dataset_batches TO lmps_intake;
--> statement-breakpoint
GRANT INSERT (workspace_key,batch_ref,source_table,row_number,source_key,fields,row_sha256) ON platform.offline_dataset_rows TO lmps_intake;
