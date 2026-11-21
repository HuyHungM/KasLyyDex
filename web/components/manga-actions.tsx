"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import type { LibraryEntryDto, ProgressEntryDto } from "@/lib/contracts";
import { chapterLabel } from "@/lib/format";
import { useAccountSession, useRemoteResource, accountMutate } from "@/lib/account/client";
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
  const { session } = useAccountSession();
  const authed = session.status === "authenticated";
  // While the session is unresolved (or errored), neither guest nor synced
  // writes are safe. An explicit unconfigured auth state is a real guest.
  const resolved = authed || session.status === "guest" || session.status === "unconfigured";
  const useLocal = session.status === "guest" || session.status === "unconfigured";
  const identity = session.user?.id ?? "guest";
  const remoteLibrary = useRemoteResource<{ items: LibraryEntryDto[] }>(authed ? "/api/v1/me/library" : null, identity);
  const remoteProgress = useRemoteResource<{ items: ProgressEntryDto[] }>(authed ? "/api/v1/me/progress" : null, identity);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const localResume = useLocal ? history.find((entry) => entry.mangaId === mangaId) : null;
  const remoteResume = remoteProgress.data?.items.find((entry) => entry.mangaId === mangaId) ?? null;
  const resume = authed && remoteResume
    ? { chapterId: remoteResume.chapterId, lang: remoteResume.lang, chapter: remoteResume.chapter }
    : localResume;
  const followed = authed
    ? Boolean(remoteLibrary.data?.items.some((entry) => entry.mangaId === mangaId))
    : useLocal && library.some((entry) => entry.mangaId === mangaId);

  async function toggleFollow() {
    if (!resolved) return;
    if (!authed) {
      toggleLibrary({ mangaId, title, coverFile, lang });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const url = `/api/v1/me/library/${encodeURIComponent(mangaId)}`;
      if (followed) await accountMutate(url, "DELETE");
      else await accountMutate(url, "PUT", { title, coverFile, lang, status: "reading" });
      remoteLibrary.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không cập nhật được tủ truyện.");
    } finally {
      setBusy(false);
    }
  }

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
        <Link href={`/read/${encodeURIComponent(resume.chapterId)}?manga=${encodeURIComponent(mangaId)}&lang=${encodeURIComponent(resume.lang)}`} className="btn">
          Đọc tiếp · {chapterLabel(resume.chapter)}
        </Link>
      )}
      <button type="button" className="btn" aria-pressed={followed} disabled={busy || !resolved} onClick={() => void toggleFollow()}>
        {!resolved ? "Đang xác định phiên…" : followed ? "✓ Đang theo dõi" : "+ Thêm vào tủ truyện"}
      </button>
      {error ? <span className="account-error" role="alert">{error}</span> : null}
    </div>
  );
}
