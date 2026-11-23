# TruyệnViệt · Kiểm tra bản web

## Bản giao diện App Đọc Truyện

- Trang chủ, danh mục, tìm kiếm nâng cao, bảng xếp hạng, tủ truyện và trang đọc đều nằm trong bản Leptos WASM.
- `cargo +stable-x86_64-pc-windows-msvc test --workspace` đạt 20 bài kiểm thử. Bản release của Axum và Trunk đều build được.
- Các luồng chính đã được kiểm tra trên Chromium với cửa sổ desktop và mô phỏng điện thoại rộng 375px. Vuốt trong chế độ lật ngang, đổi nền và vị trí đọc được giữ khi tải lại.
- WASM release là 825.669 byte, cao hơn mục tiêu dung lượng tệp gốc trong thiết kế. Axum truyền 324.627 byte với Brotli. Đo qua HTTP tại `localhost:3100`.
- Trang chủ nhận chương mới từ nguồn cập nhật gần đây. Tủ truyện kiểm tra toàn bộ danh sách theo dõi khi mở, tối đa bốn yêu cầu đồng thời.
- The "Khám phá truyện" hero has a GET `/search` form (`q`, accessible name
  "Tìm truyện") in both its featured and fallback states. The web client is
  MangaDex-only; no alternate catalog or prefixed content IDs are accepted.

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

## Phase 1–2 local release gate (Task 9)

The measurements below are from the Next/Axum build, not the older Leptos
measurements above. Full commands and counts are in
`docs/superpowers/sdd/kaslyydex-phase-1-2/task-9-report.md`.

- WASM generated from Rust by `npm run build:wasm`:
  `reader_core.25cb810c379e858e.wasm`, 150,508 source bytes, 43,875 bytes after
  Brotli compression (computed locally; deployment transfer encoding unverified).
- Reader startup: browser suites instantiate the real WASM module, decode
  fixture pages, restore chapter-local state and show a visible retry when the
  WASM response is corrupted; no fake success fallback.
- 375px: home and reader suites assert `document`/`body` scroll width does not
  exceed the viewport by more than 1px. Desktop and mobile screenshots are
  written to ignored `web/.test-screenshots/`.
- API error paths: missing auth/content/DB/ticket config returns structured 503,
  malformed IDs return 400, upstream failures are generic 502 without
  credentials, and cross-origin mutations are rejected before writes.
- Auth ownership: real SDK session fixtures show comments, library/progress and
  completion records scoped to the authenticated user; client role fields and
  ticket forgery never grant ownership or XP.
- External Neon/Google/Vercel verification and live browser-to-Neon SQL remain
  manual gates; no Preview or Production deployment was verified.

## Multi-source reading UX + final local gate (Task 10)

Exact commands, counts and rulings are in
`docs/superpowers/sdd/kaslyydex-multi-source-ux/task-10-report.md`.

- The web client is MangaDex-only: all content ids are MangaDex UUIDs, covers
  resolve through the Axum image proxy, and `source=mangadex` is the sole
  provider filter alongside `all`. Source badges render as `MangaDex` on
  home/detail cards and covers, with no alternate-provider labels.
- No provider credentials are involved; live MangaDex catalog and ToS
  verification remain a manual release gate — not claimed here.
- Reader theme defaults to `auto` (follows the site theme, no flash on load);
  manual `light`/`sepia`/`dark` persist over it. Custom dropdown replaces
  native selects everywhere with full keyboard support (Arrow/Home/End/Enter/
  Space/Escape/Tab) and submits unchanged values via a hidden input. Skeletons
  match content shape and all motion is guarded by `prefers-reduced-motion`;
  broken reader images are released from the fade gate instead of staying behind
  a permanent skeleton. The existing retry panel covers chapter/WASM page-load
  failures (`pageError`/`wasmError`), not individual images.
- Regression gate: `web/package.json` `test:aggregate` includes
  `source-contracts`, `source-ui`, `source-progression`, `select`,
  `skeleton-motion` and `reader-theme`; `test:source` runs the same set.
  Pretest hooks run `cargo build -p server` before
  aggregate/browser suites spawn the Axum binary (ordering fix; without it
  fixture tests false-RED on the missing binary). CI runs the same order.
- Whitespace gate is baselined: 783 pre-existing findings in committed
  `docs/superpowers/sdd/kaslyydex-phase-1-2/*.diff` are listed in
  `web/scripts/whitespace-baseline.txt`; any new finding still fails.
- No deployment, push, merge, or live provider verification was performed.

## Advanced search UX + final local gate (Task 7)

- Advanced search: `/search` ("Khám phá") keeps `source` (`all`/`mangadex`),
  `lang` (`all`/`vi`/`en`) and `year` (1900…current+1) in the same GET form as
  `q`/tags/status/sort/page. Axum searches MangaDex, sorts deterministically
  and returns at most 24 results per page. When a filter can only be applied
  locally or the provider fails, `partial=true` makes the UI show a short
  warning instead of implying a complete result.
- Genre browsing moved into the same page: four grouped tag sections with a
  four-group skeleton; the standalone Next `/the-loai` route and nav link are
  gone.
- Cover badges replace title suffixes: `MangaDex` with accessible name
  `Nguồn: MangaDex` on cards, feed, ranking and detail covers.
- `/bxh` has a route-level loading shell with 12 shape-matched rows and
  `rank-top rank-1/2/3` frames for the top three rows; tab changes re-show the
  skeleton and skeleton/loaded row boxes stay within 2px, with shimmer disabled
  under `prefers-reduced-motion`.
- `test:aggregate` now runs 28 aggregate test files (7 source + 5 new among
  them): the previous suites plus `search-contracts`, `search-source`,
  `advanced-search`, `source-badge`, `ranking-skeleton`. CI installs Chromium
  before aggregate since two of the new suites are Playwright tests; the Axum
  prebuild hooks are unchanged.
- Local gate results: `build:wasm`/`build` pass; aggregate 203 pass / 0 fail;
  browser 23 pass / 0 fail; `cargo build -p server` pass; workspace tests
  90 pass / 0 fail; clippy `-D warnings`, scoped fmt,
  typecheck, lint (0 errors, 7 pre-existing `@next/next/no-img-element`
  warnings), whitespace (0 new findings), secrets (0 candidates) and
  `git diff --check` all pass.
- No deployment, push, merge or live provider verification was done. Live
  MangaDex catalog and ToS checks remain manual release gates.
