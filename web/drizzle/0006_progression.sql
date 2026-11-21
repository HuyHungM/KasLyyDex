CREATE TABLE "cultivation_realms" (
	"key" text PRIMARY KEY NOT NULL,
	"min_level" integer NOT NULL,
	"max_level" integer NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "cultivation_realms_range_check" CHECK ("cultivation_realms"."min_level" <= "cultivation_realms"."max_level")
);
--> statement-breakpoint
CREATE TABLE "reader_checkpoints" (
	"session_id" text NOT NULL,
	"page" integer NOT NULL,
	"seen_at" bigint NOT NULL,
	CONSTRAINT "reader_checkpoints_session_id_page_pk" PRIMARY KEY("session_id","page")
);
--> statement-breakpoint
CREATE TABLE "reader_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"chapter_id" text NOT NULL,
	"manga_id" text NOT NULL,
	"language" text NOT NULL,
	"page_count" integer NOT NULL,
	"issued_at" bigint NOT NULL,
	"expires_at" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reading_completions" (
	"user_id" text NOT NULL,
	"chapter_id" text NOT NULL,
	"manga_id" text NOT NULL,
	"language" text NOT NULL,
	"page_count" integer NOT NULL,
	"last_page_seen" integer NOT NULL,
	"reader_session_id" text NOT NULL,
	"completed_at" bigint NOT NULL,
	CONSTRAINT "reading_completions_user_id_chapter_id_pk" PRIMARY KEY("user_id","chapter_id")
);
--> statement-breakpoint
CREATE TABLE "xp_events" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"event_type" text NOT NULL,
	"chapter_id" text NOT NULL,
	"amount" integer NOT NULL,
	"rule_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "level" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "reader_checkpoints" ADD CONSTRAINT "reader_checkpoints_session_id_reader_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."reader_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reader_sessions" ADD CONSTRAINT "reader_sessions_user_id_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_completions" ADD CONSTRAINT "reading_completions_user_id_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xp_events" ADD CONSTRAINT "xp_events_user_id_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reader_sessions_user_idx" ON "reader_sessions" USING btree ("user_id","issued_at");--> statement-breakpoint
CREATE UNIQUE INDEX "xp_events_user_type_chapter_key" ON "xp_events" USING btree ("user_id","event_type","chapter_id");
--> statement-breakpoint
-- Deterministic cosmetic seed; boundaries mirror the pure TypeScript/Rust
-- shared-domain fixtures and the approved platform spec section 8.
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