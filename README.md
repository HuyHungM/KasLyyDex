# KasLyyDex — web đọc manga (Next + Rust)

Web đọc manga tiếng Việt / tiếng Anh, dữ liệu từ [MangaDex API](https://mangadex.org)
thông qua dịch vụ Axum. Không cần API key MangaDex.

## Kiến trúc Phase 1–2

```
web/            Next.js 16 App Router: UI, BFF, auth session, PostgreSQL/Drizzle
crates/server   Axum: /api/content/*, proxy ảnh, cache, static legacy SPA
crates/core     MangaDex client, DNS, RAM/disk cache (dùng bởi Axum)
crates/domain, contracts, reader-core, reader-wasm   contracts + WASM reader
crates/ui       legacy Leptos SPA (giữ lại, fmt baseline chưa sửa)
crates/app      Slint prototype (deferred Phase 3/4, outside workspace)
```

MangaDex chỉ được gọi từ Axum. Browser gọi same-origin `/api/content/*`; Next
không chuyển Cookie/Authorization tới Axum. Reader WASM được build từ Rust trước
mỗi lần `next build`; glue và file `.wasm` sinh ra không được commit.

## Nguồn dữ liệu và fallback

- MangaDex là nguồn chính cho catalog, danh sách chapter và metadata. Comick là
  fallback **theo từng chapter**: khi chapter MangaDex chỉ có `externalUrl`
  (hoặc chapter không đọc được), Axum thử tìm chapter Comick cùng tựa theo tựa
  đã normalize, rồi trả về metadata/page đã proxied. Chapter enum/ngoài tiêu chí
  hoặc Comick lỗi vẫn giữ nguyên liên kết ngoài; catalog MangaDex không đổi.
- Source hiển thị sau tiêu đề ở thẻ truyện, trang chi tiết, danh sách chapter và
  thanh reader: `MangaDex` (mặc định cho DTO cũ/không có `source`) hoặc `Comick`.
  ID chapter Comick có tiền tố `comick:`; tiến độ/XP gắn với source của chapter.
- `COMICK_API_ORIGIN` là override local/test cho catalog Comick, mặc định
  `https://api.comick.dev`; fixture dùng biến này để chạy offline. Không cần
  API key/secret và không giá trị nào được commit. Việc xác minh live endpoint,
  nội dung catalog và ToS của hai provider **vẫn là manual release gate** —
  fixture local không thay thế được kiểm tra đó.

## Giao diện đọc

- Reader theme mặc định `auto`: nền/chế độ đọc đi theo theme site; người dùng
  có thể chọn thủ công `light`, `sepia`, `dark`, và lựa chọn đó được lưu theo
  preference. Giá trị `auto` được chuẩn hóa ở cả guest local và validator API.
- Native `<select>` được thay bằng dropdown dùng `role="combobox"`/`listbox"`:
  ArrowDown/ArrowUp mở và di chuyển (bỏ qua option disabled), Enter/Space chọn,
  Escape đóng, Home/End tới đầu/cuối, Tab đóng. Một hidden input giữ nguyên giá
  trị form GET của tìm kiếm.
- Skeleton có hình dạng khớp nội dung thay vì khối chung; hiệu ứng chuyển động
  (chevron, fade ảnh, shimmer) nằm trong `prefers-reduced-motion`. Ảnh reader lỗi
  được giải phóng khỏi skeleton (ảnh hỏng hiện thay vì skeleton vĩnh viễn); panel
  thử lại hiện có chỉ xử lý lỗi tải chapter/WASM (`pageError`/`wasmError`), không
  có nút thử lại riêng cho từng ảnh.

## Chạy local

```bash
# Rust toolchain: stable + wasm32-unknown-unknown + wasm-bindgen-cli 0.2.130
cd web
npm ci
npm run build:wasm        # bắt buộc trước Next build
npm run build:web         # next build (không chạy lại prebuild)
npm run typecheck         # cần glue WASM + Next route types đã sinh
npm run lint
cd ..
cargo build -p server
cd web
npm run test:source       # 7 suite nguồn/fallback/UI/theme/dropdown/skeleton
npm run test:aggregate    # bao gồm cả 7 suite trên, không cần secret
npm run test:browser      # cần Edge local hoặc Playwright Chromium
```

`test:source`, `test:aggregate` và `test:browser` có pretest build Axum
(`cargo build -p server`) trước vì fixture content/fallback spawn binary đó;
chạy aggregate trước khi build server sẽ cho RED giả.

Axum local: `cargo run -p server` (`PORT`, `DIST_DIR`, `CACHE_DIR`,
`MANGADEX_API_ORIGIN` optional). Next local: `npm run dev` trong `web/`.

Health endpoints:
- `/api/v1/health` — liveness, credential-free, trả `{ok,version}` (Next) hoặc
  `{ok,service}` (Axum).
- `/api/v1/ready` — readiness: cấu hình, DB/upstream với timeout 1.5s; chỉ trả
  tên biến bị thiếu, không trả giá trị. Trên Axum readiness là config-only.

`node infra/healthcheck http://127.0.0.1:3000` in status codes, không in secret.
Thêm `--liveness-only` cho môi trường chưa cấu hình DB/auth.

## Biến môi trường (không commit giá trị)

Xem `web/.env.example`:

```
NEON_AUTH_BASE_URL
NEON_AUTH_COOKIE_SECRET
DATABASE_URL
READER_TICKET_SECRET
OPERATOR_EMAIL_ALLOWLIST (optional)
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
RUST_CONTENT_API_ORIGIN
COMICK_API_ORIGIN (optional, test override only)
NEXT_PUBLIC_APP_URL
```

`READER_TICKET_SECRET` (>=32 ký tự) ký reader ticket; thiếu là progression API
fail-closed 503. Không tiền tố server secret bằng `NEXT_PUBLIC_`.

## Release gates

`.github/workflows/ci.yml` chạy mọi gate local, deterministic, không secret:
secret-pattern scan; `cargo fmt --check` scoped (`domain`, `contracts`,
`reader-core`, `reader-wasm`, `server`, `core`); clippy workspace `-D warnings`;
`cargo test --workspace`; build Axum `cargo build -p server`; `npm ci`;
`build:wasm` → `build:web` → typecheck/lint; aggregate tests (bao gồm các suite
nguồn/fallback/UI/theme/dropdown/skeleton, server được build trước qua
pretest); Playwright Chromium install + browser suites; tracked-file
whitespace/conflict-marker scan với baseline — không vacuous trên clean
checkout, nhưng 783 finding đã commit trong
`docs/superpowers/sdd/kaslyydex-phase-1-2/*.diff` được baseline hóa qua
`web/scripts/whitespace-baseline.txt` thay vì sửa artifact của plan cũ; mọi
finding mới vẫn fail.

Full-workspace `cargo fmt --check` vẫn là baseline debt từ các file Leptos cũ;
CI scoped như trên. Xem
`infra/deployment.md` cho runbook, caveat first-deploy-is-production, chặn
402 fair-use trước đây, migration/rollback Neon và các external gate chưa chạy.
Live Comick/MangaDex provider verification và kiểm tra ToS vẫn là manual gate;
không có deploy/push/merge nào được thực hiện cho các thay đổi này.

Observability: structured JSON logs có `correlationId`, redaction cho Cookie/
Authorization/ticket/password/email/DATABASE_URL/upstream key; metric names
`kaslyydex.user_requests` và `kaslyydex.user_request.duration_ms` chỉ với label
`operation`/`outcome` bounded. Local `metric()` là no-op; ingestion trên Vercel
chưa được xác minh và paid Observability không được bật tự động.
