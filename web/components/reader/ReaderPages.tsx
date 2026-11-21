"use client";

import { useEffect, useRef, type RefObject } from "react";
import type { ReaderSettings } from "@/lib/guest";

type Props = {
  pages: string[];
  settings: ReaderSettings;
  page: number;
  onPage: (index: number) => void;
  onTurn: (direction: -1 | 1) => void;
  onPause: () => void;
  containerRef: RefObject<HTMLDivElement | null>;
};

export default function ReaderPages({
  pages, settings, page, onPage, onTurn, onPause, containerRef,
}: Props) {
  const pointerStart = useRef<{ x: number; y: number } | null>(null);

  // Stable per chapter/mode: this observer only reports the page under the
  // reading line. It never scrolls, so natural scroll and auto-scroll are not
  // fought by a scrollIntoView on every observed page change.
  useEffect(() => {
    if (settings.mode === "horizontal") return;
    const root = containerRef.current;
    if (!root) return;
    let active = true;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!active) return; // queued callbacks after chapter disposal are ignored
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const scroll = document.fullscreenElement
            ? (document.fullscreenElement as HTMLElement).scrollTop
            : window.scrollY;
          if (scroll < 1) {
            onPage(0);
            return;
          }
          const index = Number((entry.target as HTMLElement).dataset.index);
          if (Number.isInteger(index)) onPage(index);
        }
      },
      { rootMargin: "-25% 0px -73% 0px" },
    );
    root.querySelectorAll("img[data-index]").forEach((image) => observer.observe(image));
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [settings.mode, pages, onPage, containerRef]);

  if (settings.mode === "horizontal") {
    return (
      <div className="reader-paged" ref={containerRef} onPointerDown={onPause}>
        <img
          key={`${page}-${pages[page] ?? ""}`}
          className="reader-page img-fade"
          src={pages[page] ?? ""}
          data-index={page}
          data-loaded="false"
          alt={`Trang ${page + 1}`}
          draggable={false}
          onLoad={(event) => event.currentTarget.setAttribute("data-loaded", "true")}
          onPointerDown={(event) => {
            if (!event.isPrimary) {
              pointerStart.current = null;
              return;
            }
            pointerStart.current = { x: event.clientX, y: event.clientY };
          }}
          onPointerCancel={() => { pointerStart.current = null; }}
          onPointerUp={(event) => {
            const start = pointerStart.current;
            pointerStart.current = null;
            if (!start) return;
            const dx = event.clientX - start.x;
            const dy = event.clientY - start.y;
            if (Math.abs(dx) >= 50 && Math.abs(dx) > Math.abs(dy)) {
              onTurn(dx < 0 ? 1 : -1);
              return;
            }
            if (Math.abs(dx) < 12 && Math.abs(dy) < 12) {
              const rect = event.currentTarget.getBoundingClientRect();
              const offset = start.x - rect.left;
              if (offset < rect.width / 3) onTurn(-1);
              else if (offset > rect.width * 2 / 3) onTurn(1);
            }
          }}
        />
        <nav className="reader-paged-nav" aria-label="Lật trang">
          <button type="button" className="nav-btn" disabled={page === 0} onClick={() => onTurn(-1)}>← Trang trước</button>
          <button type="button" className="nav-btn" disabled={page + 1 >= pages.length} onClick={() => onTurn(1)}>Trang sau →</button>
        </nav>
      </div>
    );
  }

  return (
    <div className="reader-pages" ref={containerRef} onPointerDown={onPause}>
      {pages.map((src, index) => (
        <img
          key={`${src}-${index}`}
          className="reader-page img-fade"
          src={src}
          data-index={index}
          data-loaded="false"
          alt={`Trang ${index + 1}`}
          loading={index < 2 || index === page ? "eager" : "lazy"}
          decoding="async"
          onLoad={(event) => event.currentTarget.setAttribute("data-loaded", "true")}
        />
      ))}
    </div>
  );
}
