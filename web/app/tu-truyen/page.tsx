import LibraryView from "@/components/library-view";

export const metadata = { title: "Tủ truyện" };

export default function LibraryPage() {
  return (
    <main className="wrap catalog-page">
      <div className="page-intro">
        <div><h1>Tủ truyện</h1><p>Truyện bạn theo dõi, lưu trên thiết bị này.</p></div>
      </div>
      <LibraryView />
    </main>
  );
}
