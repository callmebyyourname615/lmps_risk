-- Synthetic, explicitly submitted jobs; no source polling, notification or payment action.
CREATE TABLE platform.local_risk_jobs (
  job_ref uuid PRIMARY KEY CHECK (job_ref::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  workspace_key text COLLATE "C" NOT NULL CHECK (workspace_key='synthetic_local'),
  input_sha256 text NOT NULL CHECK (input_sha256 ~ '^[0-9a-f]{64}$'),
  manifest jsonb NOT NULL CHECK (jsonb_typeof(manifest)='object' AND octet_length(manifest::text)<=1048576),
  manifest_sha256 text NOT NULL CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  namespace text GENERATED ALWAYS AS (manifest->'risk_request'->'target'->>'namespace') STORED NOT NULL CHECK (namespace ~ '^synthetic_[a-z0-9_]{1,40}$'),
  transaction_id text GENERATED ALWAYS AS (manifest->'risk_request'->'target'->>'transaction_id') STORED NOT NULL CHECK (transaction_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  revision_number integer GENERATED ALWAYS AS ((manifest->'risk_request'->'target'->>'revision_number')::integer) STORED NOT NULL CHECK (revision_number>0),
  observation jsonb NOT NULL CHECK (jsonb_typeof(observation)='object' AND octet_length(observation::text)<=16384),
  observation_sha256 text NOT NULL CHECK (observation_sha256 ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','retry_wait','completed','failed')),
  stage text NOT NULL DEFAULT 'assessment' CHECK (stage IN ('assessment','alert','done')),
  attempt_number integer NOT NULL DEFAULT 0 CHECK (attempt_number BETWEEN 0 AND 8),
  lease_token uuid, lease_until timestamptz CHECK (isfinite(lease_until)),
  next_attempt_at timestamptz DEFAULT clock_timestamp() CHECK (isfinite(next_attempt_at)),
  assessment_run_id uuid, alert_id uuid,
  result_code text CHECK (result_code IN ('ALERT_CREATED','ALERT_NO_MATCH','ALERT_PARTIAL_EXCLUDED','ALERT_ASSESSMENT_INELIGIBLE')),
  error_code text CHECK (error_code IN ('JOB_STORAGE_UNAVAILABLE','JOB_INPUT_CONFLICT','JOB_INVALID_INPUT','JOB_STALE_LEASE','JOB_LEASE_EXPIRED','RISK_POLICY_CONFLICT','RISK_RUN_CONFLICT','ALERT_POLICY_CONFLICT')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(created_at)),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(updated_at)),
  UNIQUE (workspace_key,job_ref), UNIQUE (workspace_key,input_sha256),
  FOREIGN KEY (workspace_key,assessment_run_id) REFERENCES platform.local_transaction_risks(workspace_key,run_id),
  FOREIGN KEY (workspace_key,alert_id) REFERENCES platform.local_alerts(workspace_key,alert_id),
  CHECK ((manifest->>'job_ref'=job_ref::text AND manifest->>'workspace_key'=workspace_key
    AND manifest->>'provenance'='local_synthetic' AND manifest->>'execution_mode'='test'
    AND manifest->'risk_request'->>'run_id'=job_ref::text) IS TRUE),
  CHECK ((status='running' AND lease_token IS NOT NULL AND lease_until IS NOT NULL)
    OR (status<>'running' AND lease_token IS NULL AND lease_until IS NULL)),
  CHECK ((status IN ('pending','retry_wait') AND next_attempt_at IS NOT NULL)
    OR (status NOT IN ('pending','retry_wait') AND next_attempt_at IS NULL)),
  CHECK ((stage='assessment' AND assessment_run_id IS NULL) OR (stage IN ('alert','done') AND assessment_run_id=job_ref AND assessment_run_id IS NOT NULL)),
  CHECK ((status='completed' AND stage='done' AND result_code IS NOT NULL AND error_code IS NULL)
    OR (status<>'completed' AND stage<>'done' AND result_code IS NULL AND alert_id IS NULL)),
  CHECK ((result_code='ALERT_CREATED' AND alert_id IS NOT NULL) OR (result_code IS DISTINCT FROM 'ALERT_CREATED' AND alert_id IS NULL)),
  CHECK (status<>'pending' OR attempt_number=0),
  CHECK (status NOT IN ('retry_wait','failed') OR error_code IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX local_risk_jobs_due ON platform.local_risk_jobs(status,next_attempt_at,lease_until);
--> statement-breakpoint
CREATE TABLE platform.local_risk_job_attempts (
  workspace_key text NOT NULL, job_ref uuid NOT NULL,
  attempt_number integer NOT NULL CHECK (attempt_number BETWEEN 1 AND 8),
  lease_token uuid NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','retry_wait','failed','interrupted')),
  started_stage text NOT NULL CHECK (started_stage IN ('assessment','alert')),
  finished_stage text CHECK (finished_stage IN ('assessment','alert','done')),
  error_code text CHECK (error_code IN ('JOB_STORAGE_UNAVAILABLE','JOB_INPUT_CONFLICT','JOB_INVALID_INPUT','JOB_STALE_LEASE','JOB_LEASE_EXPIRED','RISK_POLICY_CONFLICT','RISK_RUN_CONFLICT','ALERT_POLICY_CONFLICT')),
  started_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(started_at)),
  finished_at timestamptz CHECK (isfinite(finished_at)),
  PRIMARY KEY (workspace_key,job_ref,attempt_number),
  FOREIGN KEY (workspace_key,job_ref) REFERENCES platform.local_risk_jobs(workspace_key,job_ref),
  CHECK ((status='running' AND finished_at IS NULL AND finished_stage IS NULL AND error_code IS NULL)
    OR (status<>'running' AND finished_at IS NOT NULL AND finished_stage IS NOT NULL)),
  CHECK ((status='completed' AND finished_stage='done' AND error_code IS NULL)
    OR (status NOT IN ('completed','running') AND error_code IS NOT NULL) OR status='running')
);
--> statement-breakpoint
REVOKE ALL ON platform.local_risk_jobs,platform.local_risk_job_attempts FROM PUBLIC,lmps_app,lmps_intake,lmps_outbox,lmps_reviewer;
--> statement-breakpoint
GRANT SELECT ON platform.local_risk_jobs,platform.local_risk_job_attempts TO lmps_app,lmps_intake;
--> statement-breakpoint
GRANT INSERT(job_ref,workspace_key,input_sha256,manifest,manifest_sha256,observation,observation_sha256) ON platform.local_risk_jobs TO lmps_intake;
--> statement-breakpoint
GRANT UPDATE(status,stage,attempt_number,lease_token,lease_until,next_attempt_at,assessment_run_id,alert_id,result_code,error_code,updated_at) ON platform.local_risk_jobs TO lmps_intake;
--> statement-breakpoint
GRANT INSERT(workspace_key,job_ref,attempt_number,lease_token,started_stage) ON platform.local_risk_job_attempts TO lmps_intake;
--> statement-breakpoint
GRANT UPDATE(status,finished_stage,error_code,finished_at) ON platform.local_risk_job_attempts TO lmps_intake;
