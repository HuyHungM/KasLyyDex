"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { CommentDto, CommentListDto } from "@/lib/contracts";
import { relDate } from "@/lib/format";
import { realmForLevel } from "@/lib/progression";
import { accountMutate, useAccountSession, useRemoteResource } from "@/lib/account/client";
import { CommentSkeleton } from "@/components/loaders";

type Props = {
  targetType: "manga" | "chapter";
  targetId: string;
  label?: string;
};

type Sort = "new" | "old";

const MAX_BODY = 2000;

const ACTION_ICONS = {
  reply: "M9 14 4 9l5-5M4 9h9a6 6 0 0 1 0 12h-2",
  edit: "M4 20h4L20 8l-4-4L4 16v4Z",
  remove: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13",
  report: "M5 21V4h14l-3.5 5L19 14H5",
} as const;

type ActionIconName = keyof typeof ACTION_ICONS;

function Icon({ path, size = 14 }: { path: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

function ArrowIcon() {
  return <Icon path="M5 12h14M13 6l6 6-6 6" size={16} />;
}

function ChatIcon() {
  return <Icon path="M21 12a8 8 0 0 1-8 8H7l-4 3V12a8 8 0 0 1 16 0Z" size={28} />;
}

function InfoIcon() {
  return <Icon path="M12 8v5m0 3h.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z" />;
}

function SpoilerText({ text }: { text: string }) {
  const [shown, setShown] = useState(false);
  if (!shown) {
    return (
      <button type="button" className="spoiler-hide" aria-expanded="false" onClick={() => setShown(true)}>
        <Icon path="M3 3l18 18M10.6 5.2A9 9 0 0 1 12 5c5 0 9 3.5 9 7a8.7 8.7 0 0 1-2 4.2M6.2 6.3A9.7 9.7 0 0 0 3 12c0 3.5 4 7 9 7 1 0 2-.1 2.9-.4M9.9 9.9a3 3 0 0 0 4.2 4.2" />
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
  if (comment.status === "hidden") {
    return <p className="comment-muted comment-status"><InfoIcon /> Bình luận đã bị ẩn để kiểm duyệt.</p>;
  }
  if (comment.status === "removed") {
    return <p className="comment-muted comment-status"><InfoIcon /> Bình luận đã bị xóa. Phản hồi vẫn được giữ lại.</p>;
  }
  if (!comment.body) return <p className="comment-muted">Không có nội dung.</p>;
  return comment.spoiler ? <SpoilerText text={comment.body} /> : <p className="comment-body">{comment.body}</p>;
}

// Each cultivation realm gets its own frame colour, readable in both themes.
const REALM_COLORS: Record<string, { color: string; background: string }> = {
  mortal: { color: "#6d5b46", background: "#f3ede4" },
  qi_refining: { color: "#256b4f", background: "#e2f4ec" },
  foundation_establishment: { color: "#2c5e85", background: "#e3f0fa" },
  golden_core: { color: "#8a6510", background: "#fbf1c7" },
  nascent_soul: { color: "#6a3f93", background: "#ede2f7" },
  spirit_severing: { color: "#9b3f5e", background: "#f9e2e9" },
  void_refinement: { color: "#4c4fa0", background: "#e6e8fb" },
  body_integration: { color: "#1f6d6a", background: "#dff3f2" },
  mahayana: { color: "#9a5a20", background: "#fbe8d6" },
  tribulation_transcendence: { color: "#a14436", background: "#fce3dd" },
  true_immortal: { color: "#416b32", background: "#e5f2df" },
  immortal_king: { color: "#80389a", background: "#f2e0f5" },
  immortal_emperor: { color: "#8a6708", background: "#fdf0cf" },
};

function badgeForLevel(level: number | null | undefined) {
  const realm = realmForLevel(level ?? 1);
  return {
    label: realm.name,
    style: REALM_COLORS[realm.key] ?? REALM_COLORS.mortal,
  };
}

function formatCount(value: number) {
  return new Intl.NumberFormat("vi-VN").format(value);
}

function Initial({ name, tone }: { name: string; tone?: string }) {
  return (
    <span
      className="comment-avatar"
      aria-hidden="true"
      style={tone ? { borderColor: tone, color: tone } : undefined}
    >
      {(name.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}

function ActionButton({ label, icon, onClick, disabled, danger }: {
  label: string;
  icon: ActionIconName;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button type="button" className={`comment-action${danger ? " danger" : ""}`} disabled={disabled} onClick={onClick}>
      <Icon path={ACTION_ICONS[icon]} size={13} />
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
  const reportRef = useRef<HTMLTextAreaElement>(null);

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

  useEffect(() => {
    if (!reportId) return;
    reportRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setReportId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [reportId]);

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
          <ActionButton icon="reply" label="Trả lời" onClick={() => { setReplyTo(comment.id); setEditId(null); }} />
        ) : null}
        {owns && comment.status === "visible" ? (
          <>
            <ActionButton icon="edit" label="Sửa" onClick={() => {
              setEditId(comment.id);
              setEditDraft(comment.body ?? "");
              setEditSpoiler(comment.spoiler);
            }} />
            <ActionButton icon="remove" label="Xóa" danger disabled={busy} onClick={() => void removeComment(comment)} />
          </>
        ) : null}
        {signedIn && !owns && comment.status === "visible" ? (
          <ActionButton icon="report" label="Báo cáo" onClick={() => { setReportId(comment.id); setReason(""); }} />
        ) : null}
      </div>
    );
  }

  function renderComment(comment: CommentDto, isReply = false) {
    const editing = editId === comment.id;
    const badge = badgeForLevel(comment.authorLevel);
    return (
      <article key={comment.id} className={`comment${isReply ? " comment-reply" : ""}`} data-status={comment.status}>
        <Initial name={comment.authorName} tone={badge.style.color} />
        <div className="comment-content">
          <div className="comment-bubble">
            <div className="comment-author-bar">
              <strong className="comment-name">{comment.authorName}</strong>
              <span
                className="comment-badge"
                style={{ color: badge.style.color, background: badge.style.background }}
              >
                <Icon path="M12 3 19 11 12 21 5 11Z" size={11} />
                {badge.label}
              </span>
              <time dateTime={new Date(comment.createdAt).toISOString()} title={new Date(comment.createdAt).toLocaleString("vi-VN")}>
                {relDate(new Date(comment.createdAt).toISOString())}
              </time>
              {comment.spoiler ? <span className="comment-flag">spoiler</span> : null}
            </div>
            <hr className="comment-divider" />
            <div className="comment-body-panel">
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
                    <ActionButton icon="reply" label="Hủy" onClick={() => setEditId(null)} />
                  </div>
                </form>
              ) : <CommentBody comment={comment} />}
            </div>
            {renderActions(comment, isReply)}
          </div>
        </div>
      </article>
    );
  }

  return (
    <section className="surface comment-section" aria-label={label}>
      <header className="comment-section-head">
        <div className="comment-heading">
          <p className="auth-kicker">KasLyyDex / Community</p>
          <div className="comment-title-row">
            <h2 className="section-title">{label}</h2>
            <p className="comment-total" role="status" aria-atomic="true">{formatCount(total)} bình luận</p>
          </div>
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
          <Link href="/tai-khoan" className="btn btn-primary comment-guest-cta">Đăng nhập</Link>
        </div>
      )}

      {actionError ? <p className="account-error" role="alert">{actionError}</p> : null}
      {notice ? <p className="comment-notice" role="status">{notice}</p> : null}
      {remote.error ? <p className="account-error" role="alert">{remote.error}</p> : null}
      {remote.loading && !remote.data ? <CommentSkeleton /> : null}

      <div className="comment-list">
        {ordered.map((comment) => (
          <div key={comment.id} className="comment-thread">
            {renderComment(comment)}
            {comment.replies.length > 0 ? (
              <div className="comment-replies">
                {comment.replies.map((reply) => renderComment(reply, true))}
              </div>
            ) : null}
          </div>
        ))}
        {remote.data && comments.length === 0 && !remote.loading ? (
          <div className="comment-empty">
            <ChatIcon />
            <strong>Chưa có bình luận nào.</strong>
            <span>Hãy là người đầu tiên chia sẻ suy nghĩ.</span>
          </div>
        ) : null}
      </div>

      <div className="comment-pagination">
        {cursor ? <button type="button" className="comment-action" onClick={() => setCursor(null)}>Về trang đầu</button> : null}
        {remote.data?.nextCursor ? (
          <button type="button" className="comment-more" onClick={() => setCursor(remote.data!.nextCursor)}>
            Xem thêm bình luận <Icon path="m6 9 6 6 6-6" size={15} />
          </button>
        ) : null}
      </div>

      {reportId ? (
        <>
          <div className="comment-report-scrim" onClick={() => setReportId(null)} aria-hidden="true" />
          <div className="report-dialog" role="dialog" aria-modal="true" aria-label="Báo cáo bình luận">
            <h3>Báo cáo bình luận</h3>
            <p>Đội kiểm duyệt sẽ xem xét. Vui lòng mô tả ngắn lý do.</p>
            <form className="comment-composer" onSubmit={(event) => void submitReport(event)}>
              <label htmlFor="report-reason">Lý do báo cáo</label>
              <textarea id="report-reason" ref={reportRef} value={reason} maxLength={300} rows={3} placeholder="Nội dung spam, spoiler không đánh dấu…" onChange={(event) => setReason(event.target.value)} />
              <div className="comment-composer-row">
                <span className="comment-counter">{reason.length}/300</span>
                <button type="submit" className="comment-send" disabled={busy || reason.trim().length === 0}>Gửi báo cáo</button>
                <ActionButton icon="reply" label="Hủy" onClick={() => setReportId(null)} />
              </div>
            </form>
          </div>
        </>
      ) : null}
    </section>
  );
}
