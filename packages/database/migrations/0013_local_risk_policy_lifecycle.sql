-- Local/synthetic policy governance only; identities are synthetic JWT subjects, not production approvers.
CREATE TABLE platform.local_risk_policy_versions (
  workspace_key text COLLATE "C" NOT NULL CHECK (workspace_key='synthetic_local'),
  policy_id text COLLATE "C" NOT NULL CHECK (policy_id ~ '^synthetic_[A-Za-z0-9_.:-]{1,70}$'),
  policy_version text COLLATE "C" NOT NULL CHECK (policy_version ~ '^synthetic_[A-Za-z0-9_.:-]{1,70}$'),
  policy jsonb NOT NULL CHECK (jsonb_typeof(policy)='object' AND octet_length(policy::text)<=16384),
  policy_sha256 text NOT NULL CHECK (policy_sha256 ~ '^[0-9a-f]{64}$'),
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','submitted','approved','rejected')),
  revision integer NOT NULL DEFAULT 0 CHECK (revision BETWEEN 0 AND 2),
  created_by text NOT NULL CHECK (created_by ~ '^synthetic_[a-z0-9_]{1,40}$'),
  submitted_by text CHECK (submitted_by ~ '^synthetic_[a-z0-9_]{1,40}$'),
  approved_by text CHECK (approved_by ~ '^synthetic_[a-z0-9_]{1,40}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(workspace_key,policy_id,policy_version),
  UNIQUE(workspace_key,policy_id,policy_version,policy_sha256),
  CHECK ((policy->>'policy_id'=policy_id AND policy->>'version'=policy_version AND jsonb_array_length(policy->'rules')=15) IS TRUE),
  CHECK ((state='draft' AND revision=0 AND submitted_by IS NULL AND approved_by IS NULL)
    OR (state='submitted' AND revision=1 AND submitted_by IS NOT NULL AND approved_by IS NULL)
    OR (state='rejected' AND revision=2 AND submitted_by IS NOT NULL AND approved_by IS NULL)
    OR (state='approved' AND revision=2 AND approved_by IS NOT NULL AND submitted_by IS NOT NULL AND approved_by<>created_by AND approved_by<>submitted_by))
);
--> statement-breakpoint
CREATE TABLE platform.local_risk_policy_bindings (
  workspace_key text COLLATE "C" NOT NULL CHECK (workspace_key='synthetic_local'),
  namespace text COLLATE "C" NOT NULL CHECK (namespace ~ '^synthetic_[a-z0-9_]{1,40}$'),
  currency text COLLATE "C" NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  generation integer NOT NULL CHECK (generation>0),
  policy_id text COLLATE "C" NOT NULL,
  policy_version text COLLATE "C" NOT NULL,
  policy_sha256 text NOT NULL,
  PRIMARY KEY(workspace_key,namespace,currency),
  FOREIGN KEY(workspace_key,policy_id,policy_version,policy_sha256) REFERENCES platform.local_risk_policy_versions(workspace_key,policy_id,policy_version,policy_sha256)
);
--> statement-breakpoint
CREATE TABLE platform.local_risk_policy_events (
  workspace_key text COLLATE "C" NOT NULL CHECK (workspace_key='synthetic_local'),
  request_id uuid NOT NULL CHECK (request_id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  actor_subject text NOT NULL CHECK (actor_subject ~ '^synthetic_[a-z0-9_]{1,40}$'),
  action text NOT NULL CHECK (action IN ('create','submit','approve','reject','activate','rollback')),
  command jsonb NOT NULL CHECK (octet_length(command::text)<=24576),
  result jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  actor_role text NOT NULL DEFAULT session_user::text CHECK (actor_role='lmps_policy'),
  PRIMARY KEY(workspace_key,request_id)
);
--> statement-breakpoint
CREATE TABLE platform.local_risk_job_policy_bindings (
  workspace_key text COLLATE "C" NOT NULL CHECK (workspace_key='synthetic_local'),
  job_ref uuid NOT NULL,
  namespace text COLLATE "C" NOT NULL,
  currency text COLLATE "C" NOT NULL,
  generation integer NOT NULL CHECK (generation>0),
  policy_id text COLLATE "C" NOT NULL,
  policy_version text COLLATE "C" NOT NULL,
  policy_sha256 text NOT NULL,
  command_sha256 text NOT NULL CHECK (command_sha256 ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY(workspace_key,job_ref),
  FOREIGN KEY(workspace_key,job_ref) REFERENCES platform.local_risk_jobs(workspace_key,job_ref),
  FOREIGN KEY(workspace_key,policy_id,policy_version,policy_sha256) REFERENCES platform.local_risk_policy_versions(workspace_key,policy_id,policy_version,policy_sha256)
);
--> statement-breakpoint
REVOKE ALL ON platform.local_risk_policy_versions,platform.local_risk_policy_bindings,platform.local_risk_policy_events,platform.local_risk_job_policy_bindings FROM PUBLIC,lmps_app,lmps_intake,lmps_reviewer,lmps_outbox,lmps_policy;
--> statement-breakpoint
GRANT USAGE ON SCHEMA platform TO lmps_policy;
--> statement-breakpoint
GRANT SELECT ON platform.local_risk_policy_versions,platform.local_risk_policy_bindings,platform.local_risk_policy_events,platform.local_risk_job_policy_bindings TO lmps_app,lmps_intake,lmps_policy;
--> statement-breakpoint
GRANT INSERT(workspace_key,job_ref,namespace,currency,generation,policy_id,policy_version,policy_sha256,command_sha256) ON platform.local_risk_job_policy_bindings TO lmps_intake;
--> statement-breakpoint
CREATE FUNCTION platform.command_local_risk_policy(p_workspace text,p_actor text,p_command jsonb,p_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v platform.local_risk_policy_versions%ROWTYPE; saved platform.local_risk_policy_events%ROWTYPE;
 b platform.local_risk_policy_bindings%ROWTYPE; a text; pid text; pv text; req uuid; result jsonb; next_state text;
BEGIN
 IF session_user::text<>'lmps_policy' OR p_workspace IS DISTINCT FROM 'synthetic_local' OR p_actor IS NULL OR p_actor!~'^synthetic_[a-z0-9_]{1,40}$'
  OR p_command IS NULL OR octet_length(p_command::text)>24576 OR coalesce(p_command->>'note','')!~'[^[:space:]]' OR length(p_command->>'note')>1000
  OR coalesce(p_command->>'request_id','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
  RAISE EXCEPTION USING ERRCODE='P3600',MESSAGE='Invalid policy input';
 END IF;
 a=p_command->>'action'; req=(p_command->>'request_id')::uuid;
 IF a IS NULL OR a NOT IN ('create','submit','approve','reject','activate','rollback') THEN RAISE EXCEPTION USING ERRCODE='P3600',MESSAGE='Invalid action'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_workspace||':'||req::text,361));
 SELECT * INTO saved FROM platform.local_risk_policy_events WHERE workspace_key=p_workspace AND request_id=req;
 IF FOUND THEN
  IF saved.actor_subject<>p_actor OR saved.command<>p_command THEN RAISE EXCEPTION USING ERRCODE='P3609',MESSAGE='Policy conflict'; END IF;
  RETURN jsonb_build_object('status','duplicate','result',saved.result);
 END IF;
 pid=CASE WHEN a='create' THEN p_command->'policy'->>'policy_id' ELSE p_command->>'policy_id' END;
 pv=CASE WHEN a='create' THEN p_command->'policy'->>'version' ELSE p_command->>'policy_version' END;
 IF a='create' THEN
  IF p_hash IS NULL OR p_hash!~'^[0-9a-f]{64}$' THEN RAISE EXCEPTION USING ERRCODE='P3600',MESSAGE='Invalid policy hash'; END IF;
  INSERT INTO platform.local_risk_policy_versions(workspace_key,policy_id,policy_version,policy,policy_sha256,created_by)
   VALUES(p_workspace,pid,pv,p_command->'policy',p_hash,p_actor) ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P3609',MESSAGE='Policy conflict'; END IF;
  result=jsonb_build_object('policy_id',pid,'policy_version',pv,'state','draft','revision',0,'policy_sha256',p_hash);
 ELSE
  SELECT * INTO v FROM platform.local_risk_policy_versions WHERE workspace_key=p_workspace AND policy_id=pid AND policy_version=pv FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P3604',MESSAGE='Policy not found'; END IF;
  IF a IN ('submit','approve','reject') THEN
   IF (p_command->>'expected_revision')::integer IS DISTINCT FROM v.revision THEN RAISE EXCEPTION USING ERRCODE='P3609',MESSAGE='Policy conflict'; END IF;
   IF NOT ((a='submit' AND v.state='draft') OR (a IN ('approve','reject') AND v.state='submitted')) THEN RAISE EXCEPTION USING ERRCODE='P3610',MESSAGE='Invalid transition'; END IF;
   IF a IN ('approve','reject') AND (p_actor=v.created_by OR p_actor=v.submitted_by) THEN RAISE EXCEPTION USING ERRCODE='P3611',MESSAGE='Self approval denied'; END IF;
   next_state=CASE a WHEN 'submit' THEN 'submitted' WHEN 'approve' THEN 'approved' ELSE 'rejected' END;
   UPDATE platform.local_risk_policy_versions SET state=next_state,revision=revision+1,
    submitted_by=CASE WHEN a='submit' THEN p_actor ELSE submitted_by END,approved_by=CASE WHEN a='approve' THEN p_actor ELSE NULL END
    WHERE workspace_key=p_workspace AND policy_id=pid AND policy_version=pv;
   result=jsonb_build_object('policy_id',pid,'policy_version',pv,'state',next_state,'revision',v.revision+1,'policy_sha256',v.policy_sha256);
  ELSE
   IF v.state<>'approved' THEN RAISE EXCEPTION USING ERRCODE='P3612',MESSAGE='Policy not approved'; END IF;
   IF p_command->>'currency' IS DISTINCT FROM v.policy->>'currency' OR coalesce(p_command->>'namespace','')!~'^synthetic_[a-z0-9_]{1,40}$'
    OR coalesce(p_command->>'expected_generation','')!~'^(0|[1-9][0-9]{0,9})$' THEN RAISE EXCEPTION USING ERRCODE='P3600',MESSAGE='Invalid binding'; END IF;
   PERFORM pg_advisory_xact_lock(hashtextextended(p_workspace||':'||(p_command->>'namespace')||':'||(p_command->>'currency'),362));
   SELECT * INTO b FROM platform.local_risk_policy_bindings WHERE workspace_key=p_workspace AND namespace=p_command->>'namespace' AND currency=p_command->>'currency' FOR UPDATE;
   IF coalesce(b.generation,0)<>(p_command->>'expected_generation')::integer OR (b.policy_id=pid AND b.policy_version=pv) THEN RAISE EXCEPTION USING ERRCODE='P3609',MESSAGE='Policy conflict'; END IF;
   IF a='rollback' AND NOT EXISTS(SELECT 1 FROM platform.local_risk_policy_events e WHERE e.workspace_key=p_workspace AND e.action IN ('activate','rollback')
    AND e.command->>'namespace'=p_command->>'namespace' AND e.command->>'currency'=p_command->>'currency' AND e.result->>'policy_id'=pid AND e.result->>'policy_version'=pv) THEN
    RAISE EXCEPTION USING ERRCODE='P3610',MESSAGE='No previous activation';
   END IF;
   INSERT INTO platform.local_risk_policy_bindings(workspace_key,namespace,currency,generation,policy_id,policy_version,policy_sha256)
    VALUES(p_workspace,p_command->>'namespace',p_command->>'currency',coalesce(b.generation,0)+1,pid,pv,v.policy_sha256)
    ON CONFLICT(workspace_key,namespace,currency) DO UPDATE SET generation=excluded.generation,policy_id=excluded.policy_id,policy_version=excluded.policy_version,policy_sha256=excluded.policy_sha256;
   result=jsonb_build_object('policy_id',pid,'policy_version',pv,'policy_sha256',v.policy_sha256,'namespace',p_command->>'namespace','currency',p_command->>'currency','generation',coalesce(b.generation,0)+1);
  END IF;
 END IF;
 INSERT INTO platform.local_risk_policy_events(workspace_key,request_id,actor_subject,action,command,result) VALUES(p_workspace,req,p_actor,a,p_command,result);
 RETURN jsonb_build_object('status','inserted','result',result);
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION platform.command_local_risk_policy(text,text,jsonb,text) FROM PUBLIC,lmps_app,lmps_intake,lmps_outbox,lmps_reviewer;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform.command_local_risk_policy(text,text,jsonb,text) TO lmps_policy;
