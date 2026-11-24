# Design System: KasLyyDex — Reading-profile

## 0. Dials
VARIANCE: 7 | MOTION: 4 | DENSITY: 4

## 1. Atmosphere
Một trang hồ sơ đọc như cuốn truyện đang mở: giấy mịn, gáy rõ, chữ in sạch, nhịp hai trang cân đối. Không hiệu ứng neon, không card đồng loạt — chỉ một cú mở trang duy nhất.

## 1b. Signature element (mandatory, exactly one)
**Cuốn nhật ký mở (open reading spread)** — hồ sơ được trình bày như hai trang truyện snapped at a visible spine, kèm folio `TRANG 01 / TRANG 02` ở góc mỗi trang. Nó lives in materiality/layout và đến trực tiếp từ sản phẩm đọc truyện, không phải catalog effect. Sustained in: trang `/tai-khoan` (spread tu vi + hồ sơ) và dải nhật ký bên dưới cùng ngôn ngữ folio.

## 2. Palette and roles
- **Lilac** (`#6d4a8c`) — accent duy nhất, dùng cho folio, focus ring, viền gáy.
- **Paper** (`var(--surface)`, light `#fffafa`) — nền trang.
- **Ink** (`var(--text)`) — chữ chính.
- **Muted ink** (`var(--muted)`) — metadata, folio phụ.
- **Spine** (`var(--line)`) — gáy và đường kẻ trang.
Không dùng `#000`, không gradient tím neon, không text-gradient.

## 3. Typography
- Display: `Bricolage Grotesque` — tracking chặt, hierarchy bằng weight.
- Body: `Be Vietnam Pro` — leading 1.65, tối đa ~65ch.
- Mono: `ui-monospace, SFMono-Regular` — chỉ cho số XP/cấp/folio.
- Banned: Inter, Roboto, serif trong UI, chữ in hoa to vô nghĩa.

## 4. Components
- Buttons: phản hồi `:active` bằng translateY(1px), không glow.
- Inputs: label ở trên, helper bên dưới, focus ring accent 4px мềm.
- Pages: hai trang bằng nhau trên desktop, xếp dọc dưới 768px; mỗi trang có viền mỏng và bóng âm phía gáy.
- Loaders/empty/error: giữ nguyên dạng dòng chữ + nút thử lại hiện có.
- Icons: SVG một family, `aria-hidden` khi đi kèm chữ.

## 5. Layout
CSS Grid, max-width 1040px, `min-h-[100dvh]` thay vì `h-screen`. Không overlap; gáy là khoảng trống có đường kẻ, không chồng lên nội dung. Mobile collapse 1 cột, zero horizontal scroll.

## 6. Motion
CSS-only, chỉ `transform`/`opacity`, 300–420ms, stagger nhẹ giữa hai trang. Mọi animation nằm trong `prefers-reduced-motion: no-preference`; mặc định nội dung hiện đầy đủ. Không thêm library.

## 7. Anti-patterns (BANNED)
Emoji làm icon; Inter; neon/glow; text-gradient; ba card giống hệt; John Doe/Acme; số tròn giả (99.99%); copy cliche (`Elevate`, `Seamless`, `Unleash`); ảnh Unsplash hỏng; filler `Scroll to explore`; custom cursor; overlapping.
