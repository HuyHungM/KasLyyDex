import { sql } from "drizzle-orm";
import {
  check,
  customType,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// Timestamps are stored as epoch milliseconds in D1 and exposed to services as
// Date objects, keeping the existing service-level timestamp contract.
const timestamp = customType<{ data: Date; driverData: number }>({
  dataType() {
    return "integer";
  },
  toDriver(value: Date) {
    return value.getTime();
  },
  fromDriver(value: number) {
    return new Date(Number(value));
  },
});

const now = sql`(unixepoch() * 1000)`;

// Application-owned tables. Auth user ids stay opaque text: never parse them
// as UUIDs or derive trust from their shape.
export const authUsers = sqliteTable("auth_users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  name: text("name"),
  image: text("image"),
  googleSub: text("google_sub"),
  passwordHash: text("password_hash"),
  createdAt: timestamp("created_at").default(now).notNull(),
  updatedAt: timestamp("updated_at").default(now).notNull(),
}, (table) => [
  uniqueIndex("auth_users_email_key").on(table.email),
  uniqueIndex("auth_users_google_sub_key").on(table.googleSub),
]);

export const profiles = sqliteTable("profiles", {
  userId: text("user_id").primaryKey(),
  // Stored normalized (trimmed + lowercase); the unique index is the final guard.
  username: text("username"),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  // Server-owned XP/level. Never client-writable; kept consistent with the
  // xp_events ledger by the single completion transaction.
  totalXp: integer("total_xp").default(0).notNull(),
  level: integer("level").default(1).notNull(),
  createdAt: timestamp("created_at").default(now).notNull(),
  updatedAt: timestamp("updated_at").default(now).notNull(),
}, (table) => [uniqueIndex("profiles_username_key").on(table.username)]);

// Roles are explicitly bootstrapped from a verified allowlisted auth email.
export const userRoles = sqliteTable("user_roles", {
  userId: text("user_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  role: text("role").notNull(),
  createdAt: timestamp("created_at").default(now).notNull(),
}, (table) => [primaryKey({ columns: [table.userId, table.role] })]);

export const libraryEntries = sqliteTable("library_entries", {
  userId: text("user_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  mangaId: text("manga_id").notNull(),
  title: text("title").notNull(),
  coverFile: text("cover_file"),
  lang: text("lang").notNull().default("vi"),
  status: text("status").notNull().default("reading"),
  // Milliseconds since epoch, server-owned for normal writes; imported client
  // times are bounded before they reach this column.
  followedAt: integer("followed_at").notNull(),
  lastChapterId: text("last_chapter_id"),
  lastReadPublish: integer("last_read_publish").notNull().default(0),
  revision: integer("revision").notNull().default(1),
  updatedAt: timestamp("updated_at").default(now).notNull(),
}, (table) => [primaryKey({ columns: [table.userId, table.mangaId] })]);

export const chapterProgress = sqliteTable("chapter_progress", {
  userId: text("user_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  mangaId: text("manga_id").notNull(),
  chapterId: text("chapter_id").notNull(),
  language: text("language").notNull().default("vi"),
  chapter: text("chapter"),
  title: text("title"),
  coverFile: text("cover_file"),
  // `page` is the current position and may move backward for rereads.
  page: integer("page").notNull(),
  // `maxPage` is the furthest observed page and never regresses.
  maxPage: integer("max_page").notNull(),
  total: integer("total").notNull(),
  lastReadAt: integer("last_read_at").notNull(),
  revision: integer("revision").notNull().default(1),
  updatedAt: timestamp("updated_at").default(now).notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.mangaId, table.chapterId, table.language] }),
  index("chapter_progress_user_recent_idx").on(table.userId, table.lastReadAt),
]);

export const readerPreferences = sqliteTable("reader_preferences", {
  userId: text("user_id").primaryKey().references(() => profiles.userId, { onDelete: "cascade" }),
  mode: text("mode").notNull().default("vertical"),
  fit: integer("fit", { mode: "boolean" }).notNull().default(true),
  bg: text("bg").notNull().default("light"),
  speed: integer("speed").notNull().default(3),
  updatedAt: timestamp("updated_at").default(now).notNull(),
});

// Application-owned community tables. Locks live on the thread, never on a
// comment status; all user ids stay opaque text from the verified session.
export const commentThreads = sqliteTable("comment_threads", {
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  locked: integer("locked", { mode: "boolean" }).notNull().default(false),
  lockedBy: text("locked_by"),
  updatedAt: timestamp("updated_at").default(now).notNull(),
}, (table) => [
  primaryKey({ columns: [table.targetType, table.targetId] }),
  check("comment_threads_target_type_check", sql`${table.targetType} in ('manga', 'chapter')`),
]);

export const comments = sqliteTable("comments", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  parentId: text("parent_id"),
  body: text("body"),
  spoiler: integer("spoiler", { mode: "boolean" }).notNull().default(false),
  status: text("status").notNull().default("visible"),
  createdAt: timestamp("created_at").default(now).notNull(),
  updatedAt: timestamp("updated_at").default(now).notNull(),
}, (table) => [
  index("comments_thread_idx").on(table.targetType, table.targetId, table.createdAt),
  index("comments_parent_idx").on(table.parentId),
  check("comments_status_check", sql`${table.status} in ('visible', 'hidden', 'removed')`),
  check("comments_target_type_check", sql`${table.targetType} in ('manga', 'chapter')`),
  check("comments_no_self_parent", sql`${table.parentId} is null or ${table.parentId} <> ${table.id}`),
]);

export const commentReports = sqliteTable("comment_reports", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  commentId: text("comment_id").notNull().references(() => comments.id, { onDelete: "cascade" }),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("open"),
  createdAt: timestamp("created_at").default(now).notNull(),
  resolvedAt: timestamp("resolved_at"),
  resolvedBy: text("resolved_by"),
}, (table) => [
  uniqueIndex("comment_reports_open_key").on(table.userId, table.commentId)
    .where(sql`${table.status} = 'open'`),
  index("comment_reports_queue_idx").on(table.status, table.createdAt),
  check("comment_reports_status_check", sql`${table.status} in ('open', 'resolved', 'dismissed')`),
]);

export const notifications = sqliteTable("notifications", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  type: text("type").notNull(),
  eventKey: text("event_key").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  href: text("href"),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").default(now).notNull(),
}, (table) => [
  uniqueIndex("notifications_event_key").on(table.userId, table.eventKey),
  index("notifications_inbox_idx").on(table.userId, table.createdAt),
]);

export const notificationCursors = sqliteTable("notification_cursors", {
  userId: text("user_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  mangaId: text("manga_id").notNull(),
  language: text("language").notNull(),
  lastPublish: integer("last_publish").notNull(),
  // Composite cursor component: legacy rows keep '' and are re-evaluated for
  // chapters sharing the stored publish time; event keys dedupe the repeat.
  lastChapterId: text("last_chapter_id").notNull().default(""),
  // Continuation state for the bounded notification feed. `scan_publish` is the
  // exclusive since bound, `scan_offset` walks its page within one timestamp.
  scanPublish: integer("scan_publish").notNull().default(0),
  scanOffset: integer("scan_offset").notNull().default(0),
  // A timestamp cohort being reconciled. Pending rows are the deterministic
  // replay queue for equal publish times whose upstream order is unspecified.
  cohortPublish: integer("cohort_publish"),
  cohortComplete: integer("cohort_complete", { mode: "boolean" }).notNull().default(false),
  updatedAt: timestamp("updated_at").default(now).notNull(),
}, (table) => [primaryKey({ columns: [table.userId, table.mangaId, table.language] })]);

export const notificationPending = sqliteTable("notification_pending", {
  userId: text("user_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  mangaId: text("manga_id").notNull(),
  language: text("language").notNull(),
  chapterId: text("chapter_id").notNull(),
  publish: integer("publish").notNull(),
  chapter: text("chapter"),
  title: text("title"),
}, (table) => [
  primaryKey({ columns: [table.userId, table.mangaId, table.language, table.chapterId] }),
  index("notification_pending_cohort_idx").on(table.userId, table.mangaId, table.language, table.publish),
]);

// Server-signed reader sessions. The ticket signature binds these exact
// values; the persisted row is checked against the caller on every use.
export const readerSessions = sqliteTable("reader_sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  chapterId: text("chapter_id").notNull(),
  mangaId: text("manga_id").notNull(),
  language: text("language").notNull(),
  source: text("source").notNull().default("mangadex"),
  pageCount: integer("page_count").notNull(),
  issuedAt: integer("issued_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  createdAt: timestamp("created_at").default(now).notNull(),
}, (table) => [index("reader_sessions_user_idx").on(table.userId, table.issuedAt)]);

// Distinct observed pages per session. The PK is the monotone union guard; a
// legacy `lastPageSeen` value adds exactly one row, never a page range.
export const readerCheckpoints = sqliteTable("reader_checkpoints", {
  sessionId: text("session_id").notNull().references(() => readerSessions.id, { onDelete: "cascade" }),
  page: integer("page").notNull(),
  seenAt: integer("seen_at").notNull(),
}, (table) => [primaryKey({ columns: [table.sessionId, table.page] })]);

export const readingCompletions = sqliteTable("reading_completions", {
  userId: text("user_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  chapterId: text("chapter_id").notNull(),
  mangaId: text("manga_id").notNull(),
  language: text("language").notNull(),
  pageCount: integer("page_count").notNull(),
  lastPageSeen: integer("last_page_seen").notNull(),
  readerSessionId: text("reader_session_id").notNull(),
  completedAt: integer("completed_at").notNull(),
}, (table) => [primaryKey({ columns: [table.userId, table.chapterId] })]);

export const xpEvents = sqliteTable("xp_events", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(),
  chapterId: text("chapter_id").notNull(),
  amount: integer("amount").notNull(),
  ruleVersion: text("rule_version").notNull(),
  createdAt: timestamp("created_at").default(now).notNull(),
}, (table) => [uniqueIndex("xp_events_user_type_chapter_key").on(table.userId, table.eventType, table.chapterId)]);

// Deterministic cosmetic realm seed; boundaries mirror the pure TypeScript and
// Rust shared-domain fixtures.
export const cultivationRealms = sqliteTable("cultivation_realms", {
  key: text("key").primaryKey(),
  minLevel: integer("min_level").notNull(),
  maxLevel: integer("max_level").notNull(),
  name: text("name").notNull(),
}, (table) => [check("cultivation_realms_range_check", sql`${table.minLevel} <= ${table.maxLevel}`)]);

// Durable, sliding-window counters. D1 serializes writes per transaction, so
// no external advisory lock is needed to keep the window atomic.
export const actionEvents = sqliteTable("action_events", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  action: text("action").notNull(),
  occurredAt: integer("occurred_at").notNull(),
}, (table) => [index("action_events_window_idx").on(table.userId, table.action, table.occurredAt)]);
