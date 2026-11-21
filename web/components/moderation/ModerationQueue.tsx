"use client";

import { useState } from "react";
import type { ReportDto, ReportListDto } from "@/lib/contracts";
import { accountMutate, useAccountSession, useRemoteResource } from "@/lib/account/client";

export default function ModerationQueue() {
  const { session } = useAccountSession();
  const identityKey = session.user?.id ?? "guest";
  const signedIn = session.status === "authenticated";
  const queue = useRemoteResource<ReportListDto>(
    signedIn ? "/api/v1/moderation/reports?limit=20" : null,
    identityKey,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [targetType, setTargetType] = useState<"manga" | "chapter">("manga");
  const [targetId, setTargetId] = useState("");
  const [locked, setLocked] = useState(true);

  async function act(path: string, method: "PATCH" | "PUT", body: unknown) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await accountMutate(path, method, body);
      queue.reload();
      setNotice("Đã cập nhật.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Yêu cầu kiểm duyệt không thành công.");
    } finally {
      setBusy(false);
    }
  }

  function moderate(comment: ReportDto, action: "hide" | "remove" | "restore") {
    void act(`/api/v1/moderation/comments/${encodeURIComponent(comment.commentId)}`, "PATCH", { action });
  }

  if (!signedIn) {
    return <section className="surface account-card"><h1>Kiểm duyệt</h1><p className="account-hint">Cần đăng nhập để truy cập hàng đợi kiểm duyệt.</p></section>;
  }
  if (queue.loading && !queue.data) return <section className="surface account-card">Đang tải hàng đợi…</section>;
  if (queue.error) {
    return (
      <section className="surface account-card" role="alert">
        <h1>Kiểm duyệt</h1>
        <p className="account-error">{queue.error}</p>
        <button type="button" className="btn" onClick={queue.reload}>Thử lại</button>
      </section>
    );
  }

  return (
    <section className="surface account-card moderation-card">
      <h1>Hàng đợi kiểm duyệt</h1>
      <p className="account-hint">Ẩn/xóa bình luận, đóng báo cáo và khóa một chủ đề theo loại + id.</p>
      {error ? <p className="account-error" role="alert">{error}</p> : null}
      {notice ? <p className="account-hint" role="status">{notice}</p> : null}
      <div className="moderation-list">
        {(queue.data?.items ?? []).map((report) => (
          <article key={report.id} className="moderation-row">
            <div>
              <strong>{report.comment?.authorName ?? "Độc giả"}</strong>
              <p className="moderation-body">{report.comment?.body ?? "(nội dung không còn)"}</p>
              <p className="account-hint">Lý do: {report.reason}</p>
            </div>
            <div className="comment-actions">
              <button type="button" className="btn" disabled={busy} onClick={() => moderate(report, "hide")}>Ẩn</button>
              <button type="button" className="btn" disabled={busy} onClick={() => moderate(report, "remove")}>Xóa</button>
              {report.comment?.status === "hidden" ? (
                <button type="button" className="btn" disabled={busy} onClick={() => moderate(report, "restore")}>Khôi phục</button>
              ) : null}
              <button type="button" className="link-btn" disabled={busy} onClick={() => void act(`/api/v1/moderation/reports/${encodeURIComponent(report.id)}`, "PATCH", { action: "resolve" })}>Đóng</button>
              <button type="button" className="link-btn" disabled={busy} onClick={() => void act(`/api/v1/moderation/reports/${encodeURIComponent(report.id)}`, "PATCH", { action: "dismiss" })}>Bỏ qua</button>
            </div>
          </article>
        ))}
        {(queue.data?.items ?? []).length === 0 ? <p className="account-hint">Không có báo cáo mở.</p> : null}
      </div>
      <form className="account-form" onSubmit={(event) => {
        event.preventDefault();
        void act("/api/v1/moderation/threads", "PUT", { targetType, targetId, locked });
      }}>
        <label>
          Khóa chủ đề
          <select value={targetType} onChange={(event) => setTargetType(event.target.value as "manga" | "chapter")}>
            <option value="manga">Truyện</option>
            <option value="chapter">Chương</option>
          </select>
        </label>
        <label>Id chủ đề<input value={targetId} maxLength={200} onChange={(event) => setTargetId(event.target.value)} /></label>
        <label className="account-check">
          <input type="checkbox" checked={locked} onChange={(event) => setLocked(event.target.checked)} />
          Đóng bình luận mới
        </label>
        <button type="submit" className="btn btn-primary" disabled={busy || targetId.trim().length === 0}>Áp dụng</button>
      </form>
    </section>
  );
}
