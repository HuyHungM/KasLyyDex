import SettingsForm from "@/components/account/SettingsForm";

export const metadata = { title: "Cài đặt đọc" };

export default function SettingsRoute() {
  return (
    <main className="wrap catalog-page">
      <div className="page-intro">
        <div><h1>Cài đặt đọc</h1><p>Đồng bộ với tài khoản, hoặc lưu trên thiết bị khi đọc ở chế độ khách.</p></div>
      </div>
      <SettingsForm />
    </main>
  );
}
