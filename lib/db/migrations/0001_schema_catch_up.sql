ALTER TABLE "google_connections" ADD COLUMN "auto_sync_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "surface_sync" ADD COLUMN "config" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "surface_sync" ADD COLUMN "sync_started_at" timestamp with time zone;