import type { Metadata } from "next";
import NotificationCenter from "@/components/notifications/NotificationCenter";

export const metadata: Metadata = { title: "Thông báo" };

export default function NotificationsPage() {
  return (
    <main className="wrap">
      <NotificationCenter autoRefresh />
    </main>
  );
}
