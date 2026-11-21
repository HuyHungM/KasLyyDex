"use client";

import Link from "next/link";
import type { ChapterDto } from "@/lib/contracts";
import { chapterLabel } from "@/lib/format";
import type { ReaderSettings } from "@/lib/guest";

type Props = {
  mangaId: string;
  mangaTitle: string;
  chapterId: string;
  chapters: ChapterDto[];
  settings: ReaderSettings;
  running: boolean;
  onSettings: (patch: Partial<ReaderSettings>) => void;
  onPause: () => void;
  onToggleRun: () => void;
  onFullscreen: () => void;
  onSelectChapter: (id: string) => void;
  fullscreenSupported: boolean;
};

export default function ReaderToolbar({
  mangaId, mangaTitle, chapterId, chapters, settings, running,
  onSettings, onPause, onToggleRun, onFullscreen, onSelectChapter, fullscreenSupported,
}: Props) {
  return (
    <header className="reader-bar">
      <div className="reader-bar-inner">
        <Link href={`/manga/${mangaId}`} className="back-link">← {mangaTitle}</Link>
        <select
          className="chapter-select"
          aria-label="Chọn chương"
          value={chapterId}
          onChange={(event) => onSelectChapter(event.target.value)}
        >
          {chapters.map((chapter) => (
            <option key={chapter.id} value={chapter.id}>{chapterLabel(chapter.chapter)}</option>
          ))}
        </select>
        <details className="reader-settings">
          <summary>Cài đặt</summary>
          <div className="reader-settings-panel">
            <label>Chế độ đọc
              <select
                value={settings.mode}
                onChange={(event) => {
                  onPause();
                  onSettings({ mode: event.target.value === "horizontal" ? "horizontal" : "vertical" });
                }}
              >
                <option value="vertical">Cuộn dọc</option>
                <option value="horizontal">Lật ngang</option>
              </select>
            </label>
            <label>Nền đọc
              <select value={settings.bg} onChange={(event) => onSettings({ bg: event.target.value as ReaderSettings["bg"] })}>
                <option value="light">Sáng</option>
                <option value="sepia">Giấy ấm</option>
                <option value="dark">Tối</option>
              </select>
            </label>
            <button
              type="button"
              className="btn"
              aria-pressed={!settings.fit}
              onClick={() => onSettings({ fit: !settings.fit })}
            >
              Chiều rộng: {settings.fit ? "Vừa khung" : "Tràn màn hình"}
            </button>
            {settings.mode === "vertical" && (
              <>
                <label>Tốc độ tự cuộn
                  <select value={settings.speed} onChange={(event) => onSettings({ speed: Number(event.target.value) })}>
                    {[1, 2, 3, 4, 5].map((speed) => <option key={speed} value={speed}>{speed}</option>)}
                  </select>
                </label>
                <button type="button" className="btn btn-primary" aria-pressed={running} onClick={onToggleRun}>
                  {running ? "Dừng tự cuộn" : "Bật tự cuộn"}
                </button>
              </>
            )}
          </div>
        </details>
        {fullscreenSupported && (
          <button className="icon-btn" type="button" aria-label="Đổi chế độ toàn màn hình" onClick={onFullscreen}>
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M8 4H4v4m12-4h4v4m0 8v4h-4m-8 0H4v-4" />
            </svg>
          </button>
        )}
      </div>
    </header>
  );
}
