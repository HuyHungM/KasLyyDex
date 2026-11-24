"use client";

import Link from "next/link";
import { useState } from "react";
import { SourceBadge } from "@/components/source-badge";
import { coverImageUrl, type MangaSummaryDto } from "@/lib/contracts";

type Bucket = "day" | "month" | "all";

const LABELS: Array<[Bucket, string]> = [
  ["day", "Top ngày"],
  ["month", "Top tháng"],
  ["all", "Mọi thời đại"],
];

export default function RankTabs({ buckets }: { buckets: Record<Bucket, MangaSummaryDto[]> }) {
  const [active, setActive] = useState<Bucket>("day");
  const list = buckets[active];

  return (
    <div className="rank-tabs">
      <div className="rank-switch" role="tablist" aria-label="Khung thời gian xếp hạng">
        {LABELS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={active === value}
            className={active === value ? "active" : undefined}
            onClick={() => setActive(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <ol className="rank-list">
        {list.map((manga, index) => {
          const cover = coverImageUrl(manga, 256);
          return (
            <li key={`${active}-${manga.id}`}>
              <Link href={`/manga/${manga.id}`} className="rank-row">
                <b className={index < 3 ? "top-rank" : undefined}>{index + 1}</b>
                <span className="rank-cover">
                  {cover && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={cover} alt="" loading="lazy" />
                  )}
                  <SourceBadge source={manga.source} />
                </span>
                <span className="rank-title">
                  {manga.title}
                  <small>{active === "day" ? "Cập nhật gần đây" : manga.follows ? `${manga.follows} theo dõi` : "Top điểm"}</small>
                </span>
                {manga.rating && manga.rating > 0 ? <span className="rank-rating">★ {manga.rating.toFixed(1)}</span> : null}
              </Link>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
