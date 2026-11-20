# KasLyyDex — web đọc manga

Web đọc manga tiếng Việt / tiếng Anh, dữ liệu từ [MangaDex API](https://mangadex.org) (free, không cần key).

## Stack

- Next.js 16 (App Router, Cache Components + Partial Prerendering, Turbopack)
- React 19 + TypeScript
- Tailwind CSS v4 (theme CSS-first trong `app/globals.css`)
- undici (fetch server với DNS resolver riêng)

## Chạy

```bash
npm install
npm run dev      # development
npm run build && npm start -- -p 3100   # production
```

Mở http://localhost:3100

## Tính năng

- Trang chủ: truyện phổ biến + mới cập nhật (chỉ truyện có chapter đọc được thật)
- Tìm kiếm có phân trang
- Trang truyện: cover, mô tả, tags, danh sách chapter (ưu tiên tiếng Việt, fallback English), chapter đánh dấu đã đọc
- Reader cuộn dọc: lazy-load, đếm trang, chọn chapter, phím ←/→ chuyển chapter
- Lịch sử đọc + "Đọc tiếp" lưu trong localStorage
- Chapter chỉ có ở nguồn ngoài (truyện bản quyền) hiện link đọc tại nguồn

## Ghi chú kỹ thuật

- `lib/mangadex.ts`: mọi lời gọi API đều `'use cache'` + `cacheLife`; types/helpers thuần tách ở `lib/types.ts` để client components import được.
- `lib/http.ts`: vài mạng DNS chặn (sinkhole) host MangaDex về 127.0.0.1 → server resolve qua 1.1.1.1/8.8.8.8, fallback DNS hệ thống.
- `/api/img`: proxy ảnh (allowlist `uploads.mangadex.org` + `*.mangadex.network`, chặn redirect) vì browser và Next image optimizer có thể không resolve được host MangaDex.
- `/api/pages/[chapterId]`: lấy URL ảnh at-home (URL hết hạn nhanh, không cache).
- Trang động bọc `<Suspense>` theo yêu cầu của Cache Components.
