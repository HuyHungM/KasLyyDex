import { bigint, boolean, integer, pgTable, primaryKey, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";

// Application-owned tables only. Neon Managed Auth owns its identity/session
// tables in its own schema and they are never managed from this file. Opaque
// auth user ids stay text: never parse them as UUIDs or derive trust from them.
export const profiles = pgTable("profiles", {
  userId: text("user_id").primaryKey(),
  // Stored normalized (trimmed + lowercase); the unique index is the final guard.
  username: text("username"),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  // Placeholder only until Task 8 owns XP events. Never client-writable.
  totalXp: integer("total_xp").default(0).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex("profiles_username_key").on(table.username)]);

// Roles are explicitly bootstrapped from a verified allowlisted auth email.
export const userRoles = pgTable("user_roles", {
  userId: text("user_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  role: text("role").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [primaryKey({ columns: [table.userId, table.role] })]);

export const libraryEntries = pgTable("library_entries", {
  userId: text("user_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  mangaId: text("manga_id").notNull(),
  title: text("title").notNull(),
  coverFile: text("cover_file"),
  lang: text("lang").notNull().default("vi"),
  status: text("status").notNull().default("reading"),
  // Milliseconds since epoch, server-owned for normal writes; imported client
  // times are bounded before they reach this column.
  followedAt: bigint("followed_at", { mode: "number" }).notNull(),
  lastChapterId: text("last_chapter_id"),
  lastReadPublish: bigint("last_read_publish", { mode: "number" }).notNull().default(0),
  revision: integer("revision").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [primaryKey({ columns: [table.userId, table.mangaId] })]);

export const chapterProgress = pgTable("chapter_progress", {
  userId: text("user_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  mangaId: text("manga_id").notNull(),
  chapterId: text("chapter_id").notNull(),
  language: text("language").notNull().default("vi"),
  chapter: text("chapter"),
  title: text("title"),
  coverFile: text("cover_file"),
  // `page` is the current position and may move backward for rereads.
  page: integer("page").notNull(),
  // `maxPage` is the furthest observed page and never regresses; Task 8 will
  // derive completion checkpoints from it, never from a client percentage.
  maxPage: integer("max_page").notNull(),
  total: integer("total").notNull(),
  lastReadAt: bigint("last_read_at", { mode: "number" }).notNull(),
  revision: integer("revision").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.mangaId, table.chapterId, table.language] }),
  index("chapter_progress_user_recent_idx").on(table.userId, table.lastReadAt),
]);

export const readerPreferences = pgTable("reader_preferences", {
  userId: text("user_id").primaryKey().references(() => profiles.userId, { onDelete: "cascade" }),
  mode: text("mode").notNull().default("vertical"),
  fit: boolean("fit").notNull().default(true),
  bg: text("bg").notNull().default("light"),
  speed: integer("speed").notNull().default(3),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
