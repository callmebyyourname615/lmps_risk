CREATE TABLE platform.local_web_push_subscriptions (
  subscription_id uuid PRIMARY KEY,
  workspace_key text COLLATE "C" NOT NULL,
  subject text COLLATE "C" NOT NULL,
  endpoint_hash text NOT NULL UNIQUE CHECK(endpoint_hash ~ '^[a-f0-9]{64}$'),
  encrypted_subscription text NOT NULL CHECK(length(encrypted_subscription) BETWEEN 80 AND 8192),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
--> statement-breakpoint
CREATE TABLE platform.local_web_push_deliveries (
  delivery_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES platform.local_web_push_subscriptions,
  workspace_key text COLLATE "C" NOT NULL,
  subject text COLLATE "C" NOT NULL,
  alert_id uuid,
  kind text NOT NULL CHECK(kind IN ('alert','test')),
  state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','leased','accepted','failed','expired','revoked','suppressed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 5),
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '24 hours',
  lease_token uuid,
  lease_until timestamptz,
  last_code text CHECK(last_code IS NULL OR last_code IN ('ACCEPTED','GONE','RETRY','REJECTED','EXPIRED','REVOKED','DEFERRED','FILTERED')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(subscription_id,alert_id),
  CHECK ((kind='alert')=(alert_id IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX web_push_due ON platform.local_web_push_deliveries(state,available_at);
--> statement-breakpoint
REVOKE ALL ON platform.local_web_push_subscriptions,platform.local_web_push_deliveries FROM PUBLIC,lmps_app,lmps_intake,lmps_outbox,lmps_reviewer;
--> statement-breakpoint
GRANT SELECT ON platform.local_web_push_subscriptions,platform.local_web_push_deliveries TO lmps_app;
--> statement-breakpoint
CREATE FUNCTION platform.save_web_push_subscription(p_workspace text,p_subject text,p_hash text,p_encrypted text,p_id uuid)
RETURNS SETOF platform.local_web_push_subscriptions LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF session_user::text<>'lmps_app' OR p_workspace IS NULL OR p_workspace!~'^synthetic_[a-z0-9_]{1,40}$' OR p_subject IS NULL OR p_subject!~'^synthetic_[a-z0-9_]{1,40}$'
 OR p_hash IS NULL OR p_hash!~'^[a-f0-9]{64}$' OR p_encrypted IS NULL OR length(p_encrypted) NOT BETWEEN 80 AND 8192 OR p_id IS NULL THEN RAISE EXCEPTION 'Invalid push command'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_workspace||':'||p_subject,19));
 IF (SELECT count(*) FROM platform.local_web_push_subscriptions WHERE workspace_key=p_workspace AND subject=p_subject)>=100 AND NOT EXISTS(SELECT 1 FROM platform.local_web_push_subscriptions WHERE endpoint_hash=p_hash AND workspace_key=p_workspace AND subject=p_subject) THEN RAISE EXCEPTION 'Push device history limit'; END IF;
 IF (SELECT count(*) FROM platform.local_web_push_subscriptions WHERE workspace_key=p_workspace AND subject=p_subject AND active AND endpoint_hash<>p_hash)>=10 THEN RAISE EXCEPTION 'Push device limit'; END IF;
 RETURN QUERY INSERT INTO platform.local_web_push_subscriptions(subscription_id,workspace_key,subject,endpoint_hash,encrypted_subscription)
 VALUES(p_id,p_workspace,p_subject,p_hash,p_encrypted)
 ON CONFLICT(endpoint_hash) DO UPDATE SET encrypted_subscription=excluded.encrypted_subscription,created_at=CASE WHEN platform.local_web_push_subscriptions.active THEN platform.local_web_push_subscriptions.created_at ELSE clock_timestamp() END,active=true,updated_at=clock_timestamp()
 WHERE platform.local_web_push_subscriptions.workspace_key=p_workspace AND platform.local_web_push_subscriptions.subject=p_subject RETURNING *;
END; $$;
--> statement-breakpoint
CREATE FUNCTION platform.revoke_web_push_subscription(p_workspace text,p_subject text,p_id uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE n integer;
BEGIN
 IF session_user::text<>'lmps_app' THEN RAISE EXCEPTION 'Invalid push command'; END IF;
 UPDATE platform.local_web_push_subscriptions SET active=false,updated_at=clock_timestamp() WHERE workspace_key=p_workspace AND subject=p_subject AND subscription_id=p_id;
 GET DIAGNOSTICS n=ROW_COUNT;
 UPDATE platform.local_web_push_deliveries SET state='revoked',last_code='REVOKED',lease_token=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE workspace_key=p_workspace AND subject=p_subject AND subscription_id=p_id AND state IN ('pending','leased');
 RETURN n=1;
END; $$;
--> statement-breakpoint
CREATE FUNCTION platform.queue_web_push_test(p_workspace text,p_subject text,p_id uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result uuid;
BEGIN
 IF session_user::text<>'lmps_app' THEN RAISE EXCEPTION 'Invalid push command'; END IF;
 PERFORM 1 FROM platform.local_web_push_subscriptions WHERE subscription_id=p_id AND workspace_key=p_workspace AND subject=p_subject AND active FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF EXISTS(SELECT 1 FROM platform.local_web_push_deliveries WHERE subscription_id=p_id AND kind='test' AND created_at>clock_timestamp()-interval '1 minute') THEN RETURN NULL; END IF;
 INSERT INTO platform.local_web_push_deliveries(subscription_id,workspace_key,subject,kind,expires_at) VALUES(p_id,p_workspace,p_subject,'test',clock_timestamp()+interval '5 minutes') RETURNING delivery_id INTO result;
 RETURN result;
END; $$;
--> statement-breakpoint
CREATE FUNCTION platform.queue_web_push_alerts() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE n integer;
BEGIN
 IF session_user::text<>'lmps_app' THEN RAISE EXCEPTION 'Invalid push command'; END IF;
 INSERT INTO platform.local_web_push_deliveries(subscription_id,workspace_key,subject,alert_id,kind,expires_at)
 SELECT s.subscription_id,s.workspace_key,s.subject,a.alert_id,'alert',a.created_at+interval '24 hours'
 FROM platform.local_web_push_subscriptions s JOIN platform.local_alerts a ON a.workspace_key=s.workspace_key
 WHERE s.active AND a.created_at>=s.created_at AND a.created_at>clock_timestamp()-interval '24 hours'
 AND NOT EXISTS(SELECT 1 FROM platform.local_web_push_deliveries d WHERE d.subscription_id=s.subscription_id AND d.alert_id=a.alert_id)
 ORDER BY a.created_at,a.alert_id,s.subscription_id LIMIT 100 ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS n=ROW_COUNT; RETURN n;
END; $$;
--> statement-breakpoint
CREATE FUNCTION platform.claim_web_push_deliveries() RETURNS SETOF platform.local_web_push_deliveries LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF session_user::text<>'lmps_app' THEN RAISE EXCEPTION 'Invalid push command'; END IF;
 UPDATE platform.local_web_push_deliveries SET state='expired',last_code='EXPIRED',lease_token=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE state IN ('pending','leased') AND (expires_at<=clock_timestamp() OR attempt_count>=5 AND lease_until<=clock_timestamp());
 RETURN QUERY WITH picked AS (SELECT delivery_id FROM platform.local_web_push_deliveries WHERE expires_at>clock_timestamp() AND attempt_count<5 AND (state='pending' AND available_at<=clock_timestamp() OR state='leased' AND lease_until<=clock_timestamp()) ORDER BY available_at,delivery_id LIMIT 5 FOR UPDATE SKIP LOCKED)
 UPDATE platform.local_web_push_deliveries d SET state='leased',attempt_count=d.attempt_count+1,lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '60 seconds',updated_at=clock_timestamp() FROM picked p WHERE d.delivery_id=p.delivery_id RETURNING d.*;
END; $$;
--> statement-breakpoint
CREATE FUNCTION platform.finish_web_push_delivery(p_id uuid,p_lease uuid,p_code text,p_delay integer) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE sub uuid; n integer;
BEGIN
 IF session_user::text<>'lmps_app' OR p_code IS NULL OR p_code NOT IN ('ACCEPTED','GONE','RETRY','REJECTED','REVOKED','DEFERRED','FILTERED') OR p_delay IS NULL OR p_delay NOT BETWEEN 0 AND 3600 THEN RAISE EXCEPTION 'Invalid push command'; END IF;
 UPDATE platform.local_web_push_deliveries SET state=CASE WHEN p_code='ACCEPTED' THEN 'accepted' WHEN p_code='REVOKED' THEN 'revoked' WHEN p_code='FILTERED' THEN 'suppressed' WHEN p_code='DEFERRED' THEN 'pending' WHEN p_code='RETRY' AND attempt_count<5 THEN 'pending' ELSE 'failed' END,attempt_count=attempt_count-CASE WHEN p_code='DEFERRED' THEN 1 ELSE 0 END,last_code=p_code,available_at=clock_timestamp()+make_interval(secs=>p_delay),lease_token=NULL,lease_until=NULL,updated_at=clock_timestamp()
 WHERE delivery_id=p_id AND lease_token=p_lease AND state='leased' AND lease_until>clock_timestamp() RETURNING subscription_id INTO sub;
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n=1 AND p_code='GONE' THEN UPDATE platform.local_web_push_subscriptions SET active=false,updated_at=clock_timestamp() WHERE subscription_id=sub; END IF;
 RETURN n=1;
END; $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION platform.save_web_push_subscription(text,text,text,text,uuid),platform.revoke_web_push_subscription(text,text,uuid),platform.queue_web_push_test(text,text,uuid),platform.queue_web_push_alerts(),platform.claim_web_push_deliveries(),platform.finish_web_push_delivery(uuid,uuid,text,integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform.save_web_push_subscription(text,text,text,text,uuid),platform.revoke_web_push_subscription(text,text,uuid),platform.queue_web_push_test(text,text,uuid),platform.queue_web_push_alerts(),platform.claim_web_push_deliveries(),platform.finish_web_push_delivery(uuid,uuid,text,integer) TO lmps_app;
