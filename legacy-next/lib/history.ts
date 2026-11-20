// Reading history stored in localStorage (client-only).
export type HistoryEntry = {
  mangaId: string;
  mangaTitle: string;
  chapterId: string;
  chapter: string | null;
  title: string;
  coverFile: string | null;
  lang: string;
  ts: number;
};

const KEY = "truyenviet:history";
const MAX = 30;

export function getHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list: HistoryEntry[] = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function getHistoryFor(mangaId: string): HistoryEntry | null {
  return getHistory().find((h) => h.mangaId === mangaId) || null;
}

export function pushHistory(entry: Omit<HistoryEntry, "ts">): void {
  try {
    const list = getHistory().filter((h) => h.mangaId !== entry.mangaId);
    list.unshift({ ...entry, ts: Date.now() });
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    // storage full / disabled — history is a nice-to-have, never block reading
  }
}