import { and, count, desc, eq } from "drizzle-orm";
import type { AppDatabase } from "../db/client";
import * as tables from "../db/schema";
import type { ContentClient, LibraryEntryDto, PublicProfileDto, PublicProfileEntryDto } from "../contracts";
import { ServiceError } from "../me/service";
import { levelFromXp, realmForLevel } from "../progression";

type CommentRow = typeof tables.comments.$inferSelect;

function libraryDto(row: typeof tables.libraryEntries.$inferSelect): LibraryEntryDto {
  return {
    mangaId: row.mangaId,
    title: row.title,
    coverFile: row.coverFile,
    lang: row.lang,
    status: row.status,
    followedAt: row.followedAt,
    lastChapterId: row.lastChapterId,
    lastReadPublish: row.lastReadPublish,
    revision: row.revision,
  };
}

function entryFrom(row: CommentRow): PublicProfileEntryDto {
  return {
    targetType: row.targetType as "manga" | "chapter",
    targetId: row.targetId,
    mangaId: row.targetType === "manga" ? row.targetId : null,
    title: row.targetType === "manga" ? "Truyện" : "Chương",
    coverFile: null,
    chapterLabel: null,
    body: row.body ?? "",
    createdAt: row.createdAt.getTime(),
  };
}

function latestByTarget(rows: CommentRow[]): Map<string, CommentRow> {
  const groups = new Map<string, CommentRow>();
  for (const row of rows) {
    const key = `${row.targetType}:${row.targetId}`;
    if (!groups.has(key)) groups.set(key, row);
  }
  return groups;
}

export async function getPublicProfile(
  db: AppDatabase,
  viewerId: string | null,
  userId: string,
  _content: ContentClient,
): Promise<PublicProfileDto> {
  const [profile] = await db.select().from(tables.profiles)
    .where(eq(tables.profiles.userId, userId))
    .limit(1);
  if (!profile) throw new ServiceError(404, "USER_NOT_FOUND", "User profile not found.");

  const [chapters] = await db.select({ value: count() }).from(tables.readingCompletions)
    .where(eq(tables.readingCompletions.userId, userId));
  const [following] = await db.select({ value: count() }).from(tables.libraryEntries)
    .where(eq(tables.libraryEntries.userId, userId));
  const [comments] = await db.select({ value: count() }).from(tables.comments)
    .where(and(eq(tables.comments.userId, userId), eq(tables.comments.status, "visible")));
  const [savedTotalRow] = await db.select({ value: count() }).from(tables.libraryEntries)
    .where(eq(tables.libraryEntries.userId, userId));

  const visible = await db.select().from(tables.comments)
    .where(and(eq(tables.comments.userId, userId), eq(tables.comments.status, "visible")))
    .orderBy(desc(tables.comments.createdAt), desc(tables.comments.id));
  const roots = latestByTarget(visible.filter((row) => row.parentId === null));
  const replies = latestByTarget(visible.filter((row) => row.parentId !== null));

  const saved = viewerId === userId
    ? (await db.select().from(tables.libraryEntries)
      .where(eq(tables.libraryEntries.userId, userId))
      .orderBy(desc(tables.libraryEntries.followedAt))
      .limit(24)).map(libraryDto)
    : null;

  const level = levelFromXp(profile.totalXp);
  const postedAll = Array.from(roots.values());
  const participatingAll = Array.from(replies.values());

  return {
    id: profile.userId,
    username: profile.username,
    displayName: profile.displayName,
    avatarUrl: profile.avatarUrl,
    bio: profile.bio,
    title: realmForLevel(level).name,
    level,
    totalXp: profile.totalXp,
    joinedAt: profile.createdAt.getTime(),
    stats: {
      chaptersRead: chapters?.value ?? 0,
      following: following?.value ?? 0,
      comments: comments?.value ?? 0,
      posted: roots.size,
      participating: replies.size,
      saved: savedTotalRow?.value ?? 0,
    },
    topTags: [],
    posted: postedAll.slice(0, 20).map(entryFrom),
    participating: participatingAll.slice(0, 20).map(entryFrom),
    recent: visible.slice(0, 5).map(entryFrom),
    saved,
    savedTotal: savedTotalRow?.value ?? 0,
    truncated: {
      posted: postedAll.length > 20,
      participating: participatingAll.length > 20,
      recent: visible.length > 5,
      saved: (savedTotalRow?.value ?? 0) > 24,
    },
  };
}
