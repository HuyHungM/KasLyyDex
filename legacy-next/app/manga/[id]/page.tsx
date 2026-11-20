import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getChapters, getManga } from "@/lib/mangadex";
import { chapterLabel, coverUrl, imgProxy, statusText } from "@/lib/types";
import ChapterList from "@/components/chapter-list";
import MangaActions from "@/components/manga-actions";
import { SectionTitle } from "@/components/manga-card";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  try {
    const manga = await getManga(id);
    return { title: manga.title, description: manga.description.slice(0, 160) };
  } catch {
    return { title: "Truyện" };
  }
}

async function MangaContent({ params }: Params) {
  const { id } = await params;
  const manga = await getManga(id).catch(() => notFound());
  const [vi, en] = await Promise.all([getChapters(id, "vi"), getChapters(id, "en")]);
  // Prefer Vietnamese; fall back to English
  const lang = vi.some((c) => !c.externalUrl) ? "vi" : "en";
  const chapters = lang === "vi" ? vi : en;
  const first = chapters.find((c) => !c.externalUrl) || null;
  const cover = coverUrl(manga, 512);

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <div className="flex flex-col gap-6 sm:flex-row">
        <div className="relative mx-auto aspect-[2/3] w-52 shrink-0 overflow-hidden rounded-lg bg-panel ring-1 ring-line sm:mx-0">
          {cover && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imgProxy(cover)} alt={manga.title} className="absolute inset-0 h-full w-full object-cover" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-3xl font-semibold uppercase leading-tight tracking-wide">
            {manga.title}
          </h1>
          <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
            {manga.author && <span>Tác giả: <span className="text-paper">{manga.author}</span></span>}
            {manga.status && <span className="text-vermillion">{statusText(manga.status)}</span>}
            {manga.year && <span>{manga.year}</span>}
            <span>{chapters.length} chapter ({lang === "vi" ? "tiếng Việt" : "English"})</span>
          </p>
          {manga.tags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {manga.tags.slice(0, 12).map((t) => (
                <span key={t} className="rounded-full bg-panel px-2.5 py-0.5 text-xs text-muted ring-1 ring-line">
                  {t}
                </span>
              ))}
            </div>
          )}
          {manga.description && (
            <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-paper/90">
              {manga.description}
            </p>
          )}
          <div className="mt-5">
            <MangaActions
              mangaId={manga.id}
              lang={lang}
              firstChapterId={first?.id || null}
              firstChapterLabel={first ? chapterLabel(first) : ""}
              hasExternal={chapters.length > 0}
            />
          </div>
        </div>
      </div>

      <section className="mt-10">
        <SectionTitle>Danh sách chapter</SectionTitle>
        <ChapterList mangaId={manga.id} chapters={{ vi, en }} />
      </section>
    </main>
  );
}

export default function MangaPage({ params }: Params) {
  return (
    <Suspense
      fallback={
        <main className="mx-auto max-w-7xl animate-pulse px-4 py-8">
          <div className="flex flex-col gap-6 sm:flex-row">
            <div className="mx-auto aspect-[2/3] w-52 rounded-lg bg-panel sm:mx-0" />
            <div className="flex-1 space-y-3">
              <div className="h-8 w-2/3 rounded bg-panel" />
              <div className="h-4 w-1/3 rounded bg-panel" />
              <div className="h-24 w-full rounded bg-panel" />
            </div>
          </div>
        </main>
      }
    >
      <MangaContent params={params} />
    </Suspense>
  );
}