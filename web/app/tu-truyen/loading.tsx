import { ShelfSkeleton } from "@/components/loaders";

export default function Loading() {
  return (
    <main className="wrap catalog-page">
      <div className="page-intro">
        <div><h1>Tủ truyện</h1><p>Truyện bạn theo dõi — đồng bộ với tài khoản khi đăng nhập, hoặc lưu trên thiết bị này khi đọc khách.</p></div>
      </div>
      <ShelfSkeleton label="Đang tải tủ truyện" />
    </main>
  );
}
