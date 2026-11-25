"use client";

import { useState } from "react";
import type { ImportSummaryDto } from "@/lib/contracts";
import { getHistory, getLibrary, getSettings } from "@/lib/guest";
import { accountMutate, useAccountSession } from "@/lib/account/client";

export default function GuestImportPanel() {
  const { session } = useAccountSession();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportSummaryDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Read on every render: after login the local data is still the user's own.
  const localLibrary = getLibrary();
  const localHistory = getHistory();
  const localSettings = getSettings();

  if (session.status !== "authenticated") return null;

  async function importNow() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await accountMutate<ImportSummaryDto>("/api/v1/me/import", "POST", {
        library: localLibrary.map((entry) => ({
          mangaId: entry.mangaId,
          title: entry.title,
          coverFile: entry.coverFile,
          lang: entry.lang,
          followedAt: entry.followedAt,
        })),
        history: localHistory.map((entry) => ({
          mangaId: entry.mangaId,
          chapterId: entry.chapterId,
          lang: entry.lang,
          page: entry.page ?? 1,
          total: entry.total ?? entry.page ?? 1,
          chapter: entry.chapter,
          title: entry.title,
          coverFile: entry.coverFile,
          ts: entry.ts,
        })),
        settings: localSettings,
      }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không nhập được dữ liệu khách.");
    } finally {
      setBusy(false);
    }
  }

  const hasLocal = localLibrary.length > 0 || localHistory.length > 0;
  return (
    <div className="surface account-card">
      <h2>Nhập dữ liệu từ chế độ khách</h2>
      <p className="account-hint">
        Tủ truyện: {localLibrary.length} · Lịch sử: {localHistory.length}. Dữ liệu trên thiết bị này không bị xóa; nhập lại nhiều lần không tạo bản trùng.
      </p>
      <button type="button" className="btn" disabled={busy || !hasLocal} onClick={() => void importNow()}>
        {busy ? "Đang nhập…" : hasLocal ? "Nhập vào tài khoản" : "Không có dữ liệu khách để nhập"}
      </button>
      {error ? <p className="account-error" role="alert">{error}</p> : null}
      {result ? (
        <p className="account-hint" role="status">
          Đã nhập {result.libraryInserted} tủ truyện, {result.progressInserted} tiến độ mới, cập nhật {result.progressUpdated} mục; bỏ qua {result.skipped} mục không hợp lệ hoặc cũ hơn máy chủ. Dữ liệu gốc vẫn giữ lại.
        </p>
      ) : null}
    </div>
  );
}
