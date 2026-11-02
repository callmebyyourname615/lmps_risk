CREATE TABLE platform.local_notification_preferences (
  workspace_key text COLLATE "C" NOT NULL CHECK (workspace_key ~ '^synthetic_[a-z0-9_]{1,40}$'),
  subject text COLLATE "C" NOT NULL CHECK (subject ~ '^synthetic_[a-z0-9_]{1,40}$'),
  version integer NOT NULL CHECK (version > 0),
  settings jsonb NOT NULL CHECK (jsonb_typeof(settings)='object' AND octet_length(settings::text)<4096),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(workspace_key,subject)
);
--> statement-breakpoint
REVOKE ALL ON platform.local_notification_preferences FROM PUBLIC,lmps_app,lmps_intake,lmps_outbox,lmps_reviewer;
--> statement-breakpoint
GRANT SELECT ON platform.local_notification_preferences TO lmps_app;
--> statement-breakpoint
CREATE FUNCTION platform.save_notification_preferences(p_workspace text,p_subject text,p_version integer,p_settings jsonb)
RETURNS SETOF platform.local_notification_preferences LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF session_user::text<>'lmps_app' OR p_workspace IS NULL OR p_workspace!~'^synthetic_[a-z0-9_]{1,40}$'
    OR p_subject IS NULL OR p_subject!~'^synthetic_[a-z0-9_]{1,40}$' OR p_version IS NULL OR p_version<0 OR p_version>2147483646
    OR p_settings IS NULL OR jsonb_typeof(p_settings)<>'object' OR octet_length(p_settings::text)>=4096 THEN
    RAISE EXCEPTION USING ERRCODE='P3800',MESSAGE='Invalid notification preferences';
  END IF;
  IF p_version=0 THEN
    RETURN QUERY INSERT INTO platform.local_notification_preferences(workspace_key,subject,version,settings)
      VALUES(p_workspace,p_subject,1,p_settings) ON CONFLICT DO NOTHING RETURNING *;
  ELSE
    RETURN QUERY UPDATE platform.local_notification_preferences p SET settings=p_settings,version=p.version+1,updated_at=clock_timestamp()
      WHERE p.workspace_key=p_workspace AND p.subject=p_subject AND p.version=p_version RETURNING p.*;
  END IF;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION platform.save_notification_preferences(text,text,integer,jsonb) FROM PUBLIC,lmps_app,lmps_intake,lmps_outbox,lmps_reviewer;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform.save_notification_preferences(text,text,integer,jsonb) TO lmps_app;
