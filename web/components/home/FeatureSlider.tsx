"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { SourceBadge } from "@/components/source-badge";
import { coverImageUrl, type MangaSummaryDto } from "@/lib/contracts";
import { statusText } from "@/lib/format";

const ROTATE_MS = 6500;

export default function FeatureSlider({ items }: { items: MangaSummaryDto[] }) {
  const [index, setIndex] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [interacting, setInteracting] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) setReduceMotion(true);
  }, []);

  useEffect(() => {
    if (items.length < 2 || reduceMotion || interacting) return;
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % items.length);
    }, ROTATE_MS);
    return () => window.clearInterval(timer);
  }, [items.length, reduceMotion, interacting]);

  const manga = items[index];
  if (!manga) return null;

  const cover = coverImageUrl(manga, 512);

  return (
    <section
      className="feature feature-slider"
      aria-label={`Top 10 truyện nổi bật · ${index + 1}/${items.length}`}
      onMouseEnter={() => setInteracting(true)}
      onMouseLeave={() => setInteracting(false)}
      onFocusCapture={() => setInteracting(true)}
      onBlurCapture={() => setInteracting(false)}
    >
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
          <div className="feature-dots" role="group" aria-label="Chọn truyện">
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
        </div>
      )}
    </section>
  );
}
