import { Suspense } from "react";
import Link from "next/link";
import { serverContent } from "@/lib/content-server";
import { coverImageUrl, type LatestMangaDto, type MangaSummaryDto } from "@/lib/contracts";
import { chapterName, relDate, statusText, titleWithSource } from "@/lib/format";
import { CardSkeleton, MangaCard } from "@/components/manga-card";
import ContinueReading from "@/components/continue-reading";

async function withContent<T>(load: (client: Awaited<ReturnType<typeof serverContent>>) => Promise<T>, fallback: T): Promise<T> {
  try {
    return await load(await serverContent());
  } catch {
    return fallback;
  }
}

function HeroSkeleton() {
  return (
    <div className="feature skel-hero skel" role="status" aria-label="Đang tải truyện nổi bật">
      <div className="feature-copy" aria-hidden="true">
        <span className="skel-bar skel-label" />
        <span className="skel-bar skel-title" />
        <span className="skel-bar skel-meta" />
        <span className="skel-bar skel-desc" />
        <span className="skel-bar skel-action" />
      </div>
    </div>
  );
}

function FeedSkeleton() {
  return (
    <div className="chapter-feed" role="status" aria-label="Đang tải chương mới">
      {Array.from({ length: 3 }, (_, index) => (
        <article className="feed-row skel-feed skel" key={index} aria-hidden="true">
          <span className="feed-cover" />
          <div className="feed-details">
            <span className="skel-line title" />
            <span className="skel-line short" />
            <div className="chapter-pills"><span className="skel-pill" /><span className="skel-pill" /></div>
          </div>
        </article>
      ))}
    </div>
  );
}

function RankSkeleton() {
  return (
    <ol className="rank-list" role="status" aria-label="Đang tải xếp hạng">
      {Array.from({ length: 5 }, (_, index) => (
        <li key={index}>
          <div className="skel-rank skel" aria-hidden="true">
            <span className="rank-row">
              <span className="skel-bar skel-rank-no" />
              <span className="rank-cover" />
              <span className="rank-title"><span className="skel-bar" /><span className="skel-bar" /></span>
              <span className="skel-bar skel-rank-score" />
            </span>
          </div>
        </li>
      ))}
    </ol>
  );
}

function FeatureFallback() {
  return (
    <section className="feature feature-fallback">
      <div className="feature-copy">
        <h1>Khám phá truyện</h1>
        <p>Tìm manga theo tên, thể loại hoặc xem các chương vừa cập nhật.</p>
        <Link href="/search" className="btn btn-primary">Tìm truyện →</Link>
      </div>
    </section>
  );
}

async function Featured() {
  const [manga] = await withContent((client) => client.rank("follows"), [] as MangaSummaryDto[]);
  if (!manga) return <FeatureFallback />;
  const cover = coverImageUrl(manga, 512);
  return (
    <section className="feature" aria-labelledby="featured-title">
      {cover && (
        <div className="feature-art" aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="feature-bleed" src={cover} alt="" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="feature-poster" src={cover} alt="" fetchPriority="high" />
        </div>
      )}
      <div className="feature-copy">
        <p className="feature-label"><span aria-hidden="true" />Truyện nổi bật</p>
        <h1 id="featured-title">{titleWithSource(manga.title, manga.source)}</h1>
        <p className="feature-meta">
          {manga.rating && manga.rating > 0 ? <strong>★ {manga.rating.toFixed(1)}</strong> : null}
          {manga.year ? <span>{manga.year}</span> : null}
          {manga.status ? <span>{statusText(manga.status)}</span> : null}
        </p>
        {manga.description ? <p className="feature-description">{manga.description}</p> : null}
        <Link href={`/manga/${manga.id}`} className="btn btn-primary">Xem truyện →</Link>
      </div>
    </section>
  );
}

async function Popular() {
  const list = await withContent((client) => client.rank("follows").then((rows) => rows.slice(0, 6)), [] as MangaSummaryDto[]);
  if (list.length === 0) return <p className="empty">Chưa có truyện để hiển thị.</p>;
  return (
    <div className="popular-rail">
      {list.map((manga, index) => <MangaCard key={manga.id} manga={manga} rank={index + 1} />)}
    </div>
  );
}

async function LatestFeed() {
  const feed = await withContent((client) => client.latest(), [] as LatestMangaDto[]);
  if (feed.length === 0) return <p className="empty">Chưa có chương mới. Bạn có thể tìm truyện theo thể loại.</p>;
  return (
    <div className="chapter-feed">
      {feed.map((item) => {
        const cover = coverImageUrl(item, 256);
        return (
          <article className="feed-row" key={item.id}>
            <Link href={`/manga/${item.id}`} className="feed-cover" aria-label={`Xem truyện ${item.title}`}>
              {cover && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={cover} alt="" loading="lazy" decoding="async" />
              )}
            </Link>
            <div className="feed-details">
              <h3><Link href={`/manga/${item.id}`}>{titleWithSource(item.title, item.source)}</Link></h3>
              <div className="chapter-pills">
                {item.chapters.map((chapter, index) => (
                  <Link
                    key={chapter.id}
                    href={`/read/${chapter.id}?manga=${encodeURIComponent(item.id)}&lang=${chapter.lang}`}
                    className={index === 0 ? "chapter-pill fresh" : "chapter-pill"}
                  >
                    {chapterName(chapter.chapter)}
                    <abbr title={chapter.lang === "vi" ? "Tiếng Việt" : "Tiếng Anh"}>
                      {chapter.lang === "vi" ? "VI" : "EN"}
                    </abbr>
                    {index === 0 ? <span className="feed-date">{relDate(chapter.publish_at)}</span> : null}
                  </Link>
                ))}
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

async function RankPanel() {
  const list = await withContent((client) => client.rank("follows").then((rows) => rows.slice(0, 5)), [] as MangaSummaryDto[]);
  return (
    <ol className="rank-list">
      {list.map((manga, index) => (
        <li key={manga.id}>
          <Link href={`/manga/${manga.id}`} className="rank-row">
            <b className={index < 3 ? "top-rank" : undefined}>{index + 1}</b>
            <span className="rank-cover">
              {coverImageUrl(manga, 256) && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={coverImageUrl(manga, 256) ?? ""} alt="" loading="lazy" />
              )}
            </span>
            <span className="rank-title">{titleWithSource(manga.title, manga.source)}<small>{manga.follows ? `${manga.follows} theo dõi` : ""}</small></span>
            {manga.rating && manga.rating > 0 ? <span className="rank-rating">★ {manga.rating.toFixed(1)}</span> : null}
          </Link>
        </li>
      ))}
    </ol>
  );
}

export default function Home() {
  return (
    <main className="wrap home">
      <Suspense fallback={<HeroSkeleton />}>
        <Featured />
      </Suspense>
      <ContinueReading />
      <section className="popular-section" aria-labelledby="popular-title">
        <div className="panel-heading">
          <h2 id="popular-title">Được theo dõi nhiều</h2>
          <Link href="/bxh" className="text-link">Xem xếp hạng →</Link>
        </div>
        <Suspense fallback={<div className="popular-rail" role="status" aria-label="Đang tải truyện">{Array.from({ length: 6 }, (_, index) => <CardSkeleton key={index} rank />)}</div>}>
          <Popular />
        </Suspense>
      </section>
      <div className="home-columns">
        <div className="home-main">
          <section className="surface feed-panel" aria-label="Mới cập nhật">
            <div className="panel-heading">
              <h2><span className="live-mark" aria-hidden="true" />Mới cập nhật</h2>
              <Link href="/bxh?kind=new" className="text-link">Xem danh sách →</Link>
            </div>
            <Suspense fallback={<FeedSkeleton />}>
              <LatestFeed />
            </Suspense>
          </section>
        </div>
        <aside className="home-side">
          <section className="surface">
            <div className="panel-heading"><h2>Bảng xếp hạng</h2><Link href="/bxh" className="text-link">Xem tất cả →</Link></div>
            <Suspense fallback={<RankSkeleton />}>
              <RankPanel />
            </Suspense>
          </section>
          <section className="surface shelf-preview">
            <h2>Tủ truyện của bạn</h2>
            <p>Lưu truyện đang theo dõi và đọc tiếp mọi lúc trên thiết bị này.</p>
            <Link href="/tu-truyen" className="btn">Mở tủ truyện →</Link>
          </section>
        </aside>
      </div>
    </main>
  );
}
