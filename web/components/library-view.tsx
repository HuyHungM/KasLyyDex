"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { coverImageUrl } from "@/lib/contracts";
import { getLibrary, subscribe, toggleLibrary, type GuestLibraryEntry } from "@/lib/guest";

const EMPTY: GuestLibraryEntry[] = [];

export default function LibraryView() {
  const library = useSyncExternalStore(subscribe, getLibrary, () => EMPTY);

  if (library.length === 0) {
    return (
      <div className="surface empty">
        <h2>Tủ truyện còn trống</h2>
        <p>Thêm truyện từ trang chi tiết để theo dõi chương mới và đọc tiếp tại đây.</p>
        <Link href="/" className="btn btn-primary">Khám phá truyện</Link>
      </div>
    );
  }

  return (
    <div className="shelf-grid">
      {library.map((entry) => (
        <div key={entry.mangaId} className="surface shelf-card">
          <Link href={`/manga/${encodeURIComponent(entry.mangaId)}`} className="shelf-story">
            <div className="card-cover">
              {entry.coverFile ? (
                <img src={coverImageUrl({ id: entry.mangaId, cover_file: entry.coverFile }) ?? ""} alt="" loading="lazy" />
              ) : (
                <div className="no-cover" aria-hidden="true">Chưa có bìa</div>
              )}
            </div>
            <div>
              <strong>{entry.title}</strong>
              <p className="cc-ch">
                {entry.lastChapterId ? `Chương mới: ${entry.lastChapterId}` : "Chưa đọc"}
              </p>
            </div>
          </Link>
          <div className="actions">
            <button
              type="button"
              className="btn"
              onClick={() => toggleLibrary({ mangaId: entry.mangaId, title: entry.title, coverFile: entry.coverFile, lang: entry.lang })}
            >
              Bỏ theo dõi
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
