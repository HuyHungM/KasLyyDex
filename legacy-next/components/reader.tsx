/* eslint-disable @next/next/no-img-element */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { chapterLabel, imgProxy, type Chapter, type MangaSummary } from "@/lib/types";
import { pushHistory } from "@/lib/history";

type Props = {
  manga: MangaSummary;
  lang: string;
  chapters: Chapter[];
  chapterId: string;
};

export default function Reader({ manga, lang, chapters, chapterId }: Props) {
  const router = useRouter();
  const idx = chapters.findIndex((c) => c.id === chapterId);
  const current = idx >= 0 ? chapters[idx] : null;
  const prev = idx > 0 ? chapters[idx - 1] : null;
  const next = idx >= 0 && idx < chapters.length - 1 ? chapters[idx + 1] : null;

  const [pages, setPages] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pageIdx, setPageIdx] = useState(0);
  const [retry, setRetry] = useState(0);
  const pagesRef = useRef<HTMLDivElement>(null);

  const hrefFor = useCallback(
    (c: Chapter) => `/read/${c.id}?manga=${manga.id}&lang=${lang}`,
    [manga.id, lang],
  );

  // Save reading position for "Đọc tiếp"
  useEffect(() => {
    if (!current) return;
    pushHistory({
      mangaId: manga.id,
      mangaTitle: manga.title,
      chapterId: current.id,
      chapter: current.chapter,
      title: current.title,
      coverFile: manga.coverFile,
      lang,
    });
  }, [current, manga.id, manga.title, manga.coverFile, lang]);

  // Load page images from the at-home server (URLs are short-lived, never cached)
  useEffect(() => {
    window.scrollTo(0, 0);
    setPages(null);
    setError(null);
    setPageIdx(0);
    if (!current || current.externalUrl) return;
    let alive = true;
    fetch(`/api/pages/${current.id}`)
      .then(async (r) => {
        const j: { pages?: string[]; error?: string } = await r.json();
        if (!r.ok || j.error) throw new Error(j.error || `Không tải được ảnh (mã ${r.status}).`);
        if (!j.pages || j.pages.length === 0) throw new Error("Chapter này không có ảnh.");
        return j.pages;
      })
      .then((urls) => alive && setPages(urls))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [current, retry]);

  // Track current page while scrolling
  useEffect(() => {
    if (!pages || !pagesRef.current) return;
    const imgs = pagesRef.current.querySelectorAll("img[data-index]");
    const obs = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (en.isIntersecting) setPageIdx(Number((en.target as HTMLElement).dataset.index));
        }
      },
      { rootMargin: "-45% 0px -45% 0px" },
    );
    imgs.forEach((img) => obs.observe(img));
    return () => obs.disconnect();
  }, [pages]);

  // Arrow keys flip chapters
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" && prev) router.push(hrefFor(prev));
      if (e.key === "ArrowRight" && next) router.push(hrefFor(next));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prev, next, router, hrefFor]);

  const nav = (
    <div className="flex items-center gap-2">
      {prev ? (
        <Link
          href={hrefFor(prev)}
          className="rounded-full bg-panel px-4 py-1.5 text-sm text-paper ring-1 ring-line transition hover:ring-vermillion"
        >
          ← Trước
        </Link>
      ) : (
        <span className="rounded-full bg-panel px-4 py-1.5 text-sm text-muted/50 ring-1 ring-line">← Trước</span>
      )}
      {next ? (
        <Link
          href={hrefFor(next)}
          className="rounded-full bg-vermillion px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-vermillion-dark"
        >
          Sau →
        </Link>
      ) : (
        <span className="rounded-full bg-panel px-4 py-1.5 text-sm text-muted/50 ring-1 ring-line">Sau →</span>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-[#08090c]">
      <div className="sticky top-0 z-40 border-b border-line bg-ink/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
          <Link href={`/manga/${manga.id}`} className="text-sm text-muted transition hover:text-vermillion">
            ← {manga.title}
          </Link>
          <span className="text-sm font-semibold text-paper">
            {current ? chapterLabel(current) : "Chapter"}
            {pages && <span className="ml-2 font-normal text-muted">· Trang {pageIdx + 1}/{pages.length}</span>}
          </span>
          <div className="ml-auto flex items-center gap-2">
            {chapters.length > 0 && (
              <select
                aria-label="Chọn chapter"
                value={chapterId}
                onChange={(e) => {
                  const c = chapters.find((x) => x.id === e.target.value);
                  if (c) router.push(hrefFor(c));
                }}
                className="max-w-40 rounded-full border border-line bg-panel px-3 py-1.5 text-sm text-paper outline-none focus:border-vermillion"
              >
                {chapters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {chapterLabel(c)}
                  </option>
                ))}
              </select>
            )}
            {nav}
          </div>
        </div>
      </div>

      <main className="mx-auto max-w-3xl px-2 py-4">
        {!current && (
          <Panel>
            Không tìm thấy chapter trong danh sách.{" "}
            <Link href={`/manga/${manga.id}`} className="text-vermillion underline">
              Về trang truyện
            </Link>
          </Panel>
        )}
        {current?.externalUrl && (
          <Panel>
            Chapter này được đăng ở nguồn ngoài (không có ảnh trên MangaDex).{" "}
            <a href={current.externalUrl} target="_blank" rel="noopener noreferrer" className="text-vermillion underline">
              Đọc tại nguồn ↗
            </a>
          </Panel>
        )}
        {current && !current.externalUrl && error && (
          <Panel>
            {error}{" "}
            <button onClick={() => setRetry((r) => r + 1)} className="text-vermillion underline">
              Thử lại
            </button>
          </Panel>
        )}
        {current && !current.externalUrl && !error && !pages && (
          <div className="space-y-2 py-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-[70vh] animate-pulse rounded bg-panel" />
            ))}
          </div>
        )}
        {pages && (
          <div ref={pagesRef} className="flex flex-col items-center gap-1">
            {pages.map((src, i) => (
              <img
                key={src}
                src={imgProxy(src)}
                data-index={i}
                alt={`Trang ${i + 1}`}
                loading={i < 2 ? "eager" : "lazy"}
                className="w-full max-w-3xl"
              />
            ))}
          </div>
        )}
        <div className="flex justify-center py-8">{nav}</div>
      </main>
    </div>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-8 rounded-lg bg-panel p-6 text-center text-sm text-paper ring-1 ring-line">
      {children}
    </div>
  );
}