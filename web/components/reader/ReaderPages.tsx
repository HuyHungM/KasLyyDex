"use client";

import { useEffect, useRef } from "react";
import type { ReaderSettings } from "@/lib/guest";

type Props = {
  pages: string[];
  settings: ReaderSettings;
  page: number;
  onPage: (index: number) => void;
  onTurn: (direction: -1 | 1) => void;
  onPause: () => void;
};

export default function ReaderPages({ pages, settings, page, onPage, onTurn, onPause }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (settings.mode === "horizontal" || !container.current) return;
    const root = container.current;
    const target = root.querySelector(`img[data-index="${page}"]`);
    if (page > 0 && target) target.scrollIntoView();

    const observer = new IntersectionObserver(
      (entries) => {
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
    return () => observer.disconnect();
  }, [settings.mode, pages, page, onPage]);

  if (settings.mode === "horizontal") {
    return (
      <div className="reader-paged" ref={container} onPointerDown={() => onPause()}>
        <img
          className="reader-page"
          src={pages[page] ?? ""}
          alt={`Trang ${page + 1}`}
          draggable={false}
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
    <div className="reader-pages" ref={container} onPointerDown={onPause}>
      {pages.map((src, index) => (
        <img
          key={`${src}-${index}`}
          className="reader-page"
          src={src}
          data-index={index}
          alt={`Trang ${index + 1}`}
          loading={index < 2 || index === page ? "eager" : "lazy"}
          decoding="async"
          onLoad={(event) => event.currentTarget.setAttribute("data-loaded", "true")}
        />
      ))}
    </div>
  );
}
