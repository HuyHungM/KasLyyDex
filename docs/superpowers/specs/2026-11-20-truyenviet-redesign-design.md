# TruyệnViệt — Redesign toàn bộ + tính năng Tier A (2026-11-20)

## Mục tiêu

Nâng cấp web đọc truyện Leptos WASM + Axum thành một trang đọc truyện chuyên
nghiệp cho người dùng Việt Nam: giao diện mới hoàn toàn theo hướng **"App Đọc
Truyện"** (mockup đã duyệt: `docs/design/mockups/m3-app-doc-truyen.html`),
mobile-first, thuần Việt, không tài khoản, không database.

Thành công = người dùng trên điện thoại có thể: thấy chương mới ngay trang chủ,
theo dõi truyện vào tủ, lọc tìm kiếm theo thể loại, xem xếp hạng, và đọc với
reader chuyên nghiệp (cuộn dọc / lật ngang, nền đọc, tự cuộn) — mọi thao tác
chạm ≥ 44px, không lỗi console.

## Phạm vi

**Trong:** redesign toàn bộ UI (header, home, search, manga, reader, footer,
404) + 4 trang mới (Thể loại, BXH, Tủ truyện, tìm kiếm nâng cao) + API mở rộng
+ dark/light + thuần Việt hóa.

**Ngoài (đã chốt với user):** tài khoản/đăng nhập, bình luận, đánh giá của
người dùng, database, đồng bộ đa thiết bị, Slint native (`crates/app` không
đụng), thêm dependency mới.

## Kiến trúc (giữ nguyên khung hiện tại)

```
MangaDex API ── core (reqwest + DNS công cộng + cache moka) ── Axum /api/* + proxy ảnh + static
                                                                        │
                                              Leptos CSR WASM (ui) ─────┘
                                              localStorage: history, library, theme, reader
```

Không thêm tầng mới. Mọi tính năng "cá nhân" (tủ truyện, cài đặt) sống ở
localStorage; mọi dữ liệu truyện đi qua proxy hiện có (giữ cache ảnh đĩa +
chống DNS sinkhole).

## 1. Thiết kế thị giác (từ mockup M3)

- **Token sáng (mặc định):** nền `#faf9f7`, card `#ffffff`, chữ `#1c1b1a`,
  muted `#8a857c`, line `#eceae4`, accent `#e8492e` (vermillion, 1 accent duy
  nhất), accent-soft `#fdeee9`.
- **Token tối:** nền `#121317`, card `#1a1c22`, chữ `#f0ede7`, muted
  `#9aa0b4`, line `#2a2e38`, accent giữ `#ff5a3c`.
- **Typography:** Be Vietnam Pro (400–800) cho mọi thứ; tiêu đề 800
  tracking-tight; body 16px/1.6; không font display thứ hai.
- **Signature element:** *feed chương mới* — hàng truyện với 3 pill chương gần
  nhất (chương mới nhất nền accent-soft), xuất hiện ở home desktop + mobile và
  là lý do trang chủ tồn tại. Không hiệu ứng trang trí khác.
- **Bo góc:** card/panel 14px, ảnh bìa 8–10px, pill 8px, nút 10–12px.
- **Mobile:** bottom tab bar 4 tab (Trang chủ, Thể loại, BXH, Tủ truyện — có
  chấm đỏ khi tủ có chương mới); header gọn (logo + search + theme).
- **Desktop:** home 2 cột — feed + phổ biến (trái), BXH + tủ truyện (phải,
  320px). Các trang khác 1 cột max-width 1180px.
- **Motion:** chỉ transform/opacity, ≤ 200ms, tắt dưới `prefers-reduced-motion`.
  Skeleton đúng kích thước thật; không spinner tròn.
- **A11y:** focus-visible ring accent; aria-label cho icon button; contrast
  AA cả 2 theme; `min-height: 100dvh`.

## 2. API mới / mở rộng (`core` + `server`)

| Route | Tham số | Trả về | Cache |
|---|---|---|---|
| `/api/tags` | — | `[{id, name, group}]` từ `/manga/tag` (name.en) | RAM 24h + max-age=86400 |
| `/api/search` | `q, page, tags` (UUID, phẩy), `status`, `sort` | như cũ + `rating`, `follows` mỗi kết quả | 60s |
| `/api/rank` | `kind=follows\|rating` | top 24 summary + `rating` (bayesian), `follows` | 5 phút |
| `/api/latest` | — | như cũ + `chapters`: tối đa 3 chương đọc được gần nhất `{id, chapter, publish_at}` mỗi truyện (tận dụng feed đã gọi, không thêm request upstream) | 60s |
| `/api/manga/{id}` | — | như cũ + `rating`, `follows` (join `/statistics/manga/{id}` song song) | 1h |

- `sort` hợp lệ: `follows` → `order[followedCount]=desc`, `rating` →
  `order[rating]=desc`, `new` → `order[latestUploadedChapter]=desc`, `year` →
  `order[year]=desc`, `title` → `order[title]=asc`. Mặc định `follows`. Giá trị
  lạ → 400. `status` ∈ ongoing/completed/hiatus/cancelled; lạ → 400.
  `tags`: tối đa 8 UUID, sai định dạng → 400.
- `/api/rank`: gọi `/manga?limit=24&order[...]` rồi 1 call
  `/statistics/manga?manga[]=…` gộp vào summary.
- Giữ `LIST_PARAMS` (contentRating safe+suggestive, hasAvailableChapters).
- Cache header: API mới theo bảng trên; static giữ policy đã sửa
  (HTML no-cache, asset hash immutable).

## 3. Trang & tính năng UI (`crates/ui`)

### Header + navigation
- Logo "T TruyệnViệt", search, nav 4 mục, toggle theme (icon mặt trăng/mặt
  trời, SVG stroke 2 nhất quán). Mobile: bottom tab bar thay nav.
- Theme: `localStorage truyenviet:theme` ("light" mặc định / "dark"), script
  inline trong `index.html` set `data-theme` trước paint (không nháy).

### Home `/`
- Feed "Mới cập nhật" (signature): từ `/api/latest` — mỗi hàng: bìa 46px, tên,
  3 pill chương (pill mới nhất accent-soft + thời gian tương đối), nhãn ngôn
  ngữ. Bấm pill → reader; bấm tên/bìa → trang truyện.
- "Phổ biến nhất": hàng cuộn ngang (scroll-snap) với số hạng 1–6, ★ rating.
- Cột phải desktop: BXH mini (top 5, tab Theo dõi/Đánh giá) + Tủ truyện
  (empty state có CTA "Khám phá truyện" khi chưa theo dõi).
- "Đọc tiếp" (history) giữ, dạng hàng ngang có progress bar.

### Thể loại `/the-loai`
- Tag từ `/api/tags` nhóm theo group (genre, theme, content, format), hiển thị
  tên Việt cho ~30 tag phổ biến (map tĩnh: Action→Hành động, Romance→Tình cảm,
  Comedy→Hài hước, Isekai→Isekai, …), còn lại giữ tên Anh.
- Bấm tag → `/search?tags=<id>&tagname=<tên>`.

### Tìm kiếm `/search`
- Panel lọc: chip tag đa chọn (từ `/api/tags`), select trạng thái, select sắp
  xếp. Mọi thứ trên URL: `q, tags, status, sort, page` — chia sẻ được.
- Kết quả: grid card có ★ rating + chương mới nhất; phân trang giữ nguyên.
- Mobile: panel lọc thu gọn vào nút "Bộ lọc" mở rộng xuống.

### BXH `/bxh`
- 3 tab: Theo dõi / Đánh giá / Mới cập nhật. Top 24 dạng hàng số hạng (1–3
  accent) + bìa + tên + ★ + follows. Tab "Mới" dùng `/api/latest`.

### Tủ truyện `/tu-truyen`
- `localStorage truyenviet:library`: `[{manga_id, title, cover_file, lang,
  followed_at, last_chapter_id}]`, tối đa 200.
- Nút "＋ Theo dõi / ✓ Đang theo dõi" ở trang truyện.
- Trang tủ: grid card; kiểm tra chương mới: gọi `/api/manga/{id}/chapters`
  cho từng truyện (giới hạn 4 request đồng thời), so chương đọc được mới nhất
  với `last_chapter_id` → badge "Chương mới"; bấm đọc cập nhật
  `last_chapter_id`. Nút xóa khỏi tủ.
- Chấm đỏ trên tab Tủ truyện khi có chương mới (tính khi mở home/tủ).

### Trang truyện `/manga/:id`
- Layout mockup: bìa trái 230px, info phải — tên, chip ★ rating + follows +
  trạng thái + năm + tag, mô tả, nút "Đọc từ đầu · Chương 1" / "Đọc tiếp",
  nút Theo dõi.
- Danh sách chương: "Chương N", ngày tương đối, ✓ đã đọc, tab vi/en giữ
  logic ưu tiên vi hiện tại.

### Reader `/read/:chapter_id`
- **2 chế độ:** cuộn dọc (mặc định, giữ lazy-load + IntersectionObserver đếm
  trang) và lật ngang (1 trang/lần, ảnh fit khung, chuyển bằng nút, phím
  ←/→, swipe cảm ứng, chạm nửa trái/phải màn hình). Chế độ ngang: ←/→ đổi
  trang, đổi chương bằng nút/select.
- **Fit:** vừa khung (max 768px) / tràn khổ ngang.
- **Tự cuộn** (chỉ chế độ dọc): tốc độ 1–5, dừng khi người dùng chạm/cuộn tay.
- **Nền đọc:** sáng / sepia / tối — độc lập với theme site, lưu riêng.
- **Fullscreen:** nút requestFullscreen (ẩn khi không hỗ trợ).
- Cài đặt lưu `localStorage truyenviet:reader` `{mode, fit, bg, speed}`.
- Mobile: thanh dưới cùng (← Chương trước | Trang x/y | Chương sau →) + hàng
  cài đặt (segment chế độ + 3 chấm nền) như mockup. Desktop: controls trên
  thanh trên.
- Giữ: prefetch chương kế, lịch sử đọc, chọn chương bằng select, thông báo
  chương nguồn ngoài, nút Thử lại khi lỗi.

### Thuần Việt & UX chung
- "Ch. N" → "Chương N" khắp nơi (đã sửa `chapter_label`).
- Ngày tương đối: helper thuần `rel_date(iso, now_ms)` — "vừa xong", "N phút
  trước", "N giờ trước", "hôm qua", "N ngày trước", > 30 ngày → dd/mm/yyyy.
  Không thêm crate ngày tháng.
- Chữ nền 16px; mọi nút/chạm ≥ 44px; hàng chương cao ≥ 48px mobile.
- Empty/error states everywhere: lỗi có nút "Thử lại" (refetch resource);
  tủ trống có CTA; tìm kiếm không kết quả gợi ý xóa bộ lọc.
- Footer + 404 giữ nội dung, đổi giao diện theo token mới.

## 4. Kiểm thử

- **Unit (cargo test):** `rel_date` (các mốc + input hỏng), map sort/status
  (server, giá trị lạ → lỗi), serde roundtrip library/reader settings, map tên
  tag Việt.
- **Server:** `cargo test -p server` gồm test cache policy hiện có.
- **Browser thật (desktop + viewport mobile 375px):** từng trang mới, toggle
  theme + reload không nháy, theo dõi → tủ → badge chương mới, lọc tìm kiếm
  ra URL đúng, reader cả 2 chế độ + nền + tự cuộn + fullscreen, phím/swipe,
  không console error, không tràn ngang.
- **Ngân sách:** không dependency mới; WASM ≤ ~650KB (hiện 510KB); trang chủ
  không gọi quá 4 API song song.

## 5. Rủi ro & ghi chú

- MangaDex không có lượt xem theo thời gian → BXH là theo dõi/đánh giá/mới,
  không gọi tên "top ngày/tuần".
- Rating MangaDex thưa (nhiều truyện chưa có) → ẩn chip ★ khi null, không
  hiện 0.0 giả.
- Tủ truyện kiểm tra chương mới tốn N request phía client → giới hạn 4 đồng
  thời, chỉ chạy khi mở tủ/home, kết quả nhớ trong phiên.
- `wasm-opt` chưa cài trên máy build (Trunk bỏ qua) — không chặn phát hành.
- Build WASM cần toolchain MSVC trên máy này (GNU thiếu `as.exe`); lệnh ghi
  trong README.
