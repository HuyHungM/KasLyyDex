import { LineSkeleton } from "@/components/loaders";

export default function Loading() {
  return (
    <main className="wrap catalog-page" aria-busy="true">
      <div className="surface account-card"><LineSkeleton lines={6} label="Đang tải dữ liệu" /></div>
    </main>
  );
}
