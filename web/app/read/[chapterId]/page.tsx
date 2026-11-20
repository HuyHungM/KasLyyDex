import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getChapters, getManga } from "@/lib/mangadex";
import Reader from "@/components/reader";

type Props = {
  params: Promise<{ chapterId: string }>;
  searchParams: Promise<{ manga?: string; lang?: string }>;
};

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ chapterId }, sp] = await Promise.all([params, searchParams]);
  if (!sp.manga) return { title: "Đọc truyện" };
  try {
    const manga = await getManga(sp.manga);
    const chapters = await getChapters(sp.manga, sp.lang || "vi");
    const c = chapters.find((x) => x.id === chapterId);
    return { title: `${c ? `Ch. ${c.chapter ?? "Oneshot"} — ` : ""}${manga.title}` };
  } catch {
    return { title: "Đọc truyện" };
  }
}

async function ReadContent({ params, searchParams }: Props) {
  const [{ chapterId }, sp] = await Promise.all([params, searchParams]);
  if (!sp.manga) notFound();
  const lang = sp.lang === "en" ? "en" : "vi";
  const manga = await getManga(sp.manga).catch(() => notFound());
  const chapters = await getChapters(sp.manga, lang);
  return <Reader manga={manga} lang={lang} chapters={chapters} chapterId={chapterId} />;
}

export default function ReadPage(props: Props) {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[60vh] items-center justify-center text-sm text-muted">
          Đang tải chapter…
        </div>
      }
    >
      <ReadContent {...props} />
    </Suspense>
  );
}