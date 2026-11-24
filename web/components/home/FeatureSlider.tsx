"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { SourceBadge } from "@/components/source-badge";
import { coverImageUrl, type MangaSummaryDto } from "@/lib/contracts";
import { statusText } from "@/lib/format";

const ROTATE_MS = 6500;

export default function FeatureSlider({ items }: { items: MangaSummaryDto[] }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (items.length < 2) return;
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % items.length);
    }, ROTATE_MS);
    return () => window.clearInterval(timer);
  }, [items.length]);

  const manga = items[index];
  if (!manga) return null;

  const cover = coverImageUrl(manga, 512);
  const move = (step: number) => setIndex((current) => (current + step + items.length) % items.length);

  return (
    <section className="feature feature-slider" aria-label={`Top 10 truyện nổi bật · ${index + 1}/${items.length}`}>
      {cover && (
        <div className="feature-art feature-animate" key={`art-${manga.id}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="feature-bleed" src={cover} alt="" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="feature-poster" src={cover} alt="" fetchPriority={index === 0 ? "high" : undefined} />
          <SourceBadge source={manga.source} />
        </div>
      )}

      <div className="feature-copy feature-animate" key={`copy-${manga.id}`}>
        <p className="feature-label"><span aria-hidden="true" />Top 10 nổi bật · {index + 1}/{items.length}</p>
        <h1 id="featured-title">{manga.title}</h1>
        <p className="feature-meta">
          {manga.rating && manga.rating > 0 ? <strong>★ {manga.rating.toFixed(1)}</strong> : null}
          {manga.year ? <span>{manga.year}</span> : null}
          {manga.status ? <span>{statusText(manga.status)}</span> : null}
        </p>
        {manga.description ? <p className="feature-description">{manga.description}</p> : null}
        <Link href={`/manga/${manga.id}`} className="btn btn-primary">Xem truyện →</Link>
      </div>

      {items.length > 1 && (
        <div className="feature-slider-controls" aria-label="Điều khiển slide">
          <button type="button" aria-label="Truyện trước" onClick={() => move(-1)}>←</button>
          <div className="feature-dots">
            {items.map((item, dot) => (
              <button
                key={item.id}
                type="button"
                aria-label={`Hiện truyện ${dot + 1}: ${item.title}`}
                aria-current={dot === index}
                className={dot === index ? "active" : undefined}
                onClick={() => setIndex(dot)}
              />
            ))}
          </div>
          <button type="button" aria-label="Truyện tiếp" onClick={() => move(1)}>→</button>
        </div>
      )}
    </section>
  );
}
