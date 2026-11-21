ALTER TABLE "notification_cursors" ADD COLUMN "last_chapter_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
-- Reply inbox rows previously copied the comment body; keep only a neutral hint.
UPDATE "notifications" SET "body" = 'Có phản hồi mới trong bình luận. Mở bình luận để xem nội dung.'
WHERE "type" = 'comment_reply' AND "event_key" LIKE 'reply:%';
