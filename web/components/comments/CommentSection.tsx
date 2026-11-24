"use client";

import { useEffect, useRef, useState } from "react";
import type { CommentDto, CommentListDto } from "@/lib/contracts";
import { relDate } from "@/lib/format";
import { accountMutate, useAccountSession, useRemoteResource } from "@/lib/account/client";

type Props = {
  targetType: "manga" | "chapter";
  targetId: string;
  label?: string;
};

type Sort = "new" | "old";

const MAX_BODY = 2000;

function ArrowIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

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

function Initial({ name }: { name: string }) {
  return <span className="comment-avatar" aria-hidden="true">{(name.trim()[0] ?? "?").toUpperCase()}</span>;
}

function titleForLevel(level: number | null | undefined) {
  const value = level ?? 1;
  if (value >= 20) return { label: "HUYỀN THOẠI", tier: "legend" };
  if (value >= 10) return { label: "CAO THỦ", tier: "pro" };
  if (value >= 5) return { label: "THÀNH THẠO", tier: "skilled" };
  return { label: "TÂN THỦ", tier: "new" };
}

function ActionButton({ label, onClick, disabled, danger }: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button type="button" className={`comment-action${danger ? " danger" : ""}`} disabled={disabled} onClick={onClick}>
      {label}
    </button>
  );
}

export default function CommentSection({ targetType, targetId, label = "Bình luận" }: Props) {
  const { session } = useAccountSession();
  const identityKey = session.user?.id ?? "guest";
  const [cursor, setCursor] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>("new");
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
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const query = `/api/v1/comments?targetType=${encodeURIComponent(targetType)}&targetId=${encodeURIComponent(targetId)}&limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
  // The identity key is part of the resource key: switching accounts can never
  // paint the previous account's ownership state into this section.
  const remote = useRemoteResource<CommentListDto>(query, identityKey);
  const signedIn = session.status === "authenticated";

  const comments = remote.data?.items ?? [];
  const ordered = [...comments].sort((a, b) => sort === "new"
    ? b.createdAt - a.createdAt
    : a.createdAt - b.createdAt);
  const total = comments.reduce((sum, item) => sum + 1 + item.replies.length, 0);
  const replyName = comments.flatMap((item) => [item, ...item.replies]).find((item) => item.id === replyTo)?.authorName ?? "bình luận";

  useEffect(() => {
    if (replyTo) composerRef.current?.focus();
  }, [replyTo]);

  useEffect(() => {
    if (editId) {
      window.requestAnimationFrame(() => {
        document.querySelector<HTMLTextAreaElement>(".comment-edit textarea")?.focus();
      });
    }
  }, [editId]);

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
      setNotice("Đã cập nhật bình luận.");
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
      setNotice("Đã xóa bình luận.");
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
          <ActionButton label="Trả lời" onClick={() => { setReplyTo(comment.id); setEditId(null); }} />
        ) : null}
        {owns && comment.status === "visible" ? (
          <>
            <ActionButton label="Sửa" onClick={() => {
              setEditId(comment.id);
              setEditDraft(comment.body ?? "");
              setEditSpoiler(comment.spoiler);
            }} />
            <ActionButton label="Xóa" danger disabled={busy} onClick={() => void removeComment(comment)} />
          </>
        ) : null}
        {signedIn && !owns && comment.status === "visible" ? (
          <ActionButton label="Báo cáo" onClick={() => { setReportId(comment.id); setReason(""); }} />
        ) : null}
      </div>
    );
  }

  function renderComment(comment: CommentDto, isReply = false) {
    const editing = editId === comment.id;
    return (
      <article key={comment.id} className={`comment${isReply ? " comment-reply" : ""}`}>
        <Initial name={comment.authorName} />
        <div className="comment-content">
          <div className="comment-author-bar">
            <strong className="comment-name">{comment.authorName}</strong>
            <span className={`comment-badge comment-badge--${titleForLevel(comment.authorLevel).tier}`}>
              {titleForLevel(comment.authorLevel).label}
            </span>
            <time dateTime={new Date(comment.createdAt).toISOString()} title={new Date(comment.createdAt).toLocaleString("vi-VN")}>
              {relDate(new Date(comment.createdAt).toISOString())}
            </time>
            {comment.spoiler ? <span className="comment-flag">spoiler</span> : null}
          </div>
          <div className="comment-bubble">
            {editing ? (
              <form className="comment-edit" onSubmit={(event) => {
                event.preventDefault();
                void updateComment(comment);
              }}>
                <textarea value={editDraft} maxLength={MAX_BODY} rows={3} onChange={(event) => setEditDraft(event.target.value)} />
                <label className="comment-toggle">
                  <input type="checkbox" checked={editSpoiler} onChange={(event) => setEditSpoiler(event.target.checked)} />
                  Chứa spoiler
                </label>
                <div className="comment-actions">
                  <button type="submit" className="comment-send" disabled={busy || editDraft.trim().length === 0}>Lưu</button>
                  <ActionButton label="Hủy" onClick={() => setEditId(null)} />
                </div>
              </form>
            ) : <CommentBody comment={comment} />}
            {renderActions(comment, isReply)}
          </div>
        </div>
      </article>
    );
  }

  return (
    <section className="surface comment-section" aria-label={label}>
      <header className="comment-section-head">
        <div>
          <p className="auth-kicker">KasLyyDex / Community</p>
          <h2 className="section-title">{label}<span className="comment-total">{total}</span></h2>
        </div>
        <div className="comment-sort" role="group" aria-label="Sắp xếp bình luận">
          <button type="button" aria-pressed={sort === "new"} className={sort === "new" ? "active" : undefined} onClick={() => setSort("new")}>Mới nhất</button>
          <button type="button" aria-pressed={sort === "old"} className={sort === "old" ? "active" : undefined} onClick={() => setSort("old")}>Cũ nhất</button>
        </div>
      </header>

      {signedIn ? (
        <form className="comment-composer" onSubmit={(event) => void submitComment(event)}>
          <div className="comment-composer-head">
            <Initial name={session.user?.name ?? session.user?.email ?? "Bạn"} />
            <div>
              <label htmlFor="comment-body">Viết bình luận</label>
              <p className="comment-sub">Tối đa {MAX_BODY} ký tự · Ctrl/⌘ + Enter để gửi</p>
            </div>
          </div>
          {replyTo ? (
            <div className="comment-reply-chip">
              Đang trả lời <strong>{replyName}</strong>
              <button type="button" onClick={() => setReplyTo(null)} aria-label="Hủy trả lời">×</button>
            </div>
          ) : null}
          <textarea
            id="comment-body"
            ref={composerRef}
            value={draft}
            maxLength={MAX_BODY}
            rows={4}
            placeholder={replyTo ? `Phản hồi ${replyName}…` : "Chia sẻ suy nghĩ của bạn…"}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                event.preventDefault();
                if (draft.trim() && !busy) void submitComment(event as unknown as React.FormEvent<HTMLFormElement>);
              }
            }}
          />
          <div className="comment-composer-row">
            <label className="comment-toggle">
              <input type="checkbox" checked={spoiler} onChange={(event) => setSpoiler(event.target.checked)} />
              Chứa spoiler
            </label>
            <span className="comment-counter">{draft.length}/{MAX_BODY}</span>
            <button type="submit" className="comment-send" disabled={busy || draft.trim().length === 0}>
              {busy ? "Đang gửi…" : "Gửi"}
              <ArrowIcon />
            </button>
          </div>
        </form>
      ) : (
        <div className="comment-guest">
          <Initial name="Khách" />
          <p className="account-hint">Đăng nhập để bình luận, phản hồi hoặc báo cáo.</p>
        </div>
      )}

      {actionError ? <p className="account-error" role="alert">{actionError}</p> : null}
      {notice ? <p className="comment-notice" role="status">{notice}</p> : null}
      {remote.error ? <p className="account-error" role="alert">{remote.error}</p> : null}
      {remote.loading && !remote.data ? <p className="account-hint">Đang tải bình luận…</p> : null}

      <div className="comment-list">
        {ordered.map((comment) => (
          <div key={comment.id} className="comment-thread">
            {renderComment(comment)}
            {comment.replies.map((reply) => renderComment(reply, true))}
          </div>
        ))}
        {remote.data && comments.length === 0 && !remote.loading ? (
          <div className="comment-empty">
            <strong>Chưa có bình luận nào.</strong>
            <span>Hãy là người đầu tiên chia sẻ suy nghĩ.</span>
          </div>
        ) : null}
      </div>

      <div className="comment-pagination">
        {cursor ? <button type="button" className="comment-action" onClick={() => setCursor(null)}>Về trang đầu</button> : null}
        {remote.data?.nextCursor ? (
          <button type="button" className="comment-more" onClick={() => setCursor(remote.data!.nextCursor)}>Xem thêm bình luận</button>
        ) : null}
      </div>

      {reportId ? (
        <div className="report-dialog" role="dialog" aria-modal="true" aria-label="Báo cáo bình luận">
          <form className="comment-composer" onSubmit={(event) => void submitReport(event)}>
            <label htmlFor="report-reason">Lý do báo cáo</label>
            <textarea id="report-reason" value={reason} maxLength={300} rows={3} placeholder="Nội dung spam, spoiler không đánh dấu…" onChange={(event) => setReason(event.target.value)} />
            <div className="comment-composer-row">
              <span className="comment-counter">{reason.length}/300</span>
              <button type="submit" className="comment-send" disabled={busy || reason.trim().length === 0}>Gửi báo cáo</button>
              <ActionButton label="Hủy" onClick={() => setReportId(null)} />
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}
