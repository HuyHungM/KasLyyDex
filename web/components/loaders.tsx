export function LineSkeleton({ lines = 3, label = "Đang tải dữ liệu" }: { lines?: number; label?: string }) {
  return (
    <div className="load-skeleton" role="status" aria-label={label} aria-busy="true">
      {Array.from({ length: lines }, (_, index) => (
        <span key={index} className="skel-bar" style={{ width: index === lines - 1 ? "60%" : "100%" }} />
      ))}
    </div>
  );
}

export function AccountSkeleton({ label = "Đang tải dữ liệu", rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div className="surface account-card">
      <span className="skel-bar load-heading" aria-hidden="true" />
      <LineSkeleton lines={rows} label={label} />
    </div>
  );
}

export function FormSkeleton({ label = "Đang tải dữ liệu", fields = 3 }: { label?: string; fields?: number }) {
  return (
    <div className="surface account-card" role="status" aria-label={label} aria-busy="true">
      <span className="skel-bar load-heading" aria-hidden="true" />
      <span className="skel-bar load-sub" aria-hidden="true" />
      <div className="auth-form" aria-hidden="true">
        {Array.from({ length: fields }, (_, index) => (
          <span className="auth-field" key={index}>
            <span className="skel-bar load-label" />
            <span className="skel-bar load-input" />
          </span>
        ))}
        <span className="skel-bar load-submit" />
      </div>
    </div>
  );
}

export function ShelfSkeleton({ label = "Đang tải truyện", count = 4 }: { label?: string; count?: number }) {
  return (
    <div className="shelf-grid" role="status" aria-label={label} aria-busy="true">
      {Array.from({ length: count }, (_, index) => (
        <div className="surface shelf-card skel" key={index} aria-hidden="true">
          <div className="shelf-story">
            <span className="skel-cover" />
            <span className="load-copy"><span className="skel-bar" /><span className="skel-bar load-sub" /></span>
          </div>
          <span className="skel-bar load-submit" />
        </div>
      ))}
    </div>
  );
}

export function RealmSkeleton() {
  return (
    <div className="cultivation-badge" role="status" aria-label="Đang tải tu vi" aria-busy="true">
      <span className="skel-bar load-realm" aria-hidden="true" />
      <span className="skel-bar load-pill" aria-hidden="true" />
      <span className="skel-bar load-xp" aria-hidden="true" />
    </div>
  );
}

export function ReaderPageSkeleton() {
  return (
    <div className="reader-skel" role="status" aria-label="Đang mở trang truyện" aria-busy="true">
      <div aria-hidden="true" />
    </div>
  );
}

export function CommentSkeleton() {
  return (
    <div className="load-comments" role="status" aria-label="Đang tải bình luận" aria-busy="true">
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className="comment load-comment" aria-hidden="true">
          <span className="skel-bar load-comment-avatar" />
          <div className="comment-content">
            <div className="comment-bubble load-comment-bubble">
              <div className="comment-author-bar"><span className="skel-bar load-comment-name" /><span className="skel-bar load-pill" /></div>
              <span className="comment-divider" />
              <div className="comment-body-panel">
                <span className="skel-bar" /><span className="skel-bar load-comment-tail" />
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function ProfileHeaderSkeleton() {
  return (
    <section className="surface profile-header skel" role="status" aria-label="Đang tải hồ sơ" aria-busy="true">
      <span className="profile-avatar skel-bar" aria-hidden="true" />
      <div className="profile-identity" aria-hidden="true">
        <span className="skel-bar load-title" />
        <span className="skel-bar load-sub" />
        <span className="skel-bar load-pill" />
        <span className="skel-bar load-sub" />
        <span className="skel-bar load-sub" />
      </div>
    </section>
  );
}

export function ProfileStatsSkeleton() {
  return (
    <div className="profile-stats" role="status" aria-label="Đang tải thống kê" aria-busy="true">
      {Array.from({ length: 4 }, (_, index) => (
        <div className="surface profile-stat skel" key={index} aria-hidden="true">
          <span className="skel-bar load-title" />
          <span className="skel-bar load-label" />
        </div>
      ))}
    </div>
  );
}

export function ProfileEntrySkeleton() {
  return (
    <div className="surface profile-entry skel" role="status" aria-label="Đang tải truyện đã tương tác" aria-busy="true">
      <span className="profile-entry-cover skel-cover" aria-hidden="true" />
      <div className="profile-entry-body" aria-hidden="true">
        <span className="skel-bar load-title" />
        <span className="skel-bar load-sub" />
        <div className="comment-bubble profile-comment">
          <span className="skel-bar" />
          <span className="skel-bar load-comment-tail" />
        </div>
      </div>
    </div>
  );
}

export function ProfileRecentSkeleton() {
  return (
    <div className="profile-recent surface" role="status" aria-label="Đang tải hoạt động gần đây" aria-busy="true">
      {Array.from({ length: 3 }, (_, index) => (
        <div className="profile-recent-row skel" key={index} aria-hidden="true">
          <span className="skel-bar load-sub" />
          <span className="skel-bar load-label" />
        </div>
      ))}
    </div>
  );
}

export function ProfileTagsSkeleton() {
  return (
    <div className="profile-tag-list" role="status" aria-label="Đang tải thể loại" aria-busy="true">
      {Array.from({ length: 3 }, (_, index) => <span className="skel-pill" key={index} aria-hidden="true" />)}
    </div>
  );
}

export function PublicProfileSkeleton() {
  return (
    <div className="profile-page profile-skeleton">
      <ProfileHeaderSkeleton />
      <ProfileStatsSkeleton />
      <section className="surface profile-section" aria-label="Đang tải truyện đã đăng" aria-busy="true">
        <div className="profile-section-head"><span className="skel-bar load-title" /></div>
        <ProfileEntrySkeleton />
      </section>
      <section className="surface profile-section" aria-label="Đang tải truyện đang tham gia" aria-busy="true">
        <div className="profile-section-head"><span className="skel-bar load-title" /></div>
        <ProfileEntrySkeleton />
      </section>
      <ProfileRecentSkeleton />
      <ProfileTagsSkeleton />
      <section className="surface profile-section" aria-label="Đang tải truyện đã lưu" aria-busy="true">
        <div className="profile-section-head"><span className="skel-bar load-title" /></div>
        <ShelfSkeleton count={3} />
      </section>
    </div>
  );
}

export function AuthSkeleton() {
  return (
    <div className="auth-shell auth-shell--state" role="status" aria-label="Đang khôi phục phiên" aria-busy="true">
      <div className="auth-aside" aria-hidden="true">
        <span className="skel-bar load-label" />
        <span className="skel-bar load-title" />
        <span className="skel-bar load-sub" />
      </div>
      <div className="auth-main" aria-hidden="true">
        <span className="skel-bar load-pill" />
        <span className="skel-bar load-title" />
        <div className="auth-form">
          <span className="skel-bar load-input" />
          <span className="skel-bar load-input" />
          <span className="skel-bar load-submit" />
          <span className="skel-bar load-sub" />
        </div>
      </div>
    </div>
  );
}
