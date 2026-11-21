"use client";

import Link from "next/link";
import Select from "@/components/ui/Select";
import { sourceLabel, type ChapterDto } from "@/lib/contracts";
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
  const current = chapters.find((item) => item.id === chapterId);
  const sourceSuffix = current?.source && current.source !== "mangadex" ? ` (${sourceLabel(current.source)})` : "";
  return (
    <header className="reader-bar">
      <div className="reader-bar-inner">
        <Link href={`/manga/${mangaId}`} className="back-link">← {mangaTitle}{sourceSuffix}</Link>
        <Select
          className="chapter-select"
          ariaLabel="Chọn chương"
          value={chapterId}
          options={chapters.map((chapter) => ({ value: chapter.id, label: chapterLabel(chapter.chapter) }))}
          onChange={onSelectChapter}
        />
        <details className="reader-settings">
          <summary>Cài đặt</summary>
          <div className="reader-settings-panel">
            <label>Chế độ đọc
              <Select
                ariaLabel="Chế độ đọc"
                value={settings.mode}
                options={[{ value: "vertical", label: "Cuộn dọc" }, { value: "horizontal", label: "Lật ngang" }]}
                onChange={(value) => {
                  onPause();
                  onSettings({ mode: value === "horizontal" ? "horizontal" : "vertical" });
                }}
              />
            </label>
            <label>Nền đọc
              <Select
                ariaLabel="Nền đọc"
                value={settings.bg}
                options={[
                  { value: "light", label: "Sáng" },
                  { value: "sepia", label: "Giấy ấm" },
                  { value: "dark", label: "Tối" },
                ]}
                onChange={(value) => onSettings({ bg: value as ReaderSettings["bg"] })}
              />
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
                  <Select
                    ariaLabel="Tốc độ tự cuộn"
                    value={String(settings.speed)}
                    options={[1, 2, 3, 4, 5].map((speed) => ({ value: String(speed), label: String(speed) }))}
                    onChange={(value) => onSettings({ speed: Number(value) })}
                  />
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
