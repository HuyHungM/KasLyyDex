# TruyệnViệt — web đọc manga (Rust)

Web đọc manga tiếng Việt / tiếng Anh, dữ liệu từ [MangaDex API](https://mangadex.org) (free, không cần key).

## Kiến trúc (2 giai đoạn)

- **Giai đoạn 1 (hiện tại): web** — frontend **Leptos 0.8 CSR → WebAssembly**, backend **Axum** mỏng serve API + SPA.
- **Giai đoạn 2 (chờ confirm): native Windows + Android** — UI **Slint** (`crates/app`, đã dựng sẵn khung UI), dùng chung crate `core`.

```
crates/core    # dùng chung: MangaDex client (reqwest + DNS 1.1.1.1), cache RAM moka, cache ảnh đĩa
crates/server  # Axum: /api/* + proxy ảnh + serve static (giai đoạn 1)
crates/ui      # Leptos CSR + trunk (giai đoạn 1)
crates/app     # Slint (giai đoạn 2 — chưa vào workspace)
legacy-next    # bản Next.js 16 đầu tiên (tham khảo)
```

## Chạy bản web

```bash
cargo build --release -p server
cd crates/ui && trunk build --release && cd ../..
cargo run --release -p server     # http://localhost:3100
```

Windows: nếu toolchain mặc định là GNU và build WASM lỗi `dlltool`, dùng toolchain MSVC cho Trunk:
`rustup target add wasm32-unknown-unknown --toolchain stable-x86_64-pc-windows-msvc` rồi
`$env:RUSTUP_TOOLCHAIN='stable-x86_64-pc-windows-msvc'; trunk build --release`.

Biến môi trường: `PORT` (3100), `DIST_DIR` (`crates/ui/dist`), `CACHE_DIR` (mặc định `%LOCALAPPDATA%/TruyenViet/cache`).

## Tính năng

- Trang chủ hiển thị các chương vừa cập nhật, truyện phổ biến và tiến độ đọc.
- Trang khám phá (`/search`) có bộ lọc theo thể loại, trạng thái và cách sắp xếp. URL giữ bộ lọc khi chia sẻ hoặc chuyển trang.
- Trang thể loại (`/the-loai`) và bảng xếp hạng (`/bxh`) sử dụng dữ liệu MangaDex.
- Tủ truyện (`/tu-truyen`) lưu truyện theo dõi trên trình duyệt và báo chương mới khi mở tủ.
- Trang truyện có chương tiếng Việt và tiếng Anh, mô tả, điểm đánh giá khi có dữ liệu và liên kết đến nguồn ngoài.
- Trang đọc hỗ trợ cuộn dọc, lật ngang, vuốt, tự cuộn, chế độ toàn màn hình khi trình duyệt hỗ trợ và ba nền đọc.
- Giao diện sáng/tối, cài đặt đọc và trang đang đọc dở được lưu trên trình duyệt.

## Tối ưu

- **API** dùng bộ nhớ đệm moka và HTTP `max-age`. Danh sách, chương và tìm kiếm được giữ 60 giây, bảng xếp hạng 5 phút, chi tiết truyện 1 giờ và thể loại 24 giờ.
- **Ảnh**: cache đĩa SHA-256 vĩnh viễn (`immutable`), proxy cùng origin — không CORS, không phụ thuộc DNS client (vài mạng sinkhole host MangaDex về 127.0.0.1; server resolve qua 1.1.1.1/8.8.8.8 bằng hickory-resolver)
- **WASM**: profile `wasm-release` (`opt-level="z"`, LTO, `panic=abort`) + wasm-opt; asset hash tên + immutable cache
- **Static**: HTML no-cache, asset immutable; nén brotli/gzip mọi response
- **Reader**: prefetch URL chapter kế tiếp khi đang đọc; ảnh lazy-load + `decoding=async`

## Giai đoạn 2 (Slint native + Android)

`crates/app/ui/app.slint` đã có UI đầy đủ (home/search/manga/reader, dark theme). Khi được confirm:
thêm `crates/app` vào workspace, viết `main.rs` nối Slint ↔ `core` (tokio thread + `upgrade_in_event_loop`),
build Windows (winit/femtovg) và Android (slint android backend + cargo-apk/gradle).
