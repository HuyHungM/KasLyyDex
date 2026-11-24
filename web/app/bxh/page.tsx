import { Suspense } from "react";
import Link from "next/link";
import { serverContent } from "@/lib/content-server";
import { coverImageUrl, type LatestMangaDto, type MangaSummaryDto } from "@/lib/contracts";
import { SourceBadge } from "@/components/source-badge";
import { RankListSkeleton } from "@/components/rank-skeleton";

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
    <ol className="rank-list rank-podium">
      {list.slice(0, 24).map((manga, index) => {
        const cover = coverImageUrl(manga, 256);
        const podium = index < 3;
        return (
          <li key={manga.id} className={podium ? "podium-slot" : undefined}>
            <Link href={`/manga/${manga.id}`} className={`rank-row${podium ? ` podium-card rank-top rank-${index + 1}` : ""}`}>
              <b className={podium ? "top-rank" : undefined}>{index + 1}</b>
              <span className="rank-cover">
                {cover && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={cover} alt="" loading="lazy" />
                )}
                <SourceBadge source={manga.source} />
              </span>
              <span className="rank-title">
                {podium ? <span className="podium-tag" aria-hidden="true">HẠNG {index + 1}</span> : null}
                {manga.title}
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
    <main className="wrap catalog-page ranking-page">
      <div className="page-intro">
        <div><h1>Bảng xếp hạng</h1><p>Theo số lượt theo dõi, điểm đánh giá và cập nhật trên MangaDex.</p></div>
      </div>
      <section className="surface">
        <nav className="rank-tabs" aria-label="Cách xếp hạng">
          {TABS.map(([value, label]) => (
            <Link key={value} href={`/bxh?kind=${value}`} aria-current={kind === value ? "page" : undefined}>{label}</Link>
          ))}
        </nav>
        <Suspense key={kind} fallback={<RankListSkeleton />}>
          <RankList kind={kind} />
        </Suspense>
      </section>
    </main>
  );
}

export default function RankingPage(props: Props) {
  return (
    <Suspense fallback={<RankListSkeleton />}>
      <RankingContent {...props} />
    </Suspense>
  );
}
