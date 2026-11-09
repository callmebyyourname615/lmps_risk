-- Local synthetic core runtime only. Key bytes and raw account values are never stored here.
CREATE TABLE platform.core_identity_keys (
 workspace_key text NOT NULL CHECK(workspace_key='synthetic_local'),
 key_id text NOT NULL CHECK(key_id ~ '^synthetic_[A-Za-z0-9_.:-]{1,60}$'),
 key_version text NOT NULL CHECK(key_version ~ '^synthetic_[A-Za-z0-9_.:-]{1,60}$'),
 material_sha256 text NOT NULL CHECK(material_sha256 ~ '^[a-f0-9]{64}$'),
 revoked boolean NOT NULL DEFAULT false,
 PRIMARY KEY(workspace_key,key_id,key_version)
);
--> statement-breakpoint
CREATE TABLE platform.core_identity_mappings (
 workspace_key text NOT NULL CHECK(workspace_key='synthetic_local'),
 namespace text NOT NULL, institution text NOT NULL, mapping_version text NOT NULL,
 mapping jsonb NOT NULL CHECK(jsonb_typeof(mapping)='object' AND octet_length(mapping::text)<=8192),
 mapping_sha256 text NOT NULL CHECK(mapping_sha256 ~ '^[a-f0-9]{64}$'),
 key_id text NOT NULL, key_version text NOT NULL,
 PRIMARY KEY(workspace_key,namespace,institution,mapping_version),
 FOREIGN KEY(workspace_key,key_id,key_version) REFERENCES platform.core_identity_keys(workspace_key,key_id,key_version)
);
--> statement-breakpoint
CREATE TABLE platform.core_detection_checkpoints (
 workspace_key text NOT NULL CHECK(workspace_key='synthetic_local'),
 runtime_id text NOT NULL CHECK(runtime_id ~ '^synthetic_[A-Za-z0-9_]{1,60}$'),
 config_sha256 text NOT NULL CHECK(config_sha256 ~ '^[a-f0-9]{64}$'),
 next_offset integer NOT NULL DEFAULT 0 CHECK(next_offset BETWEEN 0 AND 64),
 state jsonb NOT NULL CHECK((jsonb_typeof(state)='object' AND octet_length(state::text)<=2097152
   AND jsonb_typeof(state->'entries')='array' AND jsonb_array_length(state->'entries')=next_offset) IS TRUE),
 state_sha256 text NOT NULL CHECK(state_sha256 ~ '^[a-f0-9]{64}$'),
 PRIMARY KEY(workspace_key,runtime_id)
);
--> statement-breakpoint
CREATE FUNCTION platform.guard_core_identity_key() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP<>'UPDATE' OR OLD.revoked OR NEW.revoked IS NOT TRUE OR
   (to_jsonb(NEW)-'revoked') IS DISTINCT FROM (to_jsonb(OLD)-'revoked') THEN
   RAISE EXCEPTION 'Immutable identity key version' USING ERRCODE='22023';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER core_identity_key_immutable BEFORE UPDATE OR DELETE ON platform.core_identity_keys FOR EACH ROW EXECUTE FUNCTION platform.guard_core_identity_key();
--> statement-breakpoint
CREATE FUNCTION platform.guard_core_detection_checkpoint() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP<>'UPDATE' OR NEW.workspace_key<>OLD.workspace_key OR NEW.runtime_id<>OLD.runtime_id
 OR NEW.config_sha256<>OLD.config_sha256 OR NEW.next_offset<>OLD.next_offset+1
 OR (NEW.state->'entries')-(NEW.next_offset-1) IS DISTINCT FROM OLD.state->'entries' THEN
   RAISE EXCEPTION 'Invalid core checkpoint transition' USING ERRCODE='22023';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER core_checkpoint_guard BEFORE UPDATE OR DELETE ON platform.core_detection_checkpoints FOR EACH ROW EXECUTE FUNCTION platform.guard_core_detection_checkpoint();
--> statement-breakpoint
REVOKE ALL ON platform.core_identity_keys,platform.core_identity_mappings,platform.core_detection_checkpoints FROM PUBLIC,lmps_app,lmps_outbox,lmps_reviewer,lmps_policy,lmps_case;
--> statement-breakpoint
GRANT SELECT,INSERT ON platform.core_identity_keys,platform.core_identity_mappings,platform.core_detection_checkpoints TO lmps_intake;
--> statement-breakpoint
GRANT UPDATE(revoked) ON platform.core_identity_keys TO lmps_intake;
--> statement-breakpoint
GRANT UPDATE(next_offset,state,state_sha256) ON platform.core_detection_checkpoints TO lmps_intake;
