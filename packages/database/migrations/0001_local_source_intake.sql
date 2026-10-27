-- Local synthetic intake only; no business/account identity or CDC protocol is approved.
CREATE TABLE platform.source_records (
  record_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  record_ref uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  workspace_key text COLLATE "C" NOT NULL CHECK (workspace_key ~ '^synthetic_[a-z0-9_]{1,40}$'),
  source_namespace text COLLATE "C" NOT NULL CHECK (source_namespace ~ '^synthetic_[a-z0-9_]{1,40}$'),
  source_generation text COLLATE "C" NOT NULL CHECK (source_generation ~ '^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,79}$'),
  source_table text NOT NULL CHECK (source_table IN ('transfer','transfer_hist','transfer_old','member')),
  source_key jsonb NOT NULL CHECK (jsonb_typeof(source_key) = 'object' AND octet_length(source_key::text) <= 1024),
  provenance text NOT NULL DEFAULT 'local_synthetic' CHECK (provenance = 'local_synthetic'),
  execution_mode text NOT NULL DEFAULT 'test' CHECK (execution_mode = 'test'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (workspace_key, source_namespace, source_generation, source_table, source_key),
  UNIQUE (workspace_key, source_namespace, source_generation, record_id),
  CHECK (
    (source_table='member' AND source_key ? 'code' AND source_key - 'code' = '{}'::jsonb AND jsonb_typeof(source_key->'code')='string') OR
    (source_table='transfer_old' AND source_key ? 'id' AND source_key - 'id' = '{}'::jsonb AND jsonb_typeof(source_key->'id')='string') OR
    (source_table IN ('transfer','transfer_hist') AND source_key ?& ARRAY['id','requesttime'] AND source_key - ARRAY['id','requesttime'] = '{}'::jsonb AND jsonb_typeof(source_key->'id')='string' AND jsonb_typeof(source_key->'requesttime')='string')
  )
);
--> statement-breakpoint
CREATE TABLE platform.source_events (
  event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_key text COLLATE "C" NOT NULL,
  source_namespace text COLLATE "C" NOT NULL,
  source_generation text COLLATE "C" NOT NULL,
  capture_epoch text COLLATE "C" NOT NULL CHECK (capture_epoch ~ '^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,79}$'),
  event_key text COLLATE "C" NOT NULL CHECK (event_key ~ '^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,79}$'),
  record_id bigint NOT NULL,
  operation text NOT NULL CHECK (operation IN ('snapshot','insert','update','delete')),
  observed_at timestamptz NOT NULL CHECK (isfinite(observed_at)),
  fields jsonb,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version=1),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (workspace_key, source_namespace, source_generation, capture_epoch, event_key),
  FOREIGN KEY (workspace_key, source_namespace, source_generation, record_id)
    REFERENCES platform.source_records (workspace_key, source_namespace, source_generation, record_id),
  CHECK (
    (operation='delete' AND fields IS NULL) OR
    (operation<>'delete' AND fields IS NOT NULL AND jsonb_typeof(fields)='object' AND octet_length(fields::text) <= 4096
      AND fields - ARRAY['amount','ccy','result','txtime','status','member_type'] = '{}'::jsonb
      AND COALESCE(jsonb_typeof(fields->'amount'),'null') IN ('string','null')
      AND COALESCE(jsonb_typeof(fields->'ccy'),'null') IN ('string','null')
      AND COALESCE(jsonb_typeof(fields->'result'),'null') IN ('string','null')
      AND COALESCE(jsonb_typeof(fields->'txtime'),'null') IN ('string','null')
      AND COALESCE(jsonb_typeof(fields->'status'),'null') IN ('string','null')
      AND COALESCE(jsonb_typeof(fields->'member_type'),'null') IN ('string','null'))
  )
);
--> statement-breakpoint
CREATE INDEX source_events_record_history ON platform.source_events (workspace_key, record_id, event_id);
--> statement-breakpoint
REVOKE ALL ON platform.source_records, platform.source_events FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON SCHEMA platform TO lmps_intake;
--> statement-breakpoint
GRANT SELECT, INSERT ON platform.source_records, platform.source_events TO lmps_intake;
--> statement-breakpoint
GRANT USAGE ON SEQUENCE platform.source_records_record_id_seq, platform.source_events_event_id_seq TO lmps_intake;
--> statement-breakpoint
GRANT SELECT ON platform.source_records, platform.source_events TO lmps_app;
