import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { serverContent } from "@/lib/content-server";
import type { ChapterDto, MangaSummaryDto } from "@/lib/contracts";
import { chapterLabel } from "@/lib/format";
import ReaderClient from "@/components/reader/ReaderClient";
import { ReaderPageSkeleton } from "@/components/loaders";

type Props = {
  params: Promise<{ chapterId: string }>;
  searchParams: Promise<{ manga?: string; lang?: string }>;
};

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ chapterId }, query] = await Promise.all([params, searchParams]);
  if (!query.manga) return { title: "Đọc truyện" };
  try {
    const client = await serverContent();
    const [manga, chapters] = await Promise.all([client.manga(query.manga), client.chapters(query.manga)]);
    const chapter = [...chapters.vi, ...chapters.en].find((item) => item.id === chapterId);
    return { title: `${chapter ? `${chapterLabel(chapter.chapter)} — ` : ""}${manga.title}` };
  } catch {
    return { title: "Đọc truyện" };
  }
}

async function ReadContent({ params, searchParams }: Props) {
  const [{ chapterId }, query] = await Promise.all([params, searchParams]);
  if (!query.manga) notFound();
  const lang = query.lang === "en" ? "en" : "vi";
  let manga: MangaSummaryDto;
  let chapters: { vi: ChapterDto[]; en: ChapterDto[] };
  try {
    const client = await serverContent();
    [manga, chapters] = await Promise.all([client.manga(query.manga), client.chapters(query.manga)]);
  } catch {
    notFound();
  }
  const chapter = chapters[lang].find((item) => item.id === chapterId)
    ?? [...chapters.vi, ...chapters.en].find((item) => item.id === chapterId);
  if (!chapter) notFound();

  let pages: string[] = [];
  let pageError: string | null = null;
  if (!chapter.external_url) {
    try {
      pages = (await (await serverContent()).pages(chapterId)).pages;
    } catch {
      pageError = "Không tải được ảnh chương. Vui lòng thử lại.";
    }
  }

  return (
    <ReaderClient
      manga={manga}
      chapter={chapter}
      chapters={chapters[lang].length > 0 ? chapters[lang] : chapters.en}
      lang={lang}
      pages={pages}
      pageError={pageError}
    />
  );
}

export default function ReadPage(props: Props) {
  return (
    <Suspense
      fallback={
        <ReaderPageSkeleton />
      }
    >
      <ReadContent {...props} />
    </Suspense>
  );
}
