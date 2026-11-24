CREATE TABLE `action_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`action` text NOT NULL,
	`occurred_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `profiles`(`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `action_events_window_idx` ON `action_events` (`user_id`,`action`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `auth_users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`name` text,
	`image` text,
	`google_sub` text,
	`password_hash` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_users_email_key` ON `auth_users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `auth_users_google_sub_key` ON `auth_users` (`google_sub`);--> statement-breakpoint
CREATE TABLE `chapter_progress` (
	`user_id` text NOT NULL,
	`manga_id` text NOT NULL,
	`chapter_id` text NOT NULL,
	`language` text DEFAULT 'vi' NOT NULL,
	`chapter` text,
	`title` text,
	`cover_file` text,
	`page` integer NOT NULL,
	`max_page` integer NOT NULL,
	`total` integer NOT NULL,
	`last_read_at` integer NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`user_id`, `manga_id`, `chapter_id`, `language`),
	FOREIGN KEY (`user_id`) REFERENCES `profiles`(`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `chapter_progress_user_recent_idx` ON `chapter_progress` (`user_id`,`last_read_at`);--> statement-breakpoint
CREATE TABLE `comment_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`comment_id` text NOT NULL,
	`reason` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`resolved_at` integer,
	`resolved_by` text,
	FOREIGN KEY (`user_id`) REFERENCES `profiles`(`user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`comment_id`) REFERENCES `comments`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "comment_reports_status_check" CHECK("comment_reports"."status" in ('open', 'resolved', 'dismissed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `comment_reports_open_key` ON `comment_reports` (`user_id`,`comment_id`) WHERE "comment_reports"."status" = 'open';--> statement-breakpoint
CREATE INDEX `comment_reports_queue_idx` ON `comment_reports` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `comment_threads` (
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`locked` integer DEFAULT false NOT NULL,
	`locked_by` text,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`target_type`, `target_id`),
	CONSTRAINT "comment_threads_target_type_check" CHECK("comment_threads"."target_type" in ('manga', 'chapter'))
);
--> statement-breakpoint
CREATE TABLE `comments` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`parent_id` text,
	`body` text,
	`spoiler` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'visible' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `profiles`(`user_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "comments_status_check" CHECK("comments"."status" in ('visible', 'hidden', 'removed')),
	CONSTRAINT "comments_target_type_check" CHECK("comments"."target_type" in ('manga', 'chapter')),
	CONSTRAINT "comments_no_self_parent" CHECK("comments"."parent_id" is null or "comments"."parent_id" <> "comments"."id")
);
--> statement-breakpoint
CREATE INDEX `comments_thread_idx` ON `comments` (`target_type`,`target_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `comments_parent_idx` ON `comments` (`parent_id`);--> statement-breakpoint
CREATE TABLE `cultivation_realms` (
	`key` text PRIMARY KEY NOT NULL,
	`min_level` integer NOT NULL,
	`max_level` integer NOT NULL,
	`name` text NOT NULL,
	CONSTRAINT "cultivation_realms_range_check" CHECK("cultivation_realms"."min_level" <= "cultivation_realms"."max_level")
);
--> statement-breakpoint
CREATE TABLE `library_entries` (
	`user_id` text NOT NULL,
	`manga_id` text NOT NULL,
	`title` text NOT NULL,
	`cover_file` text,
	`lang` text DEFAULT 'vi' NOT NULL,
	`status` text DEFAULT 'reading' NOT NULL,
	`followed_at` integer NOT NULL,
	`last_chapter_id` text,
	`last_read_publish` integer DEFAULT 0 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`user_id`, `manga_id`),
	FOREIGN KEY (`user_id`) REFERENCES `profiles`(`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `notification_cursors` (
	`user_id` text NOT NULL,
	`manga_id` text NOT NULL,
	`language` text NOT NULL,
	`last_publish` integer NOT NULL,
	`last_chapter_id` text DEFAULT '' NOT NULL,
	`scan_publish` integer DEFAULT 0 NOT NULL,
	`scan_offset` integer DEFAULT 0 NOT NULL,
	`cohort_publish` integer,
	`cohort_complete` integer DEFAULT false NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`user_id`, `manga_id`, `language`),
	FOREIGN KEY (`user_id`) REFERENCES `profiles`(`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `notification_pending` (
	`user_id` text NOT NULL,
	`manga_id` text NOT NULL,
	`language` text NOT NULL,
	`chapter_id` text NOT NULL,
	`publish` integer NOT NULL,
	`chapter` text,
	`title` text,
	PRIMARY KEY(`user_id`, `manga_id`, `language`, `chapter_id`),
	FOREIGN KEY (`user_id`) REFERENCES `profiles`(`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notification_pending_cohort_idx` ON `notification_pending` (`user_id`,`manga_id`,`language`,`publish`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`event_key` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`href` text,
	`read_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `profiles`(`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_event_key` ON `notifications` (`user_id`,`event_key`);--> statement-breakpoint
CREATE INDEX `notifications_inbox_idx` ON `notifications` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`username` text,
	`display_name` text,
	`avatar_url` text,
	`total_xp` integer DEFAULT 0 NOT NULL,
	`level` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `profiles_username_key` ON `profiles` (`username`);--> statement-breakpoint
CREATE TABLE `reader_checkpoints` (
	`session_id` text NOT NULL,
	`page` integer NOT NULL,
	`seen_at` integer NOT NULL,
	PRIMARY KEY(`session_id`, `page`),
	FOREIGN KEY (`session_id`) REFERENCES `reader_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `reader_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`mode` text DEFAULT 'vertical' NOT NULL,
	`fit` integer DEFAULT true NOT NULL,
	`bg` text DEFAULT 'light' NOT NULL,
	`speed` integer DEFAULT 3 NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `profiles`(`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `reader_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`chapter_id` text NOT NULL,
	`manga_id` text NOT NULL,
	`language` text NOT NULL,
	`source` text DEFAULT 'mangadex' NOT NULL,
	`page_count` integer NOT NULL,
	`issued_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `profiles`(`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `reader_sessions_user_idx` ON `reader_sessions` (`user_id`,`issued_at`);--> statement-breakpoint
CREATE TABLE `reading_completions` (
	`user_id` text NOT NULL,
	`chapter_id` text NOT NULL,
	`manga_id` text NOT NULL,
	`language` text NOT NULL,
	`page_count` integer NOT NULL,
	`last_page_seen` integer NOT NULL,
	`reader_session_id` text NOT NULL,
	`completed_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `chapter_id`),
	FOREIGN KEY (`user_id`) REFERENCES `profiles`(`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `user_roles` (
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`user_id`, `role`),
	FOREIGN KEY (`user_id`) REFERENCES `profiles`(`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `xp_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`event_type` text NOT NULL,
	`chapter_id` text NOT NULL,
	`amount` integer NOT NULL,
	`rule_version` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `profiles`(`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `xp_events_user_type_chapter_key` ON `xp_events` (`user_id`,`event_type`,`chapter_id`);
--> statement-breakpoint
INSERT INTO "cultivation_realms" ("key","min_level","max_level","name") VALUES
 ('mortal',1,9,'Phàm Nhân'),
 ('qi_refining',10,49,'Luyện Khí'),
 ('foundation_establishment',50,99,'Trúc Cơ'),
 ('golden_core',100,199,'Kim Đan'),
 ('nascent_soul',200,299,'Nguyên Anh'),
 ('spirit_severing',300,399,'Hóa Thần'),
 ('void_refinement',400,499,'Luyện Hư'),
 ('body_integration',500,599,'Hợp Thể'),
 ('mahayana',600,699,'Đại Thừa'),
 ('tribulation_transcendence',700,799,'Độ Kiếp'),
 ('true_immortal',800,899,'Chân Tiên'),
 ('immortal_king',900,999,'Tiên Vương'),
 ('immortal_emperor',1000,1000,'Tiên Đế');