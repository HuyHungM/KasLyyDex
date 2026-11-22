export function RankListSkeleton() {
  return (
    <ol className="rank-list" role="status" aria-label="Đang tải xếp hạng">
      {Array.from({ length: 12 }, (_, index) => {
        const rank = index + 1;
        const frame = rank <= 3 ? `rank-top rank-${rank}` : "";
        return (
          <li key={rank}>
            <div className={`rank-row skel-rank skel ${frame}`} aria-hidden="true">
              <span className="skel-bar skel-rank-no" />
              <span className="rank-cover" />
              <span className="rank-title"><span className="skel-bar" /><span className="skel-bar" /></span>
              <span className="skel-bar skel-rank-score" />
            </div>
          </li>
        );
      })}
    </ol>
  );
}
