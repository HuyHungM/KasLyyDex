"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { NotificationDto, NotificationListDto } from "@/lib/contracts";
import { accountMutate, useAccountSession, useRemoteResource } from "@/lib/account/client";
import { refreshChapterNotifications } from "@/lib/community/client";
import { LineSkeleton } from "@/components/loaders";

type Props = { compact?: boolean; autoRefresh?: boolean };

function TypeIcon({ type }: { type: string }) {
  const common = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, "aria-hidden": true };
  if (type.includes("comment")) {
    return <svg {...common}><path d="M20 15a3 3 0 0 1-3 3H8l-4 3V6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3Z" /></svg>;
  }
  if (type.includes("moderation") || type.includes("report")) {
    return <svg {...common}><path d="M12 3 4 6v5c0 5 3.4 8.6 8 10 4.6-1.4 8-5 8-10V6Z" /><path d="m9 12 2 2 4-4" /></svg>;
  }
  if (type.includes("chapter") || type.includes("feed")) {
    return <svg {...common}><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v17H6.5A2.5 2.5 0 0 1 4 17.5Z" /><path d="M8 7h7M8 11h5" /></svg>;
  }
  return <svg {...common}><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>;
}

export default function NotificationCenter({ compact = false, autoRefresh = false }: Props) {
  const { session } = useAccountSession();
  const pathname = usePathname();
  const identityKey = session.user?.id ?? "guest";
  const signedIn = session.status === "authenticated";
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [partialWarning, setPartialWarning] = useState(false);

  const inbox = useRemoteResource<NotificationListDto>(
    signedIn ? "/api/v1/notifications?limit=20" : null,
    identityKey,
  );
  const access = useRemoteResource<{ moderator: boolean }>(
    signedIn ? "/api/v1/moderation/access" : null,
    identityKey,
  );
  const reloadRef = useRef(inbox.reload);
  useEffect(() => {
    reloadRef.current = inbox.reload;
  }, [inbox.reload]);

  const openedRefreshRef = useRef(false);
  useEffect(() => {
    if (!signedIn || !autoRefresh) return;
    let alive = true;
    void refreshChapterNotifications()
      .then((result) => {
        if (!alive) return;
        setPartialWarning(result.partial === true);
        reloadRef.current();
      })
      .catch(() => { if (alive) setPartialWarning(false); });
    return () => { alive = false; };
  }, [identityKey, signedIn, autoRefresh]);

  async function refreshOnExplicitOpen() {
    if (openedRefreshRef.current) return;
    openedRefreshRef.current = true;
    try {
      const result = await refreshChapterNotifications();
      setPartialWarning(result.partial === true);
      reloadRef.current();
    } catch {
      setPartialWarning(false);
    } finally {
      openedRefreshRef.current = false;
    }
  }

  function togglePanel() {
    const next = !open;
    setOpen(next);
    if (next && compact && signedIn && pathname !== "/thong-bao" && pathname !== "/tu-truyen") {
      void refreshOnExplicitOpen();
    }
  }

  async function markRead(ids: string[]) {
    if (ids.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await accountMutate("/api/v1/notifications/read", "POST", { ids });
      reloadRef.current();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không đánh dấu được thông báo.");
    } finally {
      setBusy(false);
    }
  }

  function rows(items: NotificationDto[]) {
    if (items.length === 0) {
      return (
        <div className="notification-empty">
          <span aria-hidden="true">✦</span>
          <p>Không có thông báo nào.</p>
          <small>Chương mới và bình luận sẽ xuất hiện ở đây.</small>
        </div>
      );
    }
    return (
      <div className="notification-list">
        {items.map((item) => (
          <article key={item.id} className={`notification-item${item.readAt === null ? " unread" : ""}`}>
            <span className="notification-icon" aria-hidden="true"><TypeIcon type={item.type} /></span>
            <div className="notification-copy">
              <strong>{item.title}</strong>
              <p>{item.body}</p>
              <time dateTime={new Date(item.createdAt).toISOString()}>
                {new Date(item.createdAt).toLocaleString("vi-VN")}
              </time>
            </div>
            <div className="notification-actions">
              {item.href ? (
                <Link href={item.href} onClick={() => void markRead([item.id])} aria-label={`Mở ${item.title}`}>Mở</Link>
              ) : null}
              {item.readAt === null ? (
                <button type="button" className="link-btn" disabled={busy} aria-label={`Đánh dấu đã đọc: ${item.title}`} onClick={() => void markRead([item.id])}>Đã đọc</button>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    );
  }

  if (!signedIn) {
    if (compact) return null;
    return (
      <section className="auth-shell auth-shell--state">
        <div className="auth-aside">
          <p className="auth-kicker">KasLyyDex / Inbox</p>
          <h2 className="auth-title">Thông báo</h2>
          <p className="auth-quote">Chưa có phiên đăng nhập để hiển thị hộp thư.</p>
        </div>
        <div className="auth-main">
          <p className="account-hint">Đăng nhập để xem thông báo bình luận, kiểm duyệt và chương mới.</p>
        </div>
      </section>
    );
  }

  const items = inbox.data?.items ?? [];
  const unread = inbox.data?.unreadCount ?? 0;
  const unreadIds = items.filter((item) => item.readAt === null).map((item) => item.id);
  const body = (
    <>
      {error ? <p className="account-error" role="alert">{error}</p> : null}
      {inbox.error ? <p className="account-error" role="alert">{inbox.error}</p> : null}
      {partialWarning ? (
        <p className="account-error" role="status">Cảnh báo: thông báo chương có thể chưa đầy đủ do giới hạn nhà cung cấp.</p>
      ) : null}
      {!compact && !inbox.loading ? <p className="notification-summary" role="status">{unread > 0 ? `${unread} thông báo chưa đọc.` : "Tất cả đã đọc."}</p> : null}
      {inbox.loading && !inbox.error ? (
        <LineSkeleton lines={3} label="Đang tải thông báo" />
      ) : (
        <>
          {rows(items)}
          <div className="notification-footer">
            <button type="button" className="notification-mark-all" disabled={busy || unreadIds.length === 0} onClick={() => void markRead(unreadIds)}>
              Đánh dấu tất cả đã đọc
            </button>
            {compact ? <Link href="/thong-bao">Xem tất cả →</Link> : null}
            {access.data?.moderator ? <Link href="/kiem-duyet">Hàng đợi kiểm duyệt →</Link> : null}
          </div>
        </>
      )}
    </>
  );

  if (!compact) {
    return (
      <section className="notification-page surface">
        <header className="notification-page-head">
          <div>
            <p className="auth-kicker">KasLyyDex / Inbox</p>
            <h1>Thông báo</h1>
          </div>
          {inbox.loading ? (
            <span className="notification-count-skel skel-bar" role="status" aria-label="Đang tải thông báo" />
          ) : (
            <p className="notification-count" role="status" aria-atomic="true">
              {unread > 0 ? `${unread} thông báo chưa đọc` : "Tất cả đã đọc"}
            </p>
          )}
        </header>
        {body}
      </section>
    );
  }

  return (
    <div className="notification-center">
      <button
        type="button"
        className="notification-bell"
        aria-label={unread > 0 ? `Thông báo, ${unread} chưa đọc` : "Thông báo"}
        aria-expanded={open}
        onClick={togglePanel}
      >
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
        </svg>
        {!inbox.loading && unread > 0 ? <span className="notification-badge" aria-hidden="true">{unread > 9 ? "9+" : unread}</span> : null}
        {!inbox.loading ? (
          <span className="sr-only" role="status" aria-atomic="true">{unread > 0 ? `${unread} thông báo chưa đọc` : "Không có thông báo chưa đọc"}</span>
        ) : null}
      </button>
      {open ? (
        <div className="notification-panel surface" role="dialog" aria-label="Trung tâm thông báo">
          <header className="notification-panel-head">
            <h2>Thông báo</h2>
            {inbox.loading ? (
              <span className="notification-count-skel skel-bar" role="status" aria-label="Đang tải thông báo" />
            ) : (
              <span role="status" aria-atomic="true">{unread > 0 ? `${unread} chưa đọc` : "Đã đọc hết"}</span>
            )}
          </header>
          {body}
        </div>
      ) : null}
    </div>
  );
}
