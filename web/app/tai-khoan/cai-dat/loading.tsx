import { FormSkeleton } from "@/components/loaders";

export default function Loading() {
  return (
    <main className="wrap catalog-page">
      <div className="page-intro">
        <div><h1>Cài đặt đọc</h1><p>Đồng bộ với tài khoản, hoặc lưu trên thiết bị khi đọc ở chế độ khách.</p></div>
      </div>
      <FormSkeleton label="Đang tải cài đặt" fields={4} />
    </main>
  );
}
