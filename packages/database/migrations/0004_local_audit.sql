-- Local synthetic service evidence. No backfill or employee identity is implied.
CREATE TABLE platform.audit_events (
  audit_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_ref uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version=1),
  workspace_key text COLLATE "C" NOT NULL CHECK (workspace_key ~ '^synthetic_[a-z0-9_]{1,40}$'),
  execution_mode text NOT NULL DEFAULT 'test' CHECK (execution_mode='test'),
  actor_role text NOT NULL CHECK (actor_role IN ('lmps_outbox','lmps_migrator','lmps_bootstrap')),
  actor_type text GENERATED ALWAYS AS (CASE WHEN actor_role='lmps_outbox' THEN 'service' ELSE 'database_operator' END) STORED,
  action text NOT NULL CHECK (action IN ('outbox.intent_created','outbox.intent_updated','outbox.attempt_started','outbox.attempt_finished')),
  target_ref uuid NOT NULL,
  correlation_id uuid GENERATED ALWAYS AS (target_ref) STORED,
  previous_state text CHECK (previous_state IN ('pending','leased','accepted','expired','dead')),
  state text CHECK (state IN ('pending','leased','accepted','expired','dead')),
  attempt_number integer NOT NULL CHECK (attempt_number BETWEEN 0 AND 3),
  outcome text CHECK (outcome IN ('unknown','accepted','retry','permanent')),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(occurred_at)),
  CHECK ((action IN ('outbox.intent_created','outbox.intent_updated') AND state IS NOT NULL AND outcome IS NULL)
    OR (action IN ('outbox.attempt_started','outbox.attempt_finished') AND state IS NULL AND previous_state IS NULL AND outcome IS NOT NULL AND attempt_number>0))
);
--> statement-breakpoint
CREATE INDEX audit_events_workspace_page ON platform.audit_events(workspace_key,audit_id);
--> statement-breakpoint
CREATE INDEX audit_events_workspace_target ON platform.audit_events(workspace_key,target_ref,audit_id);
--> statement-breakpoint
REVOKE ALL ON platform.audit_events FROM PUBLIC,lmps_app,lmps_intake,lmps_outbox;
--> statement-breakpoint
GRANT SELECT ON platform.audit_events TO lmps_app;
--> statement-breakpoint
-- The migration owner writes through this fixed trigger; workers receive no audit INSERT/UPDATE/DELETE privilege.
-- shortcut: the owner/superuser can change this evidence; use approved external immutable storage before production.
CREATE FUNCTION platform.record_local_outbox_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF TG_TABLE_SCHEMA<>'platform' OR TG_OP NOT IN ('INSERT','UPDATE') THEN
    RAISE EXCEPTION 'Unsupported audit event';
  END IF;
  IF TG_TABLE_NAME='local_outbox_intents' THEN
    IF TG_OP='INSERT' THEN
      INSERT INTO platform.audit_events(workspace_key,actor_role,action,target_ref,state,attempt_number)
      VALUES (NEW.workspace_key,session_user::text,'outbox.intent_created',NEW.intent_ref,NEW.state,NEW.attempt_count);
    ELSIF (OLD.state,OLD.attempt_count,OLD.available_at,OLD.lease_token,OLD.lease_until)
      IS DISTINCT FROM (NEW.state,NEW.attempt_count,NEW.available_at,NEW.lease_token,NEW.lease_until) THEN
      INSERT INTO platform.audit_events(workspace_key,actor_role,action,target_ref,previous_state,state,attempt_number)
      VALUES (NEW.workspace_key,session_user::text,'outbox.intent_updated',NEW.intent_ref,OLD.state,NEW.state,NEW.attempt_count);
    END IF;
  ELSIF TG_TABLE_NAME='local_outbox_attempts' THEN
    IF TG_OP='INSERT' THEN
      INSERT INTO platform.audit_events(workspace_key,actor_role,action,target_ref,attempt_number,outcome)
      VALUES (NEW.workspace_key,session_user::text,'outbox.attempt_started',NEW.intent_ref,NEW.attempt_number,NEW.outcome);
    ELSIF (OLD.outcome,OLD.finished_at) IS DISTINCT FROM (NEW.outcome,NEW.finished_at) THEN
      INSERT INTO platform.audit_events(workspace_key,actor_role,action,target_ref,attempt_number,outcome)
      VALUES (NEW.workspace_key,session_user::text,'outbox.attempt_finished',NEW.intent_ref,NEW.attempt_number,NEW.outcome);
    END IF;
  ELSE
    RAISE EXCEPTION 'Unsupported audit event';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION platform.record_local_outbox_audit() FROM PUBLIC,lmps_app,lmps_intake,lmps_outbox;
--> statement-breakpoint
CREATE TRIGGER local_outbox_intents_audit AFTER INSERT OR UPDATE ON platform.local_outbox_intents
FOR EACH ROW EXECUTE FUNCTION platform.record_local_outbox_audit();
--> statement-breakpoint
CREATE TRIGGER local_outbox_attempts_audit AFTER INSERT OR UPDATE ON platform.local_outbox_attempts
FOR EACH ROW EXECUTE FUNCTION platform.record_local_outbox_audit();
