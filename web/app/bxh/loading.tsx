import Link from "next/link";
import { RankListSkeleton } from "@/components/rank-skeleton";

const TABS = [
  ["follows", "Theo dõi"],
  ["rating", "Đánh giá"],
  ["new", "Mới cập nhật"],
] as const;

export default function Loading() {
  return (
    <main className="wrap catalog-page ranking-page">
      <div className="page-intro">
        <div><h1>Bảng xếp hạng</h1><p>Theo số lượt theo dõi, điểm đánh giá và cập nhật trên MangaDex.</p></div>
      </div>
      <section className="surface">
        <nav className="rank-tabs" aria-label="Cách xếp hạng">
          {TABS.map(([value, label]) => (
            <Link key={value} href={`/bxh?kind=${value}`}>{label}</Link>
          ))}
        </nav>
        <RankListSkeleton />
      </section>
    </main>
  );
}
