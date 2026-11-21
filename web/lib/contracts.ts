// Browser-safe contracts shared by the Next BFF and later native clients.

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

export type SearchResponse = { results: MangaSummaryDto[]; total: number };

export type ChaptersResponse = { vi: ChapterDto[]; en: ChapterDto[] };

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
};

export type PagesResponse = { pages: string[] };

export type ContentEndpoint =
  | "latest"
  | "popular"
  | "tags"
  | "rank"
  | "search"
  | "manga"
  | "chapter"
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
  manga: Pick<MangaSummaryDto, "id" | "cover_file">,
  size = 256,
): string | null {
  if (!manga.cover_file) return null;
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
};

export function searchQuery(params: SearchParams): string {
  const query = new URLSearchParams();
  if (params.q?.trim()) query.set("q", params.q.trim());
  const tags = (params.tags ?? []).filter(Boolean);
  if (tags.length > 0) query.set("tags", tags.join(","));
  if (params.status) query.set("status", params.status);
  if (params.sort && params.sort !== "follows") query.set("sort", params.sort);
  if (params.page && params.page > 1) query.set("page", String(params.page));
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
    pages: async (chapterId, signal) => {
      const result = await get<PagesResponse>(contentPath("chapter", chapterId, "pages"), signal);
      return { pages: normalizePageUrls(result.pages ?? []) };
    },
  };
}
