import { Suspense } from "react";
import Link from "next/link";
import { serverContent } from "@/lib/content-server";
import { coverImageUrl, type LatestMangaDto, type MangaSummaryDto } from "@/lib/contracts";
import { titleWithSource } from "@/lib/format";

type Props = { searchParams: Promise<{ kind?: string }> };

const TABS = [
  ["follows", "Theo dõi"],
  ["rating", "Đánh giá"],
  ["new", "Mới cập nhật"],
] as const;

async function RankList({ kind }: { kind: (typeof TABS)[number][0] }) {
  let list: MangaSummaryDto[] = [];
  try {
    const client = await serverContent();
    list = kind === "new"
      ? (await client.latest()).map((item: LatestMangaDto) => item)
      : await client.rank(kind);
  } catch {
    return <div className="surface empty" role="alert">Chưa tải được bảng xếp hạng. Vui lòng thử lại sau.</div>;
  }
  if (list.length === 0) return <p className="empty">Chưa có truyện để xếp hạng.</p>;

  return (
    <ol className="rank-list">
      {list.slice(0, 24).map((manga, index) => {
        const cover = coverImageUrl(manga, 256);
        return (
          <li key={manga.id}>
            <Link href={`/manga/${manga.id}`} className="rank-row">
              <b className={index < 3 ? "top-rank" : undefined}>{index + 1}</b>
              <span className="rank-cover">
                {cover && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={cover} alt="" loading="lazy" />
                )}
              </span>
              <span className="rank-title">
                {titleWithSource(manga.title, manga.source)}
                <small>{manga.follows ? `${manga.follows} theo dõi` : ""}</small>
              </span>
              {manga.rating && manga.rating > 0 ? <span className="rank-rating">★ {manga.rating.toFixed(1)}</span> : null}
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

async function RankingContent({ searchParams }: Props) {
  const query = await searchParams;
  const kind: (typeof TABS)[number][0] = TABS.some(([value]) => value === query.kind)
    ? query.kind as (typeof TABS)[number][0]
    : "follows";
  return (
    <main className="wrap catalog-page">
      <div className="page-intro">
        <div><h1>Bảng xếp hạng</h1><p>Theo số lượt theo dõi, điểm đánh giá và cập nhật trên MangaDex.</p></div>
      </div>
      <section className="surface">
        <nav className="rank-tabs" aria-label="Cách xếp hạng">
          {TABS.map(([value, label]) => (
            <Link key={value} href={`/bxh?kind=${value}`} aria-current={kind === value ? "page" : undefined}>{label}</Link>
          ))}
        </nav>
        <Suspense key={kind} fallback={<div className="rank-loading" role="status" aria-label="Đang tải xếp hạng" />}>
          <RankList kind={kind} />
        </Suspense>
      </section>
    </main>
  );
}

export default function RankingPage(props: Props) {
  return (
    <Suspense fallback={<main className="wrap catalog-page" role="status" aria-label="Đang tải bảng xếp hạng" />}>
      <RankingContent {...props} />
    </Suspense>
  );
}
