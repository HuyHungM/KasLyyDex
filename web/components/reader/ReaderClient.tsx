"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ReaderWasm } from "@/generated/reader-wasm";
import type { ChapterDto, MangaSummaryDto, ProgressEntryDto } from "@/lib/contracts";
import { sourceLabel } from "@/lib/contracts";
import { LineSkeleton } from "@/components/loaders";
import type { ReaderSettingsDto } from "@/lib/validators";
import { accountGet, accountMutate, parseAccountResponse, useAccountSession } from "@/lib/account/client";
import { ReaderRestoreCoordinator } from "@/lib/reader-sync";
import {
  getHistoryFor, getSettings, normalizeSettings, pushHistory, restoredPage,
  saveProgress, saveSettings, setLibraryLast, type ReaderSettings,
} from "@/lib/guest";
import ReaderPages from "./ReaderPages";
import ReaderToolbar from "./ReaderToolbar";
import CommentSection from "@/components/comments/CommentSection";

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

type ReaderTicket = {
  ticket: string;
  pageCount: number;
  requiredPages: number;
  minimumElapsedMs: number;
  expiresAt: number;
};

type CheckpointResult = { seenPages: number[]; complete: boolean };

type CompletionResult = {
  awarded: boolean;
  xp: number;
  level: number;
  title: string;
  chapterId: string;
};

type XpTrack = {
  generation: number;
  ticket: ReaderTicket | null;
  issuedAt: number;
  pending: Set<number>;
  sent: Set<number>;
  sends: number[];
  observer: IntersectionObserver | null;
  timer: number | null;
  inFlight: boolean;
  completed: boolean;
};

const checkpointIntervalMs = 3_000;
const maxCheckpointsPerMinute = 15;

async function progressionPost<T>(path: string, body: unknown, signal: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  return parseAccountResponse<T>(response);
}

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
  const restore = useRef(new ReaderRestoreCoordinator());
  const settleUntil = useRef(0);
  const xp = useRef<XpTrack>({
    generation: 0, ticket: null, issuedAt: 0, pending: new Set(), sent: new Set(),
    sends: [], observer: null, timer: null, inFlight: false, completed: false,
  });
  const { session } = useAccountSession();

  const [page, setPage] = useState(0);
  const [progress, setProgress] = useState(0);
  const [settings, setSettings] = useState<ReaderSettings>(() => getSettings());
  const [wasmError, setWasmError] = useState<string | null>(null);
  const [wasmAttempt, setWasmAttempt] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [running, setRunning] = useState(false);
  const [remoteReadyKey, setRemoteReadyKey] = useState("");
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncAttempt, setSyncAttempt] = useState(0);
  const [award, setAward] = useState<string | null>(null);

  const fullscreenSupported = useSyncExternalStore(
    noopSubscribe,
    () => Boolean(typeof document !== "undefined" && document.fullscreenEnabled),
    () => false,
  );

  const total = pages.length;
  const external = Boolean(chapter.external_url);
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
    const userId = session.user?.id;
    const key = `${chapter.id}|${lang}|${userId ?? ""}`;
    const controller = restore.current;
    if (session.status !== "authenticated" || !userId || !loaded || total === 0) return;
    const generation = controller.begin(key);
    let alive = true;
    void Promise.all([
      accountGet<ReaderSettingsDto>("/api/v1/me/settings"),
      accountGet<{ items: ProgressEntryDto[] }>("/api/v1/me/progress"),
    ]).then(([prefs, history]) => {
      // A slow response from an earlier chapter/user must never touch WASM.
      if (!alive || controller.resolve(generation, key) !== key) return;
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
      setRemoteReadyKey(key);
    }).catch(() => {
      if (!alive || !controller.fail(generation, key)) return;
      setRemoteReadyKey("");
      setSyncError("Không khôi phục được tiến độ từ tài khoản.");
    });
    return () => {
      alive = false;
    };
  }, [session.status, session.user?.id, loaded, total, chapter.id, manga.id, lang, syncFromWasm, syncAttempt]);

  useEffect(() => () => restore.current.dispose(), []);

  // Account reading XP runs only after the Task 6 restore gate has settled,
  // on the real Rust/WASM chapter, and only for a managed session. A chapter,
  // language or account switch invalidates the generation and all timers.
  useEffect(() => {
    const key = `${chapter.id}|${lang}|${session.user?.id ?? ""}`;
    const chapterSource = "mangadex" as const;
    const track = xp.current;
    const generation = ++track.generation;
    track.ticket = null;
    track.pending.clear();
    track.sent.clear();
    track.sends = [];
    track.completed = false;
    queueMicrotask(() => setAward(null));
    if (session.status !== "authenticated" || !session.user || !loaded
      || total === 0 || external || remoteReadyKey !== key) return;

    const abort = new AbortController();
    let onVisibility: (() => void) | null = null;
    const active = () => generation === track.generation && !abort.signal.aborted
      && document.visibilityState === "visible" && !document.hidden;

    const flush = async () => {
      const ticket = track.ticket;
      if (!ticket || track.inFlight || track.completed || !active() || Date.now() >= ticket.expiresAt) return;
      const minuteAgo = Date.now() - 60_000;
      track.sends = track.sends.filter((time) => time > minuteAgo);
      if (track.sends.length >= maxCheckpointsPerMinute) return;
      const batch = [...track.pending].filter((page) => !track.sent.has(page))
        .slice(0, maxCheckpointsPerMinute - track.sends.length);
      track.inFlight = true;
      try {
        if (batch.length > 0) {
          const result = await progressionPost<CheckpointResult>("/api/v1/progress/checkpoint", {
            ticket: ticket.ticket, pages: batch,
          }, abort.signal);
          if (!active()) return;
          for (const page of batch) {
            track.pending.delete(page);
            track.sent.add(page);
          }
          for (const page of result.seenPages) track.sent.add(page);
          track.sends.push(Date.now());
        }
        if (track.sent.size >= ticket.requiredPages
          && Date.now() - track.issuedAt >= ticket.minimumElapsedMs) {
          track.completed = true;
          const result = await progressionPost<CompletionResult>("/api/v1/progress/complete", {
            ticket: ticket.ticket,
          }, abort.signal);
          if (!active()) return;
          setAward(result.awarded
            ? `+${result.xp} XP · Cấp ${result.level} · ${result.title}`
            : `Chương đã được ghi nhận · Cấp ${result.level} · ${result.title}`);
        }
      } catch {
        track.completed = false; // retry with the same distinct evidence
      } finally {
        track.inFlight = false;
      }
    };

    void (async () => {
      try {
        const ticket = await progressionPost<ReaderTicket>("/api/v1/reader-sessions", {
          chapterId: chapter.id, mangaId: manga.id, lang,
          source: chapterSource, source_label: sourceLabel(chapterSource),
        }, abort.signal);
        if (!active()) return;
        track.ticket = ticket;
        track.issuedAt = Date.now();
        const root = pagesContainer.current;
        if (root) {
          // Only decoded, actually intersecting images in the active document
          // become evidence. Prefetched or hidden images are never reported.
          const observer = new IntersectionObserver((entries) => {
            if (!active()) return;
            for (const entry of entries) {
              if (!entry.isIntersecting) continue;
              const image = entry.target as HTMLImageElement;
              const page = Number(image.dataset.index) + 1;
              if (!Number.isInteger(page) || page < 1 || page > total || track.sent.has(page)) continue;
              void image.decode().then(() => {
                if (!active() || image.dataset.loaded !== "true") return;
                track.pending.add(page);
              }).catch(() => undefined);
            }
          }, { threshold: 0 });
          root.querySelectorAll<HTMLImageElement>("img[data-index]").forEach((image) => observer.observe(image));
          track.observer = observer;
        }
        track.timer = window.setInterval(() => { void flush(); }, checkpointIntervalMs);
        onVisibility = () => { if (document.visibilityState === "visible") void flush(); };
        document.addEventListener("visibilitychange", onVisibility);
        void flush();
      } catch {
        // A ticket failure never blocks reading and never grants XP.
      }
    })();

    return () => {
      abort.abort();
      track.generation += 1;
      if (track.timer !== null) {
        window.clearInterval(track.timer);
        track.timer = null;
      }
      track.observer?.disconnect();
      track.observer = null;
      if (onVisibility) document.removeEventListener("visibilitychange", onVisibility);
      track.pending.clear();
    };
  }, [session.status, session.user, loaded, total, chapter.id, chapter.source, manga.id, lang, remoteReadyKey, external]);

  useEffect(() => {
    if (settings.mode !== "horizontal" || !loaded || document.hidden) return;
    const image = pagesContainer.current?.querySelector<HTMLImageElement>(`img[data-index="${page}"]`);
    if (!image) return;
    void image.decode().then(() => {
      if (!document.hidden && image.dataset.loaded === "true") xp.current.pending.add(page + 1);
    }).catch(() => undefined);
  }, [settings.mode, page, loaded]);

  useEffect(() => {
    const key = `${chapter.id}|${lang}|${session.user?.id ?? ""}`;
    if (session.status !== "authenticated" || !loaded || total === 0 || !restore.current.isReady(key)) return;
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
  }, [session.status, session.user?.id, remoteReadyKey, loaded, page, total, chapter, manga, lang]);

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
        {award ? <div className="reader-award" role="status">{award}</div> : null}
        {syncError && session.status === "authenticated" ? (
          <div className="panel" role="alert">
            <p>{syncError}</p>
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                setSyncError(null);
                setRemoteReadyKey("");
                restore.current.dispose();
                setSyncAttempt((attempt) => attempt + 1);
              }}
            >
              Thử lại đồng bộ
            </button>
          </div>
        ) : null}
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
          <div className="reader-loading" role="status" aria-label="Đang khởi tạo trình đọc"><LineSkeleton lines={4} label="Đang khởi tạo trình đọc" /></div>
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
      <div className="reader-comments">
        <CommentSection targetType="chapter" targetId={chapter.id} label="Bình luận chương" />
      </div>
    </div>
  );
}
