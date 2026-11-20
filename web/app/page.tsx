import { Suspense } from "react";
import { getLatest, getPopular } from "@/lib/mangadex";
import { GridSkeleton, MangaGrid, SectionTitle } from "@/components/manga-card";
import ContinueReading from "@/components/continue-reading";

async function Popular() {
  const list = await getPopular();
  return <MangaGrid list={list} />;
}

async function Latest() {
  const list = await getLatest();
  return <MangaGrid list={list} />;
}

export default function Home() {
  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <section className="relative mb-10 overflow-hidden rounded-xl bg-panel px-6 py-10 ring-1 ring-line sm:px-10">
        <div className="halftone absolute inset-0 opacity-30" aria-hidden />
        <div className="relative">
          <h1 className="font-display text-3xl font-semibold uppercase leading-tight tracking-wide sm:text-4xl">
            Kho manga <span className="text-vermillion">bản Việt &amp; Anh</span>
          </h1>
          <p className="mt-2 max-w-xl text-sm text-muted sm:text-base">
            Hàng chục nghìn bộ truyện từ MangaDex — đọc miễn phí, không quảng cáo, lưu lịch sử đọc ngay trên máy bạn.
          </p>
        </div>
      </section>

      <ContinueReading />

      <section className="mb-10">
        <SectionTitle>Phổ biến nhất</SectionTitle>
        <Suspense fallback={<GridSkeleton />}>
          <Popular />
        </Suspense>
      </section>

      <section className="mb-10">
        <SectionTitle>Mới cập nhật</SectionTitle>
        <Suspense fallback={<GridSkeleton />}>
          <Latest />
        </Suspense>
      </section>
    </main>
  );
}