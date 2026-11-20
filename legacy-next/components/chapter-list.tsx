"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { chapterLabel, type Chapter } from "@/lib/types";
import { getHistoryFor } from "@/lib/history";

type Props = {
  mangaId: string;
  chapters: { vi: Chapter[]; en: Chapter[] };
};

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("vi-VN");
}

export default function ChapterList({ mangaId, chapters }: Props) {
  const langs = useMemo(
    () => (["vi", "en"] as const).filter((l) => chapters[l].length > 0),
    [chapters],
  );
  const [lang, setLang] = useState<string>(langs[0] || "vi");
  const [lastRead, setLastRead] = useState<string | null>(null);

  useEffect(() => {
    const h = getHistoryFor(mangaId);
    if (h) setLastRead(h.chapter);
  }, [mangaId]);

  const list = useMemo(
    () => [...(chapters[lang as "vi" | "en"] || [])].reverse(), // newest first
    [chapters, lang],
  );

  if (langs.length === 0) {
    return <p className="py-6 text-muted">Truyện chưa có chapter dịch tiếng Việt hoặc tiếng Anh.</p>;
  }

  return (
    <div>
      {langs.length > 1 && (
        <div className="mb-4 flex gap-2">
          {langs.map((l) => (
            <button
              key={l}
              onClick={() => setLang(l)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                lang === l
                  ? "bg-vermillion text-white"
                  : "bg-panel text-muted ring-1 ring-line hover:text-paper"
              }`}
            >
              {l === "vi" ? "Tiếng Việt" : "English"}
            </button>
          ))}
        </div>
      )}
      <ul className="divide-y divide-line overflow-hidden rounded-lg ring-1 ring-line">
        {list.map((c) => {
          const read =
            lastRead !== null && c.chapter !== null && Number(c.chapter) <= Number(lastRead);
          const href = `/read/${c.id}?manga=${mangaId}&lang=${lang}`;
          return (
            <li key={c.id} className="bg-panel transition hover:bg-panel-2">
              {c.externalUrl ? (
                <a
                  href={c.externalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-baseline gap-3 px-4 py-2.5 text-sm"
                >
                  <span className="w-20 shrink-0 font-semibold text-muted">{chapterLabel(c)}</span>
                  <span className="min-w-0 flex-1 truncate text-muted">
                    {c.title || "Đọc tại nguồn ngoài"} ↗
                  </span>
                  <span className="hidden shrink-0 text-xs text-muted sm:block">{fmtDate(c.publishAt)}</span>
                </a>
              ) : (
                <Link href={href} className="flex items-baseline gap-3 px-4 py-2.5 text-sm">
                  <span className={`w-20 shrink-0 font-semibold ${read ? "text-muted" : "text-vermillion"}`}>
                    {chapterLabel(c)} {read && "✓"}
                  </span>
                  <span className={`min-w-0 flex-1 truncate ${read ? "text-muted" : "text-paper"}`}>
                    {c.title || c.group || "—"}
                  </span>
                  <span className="hidden shrink-0 text-xs text-muted sm:block">{fmtDate(c.publishAt)}</span>
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}