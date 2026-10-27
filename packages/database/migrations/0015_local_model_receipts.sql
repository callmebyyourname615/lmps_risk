-- Local synthetic shadow evidence only. No payment actions or verified training labels.
CREATE TABLE platform.local_model_gate_policies (
 workspace_key text COLLATE "C" NOT NULL CHECK(workspace_key='synthetic_local'),
 policy_id text COLLATE "C" NOT NULL,
 policy_version text COLLATE "C" NOT NULL,
 policy jsonb NOT NULL CHECK(jsonb_typeof(policy)='object' AND octet_length(policy::text)<=16384),
 policy_sha256 text NOT NULL CHECK(policy_sha256~'^[0-9a-f]{64}$'),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(recorded_at)),
 recorded_by text NOT NULL DEFAULT session_user::text CHECK(recorded_by='lmps_intake'),
 PRIMARY KEY(workspace_key,policy_id,policy_version),
 UNIQUE(workspace_key,policy_id,policy_version,policy_sha256),
 CHECK((policy_id~'^synthetic_[a-z0-9_]{1,60}$' AND policy_version~'^synthetic_[a-z0-9_]{1,60}$'
  AND policy->>'policy_id'=policy_id AND policy->>'version'=policy_version) IS TRUE)
);
--> statement-breakpoint
CREATE TABLE platform.local_model_receipts (
 workspace_key text COLLATE "C" NOT NULL CHECK(workspace_key='synthetic_local'),
 request_id uuid NOT NULL,
 assessment_run_id uuid NOT NULL,
 policy_id text COLLATE "C" NOT NULL,
 policy_version text COLLATE "C" NOT NULL,
 policy_sha256 text NOT NULL,
 alert_id uuid,
 snapshot jsonb NOT NULL,
 snapshot_sha256 text NOT NULL CHECK(snapshot_sha256~'^[0-9a-f]{64}$'),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(recorded_at)),
 recorded_by text NOT NULL DEFAULT session_user::text CHECK(recorded_by='lmps_intake'),
 PRIMARY KEY(workspace_key,request_id),
 FOREIGN KEY(workspace_key,assessment_run_id) REFERENCES platform.local_transaction_risks(workspace_key,run_id),
 FOREIGN KEY(workspace_key,policy_id,policy_version,policy_sha256) REFERENCES platform.local_model_gate_policies(workspace_key,policy_id,policy_version,policy_sha256),
 FOREIGN KEY(workspace_key,alert_id) REFERENCES platform.local_alerts(workspace_key,alert_id),
 CHECK((jsonb_typeof(snapshot)='object' AND octet_length(snapshot::text)<=65536
  AND snapshot->'request'->>'request_id'=request_id::text AND snapshot->'request'->>'assessment_run_id'=assessment_run_id::text
  AND snapshot->'request'->>'workspace_key'=workspace_key AND snapshot->'request'->>'execution_mode'='shadow'
  AND snapshot->>'alert_id' IS NOT DISTINCT FROM alert_id::text) IS TRUE)
);
--> statement-breakpoint
REVOKE ALL ON platform.local_model_gate_policies,platform.local_model_receipts FROM PUBLIC,lmps_app,lmps_intake,lmps_outbox,lmps_reviewer,lmps_policy,lmps_case;
--> statement-breakpoint
GRANT SELECT ON platform.local_model_gate_policies,platform.local_model_receipts TO lmps_app,lmps_intake;
--> statement-breakpoint
GRANT INSERT(workspace_key,policy_id,policy_version,policy,policy_sha256) ON platform.local_model_gate_policies TO lmps_intake;
--> statement-breakpoint
GRANT INSERT(workspace_key,request_id,assessment_run_id,policy_id,policy_version,policy_sha256,alert_id,snapshot,snapshot_sha256) ON platform.local_model_receipts TO lmps_intake;
