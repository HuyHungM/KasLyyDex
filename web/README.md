# KasLyyDex — web đọc manga

Web đọc manga tiếng Việt / tiếng Anh, dữ liệu và ảnh đều đi qua dịch vụ Axum (`RUST_CONTENT_API_ORIGIN`); trình đọc dùng state Rust thật biên dịch sang WASM.

## Stack

- Next.js 16 (App Router, Cache Components + Partial Prerendering, Turbopack)
- React 19 + TypeScript
- Axum (`crates/server`) là nguồn dữ liệu/image duy nhất; Next chỉ proxy cùng nguồn
- `reader-core` (Rust thuần) → `reader-wasm` (wasm-bindgen) cho mọi thao tác trang/tiến độ/cài đặt
- CSS thiết kế dùng lại `docs/design/DESIGN.md` + `crates/ui/style.css` (tối/lime, sidebar/bottom tabs, bìa thật)

## Chạy

```bash
npm install
npm run build:wasm        # cargo (wasm32) + wasm-bindgen -> web/generated + /wasm/*.wasm có hash
npm run build             # tự chạy prebuild = build:wasm
npm start -- -p 3100
```

`RUST_CONTENT_API_ORIGIN` bắt buộc (ví dụ `http://127.0.0.1:3100` cho Axum chạy local). Không có biến này, route nội dung trả 503 có cấu trúc; trang chủ vẫn hiển thị thông báo thay vì dữ liệu giả.

 build output (`web/generated`, `web/public/wasm`, `target/`) không được commit; CI/local phải chạy `npm run build:wasm` trước `next build`.

## Tính năng

- Trang chủ: featured, rail được theo dõi, chương mới, bảng xếp hạng, đọc tiếp/tủ truyện
- `/search`: lọc URL `q`, `tags` (comma-separated), `status`, `sort`, `page`; checkbox thể loại từ Axum
- `/the-loai`, `/bxh?kind=follows|rating|new`, `/tu-truyen`, `/manga/[id]` với tag có thể bấm
- Reader: cuộn dọc/lật ngang, vuốt/phím, khôi phục trang theo đúng chapter, lazy image, prefetch chapter sau, tự cuộn + dừng, nền riêng, toàn màn hình, tiến độ %
- Lưu localStorage `truyenviet:*`: tương thích camelCase Next cũ và snake_case Leptos; dữ liệu hỏng/không có storage không làm lỗi

## Kiểm tra

```bash
npm run lint                 # 0 error
npx tsc --noEmit
npm run test:task5           # build + 27 Node tests (Axum fixture thật + WASM thật)
npm run test:e2e             # 6 Playwright tests, dùng Edge có sẵn ở máy
cargo test --workspace
```

`test:e2e` dùng fixture content backend local và pre-seed cache ảnh của Axum; không gọi MangaDex thật và không đưa auth/content giả vào production. Ảnh chụp màn hình ghi tại `web/.test-screenshots/` (không commit).

## Ghi chú kỹ thuật

- `lib/contracts.ts`: DTO/client dùng chung; `lib/content-proxy.ts`: reject `.`/`..` (kể cả double-encoded), chỉ forward header an toàn, không Cookie/Authorization/Set-Cookie.
- `/api/content/*` là namespace mới; `/api/img` chỉ còn là alias forward sang Axum cho client Leptos cũ. Mọi URL ảnh page/cover mới đều là `/api/content/img?u=...`.
- Không còn `lib/mangadex.ts`, `lib/http.ts`, `/api/pages` hay fetcher ảnh MangaDex thứ hai trong Next.
- Trang động bọc `<Suspense>` theo yêu cầu của Cache Components; hook browser (WASM, localStorage) chỉ ở Client Component.
