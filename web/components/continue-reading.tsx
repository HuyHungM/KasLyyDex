"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { coverImageUrl, type ProgressEntryDto } from "@/lib/contracts";
import { chapterLabel } from "@/lib/format";
import { getHistory, subscribe, type GuestHistory } from "@/lib/guest";
import { SectionTitle } from "@/components/manga-card";
import { useAccountSession, useRemoteResource } from "@/lib/account/client";

const EMPTY: GuestHistory[] = [];

function Card({ to, mangaId, title, chapter, cover, page, total }: {
  to: string;
  mangaId: string;
  title: string;
  chapter: string | null;
  cover: string | null;
  page: number | null;
  total: number | null;
}) {
  return (
    <Link href={to} className="continue-card">
      <div className="continue-cover">
        {cover ? <img src={coverImageUrl({ id: mangaId, cover_file: cover }, 256) ?? ""} alt="" loading="lazy" decoding="async" /> : null}
      </div>
      <div className="continue-meta">
        <p className="cc-title">{title}</p>
        <p className="cc-ch">{chapterLabel(chapter)}</p>
        {total && total > 0 ? <progress aria-label="Tiến độ đọc chương" max={total} value={page ?? 1} /> : null}
      </div>
    </Link>
  );
}

export default function ContinueReading() {
  const history = useSyncExternalStore(subscribe, getHistory, () => EMPTY);
  const { session } = useAccountSession();
  const remote = useRemoteResource<{ items: ProgressEntryDto[] }>(
    session.status === "authenticated" ? "/api/v1/me/progress" : null,
  );

  if (session.status !== "authenticated") {
    if (history.length === 0) return null;
    return (
      <section className="section">
        <SectionTitle>Đọc tiếp</SectionTitle>
        <div className="continue-grid">
          {history.slice(0, 6).map((entry) => (
            <Card
              key={entry.mangaId}
              to={`/read/${encodeURIComponent(entry.chapterId)}?manga=${encodeURIComponent(entry.mangaId)}&lang=${encodeURIComponent(entry.lang)}`}
              mangaId={entry.mangaId}
              title={entry.mangaTitle}
              chapter={entry.chapter}
              cover={entry.coverFile}
              page={entry.page}
              total={entry.total}
            />
          ))}
        </div>
      </section>
    );
  }

  const items = (remote.data?.items ?? []).slice(0, 6);
  if (items.length === 0) return null;
  return (
    <section className="section">
      <SectionTitle>Đọc tiếp · đã đồng bộ</SectionTitle>
      <div className="continue-grid">
        {items.map((entry) => (
          <Card
            key={`${entry.mangaId}:${entry.chapterId}:${entry.lang}`}
            to={`/read/${encodeURIComponent(entry.chapterId)}?manga=${encodeURIComponent(entry.mangaId)}&lang=${encodeURIComponent(entry.lang)}`}
            mangaId={entry.mangaId}
            title={entry.title ?? entry.mangaId}
            chapter={entry.chapter}
            cover={entry.coverFile}
            page={entry.page}
            total={entry.total}
          />
        ))}
      </div>
    </section>
  );
}
