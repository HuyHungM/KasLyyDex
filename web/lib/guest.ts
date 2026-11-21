// Guest state at one boundary: accepts the old Next camelCase entries and the
// Leptos snake_case entries, writes one canonical shape, and never throws when
// storage is full, corrupt or unavailable.

export const KEYS = {
  history: "truyenviet:history",
  library: "truyenviet:library",
  reader: "truyenviet:reader",
  theme: "truyenviet:theme",
} as const;

export const STORAGE_EVENT = "kaslyydex:guest-change";

export type GuestHistory = {
  mangaId: string;
  mangaTitle: string;
  chapterId: string;
  chapter: string | null;
  title: string;
  coverFile: string | null;
  lang: string;
  ts: number;
  page: number | null;
  total: number | null;
};

export type GuestLibraryEntry = {
  mangaId: string;
  title: string;
  coverFile: string | null;
  lang: string;
  followedAt: number;
  lastChapterId: string | null;
  lastReadPublish: number;
};

export type ReaderSettings = {
  mode: "vertical" | "horizontal";
  fit: boolean;
  bg: "auto" | "light" | "sepia" | "dark";
  speed: number;
};

export const DEFAULT_SETTINGS: ReaderSettings = {
  mode: "vertical",
  fit: true,
  bg: "auto",
  speed: 3,
};

type Loose = Record<string, unknown>;

function obj(value: unknown): Loose {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Loose) : {};
}

function pick(source: Loose, camel: string, snake: string): unknown {
  return source[camel] ?? source[snake];
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function number(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function positive(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

function store(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    const candidate = globalThis.localStorage;
    return candidate ?? null;
  } catch {
    return null;
  }
}

function readRaw(key: string): string | null {
  try {
    return store()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeRaw(key: string, value: string): void {
  try {
    store()?.setItem(key, value);
    if (typeof globalThis.dispatchEvent === "function") {
      globalThis.dispatchEvent(new Event(STORAGE_EVENT));
    }
  } catch {
    // Storage is a nice-to-have: never block reading or navigation.
  }
}

function parseList(raw: string | null): Loose[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(obj) : [];
  } catch {
    return [];
  }
}

export function normalizeHistoryEntry(value: unknown): GuestHistory | null {
  const raw = obj(value);
  const mangaId = text(pick(raw, "mangaId", "manga_id"));
  const chapterId = text(pick(raw, "chapterId", "chapter_id"));
  if (!mangaId || !chapterId) return null;
  return {
    mangaId,
    mangaTitle: text(pick(raw, "mangaTitle", "manga_title")) || mangaId,
    chapterId,
    chapter: nullableText(raw.chapter),
    title: text(raw.title) || text(pick(raw, "chapterTitle", "chapter_title")),
    coverFile: nullableText(pick(raw, "coverFile", "cover_file")),
    lang: text(raw.lang) || "vi",
    ts: number(raw.ts, Date.now()),
    page: positive(pick(raw, "page", "page")),
    total: positive(raw.total),
  };
}

let historyCache = { raw: "", value: [] as GuestHistory[] };

export function getHistory(): GuestHistory[] {
  const raw = readRaw(KEYS.history) ?? "";
  if (raw !== historyCache.raw) {
    const entries = parseList(raw || null)
      .map(normalizeHistoryEntry)
      .filter((entry): entry is GuestHistory => entry !== null);
    entries.sort((a, b) => b.ts - a.ts);
    historyCache = { raw, value: entries.slice(0, 30) };
  }
  return historyCache.value;
}

export function getHistoryFor(mangaId: string): GuestHistory | null {
  return getHistory().find((entry) => entry.mangaId === mangaId) ?? null;
}

export type HistoryInput = Omit<GuestHistory, "ts" | "page" | "total">;

export function pushHistory(input: HistoryInput): void {
  const previous = getHistoryFor(input.mangaId);
  const page = previous?.chapterId === input.chapterId ? previous.page : null;
  const total = previous?.chapterId === input.chapterId ? previous.total : null;
  const next = [
    { ...input, ts: Date.now(), page, total },
    ...getHistory().filter((entry) => entry.mangaId !== input.mangaId),
  ].slice(0, 30);
  writeRaw(KEYS.history, JSON.stringify(next));
}

/// Chapter-local restoration: only a matching chapterId and a valid page within
/// the current page count may restore a position.
export function restoredPage(history: GuestHistory | null, chapterId: string, totalPages: number): number {
  if (!history || history.chapterId !== chapterId || totalPages <= 0) return 0;
  const page = history.page;
  if (page === null || page < 1 || page > totalPages) return 0;
  return page - 1;
}

export function saveProgress(chapterId: string, page: number, total: number): void {
  if (total <= 0) return;
  const current = getHistory();
  const target = current.find((entry) => entry.chapterId === chapterId);
  if (!target || target.page === page && target.total === total) return;
  const next = current.map((entry) =>
    entry.chapterId === chapterId ? { ...entry, page, total } : entry,
  );
  writeRaw(KEYS.history, JSON.stringify(next));
}

export function normalizeLibraryEntry(value: unknown): GuestLibraryEntry | null {
  const raw = obj(value);
  const mangaId = text(pick(raw, "mangaId", "manga_id"));
  if (!mangaId) return null;
  return {
    mangaId,
    title: text(raw.title) || mangaId,
    coverFile: nullableText(pick(raw, "coverFile", "cover_file")),
    lang: text(raw.lang) || "vi",
    followedAt: number(pick(raw, "followedAt", "followed_at"), Date.now()),
    lastChapterId: nullableText(pick(raw, "lastChapterId", "last_chapter_id")),
    lastReadPublish: number(pick(raw, "lastReadPublish", "last_read_publish")),
  };
}

let libraryCache = { raw: "", value: [] as GuestLibraryEntry[] };

export function getLibrary(): GuestLibraryEntry[] {
  const raw = readRaw(KEYS.library) ?? "";
  if (raw !== libraryCache.raw) {
    const entries = parseList(raw || null)
      .map(normalizeLibraryEntry)
      .filter((entry): entry is GuestLibraryEntry => entry !== null);
    libraryCache = { raw, value: entries.slice(0, 200) };
  }
  return libraryCache.value;
}

export function toggleLibrary(entry: Omit<GuestLibraryEntry, "followedAt" | "lastChapterId" | "lastReadPublish">): boolean {
  const current = getLibrary();
  const exists = current.some((item) => item.mangaId === entry.mangaId);
  const next = exists
    ? current.filter((item) => item.mangaId !== entry.mangaId)
    : [{ ...entry, followedAt: Date.now(), lastChapterId: null, lastReadPublish: 0 }, ...current];
  writeRaw(KEYS.library, JSON.stringify(next.slice(0, 200)));
  return !exists;
}

export function setLibraryLast(mangaId: string, chapterId: string, publishMs: number): void {
  const next = getLibrary().map((entry) => {
    if (entry.mangaId !== mangaId || !chapterId || entry.lastChapterId === chapterId) return entry;
    return { ...entry, lastChapterId: chapterId, lastReadPublish: publishMs };
  });
  writeRaw(KEYS.library, JSON.stringify(next));
}

export function normalizeSettings(value: unknown): ReaderSettings {
  const raw = obj(value);
  const mode = text(pick(raw, "mode", "mode"));
  const bg = text(raw.bg);
  const parsedSpeed = number(raw.speed, DEFAULT_SETTINGS.speed);
  const speed = parsedSpeed >= 1 && parsedSpeed <= 5
    ? Math.round(parsedSpeed)
    : DEFAULT_SETTINGS.speed;
  return {
    mode: mode === "horizontal" ? "horizontal" : "vertical",
    fit: typeof raw.fit === "boolean" ? raw.fit : DEFAULT_SETTINGS.fit,
    bg: bg === "auto" || bg === "light" || bg === "sepia" || bg === "dark" ? bg : DEFAULT_SETTINGS.bg,
    speed,
  };
}

let settingsCache = { raw: "", value: DEFAULT_SETTINGS };

export function getSettings(): ReaderSettings {
  const raw = readRaw(KEYS.reader) ?? "";
  if (raw !== settingsCache.raw) {
    let parsed: unknown = null;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = null;
    }
    settingsCache = { raw, value: normalizeSettings(parsed) };
  }
  return settingsCache.value;
}

export function saveSettings(settings: ReaderSettings): void {
  writeRaw(KEYS.reader, JSON.stringify(normalizeSettings(settings)));
}

export function getTheme(): "dark" | "light" {
  return readRaw(KEYS.theme) === "light" ? "light" : "dark";
}

export function saveTheme(theme: "dark" | "light"): void {
  writeRaw(KEYS.theme, theme);
}

export function subscribe(listener: () => void): () => void {
  if (typeof globalThis.addEventListener === "function") {
    globalThis.addEventListener(STORAGE_EVENT, listener);
  }
  if (typeof window !== "undefined") window.addEventListener("storage", listener);
  return () => {
    if (typeof globalThis.removeEventListener === "function") {
      globalThis.removeEventListener(STORAGE_EVENT, listener);
    }
    if (typeof window !== "undefined") window.removeEventListener("storage", listener);
  };
}
