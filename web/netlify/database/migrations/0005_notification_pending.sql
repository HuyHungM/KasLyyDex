CREATE TABLE "notification_pending" (
	"user_id" text NOT NULL,
	"manga_id" text NOT NULL,
	"language" text NOT NULL,
	"chapter_id" text NOT NULL,
	"publish" bigint NOT NULL,
	"chapter" text,
	"title" text,
	CONSTRAINT "notification_pending_user_id_manga_id_language_chapter_id_pk" PRIMARY KEY("user_id","manga_id","language","chapter_id")
);

ALTER TABLE "notification_cursors" ADD COLUMN "cohort_publish" bigint;
ALTER TABLE "notification_cursors" ADD COLUMN "cohort_complete" boolean DEFAULT false NOT NULL;
ALTER TABLE "notification_pending" ADD CONSTRAINT "notification_pending_user_id_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("user_id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "notification_pending_cohort_idx" ON "notification_pending" USING btree ("user_id","manga_id","language","publish");
-- Round-2 rows used an exclusive scan bound equal to the processed publish time.
-- Rewind one second so same-time legacy rows are replayed; event-key uniqueness
-- makes the overlap idempotent.
UPDATE "notification_cursors" SET "scan_publish" = GREATEST(0, "last_publish" - 1000) WHERE "scan_publish" = "last_publish";
