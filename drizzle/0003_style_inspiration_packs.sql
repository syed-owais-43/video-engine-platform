CREATE TABLE "library_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"path" text NOT NULL,
	"size" integer NOT NULL,
	"content_type" text NOT NULL,
	"url" text,
	"data" text
);
--> statement-breakpoint
CREATE TABLE "library_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "library_files" ADD CONSTRAINT "library_files_item_id_library_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."library_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "library_files_item_path_idx" ON "library_files" USING btree ("item_id","path");--> statement-breakpoint
CREATE UNIQUE INDEX "library_items_kind_slug_idx" ON "library_items" USING btree ("kind","slug");