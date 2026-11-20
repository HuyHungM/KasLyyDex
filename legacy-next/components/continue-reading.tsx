/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getHistory, type HistoryEntry } from "@/lib/history";
import { imgProxy } from "@/lib/types";
import { SectionTitle } from "./manga-card";

export default function ContinueReading() {
  const [list, setList] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    setList(getHistory().slice(0, 6));
  }, []);

  if (list.length === 0) return null;

  return (
    <section className="mb-10">
      <SectionTitle>Đọc tiếp</SectionTitle>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {list.map((h) => {
          const cover = h.coverFile
            ? `https://uploads.mangadex.org/covers/${h.mangaId}/${h.coverFile}.256.jpg`
            : null;
          return (
            <Link
              key={h.mangaId}
              href={`/read/${h.chapterId}?manga=${h.mangaId}&lang=${h.lang}`}
              className="group flex gap-3 rounded-lg bg-panel p-2 ring-1 ring-line transition hover:ring-vermillion/60"
            >
              <div className="relative h-20 w-14 shrink-0 overflow-hidden rounded bg-panel-2">
                {cover && (
                  <img src={imgProxy(cover)} alt={h.mangaTitle} loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
                )}
              </div>
              <div className="min-w-0 py-0.5">
                <p className="line-clamp-2 text-sm font-medium text-paper group-hover:text-vermillion">
                  {h.mangaTitle}
                </p>
                <p className="mt-1 text-xs text-muted">
                  Đọc tiếp · {h.chapter ? `Ch. ${h.chapter}` : "Oneshot"}
                </p>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}