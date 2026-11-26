/* eslint-disable @next/next/no-img-element */
import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { serverContent } from "@/lib/content-server";
import { coverImageUrl, type ChaptersResponse, type MangaSummaryDto } from "@/lib/contracts";
import { chapterLabel, filterUrl, statusText, tagLabel } from "@/lib/format";
import ChapterList from "@/components/chapter-list";
import MangaActions from "@/components/manga-actions";
import { SectionTitle } from "@/components/manga-card";
import { SourceBadge } from "@/components/source-badge";
import CommentSection from "@/components/comments/CommentSection";

type Props = { params: Promise<{ id: string }> };

// Next keeps the encoded colon in route params; contentPath encodes once more.
function routeId(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const id = routeId((await params).id);
  try {
    const manga = await (await serverContent()).manga(id);
    return { title: manga.title, description: manga.description.slice(0, 160) };
  } catch {
    return { title: "Truyện" };
  }
}

async function MangaContent({ params }: Props) {
  const id = routeId((await params).id);
  let manga: MangaSummaryDto;
  let chapters: ChaptersResponse;
  try {
    const client = await serverContent();
    [manga, chapters] = await Promise.all([client.manga(id), client.chapters(id)]);
  } catch {
    notFound();
  }
  const lang = chapters.vi.some((chapter) => !chapter.external_url) ? "vi" : "en";
  const active = chapters[lang];
  const first = active.find((chapter) => !chapter.external_url);
  const cover = coverImageUrl(manga, 512);

  return (
    <main className="wrap">
      <Link href="/" className="back-link">← Về trang chủ</Link>
      <section className="surface manga-head">
        <div className="manga-cover">
          {cover && <img src={cover} alt="" fetchPriority="high" />}
          <SourceBadge source={manga.source} />
        </div>
        <div className="manga-info">
          <h1 className="manga-title">{manga.title}</h1>
          <p className="meta-row">
            {manga.author ? <>Tác giả: <b>{manga.author}</b></> : null}
            {manga.status ? <span className="stat-chip">{statusText(manga.status)}</span> : null}
            {manga.year ? <span>{manga.year}</span> : null}
            <span>{active.length} chapter ({lang === "vi" ? "tiếng Việt" : "English"})</span>
          </p>
          {manga.tags.length > 0 && (
            <div className="tags">
              {manga.tags.map((name, index) => {
                const tagId = manga.tag_ids[index];
                return tagId
                  ? <Link key={`${tagId}-${index}`} href={filterUrl("", [tagId], "", "follows", 1)} className="tag">{tagLabel(name)}</Link>
                  : <span key={`${name}-${index}`} className="tag">{tagLabel(name)}</span>;
              })}
            </div>
          )}
          {manga.description && <p className="desc">{manga.description}</p>}
          <div className="actions">
            <MangaActions
              mangaId={manga.id}
              title={manga.title}
              coverFile={manga.cover_file}
              lang={lang}
              firstChapterId={first?.id ?? null}
              firstChapterLabel={chapterLabel(first?.chapter)}
              hasExternal={active.length > 0}
            />
          </div>
        </div>
      </section>
      <section className="surface chapters-panel">
        <SectionTitle>Danh sách chapter</SectionTitle>
        {chapters.notice ? (
          <div className="source-notice" role="status"><span>{chapters.notice}</span></div>
        ) : null}
        <ChapterList mangaId={manga.id} chapters={chapters} />
      </section>
      <CommentSection targetType="manga" targetId={manga.id} />
    </main>
  );
}

export default function MangaPage({ params }: Props) {
  return (
    <Suspense
      fallback={
        <main className="wrap">
          <span className="back-link skel-bar load-back" aria-hidden="true" />
          <section className="surface manga-head skel" role="status" aria-label="Đang tải truyện">
            <div className="skel-cover big" aria-hidden="true" />
            <div className="skel-info" aria-hidden="true">
              <div className="skel-line w60" /><div className="skel-line w30" /><div className="skel-line w90" />
              <div className="skel-line w90" /><div className="skel-line w60" />
              <div className="tags"><span className="skel-pill" /><span className="skel-pill" /><span className="skel-pill" /></div>
              <div className="actions"><span className="skel-bar load-submit" /></div>
            </div>
          </section>
          <section className="surface chapters-panel" role="status" aria-label="Đang tải danh sách chapter">
            <div className="section-title"><h2>Danh sách chapter</h2></div>
            <div className="lang-tabs" aria-hidden="true"><span className="skel-bar load-pill" /><span className="skel-bar load-pill" /></div>
            <ul className="chapter-list">
              {Array.from({ length: 4 }, (_, index) => (
                <li key={index}>
                  <div className="chapter-row skel-chapter skel" aria-hidden="true">
                    <span className="skel-bar skel-num" />
                    <span className="skel-bar skel-title" />
                    <span className="skel-bar skel-date" />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </main>
      }
    >
      <MangaContent params={params} />
    </Suspense>
  );
}
