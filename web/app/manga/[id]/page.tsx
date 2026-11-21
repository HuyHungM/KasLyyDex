/* eslint-disable @next/next/no-img-element */
import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { serverContent } from "@/lib/content-server";
import { coverImageUrl, type ChaptersResponse, type MangaSummaryDto } from "@/lib/contracts";
import { filterUrl, statusText, tagLabel } from "@/lib/format";
import ChapterList from "@/components/chapter-list";
import MangaActions from "@/components/manga-actions";
import { SectionTitle } from "@/components/manga-card";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  try {
    const manga = await (await serverContent()).manga(id);
    return { title: manga.title, description: manga.description.slice(0, 160) };
  } catch {
    return { title: "Truyện" };
  }
}

async function MangaContent({ params }: Props) {
  const { id } = await params;
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
              firstChapterLabel={first?.chapter ? `Ch. ${first.chapter}` : "Oneshot"}
              hasExternal={active.length > 0}
            />
          </div>
        </div>
      </section>
      <section className="surface chapters-panel">
        <SectionTitle>Danh sách chapter</SectionTitle>
        <ChapterList mangaId={manga.id} chapters={chapters} />
      </section>
    </main>
  );
}

export default function MangaPage({ params }: Props) {
  return (
    <Suspense
      fallback={
        <main className="wrap">
          <div className="surface manga-head skel">
            <div className="skel-cover big" />
            <div className="skel-info"><div className="skel-line w60" /><div className="skel-line w30" /><div className="skel-line w90" /></div>
          </div>
        </main>
      }
    >
      <MangaContent params={params} />
    </Suspense>
  );
}
