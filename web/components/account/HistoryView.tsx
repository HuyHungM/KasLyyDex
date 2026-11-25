"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { coverImageUrl, type ProgressEntryDto } from "@/lib/contracts";
import { chapterLabel } from "@/lib/format";
import { getHistory, subscribe, type GuestHistory } from "@/lib/guest";
import { useAccountSession, useRemoteResource } from "@/lib/account/client";
import { FormSkeleton } from "@/components/loaders";

const NO_HISTORY: GuestHistory[] = [];

function LocalHistory() {
  const entries = useSyncExternalStore(subscribe, getHistory, () => NO_HISTORY);
  if (entries.length === 0) return <div className="surface empty"><h2>Chưa có lịch sử đọc</h2><p>Mở một chương để bắt đầu.</p></div>;
  return (
    <div className="history-list">
      {entries.map((entry) => (
        <Link key={`${entry.mangaId}:${entry.chapterId}`} href={`/read/${encodeURIComponent(entry.chapterId)}?manga=${encodeURIComponent(entry.mangaId)}&lang=${encodeURIComponent(entry.lang)}`} className="history-row">
          <span><strong>{entry.mangaTitle}</strong><small>{chapterLabel(entry.chapter)} · thiết bị này</small></span>
          {entry.total ? <progress max={entry.total} value={entry.page ?? 1} /> : null}
        </Link>
      ))}
    </div>
  );
}

function SyncedHistory() {
  const { session } = useAccountSession();
  const remote = useRemoteResource<{ items: ProgressEntryDto[] }>(
    "/api/v1/me/progress",
    session.user?.id ?? "guest",
  );
  if (remote.loading && !remote.data) return <FormSkeleton label="Đang tải lịch sử" fields={4} />;
  if (remote.error || !remote.data) {
    return <div className="surface account-card" role="alert"><p>{remote.error ?? "Không tải được lịch sử."}</p><button type="button" className="btn" onClick={remote.reload}>Thử lại</button></div>;
  }
  if (remote.data.items.length === 0) return <div className="surface empty"><h2>Chưa có lịch sử đọc</h2><p>Tiến độ sẽ được đồng bộ khi bạn mở truyện.</p></div>;
  return (
    <div className="history-list">
      {remote.data.items.map((item) => (
        <Link key={`${item.mangaId}:${item.chapterId}:${item.lang}`} href={`/read/${encodeURIComponent(item.chapterId)}?manga=${encodeURIComponent(item.mangaId)}&lang=${encodeURIComponent(item.lang)}`} className="history-row">
          <span>
            <strong>{item.title ?? item.mangaId}</strong>
            <small>{chapterLabel(item.chapter)} · đã đọc tới trang {item.maxPage}/{item.total}</small>
          </span>
          {item.coverFile ? <img src={coverImageUrl({ id: item.mangaId, cover_file: item.coverFile }, 96) ?? ""} alt="" loading="lazy" /> : null}
          <progress max={item.total} value={item.page} />
        </Link>
      ))}
    </div>
  );
}

export default function HistoryView() {
  const { session } = useAccountSession();
  if (session.status === "authenticated") return <SyncedHistory />;
  return <LocalHistory />;
}
