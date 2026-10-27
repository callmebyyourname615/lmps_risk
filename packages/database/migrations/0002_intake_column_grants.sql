-- Preserve applied migration history; intake cannot supply server-generated metadata.
REVOKE INSERT ON platform.source_records, platform.source_events FROM lmps_intake;
--> statement-breakpoint
GRANT INSERT (workspace_key, source_namespace, source_generation, source_table, source_key)
  ON platform.source_records TO lmps_intake;
--> statement-breakpoint
GRANT INSERT (workspace_key, source_namespace, source_generation, capture_epoch, event_key, record_id, operation, observed_at, fields)
  ON platform.source_events TO lmps_intake;
