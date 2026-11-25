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
