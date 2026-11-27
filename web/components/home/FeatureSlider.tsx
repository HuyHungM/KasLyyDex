"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { SourceBadge } from "@/components/source-badge";
import { coverImageUrl, type MangaSummaryDto } from "@/lib/contracts";
import { statusText } from "@/lib/format";

const ROTATE_MS = 6500;
const FADE_MS = 700;

type Layer = "in" | "out";

type Slide = { current: number; previous: number | null };

export default function FeatureSlider({ items }: { items: MangaSummaryDto[] }) {
  const [slide, setSlide] = useState<Slide>({ current: 0, previous: null });
  const [reduceMotion, setReduceMotion] = useState(false);
  const [interacting, setInteracting] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) setReduceMotion(true);
  }, []);

  useEffect(() => {
    if (items.length < 2 || reduceMotion || interacting) return;
    const timer = window.setInterval(() => {
      setSlide((state) => ({ current: (state.current + 1) % items.length, previous: state.current }));
    }, ROTATE_MS);
    return () => window.clearInterval(timer);
  }, [items.length, reduceMotion, interacting]);

  useEffect(() => {
    if (slide.previous === null) return;
    const timer = window.setTimeout(() => setSlide((state) => ({ ...state, previous: null })), FADE_MS);
    return () => window.clearTimeout(timer);
  }, [slide.previous]);

  const manga = items[slide.current];
  if (!manga) return null;

  const outgoing = slide.previous === null ? null : items[slide.previous];
  const goTo = (next: number) => setSlide((state) => (
    next === state.current ? state : { current: next, previous: state.current }
  ));

  function renderArt(item: MangaSummaryDto, layer: Layer) {
    const cover = coverImageUrl(item, 512);
    if (!cover) return null;
    return (
      <div
        className="feature-art feature-animate"
        data-layer={layer}
        key={`art-${layer}-${item.id}`}
        aria-hidden={layer === "out" ? true : undefined}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="feature-bleed" src={cover} alt="" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="feature-poster" src={cover} alt="" fetchPriority={slide.current === 0 ? "high" : undefined} />
        <SourceBadge source={item.source} />
      </div>
    );
  }

  function renderCopy(item: MangaSummaryDto, layer: Layer) {
    const active = layer === "in";
    return (
      <div
        className="feature-copy feature-animate"
        data-layer={layer}
        key={`copy-${layer}-${item.id}`}
        aria-hidden={active ? undefined : true}
      >
        <p className="feature-label"><span aria-hidden="true" />Top 10 ngày · {slide.current + 1}/{items.length}</p>
        {active ? <h1 id="featured-title">{item.title}</h1> : <h2 className="feature-title">{item.title}</h2>}
        <p className="feature-meta">
          {item.rating && item.rating > 0 ? <strong>★ {item.rating.toFixed(1)}</strong> : null}
          {item.year ? <span>{item.year}</span> : null}
          {item.status ? <span>{statusText(item.status)}</span> : null}
        </p>
        <p className="feature-description">{item.description ?? ""}</p>
        {active ? (
          <Link href={`/manga/${item.id}`} className="btn btn-primary">Xem truyện →</Link>
        ) : <span className="btn btn-primary" aria-hidden="true">Xem truyện →</span>}
      </div>
    );
  }

  return (
    <section
      className="feature feature-slider"
      aria-label={`Top 10 ngày · ${slide.current + 1}/${items.length}`}
      onMouseEnter={() => setInteracting(true)}
      onMouseLeave={() => setInteracting(false)}
      onFocusCapture={() => setInteracting(true)}
      onBlurCapture={() => setInteracting(false)}
    >
      {outgoing ? renderArt(outgoing, "out") : null}
      {renderArt(manga, "in")}
      {outgoing ? renderCopy(outgoing, "out") : null}
      {renderCopy(manga, "in")}

      {items.length > 1 && (
        <div className="feature-slider-controls" aria-label="Điều khiển slide">
          <div className="feature-dots" role="group" aria-label="Chọn truyện">
            {items.map((item, dot) => (
              <button
                key={item.id}
                type="button"
                aria-label={`Hiện truyện ${dot + 1}: ${item.title}`}
                aria-current={dot === slide.current}
                className={dot === slide.current ? "active" : undefined}
                onClick={() => goTo(dot)}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
