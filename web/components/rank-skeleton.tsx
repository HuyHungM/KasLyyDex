export function RankListSkeleton() {
  return (
    <ol className="rank-list rank-podium" role="status" aria-label="Đang tải xếp hạng">
      {Array.from({ length: 24 }, (_, index) => {
        const rank = index + 1;
        const podium = rank <= 3;
        const frame = podium ? `podium-card rank-top rank-${rank}` : "";
        return (
          <li key={rank} className={podium ? "podium-slot" : undefined}>
            <div className={`rank-row skel-rank skel ${frame}`} aria-hidden="true">
              <span className="skel-bar skel-rank-no" />
              <span className="rank-cover" />
              <span className="rank-title">{podium ? <span className="podium-tag skel-bar" /> : null}<span className="skel-bar" /><span className="skel-bar" /></span>
              <span className="skel-bar skel-rank-score" />
            </div>
          </li>
        );
      })}
    </ol>
  );
}
