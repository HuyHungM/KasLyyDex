CREATE TABLE "action_events" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"action" text NOT NULL,
	"occurred_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comment_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"comment_id" text NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	CONSTRAINT "comment_reports_status_check" CHECK ("comment_reports"."status" in ('open', 'resolved', 'dismissed'))
);
--> statement-breakpoint
CREATE TABLE "comment_threads" (
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"locked_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comment_threads_target_type_target_id_pk" PRIMARY KEY("target_type","target_id"),
	CONSTRAINT "comment_threads_target_type_check" CHECK ("comment_threads"."target_type" in ('manga', 'chapter'))
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"parent_id" text,
	"body" text,
	"spoiler" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'visible' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comments_status_check" CHECK ("comments"."status" in ('visible', 'hidden', 'removed')),
	CONSTRAINT "comments_target_type_check" CHECK ("comments"."target_type" in ('manga', 'chapter')),
	CONSTRAINT "comments_no_self_parent" CHECK ("comments"."parent_id" is null or "comments"."parent_id" <> "comments"."id")
);
--> statement-breakpoint
CREATE TABLE "notification_cursors" (
	"user_id" text NOT NULL,
	"manga_id" text NOT NULL,
	"language" text NOT NULL,
	"last_publish" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_cursors_user_id_manga_id_language_pk" PRIMARY KEY("user_id","manga_id","language")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"event_key" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"href" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "action_events" ADD CONSTRAINT "action_events_user_id_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_reports" ADD CONSTRAINT "comment_reports_user_id_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_reports" ADD CONSTRAINT "comment_reports_comment_id_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_user_id_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_cursors" ADD CONSTRAINT "notification_cursors_user_id_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "action_events_window_idx" ON "action_events" USING btree ("user_id","action","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "comment_reports_open_key" ON "comment_reports" USING btree ("user_id","comment_id") WHERE "comment_reports"."status" = 'open';--> statement-breakpoint
CREATE INDEX "comment_reports_queue_idx" ON "comment_reports" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "comments_thread_idx" ON "comments" USING btree ("target_type","target_id","created_at");--> statement-breakpoint
CREATE INDEX "comments_parent_idx" ON "comments" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_event_key" ON "notifications" USING btree ("user_id","event_key");--> statement-breakpoint
CREATE INDEX "notifications_inbox_idx" ON "notifications" USING btree ("user_id","created_at");