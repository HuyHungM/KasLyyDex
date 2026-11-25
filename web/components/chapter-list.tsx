"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { sourceLabel, type ChaptersResponse, type ChapterDto } from "@/lib/contracts";
import { chapterLabel, fmtDate } from "@/lib/format";
import { getHistory, subscribe, type GuestHistory } from "@/lib/guest";

const NO_HISTORY: GuestHistory[] = [];

const sourceSuffix = (chapter: ChapterDto) =>
  chapter.source && chapter.source !== "mangadex" ? ` (${sourceLabel(chapter.source)})` : "";

export default function ChapterList({ mangaId, chapters }: { mangaId: string; chapters: ChaptersResponse }) {
  const langs = (["vi", "en"] as const).filter((lang) => chapters[lang].length > 0);
  const [lang, setLang] = useState<string>(langs[0] ?? "vi");
  const history = useSyncExternalStore(subscribe, getHistory, () => NO_HISTORY);
  const lastRead = history.find((entry) => entry.mangaId === mangaId)?.chapter ?? null;

  if (langs.length === 0) {
    return <p className="empty">Truyện chưa có chapter dịch tiếng Việt hoặc tiếng Anh.</p>;
  }

  const active = langs.includes(lang as "vi" | "en") ? lang : langs[0];
  const list = [...chapters[active as "vi" | "en"]].reverse();

  return (
    <div>
      {langs.length > 1 && (
        <div className="lang-tabs">
          {langs.map((item) => (
            <button
              key={item}
              type="button"
              className="lang-tab"
              aria-pressed={active === item}
              onClick={() => setLang(item)}
            >
              {item === "vi" ? "Tiếng Việt" : "English"}
            </button>
          ))}
        </div>
      )}
      <ul className="chapter-list">
        {list.map((chapter: ChapterDto) => {
          const read = lastRead !== null && chapter.chapter !== null && Number(chapter.chapter) <= Number(lastRead);
          const href = `/read/${chapter.id}?manga=${encodeURIComponent(mangaId)}&lang=${active}`;
          return (
            <li key={chapter.id}>
              {chapter.external_url ? (
                <a href={chapter.external_url} target="_blank" rel="noopener noreferrer" className="chapter-row">
                  <span className="ch-num">{chapterLabel(chapter.chapter)}</span>
                  <span className="ch-title">{chapter.title || "Đọc tại nguồn ngoài"}{sourceSuffix(chapter)} ↗</span>
                  <span className="ch-date">{fmtDate(chapter.publish_at)}</span>
                </a>
              ) : (
                <Link href={href} className="chapter-row">
                  <span className={`ch-num${read ? " read" : ""}`}>{chapterLabel(chapter.chapter)}{read ? " ✓" : ""}</span>
                  <span className={`ch-title${read ? " read" : ""}`}>{chapter.title || chapter.group || "—"}{sourceSuffix(chapter)}</span>
                  <span className="ch-date">{fmtDate(chapter.publish_at)}</span>
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
