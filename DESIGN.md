# Design System: KasLyyDex — Volume Account

## 0. Dials
VARIANCE: 6 | MOTION: 3 | DENSITY: 5

## 1. Atmosphere
Trang mở đầu của một tập truyện: tiêu đề to, kẻ double-rule, rồi mục lục các chương có số thứ tự lớn. Không card, không panel, không spread — chỉ giấy, mực và đường kẻ.

## 1b. Signature element (mandatory, exactly one)
**Mục lục tập truyện (volume table of contents)** — toàn bộ `/tai-khoan` là một trang mục lục: masthead `TẬP 01`, danh sách `01 / 02 / 03` với số to bên trái, nhãn chương bên phải, nội dung thật ở giữa. Nó lives in layout/typography và đến trực tiếp từ định dạng đầu sách truyện, không phải catalog effect. Sustained in: masthead + mọi dòng mục lục + footer rule; mobile vẫn giữ số chương và đường kẻ.

## 2. Palette and roles
- **Lilac** (`#6d4a8c`) — accent duy nhất: số chương, kicker, focus ring.
- **Paper** (`var(--surface)`, light `#fffafa`) — nền trang.
- **Black** (`#0b0b0e`) — chế độ tối thứ ba, off-black (không dùng `#000`), vẫn một accent lilac.
- **Rule** (`var(--line)`) — double rule ở masthead, gạch dòng mục lục.
- **Ink** (`var(--text)`) — chữ chính.
- **Muted ink** (`var(--muted)`) — nhãn chương, mô tả.
Không `#000`, không neon/glow, không text-gradient.

## 3. Typography
- Display: `Bricolage Grotesque` — tracking chặt, số chương size lớn.
- Body: `Be Vietnam Pro` — leading 1.65, tối đa 65ch.
- Mono: `ui-monospace, SFMono-Regular` — nhãn chương, XP/cấp.
- Banned: Inter, Roboto, serif trong UI, chữ in hoa to vô nghĩa.

## 4. Components
- Cover:AuthPanel giữ nguyên API, chỉ đổi viền/radius cho khớp trang.
- TOC row: grid `số / nội dung / nhãn`, gạch dưới mỏng, padding 24px; nội dung là component thật (tu vi, hồ sơ, nhập khách), không card bọc.
- Buttons: tactile `:active` translateY(1px), không glow.
- Inputs: label ở trên, focus ring accent, error rõ ràng.
- Loaders/empty/error: giữ dạng dòng chữ + nút thử lại đã có.
- Icons: SVG family hiện có, `aria-hidden` khi đi kèm chữ.

## 5. Layout
Grid-first, max-width 1040px, `min-h-[100dvh]`. Không overlap, không card đồng loạt. Dưới 640px số chương thu nhỏ, nhãn xuống dưới, vẫn có gạch dòng. Zero horizontal scroll.

## 6. Motion
CSS-only, `transform`/`opacity`, 260–360ms, TOC hiện theo thứ tự dòng. Mặc định visible; chỉ chạy trong `prefers-reduced-motion: no-preference`; `none` khi reduce. Không thêm library.

## 7. Anti-patterns (BANNED)
Emoji; Inter; neon/glow; text-gradient; ba card giống hệt; John Doe/Acme; số tròn giả; copy cliche (`Elevate`, `Seamless`, `Unleash`); ảnh hỏng; filler; custom cursor; overlap; **KHÔNG dùng lại open spread hay comic panel grid**.
