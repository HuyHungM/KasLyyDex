import { NoticeSkeleton } from "@/components/loaders";

export default function Loading() {
  return (
    <main className="wrap catalog-page">
      <div className="page-intro">
        <div><h1>Thông báo</h1><p>Phản hồi, kiểm duyệt và chương mới từ các truyện bạn theo dõi trên MangaDex.</p></div>
      </div>
      <div className="shelf-grid" role="status" aria-label="Đang tải thông báo" aria-busy="true">
        {Array.from({ length: 4 }, (_, index) => <NoticeSkeleton key={index} />)}
      </div>
    </main>
  );
}
