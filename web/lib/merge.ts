// Pure merge rules shared by the service and its tests. Local import data is
// advisory: newer server state always wins, max observed page never regresses,
// and imports never create XP, completions or roles.

export type LibraryState = {
  mangaId: string;
  title: string;
  coverFile: string | null;
  lang: string;
  status: string;
  followedAt: number;
  lastChapterId: string | null;
  lastReadPublish: number;
};

export type LibraryIncoming = {
  mangaId: string;
  title: string;
  coverFile: string | null;
  lang: string;
  status: string;
  followedAt: number;
};

export function mergeLibrary(
  existing: LibraryState,
  incoming: LibraryIncoming,
): { changed: boolean; value: LibraryState } {
  if (incoming.followedAt <= existing.followedAt) return { changed: false, value: existing };
  return {
    changed: true,
    value: {
      ...existing,
      title: incoming.title,
      coverFile: incoming.coverFile,
      lang: incoming.lang,
      // A completed server row is never downgraded by a guest import.
      status: existing.status === "completed" ? existing.status : incoming.status,
      followedAt: incoming.followedAt,
      lastChapterId: existing.lastChapterId,
      lastReadPublish: existing.lastReadPublish,
    },
  };
}

export type ProgressState = {
  mangaId: string;
  chapterId: string;
  lang: string;
  page: number;
  maxPage: number;
  total: number;
  chapter: string | null;
  title: string | null;
  lastReadAt: number;
};

export type ProgressIncoming = {
  mangaId: string;
  chapterId: string;
  lang: string;
  page: number;
  total: number;
  chapter: string | null;
  title: string | null;
  ts: number;
};

export function mergeProgress(
  existing: ProgressState | null,
  incoming: ProgressIncoming,
): { changed: boolean; value: ProgressState } {
  if (!existing) {
    return {
      changed: true,
      value: {
        mangaId: incoming.mangaId,
        chapterId: incoming.chapterId,
        lang: incoming.lang,
        page: incoming.page,
        maxPage: incoming.page,
        total: incoming.total,
        chapter: incoming.chapter,
        title: incoming.title,
        lastReadAt: incoming.ts,
      },
    };
  }
  if (incoming.ts <= existing.lastReadAt) return { changed: false, value: existing };
  return {
    changed: true,
    value: {
      ...existing,
      page: incoming.page,
      maxPage: Math.max(existing.maxPage, incoming.page),
      total: incoming.total,
      chapter: incoming.chapter,
      title: incoming.title,
      lastReadAt: incoming.ts,
    },
  };
}
