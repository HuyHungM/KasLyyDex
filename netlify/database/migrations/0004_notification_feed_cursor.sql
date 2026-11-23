ALTER TABLE "notification_cursors" ADD COLUMN "scan_publish" bigint DEFAULT 0 NOT NULL;
ALTER TABLE "notification_cursors" ADD COLUMN "scan_offset" integer DEFAULT 0 NOT NULL;
-- Existing cursors already consumed everything up to last_publish; continue from there.
UPDATE "notification_cursors" SET "scan_publish" = "last_publish", "scan_offset" = 0;
