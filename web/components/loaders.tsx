export function LineSkeleton({ lines = 3, label = "Đang tải dữ liệu" }: { lines?: number; label?: string }) {
  return (
    <div className="load-skeleton" role="status" aria-label={label} aria-busy="true">
      {Array.from({ length: lines }, (_, index) => (
        <span key={index} className="skel-bar" style={{ width: index === lines - 1 ? "60%" : "100%" }} />
      ))}
    </div>
  );
}

export function AccountSkeleton({ label = "Đang tải dữ liệu" }: { label?: string }) {
  return (
    <div className="surface account-card">
      <LineSkeleton lines={3} label={label} />
    </div>
  );
}

export function CommentSkeleton() {
  return (
    <div className="load-comments" role="status" aria-label="Đang tải bình luận" aria-busy="true">
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className="load-comment">
          <span className="skel-bar load-comment-avatar" />
          <div className="load-comment-lines">
            <span className="skel-bar load-comment-name" />
            <span className="skel-bar" />
            <span className="skel-bar load-comment-tail" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function AuthSkeleton() {
  return (
    <div className="auth-shell auth-shell--state" role="status" aria-label="Đang khôi phục phiên" aria-busy="true">
      <div className="auth-aside"><LineSkeleton lines={4} label="Đang khôi phục phiên" /></div>
      <div className="auth-main"><LineSkeleton lines={5} label="Đang khôi phục phiên" /></div>
    </div>
  );
}
