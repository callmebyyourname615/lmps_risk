-- Separate immutable review evidence; existing Case opinions remain non-training labels.
CREATE TABLE platform.local_label_adjudications (
 workspace_key text COLLATE "C" NOT NULL CHECK(workspace_key='synthetic_local'),
 label_id uuid NOT NULL,
 version integer NOT NULL CHECK(version BETWEEN 1 AND 100),
 request_id uuid NOT NULL,
 case_id uuid NOT NULL,
 outcome_version integer NOT NULL,
 alert_id uuid NOT NULL,
 task text NOT NULL CHECK(task IN ('fraud','mule_network','aml')),
 command jsonb NOT NULL CHECK(jsonb_typeof(command)='object' AND octet_length(command::text)<=4096),
 command_sha256 text NOT NULL CHECK(command_sha256~'^[0-9a-f]{64}$'),
 target jsonb NOT NULL,
 case_cycle integer NOT NULL,
 evidence_version integer NOT NULL,
 actor_subject text NOT NULL CHECK(actor_subject~'^synthetic_[a-z0-9_]{1,40}$'),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(recorded_at)),
 recorded_by text NOT NULL DEFAULT session_user::text CHECK(recorded_by='lmps_policy'),
 PRIMARY KEY(workspace_key,label_id,version),
 UNIQUE(workspace_key,request_id),
 FOREIGN KEY(workspace_key,case_id,outcome_version) REFERENCES platform.local_case_outcomes(workspace_key,case_id,version),
 FOREIGN KEY(workspace_key,alert_id) REFERENCES platform.local_alerts(workspace_key,alert_id),
 CHECK((command->>'request_id'=request_id::text AND command->>'alert_id'=alert_id::text AND command->>'task'=task
   AND (command->>'expected_version')::integer=version-1 AND (command->>'outcome_version')::integer=outcome_version) IS TRUE)
);
--> statement-breakpoint
CREATE UNIQUE INDEX local_label_one_chain ON platform.local_label_adjudications(workspace_key,case_id,alert_id,task) WHERE version=1;
--> statement-breakpoint
REVOKE ALL ON platform.local_label_adjudications FROM PUBLIC,lmps_app,lmps_intake,lmps_outbox,lmps_reviewer,lmps_case,lmps_policy;
--> statement-breakpoint
GRANT SELECT ON platform.local_label_adjudications TO lmps_app,lmps_policy;
--> statement-breakpoint
GRANT INSERT(workspace_key,label_id,version,request_id,case_id,outcome_version,alert_id,task,command,command_sha256,target,case_cycle,evidence_version,actor_subject) ON platform.local_label_adjudications TO lmps_policy;
--> statement-breakpoint
GRANT SELECT ON platform.local_cases,platform.local_case_events,platform.local_case_alerts,platform.local_case_outcomes,platform.local_alerts,platform.local_alert_policies,platform.local_alert_reviews,platform.local_transaction_risks TO lmps_policy;
