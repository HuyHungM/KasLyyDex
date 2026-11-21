"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { coverImageUrl } from "@/lib/contracts";
import { chapterLabel } from "@/lib/format";
import { getHistory, subscribe, type GuestHistory } from "@/lib/guest";
import { SectionTitle } from "@/components/manga-card";

const EMPTY: GuestHistory[] = [];

export default function ContinueReading() {
  // useSyncExternalStore reads localStorage during hydration without a
  // setState-in-effect (and without a hydration mismatch).
  const list = useSyncExternalStore(subscribe, getHistory, () => EMPTY);
  if (list.length === 0) return null;

  return (
    <section className="section">
      <SectionTitle>Đọc tiếp</SectionTitle>
      <div className="continue-grid">
        {list.slice(0, 6).map((entry) => (
          <Link
            key={entry.mangaId}
            href={`/read/${entry.chapterId}?manga=${encodeURIComponent(entry.mangaId)}&lang=${entry.lang}`}
            className="continue-card"
          >
            <div className="continue-cover">
              {entry.coverFile && (
                <img
                  src={coverImageUrl({ id: entry.mangaId, cover_file: entry.coverFile }, 256) ?? ""}
                  alt=""
                  loading="lazy"
                  decoding="async"
                />
              )}
            </div>
            <div className="continue-meta">
              <p className="cc-title">{entry.mangaTitle}</p>
              <p className="cc-ch">{chapterLabel(entry.chapter)}</p>
              {entry.total && entry.total > 0 ? (
                <progress aria-label="Tiến độ đọc chương" max={entry.total} value={entry.page ?? 1} />
              ) : null}
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
