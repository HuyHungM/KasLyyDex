import Link from "next/link";
import { coverImageUrl, type MangaSummaryDto } from "@/lib/contracts";
import { chapterName, filterUrl, statusText, tagLabel } from "@/lib/format";

export function MangaCard({ manga, rank }: { manga: MangaSummaryDto; rank?: number }) {
  const cover = coverImageUrl(manga, 256);
  return (
    <Link href={`/manga/${manga.id}`} className="card">
      <div className="card-cover">
        {cover ? (
          <img src={cover} alt="" loading="lazy" decoding="async" />
        ) : (
          <div className="no-cover" aria-hidden="true">Chưa có bìa</div>
        )}
        {rank !== undefined && <span className="rank-num">{rank}</span>}
      </div>
      <h3 className="card-title">{manga.title}</h3>
      <p className="card-year">
        {manga.rating && manga.rating > 0 ? `★ ${manga.rating.toFixed(1)} · ` : ""}
        {manga.latest_chapter
          ? chapterName(manga.latest_chapter)
          : manga.status
            ? statusText(manga.status)
            : manga.year?.toString() ?? ""}
      </p>
    </Link>
  );
}

export function MangaGrid({ list }: { list: MangaSummaryDto[] }) {
  if (list.length === 0) return <p className="empty">Không có truyện nào.</p>;
  return (
    <div className="manga-grid">
      {list.map((manga) => <MangaCard key={manga.id} manga={manga} />)}
    </div>
  );
}

export function GridSkeleton() {
  return (
    <div className="manga-grid" role="status" aria-label="Đang tải truyện">
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className="skel">
          <div className="skel-cover" />
          <div className="skel-line" />
        </div>
      ))}
    </div>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="section-title">
      <h2>{children}</h2>
    </div>
  );
}

export function TagLinks({ mangas }: { mangas: MangaSummaryDto[] }) {
  const tags = new Map<string, string>();
  for (const manga of mangas) {
    manga.tags.forEach((name, index) => {
      const id = manga.tag_ids[index];
      if (id) tags.set(id, tagLabel(name));
    });
  }
  return (
    <div className="tag-options">
      {[...tags].slice(0, 12).map(([id, name]) => (
        <Link key={id} className="chapter-pill" href={filterUrl("", [id], "", "follows", 1)}>
          {name}
        </Link>
      ))}
    </div>
  );
}
