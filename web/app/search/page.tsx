import { Suspense } from "react";
import Link from "next/link";
import { searchManga } from "@/lib/mangadex";
import { GridSkeleton, MangaGrid, SectionTitle } from "@/components/manga-card";

type SearchParams = Promise<{ q?: string; page?: string }>;

async function Results({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const q = (sp.q || "").trim();
  const page = Math.max(1, parseInt(sp.page || "1", 10) || 1);
  if (!q) return <p className="py-8 text-muted">Nhập tên truyện vào ô tìm kiếm phía trên.</p>;

  const { results, total } = await searchManga(q, page);
  const pages = Math.ceil(total / 24);
  return (
    <>
      <p className="mb-4 text-sm text-muted">
        {total > 0 ? `${total} kết quả cho “${q}”` : `Không tìm thấy truyện nào cho “${q}”.`}
      </p>
      <MangaGrid list={results} />
      {pages > 1 && (
        <div className="mt-8 flex items-center justify-center gap-3 text-sm">
          {page > 1 && (
            <Link
              href={`/search?q=${encodeURIComponent(q)}&page=${page - 1}`}
              className="rounded-full bg-panel px-4 py-1.5 ring-1 ring-line transition hover:ring-vermillion"
            >
              ← Trang trước
            </Link>
          )}
          <span className="text-muted">
            Trang {page}/{pages}
          </span>
          {page < pages && (
            <Link
              href={`/search?q=${encodeURIComponent(q)}&page=${page + 1}`}
              className="rounded-full bg-panel px-4 py-1.5 ring-1 ring-line transition hover:ring-vermillion"
            >
              Trang sau →
            </Link>
          )}
        </div>
      )}
    </>
  );
}

export default function SearchPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <SectionTitle>Tìm kiếm</SectionTitle>
      <Suspense fallback={<GridSkeleton />}>
        <Results searchParams={searchParams} />
      </Suspense>
    </main>
  );
}