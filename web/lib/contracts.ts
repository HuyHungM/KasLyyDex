// Browser-safe contracts shared by the Next BFF and later native clients.

// Account DTOs are browser-safe: no email, role or privileged state leaks into
// public content components.
export type AccountProfileDto = {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  level: number;
  totalXp: number;
  title: string;
};

export type LibraryEntryDto = {
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

export type ProgressEntryDto = {
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

export type ImportSummaryDto = {
  libraryInserted: number;
  libraryUpdated: number;
  progressInserted: number;
  progressUpdated: number;
  skipped: number;
  settingsApplied: boolean;
};

export type ApiErrorEnvelope = {
  error: {
    code: string;
    message: string;
    details: Record<string, string>;
  };
};

export function errorEnvelope(
  code: string,
  message: string,
  details: Record<string, string> = {},
): ApiErrorEnvelope {
  return { error: { code, message, details } };
}

export function serviceUnavailableResponse(
  service: "auth" | "content" | "database",
  missing: string[],
): Response {
  return Response.json(
    errorEnvelope(
      `${service.toUpperCase()}_NOT_CONFIGURED`,
      `${service} service is not configured.`,
      { service, missing: missing.join(",") },
    ),
    { status: 503 },
  );
}

export type MangaSummaryDto = {
  id: string;
  title: string;
  cover_file: string | null;
  status: string;
  year: number | null;
  description: string;
  tags: string[];
  tag_ids: string[];
  author: string;
  artist: string;
  rating: number | null;
  follows: number | null;
  latest_chapter: string | null;
  source?: string;
  source_label?: string;
  source_url?: string | null;
};

export type LatestChapterSummaryDto = {
  id: string;
  chapter: string | null;
  lang: string;
  publish_at: string;
};

export type LatestMangaDto = MangaSummaryDto & {
  chapters: LatestChapterSummaryDto[];
};

export type TagDto = { id: string; name: string; group: string };

export type SearchResponse = {
  results: MangaSummaryDto[];
  total: number;
  partial?: boolean;
};

export type ChaptersResponse = { vi: ChapterDto[]; en: ChapterDto[]; notice?: string | null };

export type ChapterDto = {
  id: string;
  chapter: string | null;
  volume: string | null;
  title: string;
  lang: string;
  pages: number;
  external_url: string | null;
  publish_at: string;
  group: string;
  source?: string;
  source_label?: string;
  readable?: boolean;
};

export function sourceLabel(source?: string): string {
  return source === "comick" ? "Comick" : "MangaDex";
}

/// Single-chapter authority from Axum/MangaDex entity metadata. The public
/// chapter lists are capped at 2000 and cannot establish ownership alone.
export type ChapterMetadataDto = {
  id: string;
  manga_id: string;
  lang: string;
  pages: number;
  external_url: string | null;
  unavailable: boolean;
  chapter: string | null;
  title: string;
};

export type PagesResponse = { pages: string[] };

/// Bounded continuation page for chapter notifications. `partial` is true when
/// MangaDex's 10,000 offset limit prevents reaching older candidates.
export type ChapterFeedPageDto = {
  items: ChapterDto[];
  total: number;
  offset: number;
  limit: number;
  next_offset: number | null;
  partial: boolean;
};

export type NotificationFeedParams = {
  lang: "vi" | "en";
  since?: string | null;
  offset?: number;
  limit?: number;
};

// Task 7 browser-safe community DTOs. Bodies are plain text; hidden/removed
// bodies are null outside the authenticated moderator queue.
export type CommentStatus = "visible" | "hidden" | "removed";

export type CommentDto = {
  id: string;
  targetType: "manga" | "chapter";
  targetId: string;
  parentId: string | null;
  userId: string;
  authorName: string;
  body: string | null;
  spoiler: boolean;
  status: CommentStatus;
  createdAt: number;
  updatedAt: number;
  replies: CommentDto[];
};

export type CommentListDto = { items: CommentDto[]; nextCursor: string | null };

export type ReportDto = {
  id: string;
  commentId: string;
  reason: string;
  status: "open" | "resolved" | "dismissed";
  createdAt: number;
  comment: CommentDto | null;
};

export type ReportListDto = { items: ReportDto[]; nextCursor: string | null };

export type NotificationDto = {
  id: string;
  type: string;
  title: string;
  body: string;
  href: string | null;
  readAt: number | null;
  createdAt: number;
};

export type NotificationListDto = {
  items: NotificationDto[];
  unreadCount: number;
  nextCursor: string | null;
};

export type ThreadDto = {
  targetType: "manga" | "chapter";
  targetId: string;
  locked: boolean;
};

export type ContentEndpoint =
  | "latest"
  | "popular"
  | "tags"
  | "rank"
  | "search"
  | "manga"
  | "chapter"
  | "notifications"
  | "img";

export function contentPath(endpoint: ContentEndpoint, ...segments: string[]): string {
  const tail = segments.map(encodeURIComponent).join("/");
  return `/api/content/${endpoint}${tail ? `/${tail}` : ""}`;
}

export class ContentClientError extends Error {
  readonly status: number;
  readonly body: ApiErrorEnvelope | null;

  constructor(status: number, body: ApiErrorEnvelope | null) {
    super(`Content request failed with status ${status}`);
    this.status = status;
    this.body = body;
  }
}

/// All MangaDex image bytes flow through Axum's `/api/content/img` handler.
export function contentImageUrl(upstream: string): string {
  return `${contentPath("img")}?u=${encodeURIComponent(upstream)}`;
}

export function coverImageUrl(
  manga: Pick<MangaSummaryDto, "id" | "cover_file" | "source">,
  size = 256,
): string | null {
  if (!manga.cover_file) return null;
  if (manga.source === "comick") {
    // Comick normalization supplies a full CDN URL; only the proxy allowlist's
    // HTTPS host may pass through.
    let upstream: URL;
    try {
      upstream = new URL(manga.cover_file);
    } catch {
      return null;
    }
    if (upstream.protocol !== "https:" || upstream.hostname !== "meo.comick.pictures") return null;
    return contentImageUrl(upstream.href);
  }
  return contentImageUrl(
    `https://uploads.mangadex.org/covers/${manga.id}/${manga.cover_file}.${size}.jpg`,
  );
}

/// Defensive boundary normalization for any legacy `/api/img?u=` page URL that
/// may still arrive from cached content. No upstream fetch happens here.
export function normalizePageUrls(pages: string[]): string[] {
  return pages.map((page) => {
    if (!page.startsWith("/api/img?")) return page;
    const upstream = new URL(page, "http://content.local").searchParams.get("u");
    return upstream ? contentImageUrl(upstream) : page;
  });
}

export type SearchParams = {
  q?: string;
  tags?: string[];
  status?: string;
  sort?: string;
  page?: number;
  source?: string;
  lang?: string;
  year?: number;
};

export function searchQuery(params: SearchParams): string {
  const query = new URLSearchParams();
  if (params.q?.trim()) query.set("q", params.q.trim());
  const tags = (params.tags ?? []).filter(Boolean);
  if (tags.length > 0) query.set("tags", tags.join(","));
  if (params.status) query.set("status", params.status);
  if (params.sort && params.sort !== "follows") query.set("sort", params.sort);
  if (params.page && params.page > 1) query.set("page", String(params.page));
  if (params.source && params.source !== "all") query.set("source", params.source);
  if (params.lang && params.lang !== "all") query.set("lang", params.lang);
  if (params.year !== undefined) query.set("year", String(params.year));
  const encoded = query.toString();
  return encoded ? `?${encoded}` : "";
}

export type ContentClient = {
  latest(signal?: AbortSignal): Promise<LatestMangaDto[]>;
  popular(signal?: AbortSignal): Promise<MangaSummaryDto[]>;
  tags(signal?: AbortSignal): Promise<TagDto[]>;
  rank(kind: "follows" | "rating", signal?: AbortSignal): Promise<MangaSummaryDto[]>;
  search(params: SearchParams, signal?: AbortSignal): Promise<SearchResponse>;
  manga(id: string, signal?: AbortSignal): Promise<MangaSummaryDto>;
  chapters(id: string, signal?: AbortSignal): Promise<ChaptersResponse>;
  chapterMetadata(id: string, signal?: AbortSignal): Promise<ChapterMetadataDto>;
  notificationFeed(id: string, params: NotificationFeedParams, signal?: AbortSignal): Promise<ChapterFeedPageDto>;
  pages(chapterId: string, signal?: AbortSignal): Promise<PagesResponse>;
};

export function createContentClient(origin = "/api/content"): ContentClient {
  const root = origin.endsWith("/api/content")
    ? origin.slice(0, -"/api/content".length)
    : origin.replace(/\/$/, "");

  async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
    const res = await fetch(`${root}${path}`, { signal, cache: "no-store" });
    const payload = await res.json().catch(() => null);
    if (!res.ok) throw new ContentClientError(res.status, payload as ApiErrorEnvelope | null);
    return payload as T;
  }

  return {
    latest: (signal) => get<LatestMangaDto[]>(contentPath("latest"), signal),
    popular: (signal) => get<MangaSummaryDto[]>(contentPath("popular"), signal),
    tags: (signal) => get<TagDto[]>(contentPath("tags"), signal),
    rank: (kind, signal) => get<MangaSummaryDto[]>(
      `${contentPath("rank")}?kind=${kind}`,
      signal,
    ),
    search: (params, signal) => get<SearchResponse>(
      `${contentPath("search")}${searchQuery(params)}`,
      signal,
    ),
    manga: (id, signal) => get<MangaSummaryDto>(contentPath("manga", id), signal),
    chapters: (id, signal) => get<ChaptersResponse>(
      contentPath("manga", id, "chapters"),
      signal,
    ),
    chapterMetadata: (id, signal) => get<ChapterMetadataDto>(contentPath("chapter", id), signal),
    notificationFeed: (id, params, signal) => {
      const query = new URLSearchParams();
      query.set("lang", params.lang);
      if (params.since) query.set("since", params.since);
      if (params.offset !== undefined) query.set("offset", String(params.offset));
      if (params.limit !== undefined) query.set("limit", String(params.limit));
      const encoded = query.toString();
      return get<ChapterFeedPageDto>(
        `${contentPath("notifications", "feed", id)}${encoded ? `?${encoded}` : ""}`,
        signal,
      );
    },
    pages: async (chapterId, signal) => {
      const result = await get<PagesResponse>(contentPath("chapter", chapterId, "pages"), signal);
      return { pages: normalizePageUrls(result.pages ?? []) };
    },
  };
}
