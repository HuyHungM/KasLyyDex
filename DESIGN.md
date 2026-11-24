# Design System: KasLyyDex — Reader Profile

## 0. Dials
VARIANCE: 7 | MOTION: 3 | DENSITY: 5

## 1. Atmosphere
Bố cục trang truyện: các ô panel không đều nhau, rãnh dày nhìn thấy nền, số chương nhỏ ở góc mỗi ô. Đọc từ trên xuống như lật một chương, không phải một danh sách card đồng dạng.

## 1b. Signature element (mandatory, exactly one)
**Trang panel truyện (manga panel grid)** — hồ sơ được chia thành các ô kích thước bất đối xứng, ngăn nhau bằng rãnh màu nền và đánh số `CH.00 → CH.03` như số chương. Nó lives in layout/materiality và đến từ chính product đọc truyện, không phải thư viện effect. Sustained in: toàn bộ trang `/tai-khoan` (mỗi vùng là một panel có số chương), mobile vẫn giữ rãnh và số chương khi xếp dọc.

## 2. Palette and roles
- **Lilac** (`#6d4a8c`) — accent duy nhất: số chương, focus ring, góc panel.
- **Paper** (`var(--surface)`, light `#fffafa`) — mặt panel.
- **Gutter** (`var(--bg)`) — rãnh giữa các panel, không phải viền trang.
- **Ink** (`var(--text)`) — chữ chính.
- **Muted ink** (`var(--muted)`) — metadata.
Không `#000`, không neon/glow, không text-gradient.

## 3. Typography
- Display: `Bricolage Grotesque` — tracking chặt, hierarchy bằng weight.
- Body: `Be Vietnam Pro` — leading 1.65, tối đa ~65ch.
- Mono: `ui-monospace, SFMono-Regular` — số chương, XP, cấp.
- Banned: Inter, Roboto, serif trong UI, chữ in hoa to vô nghĩa.

## 4. Components
- Panel: bo 16px, viền mỏng, rãnh 8–10px; kích thước không đồng đều (head full-width, identity hẹp, form cao, import full-width).
- Chapter marker: `CH.0n` mono, màu accent, góc trên bên trái mỗi panel.
- Buttons: tactile `:active` translateY(1px), không glow.
- Inputs: label ở trên, focus ring accent; helper/error rõ ràng.
- Loaders/empty/error: giữ dạng dòng chữ + nút thử lại.
- Icons: SVG family hiện có, `aria-hidden` khi đi kèm chữ.

## 5. Layout
CSS GridWithAreas, max-width 1040px, `min-h-[100dvh]`. Không overlap; rãnh là khoảng trống thật. Dưới 768px collapse thành 1 cột nhưng vẫn giữ rãnh và số chương. Zero horizontal scroll.

## 6. Motion
CSS-only, chỉ `transform`/`opacity`, 260–380ms, panel vào theo thứ tự chương. Mặc định nội dung visible; chạy trong `prefers-reduced-motion: no-preference`; tắt hẳn khi reduce. Không thêm library.

## 7. Anti-patterns (BANNED)
Emoji làm icon; Inter; neon/glow; text-gradient; ba card giống hệt; John Doe/Acme; số tròn giả; copy cliche (`Elevate`, `Seamless`, `Unleash`); ảnh hỏng; filler `Scroll to explore`; custom cursor; overlapping; quay lại dạng spread/gáy cũ.
