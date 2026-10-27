-- Synthetic fake-provider outbox only. No live alert, device or recipient is represented.
CREATE TABLE platform.local_outbox_intents (
  intent_ref uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_key text COLLATE "C" NOT NULL CHECK (workspace_key ~ '^synthetic_[a-z0-9_]{1,40}$'),
  semantic_key text COLLATE "C" NOT NULL CHECK (semantic_key ~ '^synthetic_[a-z0-9_.:-]{1,80}$'),
  notification_ref uuid NOT NULL,
  provider text NOT NULL DEFAULT 'fake' CHECK (provider='fake'),
  execution_mode text NOT NULL DEFAULT 'test' CHECK (execution_mode='test'),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','leased','accepted','expired','dead')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 3),
  available_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(available_at)),
  expires_at timestamptz NOT NULL CHECK (isfinite(expires_at)),
  lease_token uuid,
  lease_until timestamptz CHECK (isfinite(lease_until)),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (workspace_key,semantic_key),
  UNIQUE (workspace_key,intent_ref),
  CHECK ((state='leased' AND lease_token IS NOT NULL AND lease_until IS NOT NULL) OR (state<>'leased' AND lease_token IS NULL AND lease_until IS NULL))
);
--> statement-breakpoint
CREATE INDEX local_outbox_due ON platform.local_outbox_intents (workspace_key,available_at,intent_ref) WHERE state IN ('pending','leased');
--> statement-breakpoint
CREATE TABLE platform.local_outbox_attempts (
  attempt_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_key text COLLATE "C" NOT NULL,
  intent_ref uuid NOT NULL,
  attempt_number integer NOT NULL CHECK (attempt_number BETWEEN 1 AND 3),
  lease_token uuid NOT NULL UNIQUE,
  outcome text NOT NULL DEFAULT 'unknown' CHECK (outcome IN ('unknown','accepted','retry','permanent')),
  claimed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz,
  FOREIGN KEY (workspace_key,intent_ref) REFERENCES platform.local_outbox_intents(workspace_key,intent_ref),
  UNIQUE (intent_ref,attempt_number),
  CHECK ((outcome='unknown' AND finished_at IS NULL) OR (outcome<>'unknown' AND finished_at IS NOT NULL AND isfinite(finished_at)))
);
--> statement-breakpoint
REVOKE ALL ON platform.local_outbox_intents, platform.local_outbox_attempts FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON SCHEMA platform TO lmps_outbox;
--> statement-breakpoint
GRANT SELECT ON platform.local_outbox_intents, platform.local_outbox_attempts TO lmps_outbox,lmps_app;
--> statement-breakpoint
GRANT INSERT (workspace_key,semantic_key,notification_ref,expires_at) ON platform.local_outbox_intents TO lmps_outbox;
--> statement-breakpoint
GRANT UPDATE (state,attempt_count,available_at,lease_token,lease_until) ON platform.local_outbox_intents TO lmps_outbox;
--> statement-breakpoint
GRANT INSERT (workspace_key,intent_ref,attempt_number,lease_token) ON platform.local_outbox_attempts TO lmps_outbox;
--> statement-breakpoint
GRANT UPDATE (outcome,finished_at) ON platform.local_outbox_attempts TO lmps_outbox;
--> statement-breakpoint
GRANT USAGE ON SEQUENCE platform.local_outbox_attempts_attempt_id_seq TO lmps_outbox;
