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

export type LatestMangaDto = MangaSummaryDto & {
  chapters: { id: string; chapter: string | null; lang: string; publish_at: string }[];
};

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
  | "chapter";

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

export type ContentClient = {
  latest(signal?: AbortSignal): Promise<LatestMangaDto[]>;
  popular(signal?: AbortSignal): Promise<MangaSummaryDto[]>;
  manga(id: string, signal?: AbortSignal): Promise<MangaSummaryDto>;
  chapters(id: string, signal?: AbortSignal): Promise<{ vi: ChapterDto[]; en: ChapterDto[] }>;
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
    manga: (id, signal) => get<MangaSummaryDto>(contentPath("manga", id), signal),
    chapters: (id, signal) => get<{ vi: ChapterDto[]; en: ChapterDto[] }>(
      contentPath("manga", id, "chapters"),
      signal,
    ),
    pages: (chapterId, signal) => get<PagesResponse>(
      contentPath("chapter", chapterId, "pages"),
      signal,
    ),
  };
}
