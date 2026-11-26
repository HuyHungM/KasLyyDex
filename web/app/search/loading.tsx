import { GridSkeleton } from "@/components/manga-card";
import { SearchFiltersSkeleton } from "@/components/loaders";

export default function Loading() {
  return (
    <main className="wrap catalog-page">
      <div className="page-intro"><h1>Khám phá truyện</h1></div>
      <SearchFiltersSkeleton />
      <GridSkeleton />
    </main>
  );
}
