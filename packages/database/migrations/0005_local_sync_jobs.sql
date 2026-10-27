-- Bounded local snapshot import jobs; no live source/CDC checkpoint is represented.
CREATE TABLE platform.local_sync_jobs (
  job_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_ref uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  workspace_key text COLLATE "C" NOT NULL CHECK (workspace_key ~ '^synthetic_[a-z0-9_]{1,40}$'),
  capture_id uuid NOT NULL,
  snapshot_sha256 text NOT NULL CHECK (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  total integer NOT NULL CHECK (total BETWEEN 0 AND 400),
  execution_mode text NOT NULL DEFAULT 'test' CHECK (execution_mode='test'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','imported','reconciled','failed','needs_review')),
  attempt_number integer NOT NULL DEFAULT 0 CHECK (attempt_number BETWEEN 0 AND 32),
  lease_token uuid,
  lease_until timestamptz CHECK (isfinite(lease_until)),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (workspace_key,capture_id),
  UNIQUE (workspace_key,job_ref),
  CHECK ((status IN ('running','imported') AND lease_token IS NOT NULL AND lease_until IS NOT NULL)
    OR (status NOT IN ('running','imported') AND lease_token IS NULL AND lease_until IS NULL))
);
--> statement-breakpoint
CREATE INDEX local_sync_jobs_workspace_page ON platform.local_sync_jobs(workspace_key,job_id);
--> statement-breakpoint
CREATE TABLE platform.local_sync_attempts (
  workspace_key text NOT NULL,
  job_ref uuid NOT NULL,
  attempt_number integer NOT NULL CHECK (attempt_number BETWEEN 1 AND 32),
  lease_token uuid NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','reconciled','failed','needs_review','interrupted')),
  processed integer NOT NULL DEFAULT 0 CHECK (processed BETWEEN 0 AND 400),
  inserted integer NOT NULL DEFAULT 0 CHECK (inserted BETWEEN 0 AND 400),
  duplicate integer NOT NULL DEFAULT 0 CHECK (duplicate BETWEEN 0 AND 400),
  import_completed boolean NOT NULL DEFAULT false,
  reconciliation_status text CHECK (reconciliation_status IN ('PASS','FAIL','UNAVAILABLE','LIMIT_EXCEEDED')),
  error_code text CHECK (error_code IN ('STORAGE_FAILED','EVENT_CONFLICT','LEASE_EXPIRED','RECONCILE_FAILED','RECONCILE_UNAVAILABLE','RECONCILE_LIMIT_EXCEEDED')),
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz CHECK (isfinite(finished_at)),
  PRIMARY KEY (workspace_key,job_ref,attempt_number),
  FOREIGN KEY (workspace_key,job_ref) REFERENCES platform.local_sync_jobs(workspace_key,job_ref),
  CHECK (processed=inserted+duplicate),
  CHECK ((status='running' AND finished_at IS NULL AND error_code IS NULL AND reconciliation_status IS NULL)
    OR (status<>'running' AND finished_at IS NOT NULL)),
  CHECK ((status='reconciled' AND import_completed AND reconciliation_status IS NOT NULL AND reconciliation_status='PASS' AND error_code IS NULL)
    OR (status<>'reconciled' AND reconciliation_status IS DISTINCT FROM 'PASS')),
  CHECK (reconciliation_status IS NULL OR import_completed)
);
--> statement-breakpoint
REVOKE ALL ON platform.local_sync_jobs,platform.local_sync_attempts FROM PUBLIC,lmps_app,lmps_intake,lmps_outbox;
--> statement-breakpoint
GRANT SELECT ON platform.local_sync_jobs,platform.local_sync_attempts TO lmps_app,lmps_intake;
--> statement-breakpoint
GRANT INSERT (workspace_key,capture_id,snapshot_sha256,total) ON platform.local_sync_jobs TO lmps_intake;
--> statement-breakpoint
GRANT UPDATE (status,attempt_number,lease_token,lease_until,updated_at) ON platform.local_sync_jobs TO lmps_intake;
--> statement-breakpoint
GRANT USAGE ON SEQUENCE platform.local_sync_jobs_job_id_seq TO lmps_intake;
--> statement-breakpoint
GRANT INSERT (workspace_key,job_ref,attempt_number,lease_token) ON platform.local_sync_attempts TO lmps_intake;
--> statement-breakpoint
GRANT UPDATE (status,processed,inserted,duplicate,import_completed,reconciliation_status,error_code,finished_at) ON platform.local_sync_attempts TO lmps_intake;
--> statement-breakpoint
ALTER TABLE platform.audit_events DROP CONSTRAINT audit_events_schema_version_check,
  DROP CONSTRAINT audit_events_actor_role_check, DROP CONSTRAINT audit_events_action_check,
  DROP CONSTRAINT audit_events_attempt_number_check, DROP CONSTRAINT audit_events_check;
--> statement-breakpoint
ALTER TABLE platform.audit_events ADD COLUMN target_type text NOT NULL DEFAULT 'local_outbox_intent',
  ADD COLUMN capture_id uuid, ADD COLUMN job_status text, ADD COLUMN previous_job_status text,
  ADD CONSTRAINT audit_events_schema_version_check CHECK (schema_version IN (1,2)),
  ADD CONSTRAINT audit_events_actor_role_check CHECK (actor_role IN ('lmps_outbox','lmps_intake','lmps_migrator','lmps_bootstrap')),
  ADD CONSTRAINT audit_events_attempt_number_check CHECK (attempt_number BETWEEN 0 AND 32),
  ADD CONSTRAINT audit_events_check CHECK (
    (schema_version=1 AND target_type='local_outbox_intent' AND capture_id IS NULL AND job_status IS NULL AND previous_job_status IS NULL AND attempt_number<=3
      AND ((action IN ('outbox.intent_created','outbox.intent_updated') AND state IS NOT NULL AND outcome IS NULL)
        OR (action IN ('outbox.attempt_started','outbox.attempt_finished') AND state IS NULL AND previous_state IS NULL AND outcome IS NOT NULL AND attempt_number>0)))
    OR (schema_version=2 AND target_type='local_sync_job' AND capture_id IS NOT NULL AND action IN ('sync.job_created','sync.job_updated','sync.attempt_finished')
      AND state IS NULL AND previous_state IS NULL AND outcome IS NULL
      AND job_status IS NOT NULL AND job_status IN ('pending','running','imported','reconciled','failed','needs_review','interrupted')
      AND (previous_job_status IS NULL OR previous_job_status IN ('pending','running','imported','reconciled','failed','needs_review','interrupted'))));
--> statement-breakpoint
ALTER TABLE platform.audit_events DROP COLUMN actor_type;
--> statement-breakpoint
ALTER TABLE platform.audit_events ADD COLUMN actor_type text GENERATED ALWAYS AS
  (CASE WHEN actor_role IN ('lmps_outbox','lmps_intake') THEN 'service' ELSE 'database_operator' END) STORED;
--> statement-breakpoint
CREATE FUNCTION platform.record_local_sync_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF TG_TABLE_SCHEMA<>'platform' OR TG_TABLE_NAME<>'local_sync_jobs' OR TG_OP NOT IN ('INSERT','UPDATE') THEN
    RAISE EXCEPTION 'Unsupported audit event';
  END IF;
  IF TG_OP='INSERT' THEN
    INSERT INTO platform.audit_events(schema_version,workspace_key,actor_role,action,target_ref,target_type,capture_id,job_status,attempt_number)
    VALUES (2,NEW.workspace_key,session_user::text,'sync.job_created',NEW.job_ref,'local_sync_job',NEW.capture_id,NEW.status,NEW.attempt_number);
  ELSIF (OLD.status,OLD.attempt_number,OLD.lease_token) IS DISTINCT FROM (NEW.status,NEW.attempt_number,NEW.lease_token) THEN
    INSERT INTO platform.audit_events(schema_version,workspace_key,actor_role,action,target_ref,target_type,capture_id,previous_job_status,job_status,attempt_number)
    VALUES (2,NEW.workspace_key,session_user::text,'sync.job_updated',NEW.job_ref,'local_sync_job',NEW.capture_id,OLD.status,NEW.status,NEW.attempt_number);
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION platform.record_local_sync_audit() FROM PUBLIC,lmps_app,lmps_intake,lmps_outbox;
--> statement-breakpoint
CREATE TRIGGER local_sync_jobs_audit AFTER INSERT OR UPDATE ON platform.local_sync_jobs
FOR EACH ROW EXECUTE FUNCTION platform.record_local_sync_audit();

--> statement-breakpoint
CREATE FUNCTION platform.record_local_sync_attempt_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF TG_TABLE_SCHEMA<>'platform' OR TG_TABLE_NAME<>'local_sync_attempts' OR TG_OP<>'UPDATE' THEN
    RAISE EXCEPTION 'Unsupported audit event';
  END IF;
  INSERT INTO platform.audit_events(schema_version,workspace_key,actor_role,action,target_ref,target_type,capture_id,previous_job_status,job_status,attempt_number)
  SELECT 2,NEW.workspace_key,session_user::text,'sync.attempt_finished',NEW.job_ref,'local_sync_job',j.capture_id,OLD.status,NEW.status,NEW.attempt_number
  FROM platform.local_sync_jobs j WHERE j.workspace_key=NEW.workspace_key AND j.job_ref=NEW.job_ref;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION platform.record_local_sync_attempt_audit() FROM PUBLIC,lmps_app,lmps_intake,lmps_outbox;
--> statement-breakpoint
CREATE TRIGGER local_sync_attempts_audit AFTER UPDATE ON platform.local_sync_attempts
FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION platform.record_local_sync_attempt_audit();
