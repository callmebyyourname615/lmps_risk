-- Local/synthetic analyst workflow. No verified criminal label, training eligibility or payment action.
CREATE TABLE platform.local_cases (
 workspace_key text COLLATE "C" NOT NULL CHECK (workspace_key='synthetic_local'),
 case_id uuid NOT NULL CHECK (case_id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
 title text NOT NULL CHECK (length(title) BETWEEN 1 AND 120 AND title ~ '[^[:space:]]'),
 state text NOT NULL DEFAULT 'open' CHECK (state IN ('open','in_review','closed')),
 version integer NOT NULL CHECK (version BETWEEN 1 AND 1000),
 assignee_subject text CHECK (assignee_subject ~ '^synthetic_[a-z0-9_]{1,40}$'),
 created_by text NOT NULL CHECK (created_by ~ '^synthetic_[a-z0-9_]{1,40}$'),
 review_cycle integer NOT NULL DEFAULT 1 CHECK (review_cycle BETWEEN 1 AND 1000),
 evidence_version integer NOT NULL DEFAULT 1 CHECK (evidence_version BETWEEN 1 AND 20),
 active_outcome_version integer,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 recorded_by text NOT NULL DEFAULT session_user::text CHECK (recorded_by='lmps_case'),
 PRIMARY KEY(workspace_key,case_id),
 CHECK ((state='open' OR assignee_subject IS NOT NULL) AND (state<>'closed' OR active_outcome_version IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE platform.local_case_alerts (
 workspace_key text COLLATE "C" NOT NULL,
 case_id uuid NOT NULL,
 alert_id uuid NOT NULL,
 added_version integer NOT NULL CHECK (added_version BETWEEN 1 AND 1000),
 evidence jsonb NOT NULL CHECK (octet_length(evidence::text)<=4096),
 evidence_sha256 text NOT NULL CHECK (evidence_sha256 ~ '^[0-9a-f]{64}$'),
 PRIMARY KEY(workspace_key,alert_id),
 FOREIGN KEY(workspace_key,case_id) REFERENCES platform.local_cases(workspace_key,case_id),
 FOREIGN KEY(workspace_key,alert_id) REFERENCES platform.local_alerts(workspace_key,alert_id),
 CHECK ((evidence->>'alert_id'=alert_id::text) IS TRUE)
);
--> statement-breakpoint
CREATE INDEX local_case_alerts_case_order ON platform.local_case_alerts(workspace_key,case_id,added_version);
--> statement-breakpoint
CREATE TABLE platform.local_case_events (
 workspace_key text COLLATE "C" NOT NULL,
 case_id uuid NOT NULL,
 version integer NOT NULL CHECK (version BETWEEN 1 AND 1000),
 request_id uuid NOT NULL CHECK (request_id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
 action text NOT NULL CHECK (action IN ('create','link_alert','assign','start','add_note','record_outcome','close','reopen')),
 actor_subject text NOT NULL CHECK (actor_subject ~ '^synthetic_[a-z0-9_]{1,40}$'),
 actor_role text NOT NULL DEFAULT session_user::text CHECK (actor_role='lmps_case'),
 command jsonb NOT NULL CHECK (octet_length(command::text)<=18432),
 result jsonb NOT NULL,
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_key,case_id,version),
 UNIQUE(workspace_key,request_id),
 FOREIGN KEY(workspace_key,case_id) REFERENCES platform.local_cases(workspace_key,case_id)
);
--> statement-breakpoint
CREATE TABLE platform.local_case_outcomes (
 workspace_key text COLLATE "C" NOT NULL,
 case_id uuid NOT NULL,
 version integer NOT NULL,
 review_cycle integer NOT NULL,
 evidence_version integer NOT NULL,
 actor_subject text NOT NULL CHECK (actor_subject ~ '^synthetic_[a-z0-9_]{1,40}$'),
 dimensions jsonb NOT NULL CHECK (jsonb_typeof(dimensions)='object' AND octet_length(dimensions::text)<=16384),
 dimensions_sha256 text NOT NULL CHECK (dimensions_sha256 ~ '^[0-9a-f]{64}$'),
 review_status text NOT NULL DEFAULT 'analyst_reviewed' CHECK (review_status='analyst_reviewed'),
 maturity text NOT NULL DEFAULT 'unverified' CHECK (maturity='unverified'),
 training_eligible boolean NOT NULL DEFAULT false CHECK (training_eligible=false),
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_key,case_id,version),
 FOREIGN KEY(workspace_key,case_id,version) REFERENCES platform.local_case_events(workspace_key,case_id,version) DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
ALTER TABLE platform.local_cases ADD CONSTRAINT local_case_current_event_fk FOREIGN KEY(workspace_key,case_id,version) REFERENCES platform.local_case_events(workspace_key,case_id,version) DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE platform.local_cases ADD CONSTRAINT local_case_current_outcome_fk FOREIGN KEY(workspace_key,case_id,active_outcome_version) REFERENCES platform.local_case_outcomes(workspace_key,case_id,version) DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE platform.local_case_alerts ADD CONSTRAINT local_case_link_event_fk FOREIGN KEY(workspace_key,case_id,added_version) REFERENCES platform.local_case_events(workspace_key,case_id,version) DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
REVOKE ALL ON platform.local_cases,platform.local_case_alerts,platform.local_case_events,platform.local_case_outcomes FROM PUBLIC,lmps_app,lmps_intake,lmps_outbox,lmps_reviewer,lmps_policy,lmps_case;
--> statement-breakpoint
GRANT USAGE ON SCHEMA platform TO lmps_case;
--> statement-breakpoint
GRANT SELECT ON platform.local_cases,platform.local_case_alerts,platform.local_case_events,platform.local_case_outcomes TO lmps_app,lmps_case;
--> statement-breakpoint
GRANT SELECT ON platform.local_alerts,platform.local_alert_reviews,platform.local_alert_policies,platform.local_transaction_risks TO lmps_case;
--> statement-breakpoint
CREATE FUNCTION platform.command_local_case(p_workspace text,p_case uuid,p_actor text,p_command jsonb,p_evidence jsonb,p_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c platform.local_cases%ROWTYPE; saved platform.local_case_events%ROWTYPE; o platform.local_case_outcomes%ROWTYPE;
 a text; req uuid; expected integer; next_version integer; linked uuid; output jsonb; dim jsonb; dimension_key text;
BEGIN
 IF session_user::text<>'lmps_case' OR p_workspace IS DISTINCT FROM 'synthetic_local' OR p_case IS NULL
  OR p_case::text!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  OR p_actor IS NULL OR p_actor!~'^synthetic_[a-z0-9_]{1,40}$' OR p_command IS NULL OR octet_length(p_command::text)>18432
  OR coalesce(p_command->>'request_id','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  OR coalesce(p_command->>'note','')!~'[^[:space:]]' OR length(p_command->>'note')>2000
  OR coalesce(p_command->>'expected_version','')!~'^(0|[1-9][0-9]{0,3})$' THEN
  RAISE EXCEPTION USING ERRCODE='P3700',MESSAGE='Invalid case command';
 END IF;
 a=p_command->>'action'; req=(p_command->>'request_id')::uuid; expected=(p_command->>'expected_version')::integer;
 IF a IS NULL OR a NOT IN ('create','link_alert','assign','start','add_note','record_outcome','close','reopen') THEN RAISE EXCEPTION USING ERRCODE='P3700',MESSAGE='Invalid case action'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_workspace||':'||req::text,371));
 SELECT * INTO saved FROM platform.local_case_events WHERE workspace_key=p_workspace AND request_id=req;
 IF FOUND THEN
  IF saved.case_id<>p_case OR saved.actor_subject<>p_actor OR saved.command<>p_command THEN RAISE EXCEPTION USING ERRCODE='P3709',MESSAGE='Case command conflict'; END IF;
  RETURN jsonb_build_object('status','duplicate','result',saved.result);
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_workspace||':'||p_case::text,372));
 SELECT * INTO c FROM platform.local_cases WHERE workspace_key=p_workspace AND case_id=p_case FOR UPDATE;
 IF a='create' THEN
  IF FOUND OR expected<>0 THEN RAISE EXCEPTION USING ERRCODE='P3709',MESSAGE='Case exists'; END IF;
  INSERT INTO platform.local_cases(workspace_key,case_id,title,version,created_by) VALUES(p_workspace,p_case,p_command->>'title',1,p_actor) RETURNING * INTO c;
  next_version=1;
 ELSE
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P3704',MESSAGE='Case not found'; END IF;
  IF expected<>c.version THEN RAISE EXCEPTION USING ERRCODE='P3709',MESSAGE='Case version conflict'; END IF;
  IF c.version>=1000 THEN RAISE EXCEPTION USING ERRCODE='P3713',MESSAGE='Case history limit'; END IF;
  next_version=c.version+1;
  IF (c.state='closed' AND a<>'reopen') OR (a='reopen' AND c.state<>'closed') THEN RAISE EXCEPTION USING ERRCODE='P3710',MESSAGE='Invalid case transition'; END IF;
  IF a IN ('start','add_note','record_outcome','close') AND p_actor IS DISTINCT FROM c.assignee_subject THEN RAISE EXCEPTION USING ERRCODE='P3711',MESSAGE='Assigned reviewer required'; END IF;
  IF a='assign' THEN
   IF coalesce(p_command->>'assignee_subject','')!~'^synthetic_[a-z0-9_]{1,40}$' THEN RAISE EXCEPTION USING ERRCODE='P3700',MESSAGE='Invalid assignee'; END IF;
   IF c.assignee_subject=p_command->>'assignee_subject' THEN RAISE EXCEPTION USING ERRCODE='P3709',MESSAGE='Assignee unchanged'; END IF;
   c.assignee_subject=p_command->>'assignee_subject'; c.active_outcome_version=NULL;
  ELSIF a='start' THEN
   IF c.state<>'open' THEN RAISE EXCEPTION USING ERRCODE='P3710',MESSAGE='Case is not open'; END IF;
   c.state='in_review';
  ELSIF a='record_outcome' THEN
   IF c.state<>'in_review' THEN RAISE EXCEPTION USING ERRCODE='P3710',MESSAGE='Case is not in review'; END IF;
   dim=p_command->'dimensions';
   IF jsonb_typeof(dim) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(dim))<>3 OR p_hash IS NULL OR p_hash!~'^[0-9a-f]{64}$' THEN RAISE EXCEPTION USING ERRCODE='P3700',MESSAGE='Invalid dimensions'; END IF;
   FOREACH dimension_key IN ARRAY ARRAY['fraud','mule_network','aml'] LOOP
    IF jsonb_typeof(dim->dimension_key) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(dim->dimension_key))<>2
     OR coalesce(dim->dimension_key->>'outcome','') NOT IN ('suspicious','legitimate','unknown')
     OR coalesce(dim->dimension_key->>'rationale','')!~'[^[:space:]]' OR length(dim->dimension_key->>'rationale')>1000 THEN
     RAISE EXCEPTION USING ERRCODE='P3700',MESSAGE='Invalid dimension outcome';
    END IF;
   END LOOP;
   INSERT INTO platform.local_case_outcomes(workspace_key,case_id,version,review_cycle,evidence_version,actor_subject,dimensions,dimensions_sha256)
    VALUES(p_workspace,p_case,next_version,c.review_cycle,c.evidence_version,p_actor,dim,p_hash);
   c.active_outcome_version=next_version;
  ELSIF a='close' THEN
   IF c.state<>'in_review' THEN RAISE EXCEPTION USING ERRCODE='P3710',MESSAGE='Case is not in review'; END IF;
   SELECT * INTO o FROM platform.local_case_outcomes WHERE workspace_key=p_workspace AND case_id=p_case AND version=c.active_outcome_version;
   IF NOT FOUND OR o.review_cycle<>c.review_cycle OR o.evidence_version<>c.evidence_version OR o.actor_subject<>p_actor THEN RAISE EXCEPTION USING ERRCODE='P3712',MESSAGE='Current outcomes required'; END IF;
   c.state='closed';
  ELSIF a='reopen' THEN
   c.state='open'; c.review_cycle=c.review_cycle+1; c.active_outcome_version=NULL;
  END IF;
 END IF;
 IF a IN ('create','link_alert') THEN
  IF coalesce(p_command->>'alert_id','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
   OR p_hash IS NULL OR p_hash!~'^[0-9a-f]{64}$' OR p_evidence IS NULL THEN RAISE EXCEPTION USING ERRCODE='P3700',MESSAGE='Invalid alert reference'; END IF;
  linked=(p_command->>'alert_id')::uuid;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_workspace||':'||linked::text,373));
  IF EXISTS(SELECT 1 FROM platform.local_case_alerts WHERE workspace_key=p_workspace AND alert_id=linked) THEN RAISE EXCEPTION USING ERRCODE='P3708',MESSAGE='Alert already linked'; END IF;
  IF (SELECT count(*) FROM platform.local_case_alerts WHERE workspace_key=p_workspace AND case_id=p_case)>=20 THEN RAISE EXCEPTION USING ERRCODE='P3713',MESSAGE='Case evidence limit'; END IF;
  IF NOT EXISTS(SELECT 1 FROM platform.local_alerts al WHERE al.workspace_key=p_workspace AND al.alert_id=linked AND al.alert_id::text=p_evidence->>'alert_id'
    AND al.snapshot_sha256=p_evidence->>'alert_snapshot_sha256' AND al.assessment_run_id::text=p_evidence->>'assessment_run_id'
    AND al.snapshot->>'assessment_sha256'=p_evidence->>'assessment_sha256') THEN RAISE EXCEPTION USING ERRCODE='P3705',MESSAGE='Alert evidence not found'; END IF;
  INSERT INTO platform.local_case_alerts(workspace_key,case_id,alert_id,added_version,evidence,evidence_sha256) VALUES(p_workspace,p_case,linked,next_version,p_evidence,p_hash);
  IF a='link_alert' THEN c.evidence_version=c.evidence_version+1; END IF;
  c.active_outcome_version=NULL;
 END IF;
 IF a<>'create' THEN
  UPDATE platform.local_cases SET state=c.state,version=next_version,assignee_subject=c.assignee_subject,review_cycle=c.review_cycle,evidence_version=c.evidence_version,
   active_outcome_version=c.active_outcome_version,updated_at=clock_timestamp() WHERE workspace_key=p_workspace AND case_id=p_case;
 END IF;
 output=jsonb_build_object('case_id',p_case::text,'state',c.state,'version',next_version,'assignee_subject',c.assignee_subject,'review_cycle',c.review_cycle,
  'evidence_version',c.evidence_version,'active_outcome_version',c.active_outcome_version);
 INSERT INTO platform.local_case_events(workspace_key,case_id,version,request_id,action,actor_subject,command,result) VALUES(p_workspace,p_case,next_version,req,a,p_actor,p_command,output);
 RETURN jsonb_build_object('status','inserted','result',output);
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION platform.command_local_case(text,uuid,text,jsonb,jsonb,text) FROM PUBLIC,lmps_app,lmps_intake,lmps_outbox,lmps_reviewer,lmps_policy;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform.command_local_case(text,uuid,text,jsonb,jsonb,text) TO lmps_case;
