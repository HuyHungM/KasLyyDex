"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { chapterLabel } from "@/lib/format";
import {
  getHistory, getLibrary, subscribe, toggleLibrary, type GuestHistory, type GuestLibraryEntry,
} from "@/lib/guest";

type Props = {
  mangaId: string;
  title: string;
  coverFile: string | null;
  lang: string;
  firstChapterId: string | null;
  firstChapterLabel: string;
  hasExternal?: boolean;
};

const NO_HISTORY: GuestHistory[] = [];
const NO_LIBRARY: GuestLibraryEntry[] = [];

export default function MangaActions({ mangaId, title, coverFile, lang, firstChapterId, firstChapterLabel, hasExternal }: Props) {
  const history = useSyncExternalStore(subscribe, getHistory, () => NO_HISTORY);
  const library = useSyncExternalStore(subscribe, getLibrary, () => NO_LIBRARY);
  const resume = history.find((entry) => entry.mangaId === mangaId);
  const followed = library.some((entry) => entry.mangaId === mangaId);

  return (
    <div className="actions">
      {firstChapterId ? (
        <Link href={`/read/${firstChapterId}?manga=${encodeURIComponent(mangaId)}&lang=${lang}`} className="btn btn-primary">
          Đọc từ đầu · {firstChapterLabel}
        </Link>
      ) : (
        <span className="btn btn-disabled">{hasExternal ? "Chapter chỉ có ở nguồn ngoài" : "Chưa có chapter"}</span>
      )}
      {resume && (
        <Link href={`/read/${resume.chapterId}?manga=${encodeURIComponent(mangaId)}&lang=${resume.lang}`} className="btn">
          Đọc tiếp · {chapterLabel(resume.chapter)}
        </Link>
      )}
      <button
        type="button"
        className="btn"
        aria-pressed={followed}
        onClick={() => toggleLibrary({ mangaId, title, coverFile, lang })}
      >
        {followed ? "✓ Đang theo dõi" : "+ Thêm vào tủ truyện"}
      </button>
    </div>
  );
}
