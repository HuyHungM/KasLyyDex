"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getHistoryFor } from "@/lib/history";

type Props = {
  mangaId: string;
  lang: string;
  firstChapterId: string | null;
  firstChapterLabel: string;
  hasExternal?: boolean;
};

export default function MangaActions({ mangaId, lang, firstChapterId, firstChapterLabel, hasExternal }: Props) {
  const [resume, setResume] = useState<{ chapterId: string; chapter: string | null; lang: string } | null>(null);

  useEffect(() => {
    const h = getHistoryFor(mangaId);
    if (h) setResume({ chapterId: h.chapterId, chapter: h.chapter, lang: h.lang });
  }, [mangaId]);

  return (
    <div className="flex flex-wrap gap-3">
      {firstChapterId ? (
        <Link
          href={`/read/${firstChapterId}?manga=${mangaId}&lang=${lang}`}
          className="rounded-full bg-vermillion px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-vermillion-dark"
        >
          Đọc từ đầu · {firstChapterLabel}
        </Link>
      ) : (
        <span className="rounded-full bg-panel px-6 py-2.5 text-sm text-muted">
          {hasExternal ? "Chapter chỉ có ở nguồn ngoài" : "Chưa có chapter"}
        </span>
      )}
      {resume && (
        <Link
          href={`/read/${resume.chapterId}?manga=${mangaId}&lang=${resume.lang}`}
          className="rounded-full border border-line bg-panel px-6 py-2.5 text-sm font-medium text-paper transition hover:border-vermillion"
        >
          Đọc tiếp · {resume.chapter ? `Ch. ${resume.chapter}` : "Oneshot"}
        </Link>
      )}
    </div>
  );
}