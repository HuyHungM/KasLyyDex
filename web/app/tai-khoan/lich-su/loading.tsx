import { HistorySkeleton } from "@/components/loaders";

export default function Loading() {
  return (
    <main className="wrap catalog-page">
      <div className="page-intro">
        <div><h1>Lịch sử đọc</h1><p>Trang hiện tại có thể lùi lại khi đọc lại; mục đã đọc xa nhất được giữ riêng.</p></div>
      </div>
      <HistorySkeleton label="Đang tải lịch sử" rows={4} />
    </main>
  );
}
