CREATE TABLE "chapter_progress" (
	"user_id" text NOT NULL,
	"manga_id" text NOT NULL,
	"chapter_id" text NOT NULL,
	"language" text DEFAULT 'vi' NOT NULL,
	"chapter" text,
	"title" text,
	"cover_file" text,
	"page" integer NOT NULL,
	"max_page" integer NOT NULL,
	"total" integer NOT NULL,
	"last_read_at" bigint NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chapter_progress_user_id_manga_id_chapter_id_language_pk" PRIMARY KEY("user_id","manga_id","chapter_id","language")
);
--> statement-breakpoint
CREATE TABLE "library_entries" (
	"user_id" text NOT NULL,
	"manga_id" text NOT NULL,
	"title" text NOT NULL,
	"cover_file" text,
	"lang" text DEFAULT 'vi' NOT NULL,
	"status" text DEFAULT 'reading' NOT NULL,
	"followed_at" bigint NOT NULL,
	"last_chapter_id" text,
	"last_read_publish" bigint DEFAULT 0 NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_entries_user_id_manga_id_pk" PRIMARY KEY("user_id","manga_id")
);
--> statement-breakpoint
CREATE TABLE "reader_preferences" (
	"user_id" text PRIMARY KEY NOT NULL,
	"mode" text DEFAULT 'vertical' NOT NULL,
	"fit" boolean DEFAULT true NOT NULL,
	"bg" text DEFAULT 'light' NOT NULL,
	"speed" integer DEFAULT 3 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_roles_user_id_role_pk" PRIMARY KEY("user_id","role")
);
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "username" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "display_name" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "avatar_url" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "total_xp" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "chapter_progress" ADD CONSTRAINT "chapter_progress_user_id_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_entries" ADD CONSTRAINT "library_entries_user_id_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reader_preferences" ADD CONSTRAINT "reader_preferences_user_id_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chapter_progress_user_recent_idx" ON "chapter_progress" USING btree ("user_id","last_read_at");--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_username_key" ON "profiles" USING btree ("username");