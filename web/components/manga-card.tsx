/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { coverUrl, imgProxy, statusText, type MangaSummary } from "@/lib/types";

export function MangaCard({ manga }: { manga: MangaSummary }) {
  const cover = coverUrl(manga, 256);
  return (
    <Link href={`/manga/${manga.id}`} className="group block">
      <div className="relative aspect-[2/3] overflow-hidden rounded-lg bg-panel ring-1 ring-line transition group-hover:ring-vermillion/60">
        {cover ? (
          <img
            src={imgProxy(cover)}
            alt={manga.title}
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full items-center justify-center p-2 text-center text-xs text-muted">
            {manga.title}
          </div>
        )}
        {manga.status && (
          <span className="absolute left-1.5 top-1.5 rounded bg-ink/85 px-1.5 py-0.5 text-[11px] font-medium text-paper">
            {statusText(manga.status)}
          </span>
        )}
      </div>
      <h3 className="mt-2 line-clamp-2 text-sm font-medium leading-snug text-paper transition group-hover:text-vermillion">
        {manga.title}
      </h3>
      {manga.year && <p className="text-xs text-muted">{manga.year}</p>}
    </Link>
  );
}

export function MangaGrid({ list }: { list: MangaSummary[] }) {
  if (list.length === 0) {
    return <p className="py-8 text-center text-muted">Không có truyện nào.</p>;
  }
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
      {list.map((m) => (
        <MangaCard key={m.id} manga={m} />
      ))}
    </div>
  );
}

export function GridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="animate-pulse">
          <div className="aspect-[2/3] rounded-lg bg-panel" />
          <div className="mt-2 h-4 w-4/5 rounded bg-panel" />
        </div>
      ))}
    </div>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <span className="h-6 w-1.5 rounded-full bg-vermillion" aria-hidden />
      <h2 className="font-display text-xl font-semibold uppercase tracking-wide text-paper">{children}</h2>
      <span className="halftone h-4 flex-1 opacity-40" aria-hidden />
    </div>
  );
}