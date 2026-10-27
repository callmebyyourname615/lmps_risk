-- Synthetic monitoring prototype. Does not approve a production risk policy or enable payment actions.
CREATE TABLE platform.local_risk_policies (
  workspace_key text COLLATE "C" NOT NULL CHECK (workspace_key='synthetic_local'),
  policy_id text COLLATE "C" NOT NULL CHECK (policy_id ~ '^synthetic_[A-Za-z0-9_.:-]{1,70}$'),
  policy_version text COLLATE "C" NOT NULL CHECK (policy_version ~ '^synthetic_[A-Za-z0-9_.:-]{1,70}$'),
  policy jsonb NOT NULL,
  policy_sha256 text NOT NULL CHECK (policy_sha256 ~ '^[0-9a-f]{64}$'),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  recorded_by text NOT NULL DEFAULT session_user::text,
  PRIMARY KEY (workspace_key,policy_id,policy_version),
  UNIQUE (workspace_key,policy_id,policy_version,policy_sha256),
  CHECK ((jsonb_typeof(policy)='object' AND octet_length(policy::text)<=16384
    AND policy->>'policy_id'=policy_id AND policy->>'version'=policy_version
    AND jsonb_typeof(policy->'rules')='array' AND jsonb_array_length(policy->'rules')=15) IS TRUE)
);
--> statement-breakpoint
CREATE TABLE platform.local_transaction_risks (
  workspace_key text COLLATE "C" NOT NULL CHECK (workspace_key='synthetic_local'),
  run_id uuid NOT NULL CHECK (run_id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  namespace text COLLATE "C" NOT NULL CHECK (namespace ~ '^synthetic_[a-z0-9_]{1,40}$'),
  transaction_id text COLLATE "C" NOT NULL CHECK (transaction_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  revision_number integer NOT NULL CHECK (revision_number>0),
  policy_id text COLLATE "C",
  policy_version text COLLATE "C",
  snapshot jsonb NOT NULL,
  policy_sha256 text GENERATED ALWAYS AS (snapshot->'result'->'policy'->>'sha256') STORED,
  snapshot_sha256 text NOT NULL CHECK (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  recorded_by text NOT NULL DEFAULT session_user::text,
  PRIMARY KEY (workspace_key,run_id),
  FOREIGN KEY (workspace_key,policy_id,policy_version,policy_sha256) REFERENCES platform.local_risk_policies(workspace_key,policy_id,policy_version,policy_sha256),
  CHECK ((policy_id IS NULL)=(policy_version IS NULL)),
  CHECK ((policy_id IS NULL)=(policy_sha256 IS NULL)),
  CHECK ((jsonb_typeof(snapshot)='object' AND octet_length(snapshot::text)<=2200000
    AND snapshot ?& ARRAY['request','observation','result'] AND snapshot-ARRAY['request','observation','result']='{}'::jsonb
    AND snapshot->'request'->>'workspace_key'=workspace_key AND snapshot->'request'->>'run_id'=run_id::text
    AND snapshot->'request'->>'provenance'='local_synthetic' AND snapshot->'request'->>'execution_mode'='test'
    AND snapshot->'request'->'target'->>'namespace'=namespace AND snapshot->'request'->'target'->>'transaction_id'=transaction_id
    AND snapshot->'request'->'target'->>'revision_number'=revision_number::text
    AND ((policy_id IS NULL AND snapshot->'request'->'policy'='null'::jsonb) OR
      (policy_id IS NOT NULL AND snapshot->'request'->'policy'->>'policy_id'=policy_id AND snapshot->'request'->'policy'->>'version'=policy_version))
    AND snapshot->'result'->>'engine_version'='synthetic-risk-0.1.0-draft.1' AND snapshot->'result'->'enforcement'='false'::jsonb
    AND snapshot->'result'->'canonical_emission'='false'::jsonb AND snapshot->'result'->'decision'->>'status'='not_decided'
    AND jsonb_typeof(snapshot->'result'->'findings')='array' AND jsonb_array_length(snapshot->'result'->'findings')=15) IS TRUE)
);
--> statement-breakpoint
CREATE INDEX local_transaction_risks_target ON platform.local_transaction_risks(workspace_key,namespace,transaction_id,revision_number,run_id);
--> statement-breakpoint
REVOKE ALL ON platform.local_risk_policies,platform.local_transaction_risks FROM PUBLIC,lmps_app,lmps_intake,lmps_outbox;
--> statement-breakpoint
GRANT SELECT ON platform.local_risk_policies,platform.local_transaction_risks TO lmps_app,lmps_intake;
--> statement-breakpoint
GRANT INSERT(workspace_key,policy_id,policy_version,policy,policy_sha256) ON platform.local_risk_policies TO lmps_intake;
--> statement-breakpoint
GRANT INSERT(workspace_key,run_id,namespace,transaction_id,revision_number,policy_id,policy_version,snapshot,snapshot_sha256) ON platform.local_transaction_risks TO lmps_intake;
