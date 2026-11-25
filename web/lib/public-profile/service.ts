import { and, count, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { AppDatabase } from "../db/client";
import * as tables from "../db/schema";
import type {
  ContentClient,
  LibraryEntryDto,
  MangaSummaryDto,
  PublicProfileDto,
  PublicProfileEntryDto,
} from "../contracts";
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

function targetKey(row: CommentRow) {
  return `${row.targetType}:${row.targetId}`;
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
    const key = targetKey(row);
    if (!groups.has(key)) groups.set(key, row);
  }
  return groups;
}

export async function getPublicProfile(
  db: AppDatabase,
  viewerId: string | null,
  userId: string,
  content: ContentClient,
): Promise<PublicProfileDto> {
  const [profile] = await db.select().from(tables.profiles)
    .where(eq(tables.profiles.userId, userId))
    .limit(1);
  if (!profile) throw new ServiceError(404, "USER_NOT_FOUND", "User profile not found.");

  const [chapters] = await db.select({ value: count() }).from(tables.readingCompletions)
    .where(eq(tables.readingCompletions.userId, userId));
  const [libraryTotalRow] = await db.select({ value: count() }).from(tables.libraryEntries)
    .where(eq(tables.libraryEntries.userId, userId));
  const [comments] = await db.select({ value: count() }).from(tables.comments)
    .where(and(eq(tables.comments.userId, userId), eq(tables.comments.status, "visible")));
  const [postedCountRow] = await db.select({
    value: sql<number>`count(distinct ${tables.comments.targetType} || ':' || ${tables.comments.targetId})`,
  }).from(tables.comments).where(and(
    eq(tables.comments.userId, userId),
    eq(tables.comments.status, "visible"),
    isNull(tables.comments.parentId),
  ));
  const [participatingCountRow] = await db.select({
    value: sql<number>`count(distinct ${tables.comments.targetType} || ':' || ${tables.comments.targetId})`,
  }).from(tables.comments).where(and(
    eq(tables.comments.userId, userId),
    eq(tables.comments.status, "visible"),
    isNotNull(tables.comments.parentId),
  ));

  const visible = await db.select().from(tables.comments)
    .where(and(eq(tables.comments.userId, userId), eq(tables.comments.status, "visible")))
    .orderBy(desc(tables.comments.createdAt), desc(tables.comments.id))
    .limit(1000);
  const roots = latestByTarget(visible.filter((row) => row.parentId === null));
  const replies = latestByTarget(visible.filter((row) => row.parentId !== null));

  const libraryRows = await db.select().from(tables.libraryEntries)
    .where(eq(tables.libraryEntries.userId, userId))
    .orderBy(desc(tables.libraryEntries.followedAt))
    .limit(200);
  const savedRows = viewerId === userId ? libraryRows.slice(0, 24) : [];
  const saved = viewerId === userId ? savedRows.map(libraryDto) : null;
  const libraryTitles = new Map(libraryRows.map((row) => [row.mangaId, row]));
  const libraryByChapter = new Map(
    libraryRows.filter((row) => row.lastChapterId).map((row) => [row.lastChapterId!, row.mangaId]),
  );

  const postedAll = Array.from(roots.values());
  const participatingAll = Array.from(replies.values());
  const recentRows = visible.slice(0, 5);
  const entries = new Map<string, PublicProfileEntryDto>();
  const entryFor = (row: CommentRow, section: string) => {
    const key = `${section}:${targetKey(row)}`;
    let entry = entries.get(key);
    if (!entry) {
      entry = entryFrom(row);
      entries.set(key, entry);
    }
    return entry;
  };
  const posted = postedAll.slice(0, 20).map((row) => entryFor(row, "posted"));
  const participating = participatingAll.slice(0, 20).map((row) => entryFor(row, "participating"));
  const recent = recentRows.map((row, index) => entryFor(row, `recent:${index}`));

  let contentCalls = 0;
  const mangaCache = new Map<string, MangaSummaryDto | null>();
  const tagCounts = new Map<string, number>();
  const taggedManga = new Set<string>();
  const loadManga = async (mangaId: string): Promise<MangaSummaryDto | null> => {
    if (mangaCache.has(mangaId)) return mangaCache.get(mangaId) ?? null;
    if (contentCalls >= 12) return null;
    contentCalls += 1;
    try {
      const manga = await content.manga(mangaId);
      mangaCache.set(mangaId, manga);
      return manga;
    } catch {
      mangaCache.set(mangaId, null);
      return null;
    }
  };
  const applyManga = (entry: PublicProfileEntryDto, manga: MangaSummaryDto | null) => {
    const known = libraryTitles.get(entry.mangaId ?? "");
    if (manga) {
      entry.title = manga.title;
      entry.coverFile = manga.cover_file;
      if (!taggedManga.has(manga.id)) {
        taggedManga.add(manga.id);
        for (const tag of manga.tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      }
    } else if (known) {
      entry.title = known.title;
      entry.coverFile = known.coverFile;
    }
  };

  for (const entry of entries.values()) {
    if (entry.targetType === "manga") {
      applyManga(entry, await loadManga(entry.targetId));
      continue;
    }
    if (contentCalls >= 12) continue;
    contentCalls += 1;
    try {
      const metadata = await content.chapterMetadata(entry.targetId);
      entry.mangaId = metadata.manga_id;
      entry.chapterLabel = metadata.chapter ? `Chương ${metadata.chapter}` : null;
      applyManga(entry, await loadManga(metadata.manga_id));
    } catch {
      entry.mangaId = libraryByChapter.get(entry.targetId) ?? null;
      if (entry.mangaId) applyManga(entry, null);
    }
  }

  const topTags = Array.from(tagCounts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([tag]) => tag);

  const level = levelFromXp(profile.totalXp);
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
      following: libraryTotalRow?.value ?? 0,
      comments: comments?.value ?? 0,
      posted: postedCountRow?.value ?? 0,
      participating: participatingCountRow?.value ?? 0,
      saved: libraryTotalRow?.value ?? 0,
    },
    topTags,
    posted,
    participating,
    recent,
    saved,
    savedTotal: libraryTotalRow?.value ?? 0,
    truncated: {
      posted: (postedCountRow?.value ?? 0) > 20,
      participating: (participatingCountRow?.value ?? 0) > 20,
      recent: (comments?.value ?? 0) > 5,
      saved: (libraryTotalRow?.value ?? 0) > 24,
    },
  };
}
