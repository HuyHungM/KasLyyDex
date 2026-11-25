import type { Metadata } from "next";
import NotificationCenter from "@/components/notifications/NotificationCenter";

export const metadata: Metadata = { title: "Thông báo" };

export default function NotificationsPage() {
  return (
    <main className="wrap catalog-page">
      <div className="page-intro">
        <div>
          <h1>Thông báo</h1>
          <p>Phản hồi, kiểm duyệt và chương mới từ các truyện bạn theo dõi trên MangaDex.</p>
        </div>
      </div>
      <NotificationCenter autoRefresh />
    </main>
  );
}
