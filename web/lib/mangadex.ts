import { cacheLife } from "next/cache";
import { agent, undiciFetch } from "./http";
import type { Chapter, MangaSummary } from "./types";

const API = "https://api.mangadex.org";
// MangaDex requires an identifying User-Agent for API calls
const UA = "KasLyyDexReader/1.0 (educational demo)";

type RawManga = {
  id: string;
  attributes: {
    title?: Record<string, string>;
    altTitles?: Record<string, string>[];
    description?: Record<string, string>;
    status?: string;
    year?: number | null;
    tags?: { attributes?: { name?: Record<string, string> } }[];
  };
  relationships?: { type: string; attributes?: Record<string, unknown> }[];
};

type RawChapter = {
  id: string;
  attributes: {
    chapter?: string | null;
    volume?: string | null;
    title?: string | null;
    translatedLanguage?: string;
    externalUrl?: string | null;
    isUnavailable?: boolean;
    pages?: number;
    publishAt?: string;
  };
  relationships?: { type: string; attributes?: { name?: string } }[];
};

type FeedResponse = { data: RawChapter[]; total: number };
type ListResponse = { data: RawManga[]; total: number };

async function md<T>(path: string): Promise<T> {
  const res = await undiciFetch(API + path, {
    dispatcher: agent,
    redirect: "error",
    headers: { "User-Agent": UA },
  });
  if (!res.ok) {
    throw new Error(
      res.status === 429
        ? "MangaDex giới hạn truy cập, vui lòng thử lại sau ít giây."
        : `Không gọi được API MangaDex (mã ${res.status}).`,
    );
  }
  return res.json() as Promise<T>;
}

function pickLocalized(map?: Record<string, string>): string {
  if (!map) return "";
  return map.en || map["ja-ro"] || map.vi || map.ja || Object.values(map)[0] || "";
}

function toSummary(m: RawManga): MangaSummary {
  const attrs = m.attributes;
  const cover = (m.relationships || []).find((r) => r.type === "cover_art");
  const names = (m.relationships || [])
    .filter((r) => r.type === "author" || r.type === "artist")
    .map((r) => (r.attributes?.name as string) || "");
  return {
    id: m.id,
    title:
      pickLocalized(attrs.title) ||
      attrs.altTitles?.map((a) => pickLocalized(a)).find(Boolean) ||
      "Không rõ",
    coverFile: (cover?.attributes?.fileName as string) || null,
    status: attrs.status || "",
    year: attrs.year ?? null,
    description: pickLocalized(attrs.description),
    tags: (attrs.tags || []).map((t) => pickLocalized(t.attributes?.name)).filter(Boolean),
    author: names.length > 1 ? names[names.length - 1] : names[0] || "",
    artist: names[0] || "",
  };
}

const LIST_PARAMS =
  "&includes[]=cover_art&includes[]=author&contentRating[]=safe&contentRating[]=suggestive&hasAvailableChapters=true";

export async function getPopular(): Promise<MangaSummary[]> {
  "use cache";
  cacheLife("minutes");
  const j = await md<ListResponse>(`/manga?limit=18&offset=0${LIST_PARAMS}&order[followedCount]=desc`);
  return j.data.map(toSummary);
}

export async function getLatest(): Promise<MangaSummary[]> {
  "use cache";
  cacheLife("minutes");
  // Chapter feed = only manga with real readable pages in vi/en (popular lists
  // include licensed titles whose chapters are external links).
  const feed = await md<{
    data: { attributes: { pages?: number; externalUrl?: string | null }; relationships?: { type: string; id: string }[] }[];
  }>("/chapter?limit=100&order[readableAt]=desc&translatedLanguage[]=vi&translatedLanguage[]=en");
  const ids: string[] = [];
  for (const c of feed.data) {
    if ((c.attributes.pages ?? 0) === 0 || c.attributes.externalUrl) continue;
    const id = c.relationships?.find((r) => r.type === "manga")?.id;
    if (id && !ids.includes(id)) ids.push(id);
    if (ids.length >= 18) break;
  }
  if (ids.length === 0) return [];
  const j = await md<ListResponse>(`/manga?limit=18&includes[]=cover_art&includes[]=author&ids[]=${ids.join("&ids[]=")}`);
  const byId = new Map(j.data.map((m) => [m.id, toSummary(m)]));
  return ids.map((id) => byId.get(id)).filter((m): m is MangaSummary => !!m);
}

export async function searchManga(q: string, page: number): Promise<{ results: MangaSummary[]; total: number }> {
  "use cache";
  cacheLife("minutes");
  const offset = (page - 1) * 24;
  const j = await md<ListResponse>(
    `/manga?limit=24&offset=${offset}&title=${encodeURIComponent(q)}${LIST_PARAMS}`,
  );
  return { results: j.data.map(toSummary), total: j.total };
}

export async function getManga(id: string): Promise<MangaSummary> {
  "use cache";
  cacheLife("hours");
  const j = await md<{ data: RawManga }>(`/manga/${id}?${LIST_PARAMS}`);
  return toSummary(j.data);
}

export async function getChapters(mangaId: string, lang: string): Promise<Chapter[]> {
  "use cache";
  cacheLife("minutes");
  const raw: RawChapter[] = [];
  let offset = 0;
  let total = Infinity;
  // Chapter feeds paginate at 500; cap at 2000 to keep one manga fast
  while (offset < total && offset < 2000) {
    const j = await md<FeedResponse>(
      `/manga/${mangaId}/feed?limit=500&offset=${offset}&translatedLanguage[]=${lang}&order[chapter]=asc&includes[]=scanlation_group`,
    );
    raw.push(...j.data);
    total = j.total;
    offset += 500;
  }
  const seen = new Set<string>();
  const chapters: Chapter[] = [];
  for (const c of raw) {
    const key = String(c.attributes.chapter ?? "oneshot");
    if (seen.has(key)) continue; // first scanlation wins
    seen.add(key);
    const a = c.attributes;
    chapters.push({
      id: c.id,
      chapter: a.chapter ?? null,
      volume: a.volume ?? null,
      title: a.title || "",
      lang: a.translatedLanguage || lang,
      pages: a.pages ?? 0,
      externalUrl: a.externalUrl || null,
      publishAt: a.publishAt || "",
      group: (c.relationships || [])
        .filter((r) => r.type === "scanlation_group")
        .map((r) => r.attributes?.name || "")
        .filter(Boolean)
        .join(", "),
    });
  }
  chapters.sort((a, b) => (parseFloat(a.chapter || "") || 0) - (parseFloat(b.chapter || "") || 0));
  return chapters;
}

// At-home URLs are short-lived: never cache. Called from /api/pages route handler.
export async function getChapterPages(chapterId: string): Promise<string[]> {
  const j = await md<{
    baseUrl: string;
    chapter: { hash: string; data: string[]; dataSaver: string[] };
  }>(`/at-home/server/${chapterId}`);
  const files = j.chapter.data.length > 0 ? j.chapter.data : j.chapter.dataSaver;
  return files.map((f) => `${j.baseUrl}/data/${j.chapter.hash}/${f}`);
}
