# TruyệnViệt · Kiểm tra bản web

## Bản giao diện App Đọc Truyện

- Trang chủ, danh mục, tìm kiếm nâng cao, bảng xếp hạng, tủ truyện và trang đọc đều nằm trong bản Leptos WASM.
- `cargo +stable-x86_64-pc-windows-msvc test --workspace` đạt 20 bài kiểm thử. Bản release của Axum và Trunk đều build được.
- Các luồng chính đã được kiểm tra trên Chromium với cửa sổ desktop và mô phỏng điện thoại rộng 375px. Vuốt trong chế độ lật ngang, đổi nền và vị trí đọc được giữ khi tải lại.
- WASM release là 825.669 byte, cao hơn mục tiêu dung lượng tệp gốc trong thiết kế. Axum truyền 324.627 byte với Brotli. Đo qua HTTP tại `localhost:3100`.
- Trang chủ nhận chương mới từ nguồn cập nhật gần đây. Tủ truyện kiểm tra toàn bộ danh sách theo dõi khi mở, tối đa bốn yêu cầu đồng thời.

## Checklist bản web ban đầu

Scope: finish the Leptos WASM + Axum web edition. Leave `crates/app`
(Slint) untouched until the user confirms Windows and Android work.

- [x] Reproduce and fix server/UI compiler errors.
- [x] Build the release server and optimized WASM bundle.
- [x] Verify routes, upstream requests, image cache and cache headers; fix observed failures.
- [x] Exercise home, search/pagination, manga, reader/navigation and reading history in a browser.
- [x] Record measured results and reproducible build/run commands.

Native Windows and Android are explicitly deferred pending confirmation.

## Build / run (verified 2026-11-20)

```powershell
cargo test -p server --release
cargo build --release -p server
$env:RUSTUP_TOOLCHAIN = 'stable-x86_64-pc-windows-msvc'  # see note below
Set-Location crates/ui; trunk build --release; Set-Location ../..
.\target\release\server.exe   # http://localhost:3100
```

The default GNU toolchain on this machine has `dlltool.exe` but no assembler
(`as.exe`), so host-side proc-macro deps (`windows-sys`, `getrandom`) fail to
build with `exit code 101`. The installed MSVC toolchain builds them cleanly;
`rustup target add wasm32-unknown-unknown --toolchain stable-x86_64-pc-windows-msvc`
was needed once. The server itself builds fine with the default GNU toolchain.

`wasm-opt` is not on PATH, so Trunk skipped its post-pass; the bundle is the
raw `wasm-release` output (510 KB). Install Binaryen and rebuild to enable it.

## Fixes made

- `crates/server/src/main.rs`: SPA fallback used `ServeDir::not_found_service`,
  which forces status 404 even though it served `index.html` (deep links such as
  `/search` were 404). Switched to `.fallback(...)` → 200 with the SPA shell.
- Same file: cache policy keyed on the URL path gave SPA HTML an `immutable`
  cache. Now keyed on response status and content-type: successful non-HTML
  assets immutable, HTML/errors `no-cache`. `cargo test -p server --release`
  passes 2/2; previously 1 failed.

## Measured results

- Build: server 24 s; WASM 1 m 02 s. Dist: `ui-*.js` 51 KB, `ui-*_bg.wasm`
  510 KB, hashed CSS 13 KB, `index.html` 1.5 KB.
- Browser load: document 26 ms, WASM 36 ms, `/api/popular` 245 ms,
  `/api/latest` 293 ms; no console errors.
- API: `/api/popular` 18 items; `/api/latest` 200; `/api/search` 27 results
  over 2 pages (both page requests 200); `/api/manga/{id}` and `/chapters`
  200 (vi/en groups); `/api/chapter/{id}/pages` 41 pages; licensed chapters
  return `external_url` and a source link instead of the reader.
- Images: `/api/img` 200 `image/png` with `max-age=31536000, immutable`;
  first fetch 115,962 bytes, second fetch (disk cache) ~222 ms.
- Cache headers: `/` and `/search` 200 `no-cache`; hashed `.wasm` 200
  `max-age=31536000, immutable`.
- UI flows exercised: home cards, search + next-page navigation, manga detail
  with language tabs, reader with 41 lazy images, scroll counter (Trang 9/41),
  chapter `<select>` and ArrowRight chapter change, `localStorage` history
  (`truyenviet:history`), and the home "Đọc tiếp · Ch. 2" shortcut.
