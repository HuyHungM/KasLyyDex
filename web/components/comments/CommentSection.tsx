"use client";

import { useState } from "react";
import type { CommentDto, CommentListDto } from "@/lib/contracts";
import { accountMutate, useAccountSession, useRemoteResource } from "@/lib/account/client";

type Props = {
  targetType: "manga" | "chapter";
  targetId: string;
  label?: string;
};

function SpoilerText({ text }: { text: string }) {
  const [shown, setShown] = useState(false);
  if (!shown) {
    return (
      <button type="button" className="spoiler-hide" aria-expanded="false" onClick={() => setShown(true)}>
        Nội dung có spoiler — bấm để xem
      </button>
    );
  }
  return (
    <>
      <p className="comment-body">{text}</p>
      <button type="button" className="link-btn" aria-expanded="true" onClick={() => setShown(false)}>Ẩn lại</button>
    </>
  );
}

function CommentBody({ comment }: { comment: CommentDto }) {
  if (comment.status === "hidden") return <p className="comment-muted">Bình luận đã bị ẩn để kiểm duyệt.</p>;
  if (comment.status === "removed") return <p className="comment-muted">Bình luận đã bị xóa.</p>;
  if (!comment.body) return <p className="comment-muted">Không có nội dung.</p>;
  return comment.spoiler ? <SpoilerText text={comment.body} /> : <p className="comment-body">{comment.body}</p>;
}

export default function CommentSection({ targetType, targetId, label = "Bình luận" }: Props) {
  const { session } = useAccountSession();
  const identityKey = session.user?.id ?? "guest";
  const [cursor, setCursor] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [spoiler, setSpoiler] = useState(false);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [editSpoiler, setEditSpoiler] = useState(false);
  const [reportId, setReportId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const query = `/api/v1/comments?targetType=${encodeURIComponent(targetType)}&targetId=${encodeURIComponent(targetId)}&limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
  // The identity key is part of the resource key: switching accounts can never
  // paint the previous account's ownership state into this section.
  const remote = useRemoteResource<CommentListDto>(query, identityKey);
  const signedIn = session.status === "authenticated";

  function report(error: unknown) {
    setActionError(error instanceof Error ? error.message : "Yêu cầu không thành công.");
  }

  async function submitComment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      await accountMutate("/api/v1/comments", "POST", {
        targetType, targetId, parentId: replyTo, body: draft, spoiler,
      });
      setDraft("");
      setSpoiler(false);
      setReplyTo(null);
      setNotice("Đã đăng bình luận.");
      remote.reload();
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }

  async function updateComment(comment: CommentDto) {
    setBusy(true);
    setActionError(null);
    try {
      await accountMutate(`/api/v1/comments/${encodeURIComponent(comment.id)}`, "PATCH", {
        body: editDraft, spoiler: editSpoiler,
      });
      setEditId(null);
      remote.reload();
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }

  async function removeComment(comment: CommentDto) {
    setBusy(true);
    setActionError(null);
    try {
      await accountMutate(`/api/v1/comments/${encodeURIComponent(comment.id)}`, "DELETE");
      remote.reload();
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }

  async function submitReport(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reportId) return;
    setBusy(true);
    setActionError(null);
    try {
      await accountMutate("/api/v1/reports", "POST", { commentId: reportId, reason });
      setReportId(null);
      setReason("");
      setNotice("Đã gửi báo cáo tới đội kiểm duyệt.");
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }

  function renderActions(comment: CommentDto, isReply = false) {
    const owns = signedIn && comment.userId === session.user?.id;
    return (
      <div className="comment-actions">
        {!isReply && comment.status === "visible" && signedIn ? (
          <button type="button" className="link-btn" onClick={() => { setReplyTo(comment.id); setEditId(null); }}>Trả lời</button>
        ) : null}
        {owns && comment.status === "visible" ? (
          <>
            <button type="button" className="link-btn" onClick={() => {
              setEditId(comment.id);
              setEditDraft(comment.body ?? "");
              setEditSpoiler(comment.spoiler);
            }}>Sửa</button>
            <button type="button" className="link-btn" disabled={busy} onClick={() => void removeComment(comment)}>Xóa</button>
          </>
        ) : null}
        {signedIn && !owns && comment.status === "visible" ? (
          <button type="button" className="link-btn" onClick={() => { setReportId(comment.id); setReason(""); }}>Báo cáo</button>
        ) : null}
      </div>
    );
  }

  function renderComment(comment: CommentDto, isReply = false) {
    const editing = editId === comment.id;
    return (
      <article key={comment.id} className={`comment${isReply ? " comment-reply" : ""}`}>
        <div className="comment-head">
          <strong>{comment.authorName}</strong>
          <time dateTime={new Date(comment.createdAt).toISOString()}>
            {new Date(comment.createdAt).toLocaleString("vi-VN")}
          </time>
          {comment.spoiler ? <span className="comment-flag">spoiler</span> : null}
        </div>
        {editing ? (
          <form className="comment-edit" onSubmit={(event) => {
            event.preventDefault();
            void updateComment(comment);
          }}>
            <textarea value={editDraft} maxLength={2000} rows={3} onChange={(event) => setEditDraft(event.target.value)} />
            <label className="account-check">
              <input type="checkbox" checked={editSpoiler} onChange={(event) => setEditSpoiler(event.target.checked)} />
              Chứa spoiler
            </label>
            <div className="comment-actions">
              <button type="submit" className="btn btn-primary" disabled={busy}>Lưu</button>
              <button type="button" className="link-btn" onClick={() => setEditId(null)}>Hủy</button>
            </div>
          </form>
        ) : <CommentBody comment={comment} />}
        {renderActions(comment, isReply)}
      </article>
    );
  }

  return (
    <section className="surface comment-section">
      <h2 className="section-title">{label}</h2>
      {signedIn ? (
        <form className="comment-composer" onSubmit={(event) => void submitComment(event)}>
          <label htmlFor="comment-body">Viết bình luận (tối đa 2000 ký tự)</label>
          <textarea
            id="comment-body"
            value={draft}
            maxLength={2000}
            rows={4}
            placeholder={replyTo ? "Viết phản hồi…" : "Chia sẻ suy nghĩ của bạn…"}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="comment-composer-row">
            <label className="account-check">
              <input type="checkbox" checked={spoiler} onChange={(event) => setSpoiler(event.target.checked)} />
              Chứa spoiler
            </label>
            {replyTo ? (
              <button type="button" className="link-btn" onClick={() => setReplyTo(null)}>Hủy trả lời</button>
            ) : null}
            <button type="submit" className="btn btn-primary" disabled={busy || draft.trim().length === 0}>Gửi</button>
          </div>
        </form>
      ) : (
        <p className="account-hint">Đăng nhập để bình luận, phản hồi hoặc báo cáo.</p>
      )}

      {actionError ? <p className="account-error" role="alert">{actionError}</p> : null}
      {notice ? <p className="account-hint" role="status">{notice}</p> : null}
      {remote.error ? <p className="account-error" role="alert">{remote.error}</p> : null}
      {remote.loading && !remote.data ? <p className="account-hint">Đang tải bình luận…</p> : null}

      <div className="comment-list">
        {(remote.data?.items ?? []).map((comment) => (
          <div key={comment.id} className="comment-thread">
            {renderComment(comment)}
            {comment.replies.map((reply) => renderComment(reply, true))}
          </div>
        ))}
        {remote.data && remote.data.items.length === 0 && !remote.loading ? (
          <p className="account-hint">Chưa có bình luận nào.</p>
        ) : null}
      </div>
      <div className="comment-actions">
        {cursor ? <button type="button" className="link-btn" onClick={() => setCursor(null)}>Về trang đầu</button> : null}
        {remote.data?.nextCursor ? (
          <button type="button" className="link-btn" onClick={() => setCursor(remote.data!.nextCursor)}>Xem thêm</button>
        ) : null}
      </div>

      {reportId ? (
        <div className="report-dialog" role="dialog" aria-modal="true" aria-label="Báo cáo bình luận">
          <form className="comment-composer" onSubmit={(event) => void submitReport(event)}>
            <label htmlFor="report-reason">Lý do báo cáo</label>
            <textarea id="report-reason" value={reason} maxLength={300} rows={3} onChange={(event) => setReason(event.target.value)} />
            <div className="comment-actions">
              <button type="submit" className="btn btn-primary" disabled={busy || reason.trim().length === 0}>Gửi báo cáo</button>
              <button type="button" className="link-btn" onClick={() => setReportId(null)}>Hủy</button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}
