-- Local synthetic MVP only; rule registration does not approve or activate a production policy.
CREATE TABLE platform.local_rule_versions (
  workspace_key text COLLATE "C" NOT NULL CHECK (workspace_key='synthetic_local'),
  rule_id text COLLATE "C" NOT NULL CHECK (rule_id ~ '^synthetic_[a-z0-9_]{1,60}$'),
  rule_version text COLLATE "C" NOT NULL CHECK (rule_version ~ '^synthetic_[A-Za-z0-9_.:-]{1,70}$'),
  definition jsonb NOT NULL,
  rule_sha256 text NOT NULL CHECK (rule_sha256 ~ '^[0-9a-f]{64}$'),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  recorded_by text NOT NULL DEFAULT session_user::text,
  PRIMARY KEY (workspace_key,rule_id,rule_version),
  CHECK ((jsonb_typeof(definition)='object' AND octet_length(definition::text)<=2048
    AND definition ?& ARRAY['rule_id','rule_version','risk_dimension','kind','currency','statuses','threshold']
    AND definition-ARRAY['rule_id','rule_version','risk_dimension','kind','currency','statuses','threshold']='{}'::jsonb
    AND definition->>'rule_id'=rule_id AND definition->>'rule_version'=rule_version
    AND definition->>'kind'='amount_gte' AND definition->>'risk_dimension' IN ('fraud','aml')
    AND definition->>'currency' ~ '^[A-Z]{3}$' AND jsonb_typeof(definition->'threshold')='string'
    AND definition->>'threshold' ~ '^(0|[1-9][0-9]{0,21})\.[0-9]{2}$'
    AND jsonb_typeof(definition->'statuses')='array' AND jsonb_array_length(definition->'statuses') BETWEEN 1 AND 5
    AND definition->'statuses' <@ '["pending","succeeded","failed","partially_reversed","reversed"]'::jsonb) IS TRUE)
);
--> statement-breakpoint
CREATE TABLE platform.local_assessment_runs (
  workspace_key text COLLATE "C" NOT NULL CHECK (workspace_key='synthetic_local'),
  run_id uuid NOT NULL CHECK (run_id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  report jsonb NOT NULL,
  report_sha256 text NOT NULL CHECK (report_sha256 ~ '^[0-9a-f]{64}$'),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  recorded_by text NOT NULL DEFAULT session_user::text,
  PRIMARY KEY (workspace_key,run_id),
  CHECK ((jsonb_typeof(report)='object' AND octet_length(report::text)<=2200000
    AND report->>'workspace_key'=workspace_key AND report->>'run_id'=run_id::text
    AND report->>'format'='1' AND report->>'provenance'='local_synthetic' AND report->>'execution_mode'='test'
    AND report->>'purpose'='synthetic_stateless_backtest' AND report->'canonical_emission'='false'::jsonb
    AND report->'enforcement'='false'::jsonb AND report->>'source_semantics'='unverified'
    AND report->>'historical_availability'='unverified' AND report->>'status' IN ('partial','complete')
    AND report->>'evaluator_version'='synthetic-rules-0.1.0-draft.1'
    AND jsonb_typeof(report->'rules')='array' AND jsonb_array_length(report->'rules') BETWEEN 1 AND 20
    AND jsonb_typeof(report->'rows')='array' AND jsonb_array_length(report->'rows') BETWEEN 1 AND 100
    AND report->>'manifest_sha256' ~ '^[0-9a-f]{64}$' AND report->>'input_set_sha256' ~ '^[0-9a-f]{64}$'
    AND report->>'rules_sha256' ~ '^[0-9a-f]{64}$') IS TRUE)
);
--> statement-breakpoint
REVOKE ALL ON platform.local_rule_versions,platform.local_assessment_runs FROM PUBLIC,lmps_app,lmps_intake,lmps_outbox;
--> statement-breakpoint
GRANT SELECT ON platform.local_rule_versions,platform.local_assessment_runs TO lmps_app,lmps_intake;
--> statement-breakpoint
GRANT INSERT (workspace_key,rule_id,rule_version,definition,rule_sha256) ON platform.local_rule_versions TO lmps_intake;
--> statement-breakpoint
GRANT INSERT (workspace_key,run_id,report,report_sha256) ON platform.local_assessment_runs TO lmps_intake;
