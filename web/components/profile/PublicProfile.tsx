"use client";

import Link from "next/link";
import { useRemoteResource } from "@/lib/account/client";
import { coverImageUrl, type PublicProfileDto, type PublicProfileEntryDto } from "@/lib/contracts";
import { relDate } from "@/lib/format";
import { PublicProfileSkeleton } from "@/components/loaders";

function entryHref(entry: PublicProfileEntryDto) {
  if (entry.targetType === "chapter") {
    return `/read/${entry.targetId}?manga=${encodeURIComponent(entry.mangaId ?? "")}&lang=vi`;
  }
  return `/manga/${entry.mangaId ?? entry.targetId}`;
}

function ProfileEntry({ entry }: { entry: PublicProfileEntryDto }) {
  const cover = entry.coverFile
    ? coverImageUrl({ id: entry.mangaId ?? entry.targetId, cover_file: entry.coverFile }, 128)
    : null;
  const canLink = entry.targetType !== "chapter" || Boolean(entry.mangaId);
  return (
    <article className="surface profile-entry">
      <span className="profile-entry-cover">
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover} alt="" loading="lazy" decoding="async" />
        ) : null}
      </span>
      <div className="profile-entry-body">
        {canLink
          ? <Link className="profile-entry-title" href={entryHref(entry)}>{entry.title}</Link>
          : <span className="profile-entry-title">{entry.title}</span>}
        <p className="profile-entry-meta">
          {entry.chapterLabel ?? (entry.targetType === "chapter" ? "Chương" : "Truyện")}
          <span aria-hidden="true"> · </span>
          {relDate(new Date(entry.createdAt).toISOString())}
        </p>
        <div className="comment-bubble profile-comment">{entry.body}</div>
      </div>
    </article>
  );
}

function ProfileSection({ title, count, items, empty, truncated = false }: { title: string; count: number; items: PublicProfileEntryDto[]; empty: string; truncated?: boolean }) {
  return (
    <section className="surface profile-section">
      <header className="profile-section-head">
        <h2>{title}</h2>
        <span className="profile-count">{count}</span>
      </header>
      {truncated ? <p className="profile-limit">{count > 20 ? "20 gần nhất" : "Đang hiển thị bản rút gọn"}</p> : null}
      <div className="profile-entries">
        {items.length > 0 ? items.map((entry) => <ProfileEntry entry={entry} key={`${entry.targetType}:${entry.targetId}`} />)
          : <p className="empty">{empty}</p>}
      </div>
    </section>
  );
}

export default function PublicProfile({ userId }: { userId: string }) {
  const remote = useRemoteResource<PublicProfileDto>(
    `/api/v1/users/${encodeURIComponent(userId)}`,
    userId,
  );

  if (remote.loading && !remote.data) return <PublicProfileSkeleton />;
  if (remote.error || !remote.data) {
    return (
      <div className="profile-page">
        <div className="surface empty" role="alert">
          <h2>Không tải được hồ sơ</h2>
          <p>{remote.error ?? "Hồ sơ này hiện không khả dụng."}</p>
          <button type="button" className="btn" onClick={remote.reload}>Thử lại</button>
        </div>
      </div>
    );
  }

  const data = remote.data;
  const name = data.displayName ?? data.username ?? "Thành viên";
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  const stats = [
    { label: "Chương đã đọc", value: data.stats.chaptersRead },
    { label: "Đang theo dõi", value: data.stats.following },
    { label: "Bình luận", value: data.stats.comments },
    { label: "Đã lưu", value: data.stats.saved },
  ];

  return (
    <div className="profile-page">
      <header className="surface profile-header">
        {data.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="profile-avatar" src={data.avatarUrl} alt="" />
        ) : <span className="profile-avatar" aria-hidden="true">{initial}</span>}
        <div className="profile-identity">
          <h1>{name}</h1>
          <p className="profile-handle">{data.username ? `@${data.username}` : "Thành viên KasLyyDex"}</p>
          <div className="cultivation-badge" data-realm={data.title}>
            <span className="cultivation-realm">{data.title}</span>
            <span className="cultivation-level">Cấp {data.level}</span>
            <span className="cultivation-xp">{data.totalXp} XP</span>
          </div>
          {data.bio ? <p className="profile-bio">{data.bio}</p> : null}
          <p className="profile-joined">Tham gia {new Date(data.joinedAt).toLocaleDateString("vi-VN")}</p>
        </div>
      </header>

      <div className="profile-stats">
        {stats.map((stat) => (
          <div className="surface profile-stat" key={stat.label}>
            <b>{stat.value}</b>
            <span>{stat.label}</span>
          </div>
        ))}
      </div>

      <ProfileSection title="Truyện đã đăng" count={data.stats.posted} items={data.posted} empty="Chưa có truyện đã đăng." truncated={data.truncated.posted} />
      <ProfileSection title="Truyện đang tham gia" count={data.stats.participating} items={data.participating} empty="Chưa có truyện đang tham gia." truncated={data.truncated.participating} />

      <section className="surface profile-section">
        <header className="profile-section-head">
          <h2>Hoạt động gần đây</h2>
          <span className="profile-count">{data.recent.length}</span>
        </header>
        <div className="profile-recent">
          {data.recent.map((entry, index) => (
            <div className="profile-recent-row" key={`recent:${entry.targetType}:${entry.targetId}:${index}`}>
              <Link href={entryHref(entry)}>{entry.title}</Link>
              <span>{relDate(new Date(entry.createdAt).toISOString())}</span>
              <p>{entry.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="surface profile-section">
        <header className="profile-section-head"><h2>Thể loại hay tương tác</h2></header>
        <div className="profile-tag-list">
          {data.topTags.length > 0
            ? data.topTags.map((tag) => <span className="profile-tag" key={tag}>{tag}</span>)
            : <span className="profile-empty-inline">Chưa có dữ liệu</span>}
        </div>
      </section>

      <section className="surface profile-section profile-saved">
        <header className="profile-section-head">
          <h2>Truyện đã lưu</h2>
          <span className="profile-count">{data.savedTotal}</span>
        </header>
        <div className="shelf-grid">
          {data.saved === null
            ? <div className="surface empty">Chỉ chủ nhân xem được</div>
            : data.saved.length > 0
              ? data.saved.map((item) => {
                const cover = item.coverFile
                  ? coverImageUrl({ id: item.mangaId, cover_file: item.coverFile, source: undefined }, 128)
                  : null;
                return (
                  <div className="surface shelf-card" key={item.mangaId}>
                    <Link className="shelf-story" href={`/manga/${encodeURIComponent(item.mangaId)}`}>
                      <div className="card-cover">
                        {cover
                          ? // eslint-disable-next-line @next/next/no-img-element
                            <img src={cover} alt="" loading="lazy" decoding="async" />
                          : <div className="no-cover" aria-hidden="true">Chưa có bìa</div>}
                      </div>
                      <div>
                        <strong>{item.title}</strong>
                        <p className="cc-ch">{item.lastChapterId ? `Chương mới: ${item.lastChapterId}` : "Chưa đọc"}</p>
                      </div>
                    </Link>
                  </div>
                );
              })
              : <div className="surface empty">Chưa có truyện đã lưu.</div>}
        </div>
        {data.saved !== null ? <Link className="profile-all-link" href="/tu-truyen">Xem tất cả →</Link> : null}
      </section>
    </div>
  );
}
