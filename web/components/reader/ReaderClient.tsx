"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReaderWasm } from "@/generated/reader-wasm";
import type { ChapterDto, MangaSummaryDto } from "@/lib/contracts";
import {
  DEFAULT_SETTINGS, getHistoryFor, normalizeSettings, pushHistory, restoredPage,
  saveProgress, saveSettings, setLibraryLast, type ReaderSettings,
} from "@/lib/guest";
import ReaderPages from "./ReaderPages";
import ReaderToolbar from "./ReaderToolbar";

type Props = {
  manga: MangaSummaryDto;
  chapter: ChapterDto;
  chapters: ChapterDto[];
  lang: string;
  pages: string[];
  pageError: string | null;
};

export default function ReaderClient({ manga, chapter, chapters, lang, pages, pageError }: Props) {
  const router = useRouter();
  const root = useRef<HTMLDivElement>(null);
  const wasm = useRef<ReaderWasm | null>(null);
  const ready = useRef(false);
  const savedChapter = useRef("");
  const prefetched = useRef("");
  const settleUntil = useRef(0);

  const [page, setPage] = useState(0);
  const [progress, setProgress] = useState(0);
  const [settings, setSettings] = useState<ReaderSettings>(DEFAULT_SETTINGS);
  const [wasmError, setWasmError] = useState<string | null>(null);
  const [wasmAttempt, setWasmAttempt] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [running, setRunning] = useState(false);

  const total = pages.length;
  const index = chapters.findIndex((item) => item.id === chapter.id);
  const prev = index > 0 ? chapters[index - 1] : null;
  const next = index >= 0 && index < chapters.length - 1 ? chapters[index + 1] : null;
  const hrefFor = useCallback(
    (target: ChapterDto) => `/read/${target.id}?manga=${encodeURIComponent(manga.id)}&lang=${lang}`,
    [manga.id, lang],
  );

  /// Mirror Rust state into React only after calling the actual WASM methods.
  const syncFromWasm = useCallback(() => {
    const state = wasm.current;
    if (!state) return;
    setPage(state.pageIndex());
    setProgress(state.progressPercent());
    let json: ReaderSettings | null = null;
    try {
      json = normalizeSettings(JSON.parse(state.settingsJson()));
    } catch {
      json = null;
    }
    if (json) setSettings(json);
    ready.current = true;
    setLoaded(true);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { loadReaderWasm } = await import("@/generated/reader-wasm");
        const { ReaderWasm: Wasm } = await loadReaderWasm();
        if (!alive || total === 0) return;
        setLoaded(false);
        const state = new Wasm(total);
        const restored = restoredPage(getHistoryFor(manga.id), chapter.id, total);
        if (restored > 0) {
          state.setPage(restored);
          // Browser scroll restoration can briefly report an older page to the
          // observer; let the explicit restoration win until the scroll settles.
          settleUntil.current = Date.now() + 800;
        }
        wasm.current = state;
        syncFromWasm();
      } catch (error) {
        if (!alive) return;
        wasm.current = null;
        ready.current = false;
        setLoaded(false);
        setWasmError((error as Error)?.message || "Không tải được trình đọc WASM.");
      }
    })();
    return () => {
      alive = false;
      wasm.current = null;
      ready.current = false;
    };
  }, [wasmAttempt, total, manga.id, chapter.id, syncFromWasm]);

  useEffect(() => {
    const key = `${chapter.id}|${lang}`;
    if (savedChapter.current === key) return;
    savedChapter.current = key;
    pushHistory({
      mangaId: manga.id,
      mangaTitle: manga.title,
      chapterId: chapter.id,
      chapter: chapter.chapter,
      title: chapter.title,
      coverFile: manga.cover_file,
      lang,
    });
    setLibraryLast(manga.id, chapter.id, Date.parse(chapter.publish_at) || 0);
  }, [chapter, manga, lang]);

  useEffect(() => {
    if (!ready.current || total === 0) return;
    saveProgress(chapter.id, page + 1, total);
  }, [page, total, chapter.id]);

  useEffect(() => {
    if (!next || prefetched.current === next.id) return;
    prefetched.current = next.id;
    void fetch(`/api/content/chapter/${encodeURIComponent(next.id)}/pages`, { cache: "force-cache" })
      .catch(() => undefined);
  }, [next]);

  const goPage = useCallback((index: number) => {
    const state = wasm.current;
    if (!state || index === state.pageIndex()) return;
    try {
      state.setPage(index);
    } catch {
      return; // Rust enforces the boundary; ignore out-of-range input.
    }
    syncFromWasm();
  }, [syncFromWasm]);

  const onObservedPage = useCallback((index: number) => {
    if (Date.now() < settleUntil.current) return;
    goPage(index);
  }, [goPage]);

  const turn = useCallback((direction: -1 | 1) => {
    const state = wasm.current;
    if (!state) return;
    if (direction === 1) state.nextPage();
    else state.previousPage();
    syncFromWasm();
  }, [syncFromWasm]);

  const changeSettings = useCallback((patch: Partial<ReaderSettings>) => {
    const state = wasm.current;
    if (!state) return;
    try {
      if (patch.mode) state.setMode(patch.mode);
      if (patch.bg) state.setBackground(patch.bg);
      if (typeof patch.fit === "boolean") state.setFit(patch.fit);
      if (patch.speed) state.setSpeed(patch.speed);
    } catch {
      return;
    }
    syncFromWasm();
    try {
      saveSettings(normalizeSettings(JSON.parse(state.settingsJson())));
    } catch {
      // Settings are cosmetic; a corrupt snapshot must not stop reading.
    }
  }, [syncFromWasm]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.defaultPrevented) return;
      const element = event.target instanceof Element ? event.target : null;
      if (element?.closest("input, select, textarea, button, [contenteditable]")) return;
      const direction: -1 | 1 | null = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : null;
      if (!direction) return;
      event.preventDefault();
      setRunning(false);
      if (settings.mode === "horizontal") turn(direction);
      else {
        const target = direction < 0 ? prev : next;
        if (target) router.push(hrefFor(target));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [settings.mode, turn, prev, next, router, hrefFor]);

  useEffect(() => {
    if (!running || settings.mode !== "vertical") return;
    let frame = 0;
    let last = 0;
    let carry = 0;
    const step = (now: number) => {
      if (last) {
        const distance = carry + Math.min(50, now - last) * settings.speed * 28 / 1000;
        const pixels = Math.floor(distance);
        carry = distance - pixels;
        if (pixels > 0) {
          const fullscreen = document.fullscreenElement as HTMLElement | null;
          const top = fullscreen ? fullscreen.scrollTop : window.scrollY;
          if (fullscreen) fullscreen.scrollTop = top + pixels;
          else window.scrollBy(0, pixels);
          const moved = fullscreen ? fullscreen.scrollTop > top : window.scrollY > top;
          if (!moved) {
            setRunning(false);
            return;
          }
        }
      }
      last = now;
      frame = window.requestAnimationFrame(step);
    };
    frame = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(frame);
  }, [running, settings.mode, settings.speed]);

  const external = Boolean(chapter.external_url);
  const showRetry = wasmError !== null || pageError !== null;

  return (
    <div
      className="reader"
      data-bg={settings.bg}
      ref={root}
      onWheel={() => setRunning(false)}
    >
      <ReaderToolbar
        mangaId={manga.id}
        mangaTitle={manga.title}
        chapterId={chapter.id}
        chapters={chapters}
        settings={settings}
        running={running}
        onSettings={changeSettings}
        onPause={() => setRunning(false)}
        onToggleRun={() => setRunning((value) => !value)}
        onFullscreen={() => {
          if (document.fullscreenElement) void document.exitFullscreen();
          else void root.current?.requestFullscreen();
        }}
        onSelectChapter={(id) => {
          const target = chapters.find((item) => item.id === id);
          if (target) router.push(hrefFor(target));
        }}
      />
      <main className={`reader-main${settings.fit ? "" : " full-width"}`} onPointerDown={() => setRunning(false)}>
        {external ? (
          <div className="panel">
            <p>Chương này được đăng ở nguồn ngoài (không có ảnh trên MangaDex).</p>
            <a className="text-link" href={chapter.external_url ?? "#"} target="_blank" rel="noopener noreferrer">Đọc tại nguồn ↗</a>
          </div>
        ) : showRetry ? (
          <div className="panel" role="alert">
            <p>{wasmError ?? pageError}</p>
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                if (wasmError) {
                  setWasmError(null);
                  wasm.current = null;
                  setWasmAttempt((attempt) => attempt + 1);
                } else {
                  router.refresh();
                }
              }}
            >
              Thử lại
            </button>
          </div>
        ) : total === 0 ? (
          <div className="panel">Chương này chưa có ảnh.</div>
        ) : !loaded ? (
          <div className="reader-loading" role="status" aria-label="Đang khởi tạo trình đọc">Đang mở trình đọc…</div>
        ) : (
          <ReaderPages
            pages={pages}
            settings={settings}
            page={page}
            onPage={onObservedPage}
            onTurn={turn}
            onPause={() => setRunning(false)}
          />
        )}
      </main>
      <nav className="reader-bottom" aria-label="Điều hướng chương">
        <div className="reader-nav">
          {prev ? (
            <Link href={hrefFor(prev)} className="nav-btn">← Chương trước</Link>
          ) : (
            <span className="nav-btn disabled" aria-disabled="true">← Chương trước</span>
          )}
          <span className="reader-page-count">
            {total > 0 ? `Trang ${page + 1}/${total} · ${progress}%` : "Trang —"}
          </span>
          {next ? (
            <Link href={hrefFor(next)} className="nav-btn primary">Chương sau →</Link>
          ) : (
            <span className="nav-btn disabled" aria-disabled="true">Chương sau →</span>
          )}
        </div>
      </nav>
    </div>
  );
}
