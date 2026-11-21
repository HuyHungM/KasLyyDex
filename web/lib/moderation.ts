import "server-only";

import { randomUUID } from "node:crypto";
import { and, count, desc, eq, gt, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import type { AppDatabase } from "./db/client";
import * as tables from "./db/schema";
import { ServiceError } from "./me/service";
import type {
  CommentDto,
  CommentStatus,
  NotificationDto,
  ReportDto,
  ThreadDto,
} from "./contracts";
import type { ContentClient } from "./contracts";

type CommentTargetType = "manga" | "chapter";
// Transactions from `db.transaction()` have no `$client`; every service call
// runs unchanged on the pooled database or inside that transaction.
type Db = Omit<AppDatabase, "$client">;

const COMMENT_LIMIT = 5;
const COMMENT_WINDOW_MS = 60_000;
const REPORT_LIMIT = 10;
const REPORT_WINDOW_MS = 3_600_000;
const LIBRARY_SCAN_LIMIT = 20;
const CHAPTERS_PER_MANGA = 3;
const NOTIFICATION_FEED_LIMIT = 100;
const UPSTREAM_OFFSET_LIMIT = 10_000;
const MAX_CHAPTER_AGE_MS = 5 * 60_000;
// Neutral by construction: no reply body can survive moderation via the inbox.
const REPLY_NOTIFICATION_BODY = "Có phản hồi mới trong bình luận. Mở bình luận để xem nội dung.";

function date(ms: number): Date {
  return new Date(Number.isFinite(ms) ? ms : Date.now());
}

function ms(value: Date | null): number | null {
  return value ? value.getTime() : null;
}

function uniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String((error as { code: unknown }).code) : "";
  const message = `${"message" in error ? String((error as { message: unknown }).message) : ""} ${
    "cause" in error && error.cause && typeof error.cause === "object" && "message" in error.cause
      ? String((error.cause as { message: unknown }).message)
      : ""
  }`;
  return code === "23505" || /duplicate key|unique constraint/i.test(message);
}

/// Stored roles are the only moderator authority. Client role/title/level
/// fields never reach this check.
export async function hasModeratorRole(db: Db, userId: string): Promise<boolean> {
  const rows = await db.select({ role: tables.userRoles.role })
    .from(tables.userRoles)
    .where(and(eq(tables.userRoles.userId, userId), inArray(tables.userRoles.role, ["moderator", "admin"])))
    .limit(1);
  return rows.length > 0;
}

export async function requireModerator(db: Db, userId: string): Promise<void> {
  if (!(await hasModeratorRole(db, userId))) {
    throw new ServiceError(403, "FORBIDDEN", "Moderator permission is required.");
  }
}

/// Sliding window backed by SQL, not by a process-local Map. The xact advisory
/// lock serialises concurrent requests for one user/action; a rejected request
/// rolls its event back with the surrounding transaction.
async function consumeRateLimit(
  db: Db,
  userId: string,
  action: "comment" | "report",
  now: number,
): Promise<void> {
  const max = action === "comment" ? COMMENT_LIMIT : REPORT_LIMIT;
  const windowMs = action === "comment" ? COMMENT_WINDOW_MS : REPORT_WINDOW_MS;
  await db.execute(sql`select pg_advisory_xact_lock(hashtext(${"community-rate:" + action + ":" + userId}))`);
  await db.delete(tables.actionEvents).where(and(
    eq(tables.actionEvents.userId, userId),
    eq(tables.actionEvents.action, action),
    sql`${tables.actionEvents.occurredAt} <= ${now - windowMs}`,
  ));
  await db.insert(tables.actionEvents).values({
    id: randomUUID(), userId, action, occurredAt: now,
  });
  const rows = await db.select({ value: count() }).from(tables.actionEvents).where(and(
    eq(tables.actionEvents.userId, userId),
    eq(tables.actionEvents.action, action),
    gt(tables.actionEvents.occurredAt, now - windowMs),
  ));
  if ((rows[0]?.value ?? 0) > max) {
    throw new ServiceError(429, "RATE_LIMITED", action === "comment"
      ? "Too many comments. Try again shortly."
      : "Too many reports. Try again later.");
  }
}

async function ensureThread(
  db: Db,
  targetType: CommentTargetType,
  targetId: string,
  now: number,
) {
  await db.insert(tables.commentThreads).values({ targetType, targetId, updatedAt: date(now) })
    .onConflictDoNothing();
  const rows = await db.select().from(tables.commentThreads)
    .where(and(eq(tables.commentThreads.targetType, targetType), eq(tables.commentThreads.targetId, targetId)))
    .for("update")
    .limit(1);
  return rows[0];
}

type CommentRow = typeof tables.comments.$inferSelect & { authorName: string | null };

function commentDto(row: CommentRow, replies: CommentDto[] = []): CommentDto {
  return {
    id: row.id,
    targetType: row.targetType as CommentTargetType,
    targetId: row.targetId,
    parentId: row.parentId,
    userId: row.userId,
    authorName: row.authorName ?? "Độc giả",
    // Hidden and removed bodies never leave the service, even for the owner.
    body: row.status === "visible" ? row.body : null,
    spoiler: row.spoiler,
    status: row.status as CommentStatus,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
    replies,
  };
}

async function loadComment(db: Db, id: string): Promise<CommentRow | null> {
  const rows = await db.select({
    comment: tables.comments,
    authorName: tables.profiles.displayName,
  }).from(tables.comments)
    .leftJoin(tables.profiles, eq(tables.profiles.userId, tables.comments.userId))
    .where(eq(tables.comments.id, id))
    .limit(1);
  const row = rows[0];
  return row ? { ...row.comment, authorName: row.authorName } : null;
}

function beforeCursor(time: number, id: string) {
  return or(
    lt(tables.comments.createdAt, date(time)),
    and(eq(tables.comments.createdAt, date(time)), lt(tables.comments.id, id)),
  );
}

export async function listComments(
  db: Db,
  targetType: CommentTargetType,
  targetId: string,
  cursor: { time: number; id: string } | null,
  limit: number,
  viewerId: string | null,
): Promise<{ items: CommentDto[]; nextCursor: string | null }> {
  const visibility = viewerId
    ? or(eq(tables.comments.status, "visible"), eq(tables.comments.userId, viewerId))
    : eq(tables.comments.status, "visible");
  const roots = await db.select({
    comment: tables.comments,
    authorName: tables.profiles.displayName,
  }).from(tables.comments)
    .leftJoin(tables.profiles, eq(tables.profiles.userId, tables.comments.userId))
    .where(and(
      eq(tables.comments.targetType, targetType),
      eq(tables.comments.targetId, targetId),
      isNull(tables.comments.parentId),
      visibility,
      cursor ? beforeCursor(cursor.time, cursor.id) : undefined,
    ))
    .orderBy(desc(tables.comments.createdAt), desc(tables.comments.id))
    .limit(limit + 1);
  const hasMore = roots.length > limit;
  const page = roots.slice(0, limit);
  const visibleRootIds = page.filter((row) => row.comment.status === "visible").map((row) => row.comment.id);

  const replies = visibleRootIds.length > 0
    ? await db.select({
      comment: tables.comments,
      authorName: tables.profiles.displayName,
    }).from(tables.comments)
      .leftJoin(tables.profiles, eq(tables.profiles.userId, tables.comments.userId))
      .where(and(inArray(tables.comments.parentId, visibleRootIds), visibility))
      .orderBy(tables.comments.createdAt, tables.comments.id)
      .limit(500)
    : [];
  const grouped = new Map<string, CommentDto[]>();
  for (const row of replies) {
    const parentId = row.comment.parentId!;
    const list = grouped.get(parentId) ?? [];
    list.push(commentDto({ ...row.comment, authorName: row.authorName }));
    grouped.set(parentId, list);
  }
  const last = page.at(-1);
  return {
    items: page.map((row) => commentDto(
      { ...row.comment, authorName: row.authorName },
      grouped.get(row.comment.id) ?? [],
    )),
    nextCursor: hasMore && last
      ? `${last.comment.createdAt.getTime()}.${last.comment.id}`
      : null,
  };
}

/// Reusable, deduplicated outbox. Task 8 emits level-up events with the same
/// interface and its own event keys; no email or push is involved.
export async function emitNotification(db: Db, input: {
  userId: string;
  type: string;
  eventKey: string;
  title: string;
  body: string;
  href?: string | null;
}): Promise<boolean> {
  if (input.userId.length === 0 || input.eventKey.length === 0 || input.eventKey.length > 300) {
    throw new ServiceError(400, "INVALID_INPUT", "Invalid notification event.");
  }
  const result = await db.insert(tables.notifications).values({
    id: randomUUID(),
    userId: input.userId,
    type: input.type.slice(0, 40),
    eventKey: input.eventKey,
    title: input.title.slice(0, 200),
    body: input.body.slice(0, 2000),
    href: input.href?.slice(0, 300) ?? null,
  }).onConflictDoNothing({ target: [tables.notifications.userId, tables.notifications.eventKey] })
    .returning({ id: tables.notifications.id });
  return result.length > 0;
}

export async function createComment(
  db: Db,
  userId: string,
  input: { targetType: CommentTargetType; targetId: string; parentId: string | null; body: string; spoiler: boolean },
  now: number,
): Promise<CommentDto> {
  return db.transaction(async (tx) => {
    const thread = await ensureThread(tx, input.targetType, input.targetId, now);
    if (thread?.locked) throw new ServiceError(409, "THREAD_LOCKED", "This discussion is locked.");

    if (input.parentId) {
      const parent = await tx.select().from(tables.comments)
        .where(eq(tables.comments.id, input.parentId)).limit(1);
      const root = parent[0];
      if (!root || root.targetType !== input.targetType || root.targetId !== input.targetId || root.parentId !== null) {
        throw new ServiceError(400, "INVALID_REPLY", "Replies must target a root in the same thread.");
      }
      if (root.status !== "visible" || !root.body) {
        throw new ServiceError(409, "PARENT_UNAVAILABLE", "That comment cannot be replied to.");
      }
    }

    await consumeRateLimit(tx, userId, "comment", now);
    const id = randomUUID();
    await tx.insert(tables.comments).values({
      id,
      userId,
      targetType: input.targetType,
      targetId: input.targetId,
      parentId: input.parentId,
      body: input.body,
      spoiler: input.spoiler,
      status: "visible",
      createdAt: date(now),
      updatedAt: date(now),
    });

    if (input.parentId) {
      const parent = await loadComment(tx, input.parentId);
      if (parent && parent.userId !== userId) {
        await emitNotification(tx, {
          userId: parent.userId,
          type: "comment_reply",
          eventKey: `reply:${id}`,
          title: "Có phản hồi bình luận",
          body: REPLY_NOTIFICATION_BODY,
          href: input.targetType === "chapter" ? `/read/${input.targetId}` : `/manga/${input.targetId}`,
        });
      }
    }
    const created = await loadComment(tx, id);
    return commentDto(created!);
  });
}

export async function editComment(
  db: Db,
  userId: string,
  id: string,
  patch: { body?: string; spoiler?: boolean },
  now: number,
): Promise<CommentDto> {
  return db.transaction(async (tx) => {
    const existing = await tx.select().from(tables.comments).where(eq(tables.comments.id, id)).limit(1);
    if (!existing[0]) throw new ServiceError(404, "NOT_FOUND", "Comment not found.");
    if (existing[0].userId !== userId) {
      throw new ServiceError(403, "FORBIDDEN", "You do not own this comment.");
    }
    if (existing[0].status !== "visible") {
      throw new ServiceError(409, "CONTENT_UNAVAILABLE", "Moderated comments cannot be edited.");
    }
    const thread = await ensureThread(tx, existing[0].targetType as CommentTargetType, existing[0].targetId, now);
    if (thread?.locked) throw new ServiceError(409, "THREAD_LOCKED", "This discussion is locked.");
    const values: Partial<typeof tables.comments.$inferInsert> = { updatedAt: date(now) };
    if (patch.body !== undefined) values.body = patch.body;
    if (patch.spoiler !== undefined) values.spoiler = patch.spoiler;
    await tx.update(tables.comments).set(values).where(eq(tables.comments.id, id));
    return commentDto((await loadComment(tx, id))!);
  });
}

export async function deleteComment(db: Db, userId: string, id: string, now: number): Promise<boolean> {
  const existing = await db.select({ userId: tables.comments.userId }).from(tables.comments)
    .where(eq(tables.comments.id, id)).limit(1);
  if (!existing[0]) return false;
  if (existing[0].userId !== userId) throw new ServiceError(403, "FORBIDDEN", "You do not own this comment.");
  const result = await db.update(tables.comments).set({
    status: "removed", body: null, updatedAt: date(now),
  }).where(and(eq(tables.comments.id, id), eq(tables.comments.userId, userId)))
    .returning({ id: tables.comments.id });
  return result.length > 0;
}

export async function createReport(
  db: Db,
  userId: string,
  input: { commentId: string; reason: string },
  now: number,
): Promise<ReportDto> {
  return db.transaction(async (tx) => {
    const target = await tx.select().from(tables.comments)
      .where(eq(tables.comments.id, input.commentId)).limit(1);
    const comment = target[0];
    if (!comment || comment.status !== "visible") {
      throw new ServiceError(404, "NOT_FOUND", "Comment not found.");
    }
    if (comment.userId === userId) throw new ServiceError(403, "SELF_REPORT", "You cannot report your own comment.");
    await consumeRateLimit(tx, userId, "report", now);
    const id = randomUUID();
    try {
      await tx.insert(tables.commentReports).values({
        id, userId, commentId: input.commentId, reason: input.reason, status: "open", createdAt: date(now),
      });
    } catch (error) {
      if (uniqueViolation(error)) throw new ServiceError(409, "DUPLICATE_REPORT", "This comment is already reported.");
      throw error;
    }
    return {
      id, commentId: input.commentId, reason: input.reason, status: "open" as const,
      createdAt: now, comment: null,
    };
  });
}

export async function listReports(
  db: Db,
  actorId: string,
  cursor: { time: number; id: string } | null,
  limit: number,
): Promise<{ items: ReportDto[]; nextCursor: string | null }> {
  await requireModerator(db, actorId);
  const rows = await db.select({
    report: tables.commentReports,
    comment: tables.comments,
    authorName: tables.profiles.displayName,
  }).from(tables.commentReports)
    .innerJoin(tables.comments, eq(tables.comments.id, tables.commentReports.commentId))
    .leftJoin(tables.profiles, eq(tables.profiles.userId, tables.comments.userId))
    .where(and(
      eq(tables.commentReports.status, "open"),
      cursor ? or(
        lt(tables.commentReports.createdAt, date(cursor.time)),
        and(eq(tables.commentReports.createdAt, date(cursor.time)), lt(tables.commentReports.id, cursor.id)),
      ) : undefined,
    ))
    .orderBy(desc(tables.commentReports.createdAt), desc(tables.commentReports.id))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map((row) => {
      // Privilege-specific DTO: only this authenticated moderator route may
      // expose a hidden body. Removal destroyed the body, so it stays null.
      const publicComment = commentDto({ ...row.comment, authorName: row.authorName });
      const moderatorComment: CommentDto = {
        ...publicComment,
        body: row.comment.status === "removed" ? null : row.comment.body,
      };
      return {
        id: row.report.id,
        commentId: row.report.commentId,
        reason: row.report.reason,
        status: row.report.status as ReportDto["status"],
        createdAt: row.report.createdAt.getTime(),
        comment: moderatorComment,
      };
    }),
    nextCursor: hasMore && last ? `${last.report.createdAt.getTime()}.${last.report.id}` : null,
  };
}

export async function resolveReport(
  db: Db,
  actorId: string,
  reportId: string,
  action: "resolve" | "dismiss",
  now: number,
): Promise<boolean> {
  await requireModerator(db, actorId);
  const result = await db.update(tables.commentReports).set({
    status: action === "resolve" ? "resolved" : "dismissed",
    resolvedAt: date(now),
    resolvedBy: actorId,
  }).where(and(eq(tables.commentReports.id, reportId), eq(tables.commentReports.status, "open")))
    .returning({ id: tables.commentReports.id });
  return result.length > 0;
}

export async function moderateComment(
  db: Db,
  actorId: string,
  commentId: string,
  action: "hide" | "remove" | "restore",
  now: number,
): Promise<CommentDto> {
  return db.transaction(async (tx) => {
    await requireModerator(tx, actorId);
    const existing = await loadComment(tx, commentId);
    if (!existing) throw new ServiceError(404, "NOT_FOUND", "Comment not found.");
    // Removing nulls the body, so only an intact hidden comment can return.
    if (action === "restore" && (existing.status !== "hidden" || !existing.body)) {
      throw new ServiceError(409, "RESTORE_NOT_ALLOWED", "Only a hidden comment can be restored.");
    }
    const status: CommentStatus = action === "hide" ? "hidden" : action === "remove" ? "removed" : "visible";
    await tx.update(tables.comments).set({
      status,
      // Removal destroys the stored body; hiding preserves it for moderators.
      ...(action === "remove" ? { body: null } : {}),
      updatedAt: date(now),
    }).where(eq(tables.comments.id, commentId));
    if (existing.userId !== actorId && action !== "restore") {
      await emitNotification(tx, {
        userId: existing.userId,
        type: "moderation",
        eventKey: `moderation:${commentId}:${action}`,
        title: "Bình luận bị kiểm duyệt",
        body: action === "hide"
          ? "Bình luận của bạn đã bị ẩn để kiểm duyệt."
          : "Bình luận của bạn đã bị xóa.",
        href: existing.targetType === "chapter" ? `/read/${existing.targetId}` : `/manga/${existing.targetId}`,
      });
    }
    return commentDto((await loadComment(tx, commentId))!);
  });
}

export async function setThreadLock(
  db: Db,
  actorId: string,
  targetType: CommentTargetType,
  targetId: string,
  locked: boolean,
  now: number,
): Promise<ThreadDto> {
  return db.transaction(async (tx) => {
    await requireModerator(tx, actorId);
    await ensureThread(tx, targetType, targetId, now);
    await tx.update(tables.commentThreads).set({
      locked,
      lockedBy: locked ? actorId : null,
      updatedAt: date(now),
    }).where(and(
      eq(tables.commentThreads.targetType, targetType),
      eq(tables.commentThreads.targetId, targetId),
    ));
    return { targetType, targetId, locked };
  });
}

export async function threadState(
  db: Db,
  targetType: CommentTargetType,
  targetId: string,
): Promise<ThreadDto> {
  const rows = await db.select().from(tables.commentThreads)
    .where(and(eq(tables.commentThreads.targetType, targetType), eq(tables.commentThreads.targetId, targetId)))
    .limit(1);
  return { targetType, targetId, locked: rows[0]?.locked === true };
}

function notificationDto(row: typeof tables.notifications.$inferSelect): NotificationDto {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    href: row.href,
    readAt: ms(row.readAt),
    createdAt: row.createdAt.getTime(),
  };
}

export async function listNotifications(
  db: Db,
  userId: string,
  cursor: { time: number; id: string } | null,
  limit: number,
): Promise<{ items: NotificationDto[]; unreadCount: number; nextCursor: string | null }> {
  const unread = await db.select({ value: count() }).from(tables.notifications)
    .where(and(eq(tables.notifications.userId, userId), isNull(tables.notifications.readAt)));
  const rows = await db.select().from(tables.notifications)
    .where(and(
      eq(tables.notifications.userId, userId),
      cursor ? or(
        lt(tables.notifications.createdAt, date(cursor.time)),
        and(eq(tables.notifications.createdAt, date(cursor.time)), lt(tables.notifications.id, cursor.id)),
      ) : undefined,
    ))
    .orderBy(desc(tables.notifications.createdAt), desc(tables.notifications.id))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map(notificationDto),
    unreadCount: unread[0]?.value ?? 0,
    nextCursor: hasMore && last ? `${last.createdAt.getTime()}.${last.id}` : null,
  };
}

export async function readNotifications(
  db: Db,
  userId: string,
  ids: string[],
  now: number,
): Promise<number> {
  const result = await db.update(tables.notifications).set({ readAt: date(now) })
    .where(and(
      eq(tables.notifications.userId, userId),
      inArray(tables.notifications.id, ids),
      isNull(tables.notifications.readAt),
    ))
    .returning({ id: tables.notifications.id });
  return result.length;
}

function parsePublish(value: string): number | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

type FeedCandidate = { id: string; published: number };

// Raw string comparison, not localeCompare: the continuation is persisted and
// must not depend on ICU/locale behaviour between workers.
function compareCandidates(a: FeedCandidate, b: FeedCandidate): number {
  if (a.published !== b.published) return a.published - b.published;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function capOffset(offset: number): number {
  return Math.min(Math.max(0, offset), UPSTREAM_OFFSET_LIMIT - NOTIFICATION_FEED_LIMIT);
}

/// On-demand only: no background worker is started or implied. The first
/// observation baselines the newest published chapter; later refreshes drain
/// older unseen candidates through a bounded MangaDex continuation.
export async function refreshFollowedChapters(
  db: Db,
  userId: string,
  content: ContentClient,
  now: number,
): Promise<{ checked: number; created: number; skipped: boolean; partial: boolean }> {
  return db.transaction(async (tx) => {
    const acquired = await tx.execute(sql`select pg_try_advisory_xact_lock(hashtext(${'chapter-refresh:' + userId})) as acquired`);
    const result = acquired as unknown as { rows?: Array<{ acquired: boolean }> };
    const rows = result.rows ?? [];
    if (rows[0]?.acquired === false) {
      return { checked: 0, created: 0, skipped: true, partial: false };
    }

    const followed = await tx.select({
      mangaId: tables.libraryEntries.mangaId,
      title: tables.libraryEntries.title,
    }).from(tables.libraryEntries)
      .where(and(eq(tables.libraryEntries.userId, userId), ne(tables.libraryEntries.status, "dropped")))
      .orderBy(desc(tables.libraryEntries.followedAt))
      .limit(LIBRARY_SCAN_LIMIT);

    let created = 0;
    let partial = false;
    for (const entry of followed) {
      for (const language of ["vi", "en"] as const) {
        const cursorWhere = and(
          eq(tables.notificationCursors.userId, userId),
          eq(tables.notificationCursors.mangaId, entry.mangaId),
          eq(tables.notificationCursors.language, language),
        );
        const existing = (await tx.select().from(tables.notificationCursors).where(cursorWhere).limit(1))[0];

        if (!existing) {
          let page;
          try {
            // Descending publication order reaches the latest chapter even in a
            // catalog far past the old 2000-item list cap.
            page = await content.notificationFeed(entry.mangaId, {
              lang: language, offset: 0, limit: NOTIFICATION_FEED_LIMIT,
            });
          } catch {
            continue;
          }
          if (page.partial) partial = true;
          const fresh = page.items
            .map((item) => ({ id: item.id, published: parsePublish(item.publish_at) }))
            .filter((value): value is FeedCandidate => value.published !== null
              && value.published <= now + MAX_CHAPTER_AGE_MS)
            .sort(compareCandidates)
            .at(-1);
          if (!fresh) continue;
          await tx.insert(tables.notificationCursors).values({
            userId, mangaId: entry.mangaId, language,
            lastPublish: fresh.published, lastChapterId: fresh.id,
            scanPublish: fresh.published, scanOffset: 0, updatedAt: date(now),
          });
          continue;
        }

        const offset = capOffset(existing.scanOffset);
        const since = new Date(existing.scanPublish).toISOString();
        let page;
        try {
          page = await content.notificationFeed(entry.mangaId, {
            lang: language, since, offset, limit: NOTIFICATION_FEED_LIMIT,
          });
        } catch {
          // An upstream failure never moves the persisted continuation.
          continue;
        }
        if (page.partial || (page.total > UPSTREAM_OFFSET_LIMIT
          && offset + NOTIFICATION_FEED_LIMIT >= UPSTREAM_OFFSET_LIMIT)) partial = true;

        const decorated = page.items.map((item) => {
          const published = parsePublish(item.publish_at);
          const valid = published !== null && published <= now + MAX_CHAPTER_AGE_MS;
          return valid
            ? { id: item.id, published: published!, valid: true as const }
            : { id: item.id, published: published ?? 0, valid: false as const };
        });
        const cursor: FeedCandidate = { id: existing.lastChapterId ?? "", published: existing.lastPublish };
        const candidates = decorated
          .filter((value): value is FeedCandidate & { valid: true } =>
            value.valid && compareCandidates(value, cursor) > 0)
          .sort(compareCandidates);
        if (candidates.length === 0) {
          // Only skip rows that cannot become notifications (invalid/duplicate).
          if (page.items.length > 0) {
            await tx.update(tables.notificationCursors).set({
              scanOffset: capOffset(offset + page.items.length), updatedAt: date(now),
            }).where(cursorWhere);
          }
          continue;
        }

        const pending = candidates.slice(0, CHAPTERS_PER_MANGA);
        for (const candidate of pending) {
          const emitted = await emitNotification(tx, {
            userId,
            type: "new_chapter",
            eventKey: `chapter:${userId}:${entry.mangaId}:${candidate.id}:${language}`,
            title: "Chương mới",
            body: `${entry.title} — ${candidate.id} (${language})`,
            href: `/read/${candidate.id}?manga=${encodeURIComponent(entry.mangaId)}&lang=${language}`,
          });
          if (emitted) created += 1;
        }

        const last = pending.at(-1)!;
        const consumed = decorated.filter((value) => !value.valid || compareCandidates(value, last) <= 0).length;
        const nextOffset = capOffset(offset + Math.max(1, consumed));
        const remainingTies = candidates
          .slice(candidates.indexOf(last) + 1)
          .some((value) => value.published === last.published);
        const lastPageItem = page.items.at(-1);
        const endsAtLastPublish = page.items.length === page.limit
          && parsePublish(lastPageItem?.publish_at ?? "") === last.published;
        if (!remainingTies && !endsAtLastPublish) {
          // No same-time rows remain in reach: start a fresh since bound.
          await tx.update(tables.notificationCursors).set({
            lastPublish: last.published, lastChapterId: last.id,
            scanPublish: last.published, scanOffset: 0, updatedAt: date(now),
          }).where(cursorWhere);
        } else {
          // Keep the old since bound and skip only what this page consumed, so
          // same-timestamp rows split across pages are not jumped over.
          if (nextOffset + NOTIFICATION_FEED_LIMIT >= UPSTREAM_OFFSET_LIMIT && page.total > UPSTREAM_OFFSET_LIMIT) {
            partial = true;
          }
          await tx.update(tables.notificationCursors).set({
            lastPublish: last.published, lastChapterId: last.id,
            scanOffset: nextOffset, updatedAt: date(now),
          }).where(cursorWhere);
        }
      }
    }
    return { checked: followed.length, created, skipped: false, partial };
  });
}
