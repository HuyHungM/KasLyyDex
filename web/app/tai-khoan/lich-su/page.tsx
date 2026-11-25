import HistoryView from "@/components/account/HistoryView";

export const metadata = { title: "Lịch sử đọc" };

export default function HistoryRoute() {
  return (
    <main className="wrap catalog-page">
      <div className="page-intro">
        <div><h1>Lịch sử đọc</h1><p>Trang hiện tại có thể lùi lại khi đọc lại; mục đã đọc xa nhất được giữ riêng.</p></div>
      </div>
      <HistoryView />
    </main>
  );
}
