"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { NotificationDto, NotificationListDto } from "@/lib/contracts";
import { accountMutate, useAccountSession, useRemoteResource } from "@/lib/account/client";
import { refreshChapterNotifications } from "@/lib/community/client";

type Props = { compact?: boolean; autoRefresh?: boolean };

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
    // Only the notification page entry checks chapters. The globally mounted
    // header badge just reads the inbox and never calls the content service.
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
      // The inbox still loads existing notifications if the content check fails.
      setPartialWarning(false);
    } finally {
      openedRefreshRef.current = false;
    }
  }

  function togglePanel() {
    const next = !open;
    setOpen(next);
    // Library and notification pages already check on entry; no second call.
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
    return (
      <div className="notification-list">
        {items.map((item) => (
          <article key={item.id} className={`notification-item${item.readAt === null ? " unread" : ""}`}>
            <div>
              <strong>{item.title}</strong>
              <p>{item.body}</p>
              <time dateTime={new Date(item.createdAt).toISOString()}>
                {new Date(item.createdAt).toLocaleString("vi-VN")}
              </time>
            </div>
            <div className="comment-actions">
              {item.href ? <Link href={item.href} onClick={() => void markRead([item.id])}>Mở</Link> : null}
              {item.readAt === null ? (
                <button type="button" className="link-btn" disabled={busy} onClick={() => void markRead([item.id])}>
                  Đã đọc
                </button>
              ) : null}
            </div>
          </article>
        ))}
        {items.length === 0 ? <p className="account-hint">Không có thông báo nào.</p> : null}
      </div>
    );
  }

  if (!signedIn) {
    if (compact) return null;
    return (
      <section className="surface account-card">
        <h1>Thông báo</h1>
        <p className="account-hint">Đăng nhập để xem thông báo bình luận, kiểm duyệt và chương mới.</p>
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
      {inbox.loading && !inbox.data ? <p className="account-hint">Đang tải thông báo…</p> : null}
      {partialWarning ? (
        <p className="account-error" role="status">
          Cảnh báo: thông báo chương có thể chưa đầy đủ do giới hạn nhà cung cấp.
        </p>
      ) : null}
      {rows(items)}
      <div className="comment-actions">
        <button type="button" className="link-btn" disabled={busy || unreadIds.length === 0} onClick={() => void markRead(unreadIds)}>
          Đánh dấu đã đọc
        </button>
        {compact ? <Link href="/thong-bao">Xem tất cả</Link> : null}
        {access.data?.moderator ? <Link href="/kiem-duyet">Hàng đợi kiểm duyệt</Link> : null}
      </div>
    </>
  );

  if (!compact) {
    return (
      <section className="surface account-card notification-page">
        <h1>Thông báo</h1>
        {unread > 0 ? <p className="account-hint">{unread} thông báo chưa đọc.</p> : null}
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
        {unread > 0 ? <span className="notification-badge" aria-hidden="true">{unread > 9 ? "9+" : unread}</span> : null}
      </button>
      {open ? (
        <div className="notification-panel surface" role="dialog" aria-label="Trung tâm thông báo">
          <h2>Thông báo</h2>
          {body}
        </div>
      ) : null}
    </div>
  );
}
