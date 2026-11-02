-- Personal read receipts for actual workspace Alert-created notifications.
-- Alert creation/review and fake delivery evidence remain separate resources.
CREATE TABLE platform.local_user_notification_reads (
  workspace_key text COLLATE "C" NOT NULL,
  subject text COLLATE "C" NOT NULL CHECK (subject ~ '^synthetic_[a-z0-9_]{1,40}$'),
  alert_id uuid NOT NULL,
  read_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(read_at)),
  PRIMARY KEY (workspace_key,subject,alert_id),
  FOREIGN KEY (workspace_key,alert_id) REFERENCES platform.local_alerts(workspace_key,alert_id)
);
--> statement-breakpoint
REVOKE ALL ON platform.local_user_notification_reads FROM PUBLIC,lmps_app,lmps_intake,lmps_outbox,lmps_reviewer;
--> statement-breakpoint
GRANT SELECT ON platform.local_user_notification_reads TO lmps_app;
--> statement-breakpoint
-- App may append only through this scoped, idempotent function; no direct receipt edits/deletes.
CREATE FUNCTION platform.read_local_user_notification(p_workspace text,p_subject text,p_alert uuid)
RETURNS TABLE(read_at timestamptz) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF session_user::text<>'lmps_app' OR p_workspace IS NULL OR p_workspace!~'^synthetic_[a-z0-9_]{1,40}$'
    OR p_subject IS NULL OR p_subject!~'^synthetic_[a-z0-9_]{1,40}$' OR p_alert IS NULL
    OR p_alert::text!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION USING ERRCODE='P3700',MESSAGE='Invalid notification read';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM platform.local_alerts a WHERE a.workspace_key=p_workspace AND a.alert_id=p_alert) THEN
    RETURN;
  END IF;
  INSERT INTO platform.local_user_notification_reads(workspace_key,subject,alert_id)
    VALUES(p_workspace,p_subject,p_alert) ON CONFLICT DO NOTHING;
  RETURN QUERY SELECT r.read_at FROM platform.local_user_notification_reads r
    WHERE r.workspace_key=p_workspace AND r.subject=p_subject AND r.alert_id=p_alert;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION platform.read_local_user_notification(text,text,uuid) FROM PUBLIC,lmps_app,lmps_intake,lmps_outbox,lmps_reviewer;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform.read_local_user_notification(text,text,uuid) TO lmps_app;
