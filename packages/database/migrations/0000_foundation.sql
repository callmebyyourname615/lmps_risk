CREATE SCHEMA platform;
--> statement-breakpoint
REVOKE ALL ON SCHEMA platform FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON SCHEMA platform TO lmps_app;
