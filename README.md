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
npm run test:aggregate    # Node/PGlite/API smoke, không cần secret
npm run test:browser      # cần Edge local hoặc Playwright Chromium
```

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
NEXT_PUBLIC_APP_URL
```

`READER_TICKET_SECRET` (>=32 ký tự) ký reader ticket; thiếu là progression API
fail-closed 503. Không tiền tố server secret bằng `NEXT_PUBLIC_`.

## Release gates

`.github/workflows/ci.yml` chạy mọi gate local, deterministic, không secret:
secret-pattern scan; `cargo fmt --check` scoped; clippy workspace `-D warnings`;
`cargo test --workspace`; `npm ci`; typecheck/lint; `build:wasm` → `build:web`;
aggregate tests; Playwright Chromium install + browser suites; `git diff --check`.

Full-workspace `cargo fmt --check` vẫn là baseline debt từ các file Leptos cũ;
CI scoped vào `domain`, `contracts`, `reader-core`, `server`. Xem
`infra/deployment.md` cho runbook, caveat first-deploy-is-production, chặn
402 fair-use trước đây, migration/rollback Neon và các external gate chưa chạy.

Observability: structured JSON logs có `correlationId`, redaction cho Cookie/
Authorization/ticket/password/email/DATABASE_URL/upstream key; metric names
`kaslyydex.user_requests` và `kaslyydex.user_request.duration_ms` chỉ với label
`operation`/`outcome` bounded. Local `metric()` là no-op; ingestion trên Vercel
chưa được xác minh và paid Observability không được bật tự động.
