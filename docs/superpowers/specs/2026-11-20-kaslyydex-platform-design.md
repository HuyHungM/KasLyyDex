# KasLyyDex — Nền tảng đọc truyện đa nền tảng

## 1. Mục tiêu và phạm vi

KasLyyDex là nền tảng đọc manga tiếng Việt/Anh với một lõi Rust dùng chung,
web Next.js, Android Kotlin/Jetpack Compose và desktop GPUI.

Phạm vi trước mắt:

- Phase 1: nền tảng, Git, đổi tên, Next/Vercel, Neon PostgreSQL, auth, API
  contract, Rust Reader Core và WASM adapter.
- Phase 2: web product hoàn chỉnh: catalog, reader, tài khoản, tủ truyện,
  lịch sử/progress đồng bộ, bình luận, moderation, notification center và
  progression tu tiên level 1–1000.
- Phase 3: Android Kotlin/Compose + UniFFI.
- Phase 4: desktop GPUI + Rust core.

Ngoài MVP:

- rating sao/review dài;
- email notification, Web Push/FCM;
- thanh toán, subscription, quảng cáo;
- thread comment nhiều cấp;
- AI recommendation;
- Kubernetes/microservices.

## 2. Ranh giới hệ thống

```text
Vercel / Next.js
  ├─ App Router UI + SEO
  ├─ Neon Managed Auth / Better Auth
  ├─ /api/v1/* user BFF
  └─ Neon PostgreSQL

Axum Rust service
  ├─ /api/content/* MangaDex API
  ├─ DNS công cộng, cache dữ liệu
  ├─ proxy/cache ảnh
  └─ chapter/page content

Rust shared crates
  ├─ domain
  ├─ contracts
  ├─ reader-core
  └─ reader-wasm / UniFFI adapters
```

Next.js và Axum chạy cùng domain qua reverse proxy/rewrite:

- `/api/v1/*` → Next.js user BFF;
- `/api/content/*` → Axum content service;
- `/` → Next.js web.

Vercel chỉ chạy Next.js và user BFF. Axum deploy riêng trên Cloud Run, Fly.io,
Render hoặc VPS. Không chạy server Axum lâu dài trong Vercel Functions.

## 3. Đổi tên và repository

- Tên sản phẩm: `KasLyyDex`.
- Tên npm/package/service/UI/metadata/user-agent dùng `kaslyydex` hoặc
  `KasLyyDex` theo ngữ cảnh.
- Khởi tạo Git tại root `D:\Code\nodejs\kaslyydex`.
- Baseline commit giữ trạng thái hiện tại trước migration.
- Branch chính: `main`; feature branches dùng `phase-1-*`, `phase-2-*`.
- `legacy-next` được chuyển thành web app chính sau khi migration; `crates/ui`
  giữ tạm tới khi Next.js đạt parity.
- `crates/app` hiện tại không được xóa trước khi Phase 4 có thay thế GPUI đã
  build được.

## 4. Shared Rust architecture

### `crates/domain`

Pure Rust types, không runtime/network/UI dependency:

- `MangaId`, `ChapterId`, `UserId`;
- `Manga`, `Chapter`, `ReadingProgress`;
- `ReaderSettings`;
- `CultivationLevel`, `CultivationRealm`;
- `SystemRole` (`user`, `moderator`, `admin`);
- structured errors.

### `crates/contracts`

DTO ổn định cho Axum, Next BFF, WASM và native. Không public `serde_json::Value`
cho response chính. Các endpoint phải có input/output/error type rõ ràng.

### `crates/reader-core`

Pure state machine, không DOM, `web-sys`, React, Compose, GPUI, filesystem hay
HTTP:

- page index và total pages;
- next/previous boundary;
- vertical/horizontal mode;
- fit/background/speed;
- progress calculation;
- chapter navigation state.

### Adapters

- `crates/reader-wasm`: `wasm-bindgen` + `serde-wasm-bindgen`, dùng bởi Next.js.
- Android: UniFFI generated Kotlin bindings.
- GPUI: gọi trực tiếp Rust crate.

Next.js chịu trách nhiệm DOM, image loading, IntersectionObserver, gesture,
keyboard, fullscreen, fetch và local UI state.

## 5. Web, auth và Neon

- Next.js App Router 16 + React 19 + TypeScript strict.
- Tailwind CSS 4 + CSS variables.
- Neon Managed Auth (Better Auth) với email/password và Google OAuth.
- Session browser dùng HttpOnly/Secure/SameSite cookie.
- JWT plugin/JWKS để Android/GPUI có thể gọi API khác domain trong Phase 3/4.
- Phase 1 có spike bắt buộc: xác minh login native bằng system-browser OAuth/PKCE,
  token exchange và JWKS verification từ Axum. Không bắt đầu Phase 3 trước khi
  spike này pass; không giả định browser session cookie dùng được cho mobile.
- Drizzle ORM cho application tables; migrations versioned trong repository.
- Vercel Node runtime cho database routes; không đưa transaction user vào Edge
  runtime ở MVP.
- Neon preview branch cho Vercel Preview deployments.
- Connection string của database, auth secrets và Google credentials chỉ nằm trong Vercel
  environment variables; không commit secrets.

Mỗi user BFF handler phải:

1. đọc session/JWT;
2. validate input;
3. kiểm tra resource ownership/role;
4. thực thi transaction;
5. trả structured error.

Không chỉ bảo vệ page; Server Action/Route Handler tự kiểm tra auth lại.

## 6. PostgreSQL model

Neon Auth sở hữu identity/session tables. KasLyyDex sở hữu:

```text
profiles
user_roles
library_items
reading_progress
reading_completions
xp_events
cultivation_realms
comments
comment_reports
moderation_actions
notifications
user_achievements
```

Các invariant bắt buộc:

- `reading_completions UNIQUE(user_id, chapter_id)`; lưu `completed_at`,
  `page_count`, `last_page_seen` và `reader_session_id`.
- `xp_events UNIQUE(user_id, event_type, chapter_id)`; lưu `amount`,
  `rule_version`, `created_at`.
- `library_items UNIQUE(user_id, manga_id)`;
- `profiles.username` unique; progress unique theo user/manga/chapter/language;
- report đang mở unique theo user/comment;
- `comments.target_type` phân biệt manga/chapter, `parent_id` chỉ cho phép
  reply một cấp; trạng thái gồm visible/hidden/removed.
- foreign keys và cascade rules rõ ràng;
- timestamps lưu UTC.

## 7. User features Phase 2

- account/profile/avatar/name;
- local guest history/library merge khi login;
- library đồng bộ;
- reading history và progress đồng bộ;
- completed chapters;
- reader settings đồng bộ;
- in-app notification center;
- comment theo manga và chapter;
- reply một cấp;
- spoiler flag;
- edit/delete comment của chính user;
- report comment;
- moderator queue và moderation actions.

Comment hiển thị ngay sau khi gửi. Rate limit, độ dài tối đa, spam detection
cơ bản và report count bảo vệ hệ thống. Moderator có thể hide/remove/lock;
admin có thể quản lý moderator và policy.

## 8. Progression tu tiên

### EXP

- 100 EXP cho một chapter hợp lệ.
- Chỉ nhận khi đọc ít nhất 80% số trang.
- Chapter phải có pages trên content API và không có `external_url`.
- Một user/chapter chỉ nhận EXP một lần.
- Refresh, retry hoặc mở lại chapter không tạo EXP mới.
- Comment, report và view không tự tạo EXP trong MVP.

Server transaction:

```text
BEGIN
  update reading_progress
  insert reading_completion ON CONFLICT DO NOTHING
  nếu insert mới:
    insert xp_event ON CONFLICT DO NOTHING
    update profile total_xp và level
COMMIT
```

### Level

```text
level = min(1000, 1 + floor(total_xp / 200))
```

Level 1000 cần khoảng 199.800 EXP, tương đương khoảng 1.998 chapter hợp lệ.
Với 1–2 chapter/ngày, cap tương ứng khoảng 2.7–5.5 năm. Đây là giả định ban
đầu để đạt mục tiêu 3–5 năm ở người đọc đều; telemetry sẽ quyết định có cần
rule version mới hay không. Rule lưu version (`progression_v1`) để có thể cân
bằng lại mà không phá lịch sử.

### Progression anti-abuse boundary

Browser progress là dữ liệu client, không thể chứng minh tuyệt đối người dùng
đã đọc bằng mắt. MVP chống farm thực dụng, không tuyên bố chống bot tuyệt đối:

- BFF xác thực session, chapter hợp lệ, page count từ Axum và chapter có ảnh.
- BFF cấp reader-session ticket ký số, gắn với user/chapter/page count/thời hạn.
- Reader gửi checkpoint đơn điệu; server từ chối page lùi, ngoài range hoặc
  hoàn thành nhanh bất khả thi.
- Completion và XP event có unique constraints; endpoint idempotent.
- Giới hạn tốc độ progress/completion; XP chỉ cosmetic, không đổi thành tiền,
  vật phẩm có thể giao dịch hoặc quyền moderation.
- Report/admin audit hỗ trợ xử lý farm; không dùng client-supplied `percent`
  làm nguồn sự thật duy nhất.

### Danh hiệu

```text
1–9       Phàm Nhân
10–49     Luyện Khí
50–99     Trúc Cơ
100–199   Kim Đan
200–299   Nguyên Anh
300–399   Hóa Thần
400–499   Luyện Hư
500–599   Hợp Thể
600–699   Đại Thừa
700–799   Độ Kiếp
800–899   Chân Tiên
900–999   Tiên Vương
1000      Tiên Đế
```

Danh hiệu là profile/cosmetic: badge, avatar frame, title, màu tên và
achievement. Không dùng cultivation level để cấp quyền quản trị.

Quyền thật chỉ gồm `user`, `moderator`, `admin`. Admin bootstrap bằng seed/env
an toàn; không tự động nâng quyền theo EXP.

## 9. API namespaces

### Next BFF

```text
/api/v1/auth/*
/api/v1/me
/api/v1/me/library
/api/v1/me/progress
/api/v1/me/level
/api/v1/comments
/api/v1/comments/:id/reports
/api/v1/notifications
/api/v1/moderation/reports
```

### Axum content

```text
/api/content/popular
/api/content/latest
/api/content/search
/api/content/tags
/api/content/rank
/api/content/manga/:id
/api/content/manga/:id/chapters
/api/content/chapter/:id/pages
/api/content/img
```

Error body thống nhất:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Dữ liệu không hợp lệ.",
    "details": {}
  }
}
```

## 10. Deployment

### Trước tiên

1. Tạo Git repository và baseline commit.
2. Import `legacy-next` vào Vercel dưới tên KasLyyDex.
3. Deploy skeleton Next.js thành công.
4. Kết nối Neon integration với Vercel.
5. Tạo Development/Preview/Production database branches.
6. Chạy migrations ở Preview trước Production.

### Sau đó

- Deploy Axum content service riêng.
- Cấu hình `RUST_CONTENT_API_ORIGIN` trên Vercel.
- Cấu hình rewrite `/api/content/*`.
- Thêm domain chính sau khi Preview smoke test pass.

## 11. Testing và security

- Rust: `cargo test`, `cargo clippy`, `cargo fmt --check`.
- Next: TypeScript strict, ESLint, unit tests cho progression và validators.
- Playwright: auth, merge guest data, library, progress, EXP idempotency,
  comments, moderation, mobile reader.
- Test JWT/JWKS giữa Vercel và native API trước Phase 3.
- Rate limit comment/report/progress/auth attempts.
- CSP, HSTS, Referrer-Policy, Permissions-Policy.
- Sanitize comment rendering; spoiler content không render raw HTML.
- Validate MangaDex responses tại Axum boundary.
- Không log password, OAuth token, connection string của database hoặc JWT.

## 12. Phase gates

### Phase 1 exit criteria

- Git repository và baseline commit;
- KasLyyDex Next skeleton deploy thành công trên Vercel;
- Neon Auth + Neon branch kết nối được;
- migrations chạy được ở Preview;
- typed contracts tồn tại;
- reader-core có unit tests;
- reader-wasm build được;
- Axum content API chạy độc lập.

### Phase 2 exit criteria

- web UI không còn phụ thuộc Leptos runtime;
- auth email/Google hoạt động;
- library/progress merge và sync hoạt động;
- comments/report/moderation hoạt động;
- XP idempotent và level/title đúng;
- in-app notification hoạt động;
- Playwright desktop/mobile pass;
- security checklist pass.

### Phase 3 exit criteria

- Android Compose gọi được cùng API;
- UniFFI bindings ổn định;
- reader-core parity với web;
- history/library/progress sync đúng.

### Phase 4 exit criteria

- GPUI desktop prototype ổn định trên Windows;
- reader-core parity;
- packaging/update/logging native hoạt động;
- GPUI không làm thay đổi contracts hoặc domain core.
