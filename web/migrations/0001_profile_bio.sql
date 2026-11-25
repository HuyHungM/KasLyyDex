ALTER TABLE `profiles` ADD `bio` text;--> statement-breakpoint
CREATE INDEX `comments_user_visible_idx` ON `comments` (`user_id`,`status`,"created_at" desc);