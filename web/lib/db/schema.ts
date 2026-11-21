import { bigint, boolean, check, integer, pgTable, primaryKey, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

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

// Task 7: application-owned community tables. Locks live on the thread, never
// on a comment status; all user ids stay opaque text from the managed session.
export const commentThreads = pgTable("comment_threads", {
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  locked: boolean("locked").notNull().default(false),
  lockedBy: text("locked_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.targetType, table.targetId] }),
  check("comment_threads_target_type_check", sql`${table.targetType} in ('manga', 'chapter')`),
]);

export const comments = pgTable("comments", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  parentId: text("parent_id"),
  body: text("body"),
  spoiler: boolean("spoiler").notNull().default(false),
  status: text("status").notNull().default("visible"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("comments_thread_idx").on(table.targetType, table.targetId, table.createdAt),
  index("comments_parent_idx").on(table.parentId),
  check("comments_status_check", sql`${table.status} in ('visible', 'hidden', 'removed')`),
  check("comments_target_type_check", sql`${table.targetType} in ('manga', 'chapter')`),
  check("comments_no_self_parent", sql`${table.parentId} is null or ${table.parentId} <> ${table.id}`),
]);

export const commentReports = pgTable("comment_reports", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  commentId: text("comment_id").notNull().references(() => comments.id, { onDelete: "cascade" }),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("open"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedBy: text("resolved_by"),
}, (table) => [
  uniqueIndex("comment_reports_open_key").on(table.userId, table.commentId)
    .where(sql`${table.status} = 'open'`),
  index("comment_reports_queue_idx").on(table.status, table.createdAt),
  check("comment_reports_status_check", sql`${table.status} in ('open', 'resolved', 'dismissed')`),
]);

export const notifications = pgTable("notifications", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  type: text("type").notNull(),
  eventKey: text("event_key").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  href: text("href"),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("notifications_event_key").on(table.userId, table.eventKey),
  index("notifications_inbox_idx").on(table.userId, table.createdAt),
]);

export const notificationCursors = pgTable("notification_cursors", {
  userId: text("user_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  mangaId: text("manga_id").notNull(),
  language: text("language").notNull(),
  lastPublish: bigint("last_publish", { mode: "number" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [primaryKey({ columns: [table.userId, table.mangaId, table.language] })]);

// Durable, sliding-window counters. pg_advisory_xact_lock in the service keeps
// concurrent requests for one user/action from racing past the limit.
export const actionEvents = pgTable("action_events", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  action: text("action").notNull(),
  occurredAt: bigint("occurred_at", { mode: "number" }).notNull(),
}, (table) => [index("action_events_window_idx").on(table.userId, table.action, table.occurredAt)]);
