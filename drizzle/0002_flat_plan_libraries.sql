DROP TABLE "credit_ledger" CASCADE;--> statement-breakpoint
DROP TABLE "credit_packs" CASCADE;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "voice_provider" text DEFAULT 'voicebox' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "elevenlabs_key" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "setup_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" DROP COLUMN "monthly_projects";--> statement-breakpoint
ALTER TABLE "plans" DROP COLUMN "monthly_credits";--> statement-breakpoint
ALTER TABLE "plans" DROP COLUMN "image_models";