"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ReaderWasm } from "@/generated/reader-wasm";
import type { ChapterDto, MangaSummaryDto, ProgressEntryDto } from "@/lib/contracts";
import type { ReaderSettingsDto } from "@/lib/validators";
import { accountGet, accountMutate, useAccountSession } from "@/lib/account/client";
import {
  DEFAULT_SETTINGS, getHistoryFor, getSettings, normalizeSettings, pushHistory, restoredPage,
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

// One cached import; repeated retries re-instantiate Rust state but never
// re-import the glue or leak an earlier ReaderWasm.
let wasmModulePromise: Promise<typeof import("@/generated/reader-wasm")> | null = null;
function wasmModule() {
  return (wasmModulePromise ??= import("@/generated/reader-wasm"));
}

const noopSubscribe = () => () => {};

/// Each chapter gets a fresh keyed session: no page/settings/error/loaded state
/// survives a client-side chapter navigation, including equal page counts.
export default function ReaderClient(props: Props) {
  return <ReaderSession key={props.chapter.id} {...props} />;
}

function ReaderSession({ manga, chapter, chapters, lang, pages, pageError }: Props) {
  const router = useRouter();
  const root = useRef<HTMLDivElement>(null);
  const pagesContainer = useRef<HTMLDivElement>(null);
  const wasm = useRef<ReaderWasm | null>(null);
  const savedChapter = useRef("");
  const prefetched = useRef("");
  const settledRemote = useRef("");
  const settleUntil = useRef(0);
  const { session } = useAccountSession();

  const [page, setPage] = useState(0);
  const [progress, setProgress] = useState(0);
  const [settings, setSettings] = useState<ReaderSettings>(DEFAULT_SETTINGS);
  const [wasmError, setWasmError] = useState<string | null>(null);
  const [wasmAttempt, setWasmAttempt] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [running, setRunning] = useState(false);

  const fullscreenSupported = useSyncExternalStore(
    noopSubscribe,
    () => Boolean(typeof document !== "undefined" && document.fullscreenEnabled),
    () => false,
  );

  const total = pages.length;
  const index = chapters.findIndex((item) => item.id === chapter.id);
  const prev = index > 0 ? chapters[index - 1] : null;
  const next = index >= 0 && index < chapters.length - 1 ? chapters[index + 1] : null;
  const hrefFor = useCallback(
    (target: ChapterDto) => `/read/${target.id}?manga=${encodeURIComponent(manga.id)}&lang=${lang}`,
    [manga.id, lang],
  );

  const releaseWasm = useCallback(() => {
    const state = wasm.current;
    wasm.current = null;
    if (state) {
      try {
        state.free();
      } catch {
        // A failed/partial instance is disposable; never block navigation.
      }
    }
  }, []);

  /// Mirror Rust state into React only after calling the actual WASM methods.
  const syncFromWasm = useCallback(() => {
    const state = wasm.current;
    if (!state) return;
    setPage(state.pageIndex());
    setProgress(state.progressPercent());
    let parsed: ReaderSettings | null = null;
    try {
      parsed = normalizeSettings(JSON.parse(state.settingsJson()));
    } catch {
      parsed = null;
    }
    if (parsed) setSettings(parsed);
    setLoaded(true);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { loadReaderWasm } = await wasmModule();
        const { ReaderWasm: Wasm } = await loadReaderWasm();
        if (!alive || total === 0) return;
        setLoaded(false);
        const state = new Wasm(total);
        wasm.current = state;
        try {
          // Persisted preferences are normalized at the storage boundary, then
          // re-applied to Rust so mode/background/fit/speed are real state.
          state.applySettingsJson(JSON.stringify(getSettings()));
          const restored = restoredPage(getHistoryFor(manga.id), chapter.id, total);
          if (restored > 0) {
            state.setPage(restored);
            // Browser scroll restoration can briefly report an older page to
            // the observer; let explicit restoration win until scroll settles.
            settleUntil.current = Date.now() + 800;
          }
        } catch (error) {
          releaseWasm();
          throw error;
        }
        if (!alive) {
          releaseWasm();
          return;
        }
        syncFromWasm();
      } catch (error) {
        if (!alive) return;
        releaseWasm();
        setLoaded(false);
        setWasmError((error as Error)?.message || "Không tải được trình đọc WASM.");
      }
    })();
    return () => {
      alive = false;
      releaseWasm();
    };
  }, [wasmAttempt, total, manga.id, chapter.id, syncFromWasm, releaseWasm]);

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

  // Persist the real Rust position, including page 1 without any page turn.
  // The chapter's history row must exist first (created by the effect above).
  useEffect(() => {
    if (!loaded || total === 0) return;
    const state = wasm.current;
    if (!state) return;
    const history = getHistoryFor(manga.id);
    if (!history || history.chapterId !== chapter.id) return;
    saveProgress(chapter.id, state.pageIndex() + 1, state.totalPages());
  }, [loaded, page, total, chapter.id, manga.id]);

  // Authenticated reading re-applies server settings and position through the
  // same Rust state machine; guests keep the local-only path untouched.
  useEffect(() => {
    const key = `${chapter.id}|${lang}`;
    if (session.status !== "authenticated" || !loaded || total === 0 || settledRemote.current === key) return;
    settledRemote.current = key;
    void Promise.all([
      accountGet<ReaderSettingsDto>("/api/v1/me/settings"),
      accountGet<{ items: ProgressEntryDto[] }>("/api/v1/me/progress"),
    ]).then(([prefs, history]) => {
      const state = wasm.current;
      if (!state) return;
      state.applySettingsJson(JSON.stringify(prefs));
      const match = history.items.find((item) => item.mangaId === manga.id && item.chapterId === chapter.id && item.lang === lang);
      if (match) {
        const target = Math.min(Math.max(match.page - 1, 0), state.totalPages() - 1);
        if (target > state.pageIndex()) {
          state.setPage(target);
          settleUntil.current = Date.now() + 800;
        }
      }
      syncFromWasm();
    }).catch(() => undefined);
  }, [session.status, loaded, total, chapter.id, manga.id, lang, syncFromWasm]);

  useEffect(() => {
    if (session.status !== "authenticated" || !loaded || total === 0) return;
    const state = wasm.current;
    if (!state) return;
    void accountMutate(`/api/v1/me/progress/${encodeURIComponent(chapter.id)}`, "PUT", {
      mangaId: manga.id,
      lang,
      page: state.pageIndex() + 1,
      total: state.totalPages(),
      chapter: chapter.chapter,
      title: chapter.title,
      coverFile: manga.cover_file,
    }).catch(() => undefined);
  }, [session.status, loaded, page, total, chapter, manga, lang]);

  // One-off restoration scroll on chapter load and when returning to vertical
  // mode. It is deliberately independent from the observer and from `page`, so
  // normal scrolling (and auto-scroll) is never snapped back.
  useEffect(() => {
    if (!loaded || settings.mode !== "vertical" || total === 0) return;
    const target = wasm.current?.pageIndex() ?? 0;
    if (target === 0) return;
    pagesContainer.current
      ?.querySelector(`img[data-index="${target}"]`)
      ?.scrollIntoView();
  }, [loaded, settings.mode, total]);

  useEffect(() => {
    if (!next || prefetched.current === next.id) return;
    prefetched.current = next.id;
    void fetch(`/api/content/chapter/${encodeURIComponent(next.id)}/pages`, { cache: "force-cache" })
      .catch(() => undefined);
  }, [next]);

  const goPage = useCallback((target: number) => {
    const state = wasm.current;
    if (!state || target === state.pageIndex()) return;
    try {
      state.setPage(target);
    } catch {
      return; // Rust enforces the boundary; ignore out-of-range input.
    }
    syncFromWasm();
  }, [syncFromWasm]);

  const onObservedPage = useCallback((target: number) => {
    if (Date.now() < settleUntil.current) return;
    goPage(target);
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
      const current = normalizeSettings(JSON.parse(state.settingsJson()));
      saveSettings(current);
      if (session.status === "authenticated") {
        void accountMutate("/api/v1/me/settings", "PUT", current).catch(() => undefined);
      }
    } catch {
      // Settings are cosmetic; a corrupt snapshot must not stop reading.
    }
  }, [syncFromWasm, session.status]);

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
    <div className="reader" data-bg={settings.bg} ref={root} onWheel={() => setRunning(false)}>
      <ReaderToolbar
        mangaId={manga.id}
        mangaTitle={manga.title}
        chapterId={chapter.id}
        chapters={chapters}
        settings={settings}
        running={running}
        fullscreenSupported={fullscreenSupported}
        onSettings={changeSettings}
        onPause={() => setRunning(false)}
        onToggleRun={() => setRunning((value) => !value)}
        onFullscreen={() => {
          try {
            if (document.fullscreenElement) {
              void Promise.resolve(document.exitFullscreen()).catch(() => undefined);
            } else if (root.current?.requestFullscreen) {
              void Promise.resolve(root.current.requestFullscreen()).catch(() => undefined);
            }
          } catch {
            // Unsupported/denied fullscreen is not a reading error.
          }
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
                  releaseWasm();
                  setLoaded(false);
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
            containerRef={pagesContainer}
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
