-- Synthetic alert monitoring/review only. No notification or payment action.
CREATE TABLE platform.local_alert_policies (
  workspace_key text COLLATE "C" NOT NULL CHECK (workspace_key='synthetic_local'),
  policy_id text COLLATE "C" NOT NULL CHECK (policy_id ~ '^synthetic_[A-Za-z0-9_.:-]{1,70}$'),
  policy_version text COLLATE "C" NOT NULL CHECK (policy_version ~ '^synthetic_[A-Za-z0-9_.:-]{1,70}$'),
  policy jsonb NOT NULL CHECK (jsonb_typeof(policy)='object' AND octet_length(policy::text)<=16384),
  policy_sha256 text NOT NULL CHECK (policy_sha256 ~ '^[0-9a-f]{64}$'),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(recorded_at)),
  recorded_by text NOT NULL DEFAULT session_user::text,
  PRIMARY KEY (workspace_key,policy_id,policy_version),
  UNIQUE (workspace_key,policy_id,policy_version,policy_sha256),
  CHECK ((policy->>'policy_id'=policy_id AND policy->>'version'=policy_version) IS TRUE)
);
--> statement-breakpoint
CREATE TABLE platform.local_alerts (
  alert_id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_key text COLLATE "C" NOT NULL CHECK (workspace_key='synthetic_local'),
  assessment_run_id uuid NOT NULL,
  policy_id text COLLATE "C" NOT NULL,
  policy_version text COLLATE "C" NOT NULL,
  policy_sha256 text NOT NULL,
  snapshot jsonb NOT NULL,
  snapshot_sha256 text NOT NULL CHECK (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  severity text GENERATED ALWAYS AS (snapshot->>'severity') STORED CHECK (severity IN ('low','medium','high','critical')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(created_at)),
  recorded_by text NOT NULL DEFAULT session_user::text,
  PRIMARY KEY (workspace_key,alert_id),
  UNIQUE (workspace_key,assessment_run_id,policy_id,policy_version),
  FOREIGN KEY (workspace_key,assessment_run_id) REFERENCES platform.local_transaction_risks(workspace_key,run_id),
  FOREIGN KEY (workspace_key,policy_id,policy_version,policy_sha256) REFERENCES platform.local_alert_policies(workspace_key,policy_id,policy_version,policy_sha256),
  CHECK ((jsonb_typeof(snapshot)='object' AND octet_length(snapshot::text)<=16384
    AND snapshot->>'workspace_key'=workspace_key AND snapshot->>'assessment_run_id'=assessment_run_id::text
    AND snapshot->>'provenance'='local_synthetic' AND snapshot->>'execution_mode'='test'
    AND snapshot->'policy'->>'policy_id'=policy_id AND snapshot->'policy'->>'version'=policy_version
    AND jsonb_typeof(snapshot->'selected_risk_types')='array' AND jsonb_array_length(snapshot->'selected_risk_types') BETWEEN 1 AND 15) IS TRUE)
);
--> statement-breakpoint
CREATE INDEX local_alerts_inbox ON platform.local_alerts(workspace_key,alert_id);
--> statement-breakpoint
-- This append-only ledger is both review state and audit; no mutable state can lose its audit write.
-- shortcut: migration owner/superuser can alter evidence; require approved external immutable retention before production.
CREATE TABLE platform.local_alert_reviews (
  workspace_key text COLLATE "C" NOT NULL,
  alert_id uuid NOT NULL,
  version integer NOT NULL CHECK (version IN (1,2)),
  expected_version integer NOT NULL CHECK (expected_version=version-1),
  request_id uuid NOT NULL CHECK (request_id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  action text NOT NULL,
  outcome text,
  note text CHECK (note IS NULL OR (length(note) BETWEEN 1 AND 1000 AND note ~ '[^[:space:]]')),
  actor_subject text NOT NULL CHECK (actor_subject ~ '^synthetic_[a-z0-9_]{1,40}$'),
  actor_role text NOT NULL DEFAULT session_user::text CHECK (actor_role='lmps_reviewer'),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(occurred_at)),
  PRIMARY KEY (workspace_key,alert_id,version),
  UNIQUE (workspace_key,alert_id,request_id),
  FOREIGN KEY (workspace_key,alert_id) REFERENCES platform.local_alerts(workspace_key,alert_id),
  CHECK ((version=1 AND action='acknowledge' AND outcome IS NULL)
    OR (version=2 AND action='review' AND outcome IN ('suspicious','legitimate','unknown') AND outcome IS NOT NULL AND note IS NOT NULL))
);
--> statement-breakpoint
REVOKE ALL ON platform.local_alert_policies,platform.local_alerts,platform.local_alert_reviews FROM PUBLIC,lmps_app,lmps_intake,lmps_outbox,lmps_reviewer;
--> statement-breakpoint
GRANT USAGE ON SCHEMA platform TO lmps_reviewer;
--> statement-breakpoint
GRANT SELECT ON platform.local_alert_policies,platform.local_alerts,platform.local_alert_reviews TO lmps_app,lmps_intake,lmps_reviewer;
--> statement-breakpoint
GRANT SELECT ON platform.local_transaction_risks TO lmps_reviewer;
--> statement-breakpoint
GRANT INSERT(workspace_key,policy_id,policy_version,policy,policy_sha256) ON platform.local_alert_policies TO lmps_intake;
--> statement-breakpoint
GRANT INSERT(workspace_key,assessment_run_id,policy_id,policy_version,policy_sha256,snapshot,snapshot_sha256) ON platform.local_alerts TO lmps_intake;
--> statement-breakpoint
CREATE FUNCTION platform.review_local_alert(p_workspace text,p_alert uuid,p_expected integer,p_request uuid,p_action text,p_outcome text,p_note text,p_subject text)
RETURNS TABLE(inserted boolean) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE saved platform.local_alert_reviews%ROWTYPE; current_version integer;
BEGIN
  IF session_user::text<>'lmps_reviewer' OR p_workspace IS NULL OR p_workspace!~'^synthetic_[a-z0-9_]{1,40}$'
    OR p_subject IS NULL OR p_subject!~'^synthetic_[a-z0-9_]{1,40}$' OR p_alert IS NULL OR p_request IS NULL
    OR p_alert::text!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    OR p_request::text!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    OR p_expected IS NULL OR p_action IS NULL
    OR NOT ((p_expected=0 AND p_action='acknowledge' AND p_outcome IS NULL)
      OR (p_expected=1 AND p_action='review' AND p_outcome IS NOT NULL AND p_outcome IN ('suspicious','legitimate','unknown') AND p_note IS NOT NULL))
    OR (p_note IS NOT NULL AND (length(p_note) NOT BETWEEN 1 AND 1000 OR p_note!~'[^[:space:]]'
      OR p_note ~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]')) THEN
    RAISE EXCEPTION USING ERRCODE='P3200',MESSAGE='Invalid alert review';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_workspace||':'||p_alert::text,32));
  IF NOT EXISTS (SELECT 1 FROM platform.local_alerts WHERE workspace_key=p_workspace AND alert_id=p_alert) THEN
    RAISE EXCEPTION USING ERRCODE='P3204',MESSAGE='Alert not found';
  END IF;
  SELECT * INTO saved FROM platform.local_alert_reviews WHERE workspace_key=p_workspace AND alert_id=p_alert AND request_id=p_request;
  IF FOUND THEN
    IF (saved.expected_version,saved.action,saved.outcome,saved.note,saved.actor_subject)
      IS DISTINCT FROM (p_expected,p_action,p_outcome,p_note,p_subject) THEN
      RAISE EXCEPTION USING ERRCODE='P3209',MESSAGE='Alert review conflict';
    END IF;
    RETURN QUERY SELECT false; RETURN;
  END IF;
  SELECT coalesce(max(version),0) INTO current_version FROM platform.local_alert_reviews WHERE workspace_key=p_workspace AND alert_id=p_alert;
  IF current_version<>p_expected THEN RAISE EXCEPTION USING ERRCODE='P3209',MESSAGE='Alert review conflict'; END IF;
  INSERT INTO platform.local_alert_reviews(workspace_key,alert_id,version,expected_version,request_id,action,outcome,note,actor_subject)
  VALUES(p_workspace,p_alert,p_expected+1,p_expected,p_request,p_action,p_outcome,p_note,p_subject);
  RETURN QUERY SELECT true;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION platform.review_local_alert(text,uuid,integer,uuid,text,text,text,text) FROM PUBLIC,lmps_app,lmps_intake,lmps_outbox;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform.review_local_alert(text,uuid,integer,uuid,text,text,text,text) TO lmps_reviewer;
