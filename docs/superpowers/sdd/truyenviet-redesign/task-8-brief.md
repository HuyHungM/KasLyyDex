### Task 8: Professional reader

**Files:** Create `crates/ui/src/reader.rs`; modify `crates/ui/src/views.rs` (route), `crates/ui/src/main.rs`.

**Interfaces:**
- Consumes: `ReaderSettings`, `/api/chapter/{id}/pages`, existing `history::push`, `chapter_label`.
- Produces: `ReadPage()`, `Reader()` with settings controls; keyboard/ swipe behavior defined in spec §3.

- [ ] **Step 1:** Port the existing reader into `reader.rs` unchanged (vertical mode, IntersectionObserver counter, lazy loading, prefetch, history, chapter select, external-link panel, retry). Verify build passes before adding features.

- [ ] **Step 2:** Add `ReaderSettings` UI: mode segment (Cuộn dọc / Lật ngang), fit toggle, 3 background dots, auto-scroll speed 1–5 (vertical only), fullscreen button. Persist each change; corrupt settings → defaults.

- [ ] **Step 3:** Implement horizontal mode: one page at a time, prev/next buttons, ArrowLeft/Right and touch swipe (`touchstart`/`touchend`, ≥ 50px threshold), tap left/right third of the image; disable buttons at ends; page counter `x/y`; chapter navigation stays in the bottom bar/select. Mobile bottom bar + settings row per mockup; desktop controls in top bar.

- [ ] **Step 4:** Implement auto-scroll with `requestAnimationFrame`, pause on touch/wheel, and stop at chapter end; keep `prefers-reduced-motion` default off.

- [ ] **Step 5:** Verify in browser at desktop + 375px: both modes, fit toggle, backgrounds, fullscreen, arrow+swipe+tap navigation, auto-scroll pause, external-only chapter panel, zero-page chapter, no console errors.

- [ ] **Step 6:** Tick task checkbox.

---

