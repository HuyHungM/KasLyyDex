import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";
import type { AppDatabase } from "../db/client";
import * as tables from "../db/schema";
import type { AccountIdentity } from "../auth/identity";
import { roleFromVerifiedAllowlist } from "../validators";
import type {
  ImportHistoryItem,
  ImportLibraryItem,
  LibraryInput,
  ProgressInput,
  ReaderSettingsDto,
} from "../validators";
import { mergeLibrary, mergeProgress } from "../merge";
import { levelFromXp, progressionForXp, realmForLevel } from "../progression";

export class ServiceError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ServiceError";
    this.status = status;
    this.code = code;
  }
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

function date(ms: number): Date {
  return new Date(Number.isFinite(ms) ? ms : Date.now());
}

const excluded = (column: string) => sql.raw(`excluded."${column}"`);

export type ProfileDto = {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  level: number;
  totalXp: number;
  title: string;
};

export type LibraryDto = {
  mangaId: string;
  title: string;
  coverFile: string | null;
  lang: string;
  status: string;
  followedAt: number;
  lastChapterId: string | null;
  lastReadPublish: number;
  revision: number;
};

export type ProgressDto = {
  mangaId: string;
  chapterId: string;
  lang: string;
  chapter: string | null;
  title: string | null;
  coverFile: string | null;
  page: number;
  total: number;
  maxPage: number;
  lastReadAt: number;
  revision: number;
};

export type ImportSummary = {
  libraryInserted: number;
  libraryUpdated: number;
  progressInserted: number;
  progressUpdated: number;
  skipped: number;
  settingsApplied: boolean;
};

function profileDto(row: typeof tables.profiles.$inferSelect): ProfileDto {
  return {
    id: row.userId,
    username: row.username,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    level: levelFromXp(row.totalXp),
    totalXp: row.totalXp,
    title: realmForLevel(levelFromXp(row.totalXp)).name,
  };
}

function libraryDto(row: typeof tables.libraryEntries.$inferSelect): LibraryDto {
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

function progressDto(row: typeof tables.chapterProgress.$inferSelect): ProgressDto {
  return {
    mangaId: row.mangaId,
    chapterId: row.chapterId,
    lang: row.language,
    chapter: row.chapter,
    title: row.title,
    coverFile: row.coverFile,
    page: row.page,
    total: row.total,
    maxPage: row.maxPage,
    lastReadAt: row.lastReadAt,
    revision: row.revision,
  };
}

/// Creates the application profile on first authenticated use. Role bootstrap
/// is the only path to elevated privileges and requires a verified allowlisted
/// email from the managed session, never a request field.
export async function ensureProfile(
  db: AppDatabase,
  identity: AccountIdentity,
  options: { now: number; allowlist: readonly string[] },
): Promise<ProfileDto> {
  await db.insert(tables.profiles).values({
    userId: identity.id,
    createdAt: date(options.now),
    updatedAt: date(options.now),
  }).onConflictDoNothing();

  const role = roleFromVerifiedAllowlist(identity, options.allowlist);
  if (role) {
    await db.insert(tables.userRoles).values({ userId: identity.id, role }).onConflictDoNothing();
  }
  const rows = await db.select().from(tables.profiles).where(eq(tables.profiles.userId, identity.id)).limit(1);
  if (rows.length === 0) throw new ServiceError(500, "PROFILE_UNAVAILABLE", "Account profile could not be loaded.");
  return profileDto(rows[0]);
}

export async function updateProfile(
  db: AppDatabase,
  userId: string,
  patch: { username?: string | null; displayName?: string | null; avatarUrl?: string | null },
  now: number,
): Promise<ProfileDto> {
  const values: Partial<typeof tables.profiles.$inferInsert> = { updatedAt: date(now) };
  if (Object.hasOwn(patch, "username")) values.username = patch.username ?? null;
  if (Object.hasOwn(patch, "displayName")) values.displayName = patch.displayName ?? null;
  if (Object.hasOwn(patch, "avatarUrl")) values.avatarUrl = patch.avatarUrl ?? null;
  try {
    await db.update(tables.profiles).set(values).where(eq(tables.profiles.userId, userId));
  } catch (error) {
    if (uniqueViolation(error)) throw new ServiceError(409, "USERNAME_TAKEN", "That username is already in use.");
    throw error;
  }
  const rows = await db.select().from(tables.profiles).where(eq(tables.profiles.userId, userId)).limit(1);
  return profileDto(rows[0]);
}

export async function listLibrary(db: AppDatabase, userId: string): Promise<LibraryDto[]> {
  const rows = await db.select().from(tables.libraryEntries)
    .where(eq(tables.libraryEntries.userId, userId))
    .orderBy(desc(tables.libraryEntries.followedAt))
    .limit(200);
  return rows.map(libraryDto);
}

export async function putLibrary(
  db: AppDatabase,
  userId: string,
  mangaId: string,
  input: LibraryInput,
  now: number,
): Promise<LibraryDto> {
  await db.insert(tables.libraryEntries).values({
    userId,
    mangaId,
    title: input.title,
    coverFile: input.coverFile,
    lang: input.lang,
    status: input.status,
    followedAt: now,
    lastReadPublish: 0,
    revision: 1,
    updatedAt: date(now),
  }).onConflictDoUpdate({
    target: [tables.libraryEntries.userId, tables.libraryEntries.mangaId],
    set: {
      title: excluded("title"),
      coverFile: excluded("cover_file"),
      lang: excluded("lang"),
      status: excluded("status"),
      // Server owns the mutation time and monotonically increasing revision.
      followedAt: sql`greatest(${tables.libraryEntries.followedAt}, ${excluded("followed_at")})`,
      revision: sql`${tables.libraryEntries.revision} + 1`,
      updatedAt: date(now),
    },
  });
  const rows = await db.select().from(tables.libraryEntries)
    .where(and(eq(tables.libraryEntries.userId, userId), eq(tables.libraryEntries.mangaId, mangaId)))
    .limit(1);
  return libraryDto(rows[0]);
}

export async function deleteLibrary(db: AppDatabase, userId: string, mangaId: string): Promise<boolean> {
  const rows = await db.select().from(tables.libraryEntries)
    .where(and(eq(tables.libraryEntries.userId, userId), eq(tables.libraryEntries.mangaId, mangaId)))
    .limit(1);
  if (rows.length === 0) return false;
  await db.delete(tables.libraryEntries)
    .where(and(eq(tables.libraryEntries.userId, userId), eq(tables.libraryEntries.mangaId, mangaId)));
  return true;
}

export async function putProgress(
  db: AppDatabase,
  userId: string,
  chapterId: string,
  input: ProgressInput,
  now: number,
): Promise<ProgressDto> {
  await db.insert(tables.chapterProgress).values({
    userId,
    mangaId: input.mangaId,
    chapterId,
    language: input.lang,
    chapter: input.chapter,
    title: input.title,
    coverFile: input.coverFile,
    page: input.page,
    maxPage: input.page,
    total: input.total,
    lastReadAt: now,
    revision: 1,
    updatedAt: date(now),
  }).onConflictDoUpdate({
    target: [
      tables.chapterProgress.userId,
      tables.chapterProgress.mangaId,
      tables.chapterProgress.chapterId,
      tables.chapterProgress.language,
    ],
    set: {
      // Current page may move backward for a reread; observed maximum may not.
      page: excluded("page"),
      maxPage: sql`greatest(${tables.chapterProgress.maxPage}, ${excluded("page")})`,
      total: excluded("total"),
      chapter: excluded("chapter"),
      title: excluded("title"),
      coverFile: excluded("cover_file"),
      lastReadAt: sql`greatest(${tables.chapterProgress.lastReadAt} + 1, ${excluded("last_read_at")})`,
      revision: sql`${tables.chapterProgress.revision} + 1`,
      updatedAt: date(now),
    },
  });
  const rows = await db.select().from(tables.chapterProgress).where(and(
    eq(tables.chapterProgress.userId, userId),
    eq(tables.chapterProgress.mangaId, input.mangaId),
    eq(tables.chapterProgress.chapterId, chapterId),
    eq(tables.chapterProgress.language, input.lang),
  )).limit(1);
  return progressDto(rows[0]);
}

export async function listProgress(db: AppDatabase, userId: string): Promise<ProgressDto[]> {
  const rows = await db.select().from(tables.chapterProgress)
    .where(eq(tables.chapterProgress.userId, userId))
    .orderBy(desc(tables.chapterProgress.lastReadAt))
    .limit(100);
  return rows.map(progressDto);
}

export async function deleteProgress(
  db: AppDatabase,
  userId: string,
  chapterId: string,
  mangaId: string,
  language: string,
): Promise<boolean> {
  const where = and(
    eq(tables.chapterProgress.userId, userId),
    eq(tables.chapterProgress.mangaId, mangaId),
    eq(tables.chapterProgress.chapterId, chapterId),
    eq(tables.chapterProgress.language, language),
  );
  const rows = await db.select().from(tables.chapterProgress).where(where).limit(1);
  if (rows.length === 0) return false;
  await db.delete(tables.chapterProgress).where(where);
  return true;
}

/// Real level data from the profile XP ledger. `source` names the active rule
/// version so future rebalancing can be versioned without rewriting history.
export async function getLevel(db: AppDatabase, userId: string): Promise<{
  level: number; totalXp: number; title: string; realm: string;
  source: string; ruleVersion: string;
}> {
  const rows = await db.select({ totalXp: tables.profiles.totalXp })
    .from(tables.profiles).where(eq(tables.profiles.userId, userId)).limit(1);
  const snapshot = progressionForXp(rows[0]?.totalXp ?? 0);
  return {
    level: snapshot.level, totalXp: snapshot.totalXp, title: snapshot.title,
    realm: snapshot.realm.key, source: "progression_v1", ruleVersion: snapshot.ruleVersion,
  };
}

export async function getSettings(db: AppDatabase, userId: string): Promise<ReaderSettingsDto> {
  const rows = await db.select().from(tables.readerPreferences)
    .where(eq(tables.readerPreferences.userId, userId)).limit(1);
  if (rows.length === 0) return { mode: "vertical", fit: true, bg: "auto", speed: 3 };
  return { mode: rows[0].mode as ReaderSettingsDto["mode"], fit: rows[0].fit, bg: rows[0].bg as ReaderSettingsDto["bg"], speed: rows[0].speed };
}

export async function putSettings(
  db: AppDatabase,
  userId: string,
  input: ReaderSettingsDto,
  now: number,
): Promise<ReaderSettingsDto> {
  await db.insert(tables.readerPreferences).values({ ...input, userId, updatedAt: date(now) })
    .onConflictDoUpdate({
      target: tables.readerPreferences.userId,
      set: { ...input, updatedAt: date(now) },
    });
  return input;
}

/// Idempotent guest merge. Uses one transaction and atomic conflict updates so
/// duplicated or concurrent imports cannot create duplicate rows or lower the
/// server's observed maximum.
export async function importGuest(
  db: AppDatabase,
  userId: string,
  payload: {
    library: ImportLibraryItem[];
    history: (ImportHistoryItem & { chapterId: string })[];
    settings: ReaderSettingsDto | null;
    skipped: number;
  },
  now: number,
): Promise<ImportSummary> {
  const summary: ImportSummary = {
    libraryInserted: 0,
    libraryUpdated: 0,
    progressInserted: 0,
    progressUpdated: 0,
    skipped: payload.skipped,
    settingsApplied: false,
  };
  await db.transaction(async (tx) => {
    for (const item of payload.library) {
      const existing = await tx.select().from(tables.libraryEntries)
        .where(and(eq(tables.libraryEntries.userId, userId), eq(tables.libraryEntries.mangaId, item.mangaId)))
        .limit(1);
      const localNewer = !existing[0] || mergeLibrary(
        {
          mangaId: existing[0].mangaId,
          title: existing[0].title,
          coverFile: existing[0].coverFile,
          lang: existing[0].lang,
          status: existing[0].status,
          followedAt: existing[0].followedAt,
          lastChapterId: existing[0].lastChapterId,
          lastReadPublish: existing[0].lastReadPublish,
        },
        item,
      ).changed;
      if (!existing[0]) summary.libraryInserted += 1;
      else if (localNewer) summary.libraryUpdated += 1;
      else { summary.skipped += 1; continue; }

      await tx.insert(tables.libraryEntries).values({
        userId,
        mangaId: item.mangaId,
        title: item.title,
        coverFile: item.coverFile,
        lang: item.lang,
        status: item.status,
        followedAt: item.followedAt,
        lastReadPublish: 0,
        revision: 1,
        updatedAt: date(now),
      }).onConflictDoUpdate({
        target: [tables.libraryEntries.userId, tables.libraryEntries.mangaId],
        set: {
          title: sql`CASE WHEN ${excluded("followed_at")} > ${tables.libraryEntries.followedAt} THEN ${excluded("title")} ELSE ${tables.libraryEntries.title} END`,
          coverFile: sql`CASE WHEN ${excluded("followed_at")} > ${tables.libraryEntries.followedAt} THEN ${excluded("cover_file")} ELSE ${tables.libraryEntries.coverFile} END`,
          lang: sql`CASE WHEN ${excluded("followed_at")} > ${tables.libraryEntries.followedAt} THEN ${excluded("lang")} ELSE ${tables.libraryEntries.lang} END`,
          status: sql`CASE WHEN ${tables.libraryEntries.status} = 'completed' OR ${excluded("followed_at")} <= ${tables.libraryEntries.followedAt} THEN ${tables.libraryEntries.status} ELSE ${excluded("status")} END`,
          followedAt: sql`greatest(${tables.libraryEntries.followedAt}, ${excluded("followed_at")})`,
          revision: sql`${tables.libraryEntries.revision} + CASE WHEN ${excluded("followed_at")} > ${tables.libraryEntries.followedAt} THEN 1 ELSE 0 END`,
          updatedAt: date(now),
        },
      });
    }

    for (const item of payload.history) {
      const existing = await tx.select().from(tables.chapterProgress).where(and(
        eq(tables.chapterProgress.userId, userId),
        eq(tables.chapterProgress.mangaId, item.mangaId),
        eq(tables.chapterProgress.chapterId, item.chapterId),
        eq(tables.chapterProgress.language, item.lang),
      )).limit(1);
      if (!existing[0]) summary.progressInserted += 1;
      else {
        const current = {
          mangaId: existing[0].mangaId,
          chapterId: existing[0].chapterId,
          lang: existing[0].language,
          page: existing[0].page,
          maxPage: existing[0].maxPage,
          total: existing[0].total,
          chapter: existing[0].chapter,
          title: existing[0].title,
          lastReadAt: existing[0].lastReadAt,
        };
        if (mergeProgress(current, item).changed) summary.progressUpdated += 1;
        else { summary.skipped += 1; continue; }
      }
      await tx.insert(tables.chapterProgress).values({
        userId,
        mangaId: item.mangaId,
        chapterId: item.chapterId,
        language: item.lang,
        chapter: item.chapter,
        title: item.title,
        coverFile: item.coverFile ?? null,
        page: item.page,
        maxPage: item.page,
        total: item.total,
        lastReadAt: item.ts,
        revision: 1,
        updatedAt: date(now),
      }).onConflictDoUpdate({
        target: [
          tables.chapterProgress.userId,
          tables.chapterProgress.mangaId,
          tables.chapterProgress.chapterId,
          tables.chapterProgress.language,
        ],
        set: {
          page: sql`CASE WHEN ${excluded("last_read_at")} > ${tables.chapterProgress.lastReadAt} THEN ${excluded("page")} ELSE ${tables.chapterProgress.page} END`,
          maxPage: sql`CASE WHEN ${excluded("last_read_at")} > ${tables.chapterProgress.lastReadAt} THEN greatest(${tables.chapterProgress.maxPage}, ${excluded("page")}) ELSE ${tables.chapterProgress.maxPage} END`,
          total: sql`CASE WHEN ${excluded("last_read_at")} > ${tables.chapterProgress.lastReadAt} THEN ${excluded("total")} ELSE ${tables.chapterProgress.total} END`,
          chapter: sql`CASE WHEN ${excluded("last_read_at")} > ${tables.chapterProgress.lastReadAt} THEN ${excluded("chapter")} ELSE ${tables.chapterProgress.chapter} END`,
          title: sql`CASE WHEN ${excluded("last_read_at")} > ${tables.chapterProgress.lastReadAt} THEN ${excluded("title")} ELSE ${tables.chapterProgress.title} END`,
          lastReadAt: sql`greatest(${tables.chapterProgress.lastReadAt}, ${excluded("last_read_at")})`,
          revision: sql`${tables.chapterProgress.revision} + CASE WHEN ${excluded("last_read_at")} > ${tables.chapterProgress.lastReadAt} THEN 1 ELSE 0 END`,
          updatedAt: date(now),
        },
      });
    }

    if (payload.settings) {
      await tx.insert(tables.readerPreferences).values({ ...payload.settings, userId, updatedAt: date(now) })
        .onConflictDoUpdate({
          target: tables.readerPreferences.userId,
          set: { ...payload.settings, updatedAt: date(now) },
        });
      summary.settingsApplied = true;
    }
  });
  return summary;
}
