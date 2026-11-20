### Task 4: Design system, theme, app shell

**Files:** Create `docs/design/DESIGN.md`; rewrite `crates/ui/style.css`; modify `crates/ui/index.html`, `crates/ui/src/views.rs`, `crates/ui/src/main.rs`, `crates/ui/Cargo.toml` (add `web-sys` feature `Document`).

**Interfaces:**
- Consumes: design tokens from spec §1 and mockup M3.
- Produces: `Theme` helpers (`init_theme()`, `toggle_theme()`), `App()`, `Header()`, `BottomTabs()`, `SectionTitle`, `show_error(res, retry)` helper, CSS classes used by all later tasks.

- [ ] **Step 1: Write `DESIGN.md`** with the exact tokens, typography, signature element (new-chapter feed), banned patterns (no neon/purple, no emoji icons, no three identical hero cards, no Inter), and motion rules from spec §1.

- [ ] **Step 2: Rewrite `style.css`** for light+dark tokens, 16px body, 44px touch targets, panel/card/pill/radius scale, focus-visible ring, skeleton shapes, bottom tab bar, `prefers-reduced-motion`, `min-height:100dvh`, zero-horizontal-scroll mobile grid. Add the pre-paint theme script to `index.html` before the stylesheet link.

- [ ] **Step 3: Implement** `init_theme()` (reads localStorage safely → default light, sets `data-theme` on `<html>`) and `toggle_theme()`. Rebuild `Header` (logo, search, 4 nav links, theme icon button) and add `BottomTabs` with the red dot for library updates. Keep router and routes. Add `show_error` helper with a "Thử lại" button that calls a supplied refetch closure.

- [ ] **Step 4:** Verify with Trunk build (MSVC toolchain) and browser: both themes, toggle persists after reload with no flash, corrupt localStorage falls back to light, 375px viewport has no horizontal scroll and 44px buttons, no console errors.

- [ ] **Step 5:** Tick task checkbox.

---

