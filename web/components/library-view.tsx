"use client";

import Link from "next/link";
import { useEffect, useSyncExternalStore, useState } from "react";
import { coverImageUrl, type LibraryEntryDto } from "@/lib/contracts";
import { accountMutate, useAccountSession, useRemoteResource } from "@/lib/account/client";
import { refreshChapterNotifications } from "@/lib/community/client";
import { getLibrary, subscribe, toggleLibrary, type GuestLibraryEntry } from "@/lib/guest";
import { AccountSkeleton } from "@/components/loaders";

const EMPTY: GuestLibraryEntry[] = [];

function LocalLibrary() {
  const library = useSyncExternalStore(subscribe, getLibrary, () => EMPTY);
  if (library.length === 0) return <EmptyLibrary />;
  return (
    <div className="shelf-grid">
      {library.map((entry) => (
        <div key={entry.mangaId} className="surface shelf-card">
          <Link href={`/manga/${encodeURIComponent(entry.mangaId)}`} className="shelf-story">
            <div className="card-cover">
              {entry.coverFile ? (
                <img src={coverImageUrl({ id: entry.mangaId, cover_file: entry.coverFile }) ?? ""} alt="" loading="lazy" />
              ) : (
                <div className="no-cover" aria-hidden="true">Chưa có bìa</div>
              )}
            </div>
            <div>
              <strong>{entry.title}</strong>
              <p className="cc-ch">{entry.lastChapterId ? `Chương mới: ${entry.lastChapterId}` : "Chưa đọc"}</p>
            </div>
          </Link>
          <div className="actions">
            <button
              type="button"
              className="btn"
              onClick={() => toggleLibrary({ mangaId: entry.mangaId, title: entry.title, coverFile: entry.coverFile, lang: entry.lang })}
            >
              Bỏ theo dõi
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyLibrary() {
  return (
    <div className="surface empty">
      <h2>Tủ truyện còn trống</h2>
      <p>Thêm truyện từ trang chi tiết để theo dõi chương mới và đọc tiếp tại đây.</p>
      <Link href="/" className="btn btn-primary">Khám phá truyện</Link>
    </div>
  );
}

function SyncedLibrary() {
  const { session } = useAccountSession();
  const identityKey = session.user?.id ?? "guest";
  const remote = useRemoteResource<{ items: LibraryEntryDto[] }>(
    "/api/v1/me/library",
    identityKey,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [partialWarning, setPartialWarning] = useState(false);
  useEffect(() => {
    // Opening the synced library is an explicit on-demand chapter check.
    let alive = true;
    void refreshChapterNotifications()
      .then((result) => { if (alive) setPartialWarning(result.partial === true); })
      .catch(() => { if (alive) setPartialWarning(false); });
    return () => { alive = false; };
  }, [identityKey]);

  if (remote.loading && !remote.data) return <AccountSkeleton label="Đang tải tủ truyện" />;
  if (remote.error || !remote.data) {
    return <div className="surface account-card" role="alert"><p>{remote.error ?? "Không tải được tủ truyện."}</p><button type="button" className="btn" onClick={remote.reload}>Thử lại</button></div>;
  }
  if (remote.data.items.length === 0) return <EmptyLibrary />;
  return (
    <>
      {error ? <p className="account-error" role="alert">{error}</p> : null}
      {partialWarning ? (
        <p className="account-error" role="status">
          Cảnh báo: thông báo chương có thể chưa đầy đủ do giới hạn nhà cung cấp.
        </p>
      ) : null}
      <div className="shelf-grid">
        {remote.data.items.map((entry) => (
          <div key={entry.mangaId} className="surface shelf-card">
            <Link href={`/manga/${encodeURIComponent(entry.mangaId)}`} className="shelf-story">
              <div className="card-cover">
                {entry.coverFile ? (
                  <img src={coverImageUrl({ id: entry.mangaId, cover_file: entry.coverFile }) ?? ""} alt="" loading="lazy" />
                ) : (
                  <div className="no-cover" aria-hidden="true">Chưa có bìa</div>
                )}
              </div>
              <div>
                <strong>{entry.title}</strong>
                <p className="cc-ch">{entry.lastChapterId ? `Chương mới: ${entry.lastChapterId}` : "Chưa đọc"}</p>
              </div>
            </Link>
            <div className="actions">
              <button
                type="button"
                className="btn"
                disabled={busy === entry.mangaId}
                onClick={async () => {
                  setBusy(entry.mangaId);
                  setError(null);
                  try {
                    await accountMutate(`/api/v1/me/library/${encodeURIComponent(entry.mangaId)}`, "DELETE");
                    remote.reload();
                  } catch (cause) {
                    setError(cause instanceof Error ? cause.message : "Không bỏ theo dõi được.");
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                {busy === entry.mangaId ? "Đang xóa…" : "Bỏ theo dõi"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

export default function LibraryView() {
  const { session } = useAccountSession();
  if (session.status === "authenticated") return <SyncedLibrary />;
  return <LocalLibrary />;
}
