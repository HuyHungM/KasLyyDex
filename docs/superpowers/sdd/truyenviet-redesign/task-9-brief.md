### Task 9: Manga detail, final integration and documentation

**Files:** Modify `crates/ui/src/manga.rs`, `crates/ui/src/views.rs`, `docs/WEB-STATUS.md`, `README.md`.

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1:** Port and redesign `MangaPage`/`ChapterList` into `manga.rs`: mockup layout (cover left, info right), rating/follows chips (hidden when null), follow button, chapter rows with "Chương N" + `rel_date` + read ticks, vi/en tabs.

- [ ] **Step 2:** Final build: `cargo test -p manga-core`, `cargo test -p server --release`, `cargo test -p ui`, Trunk build with MSVC. Record bundle size; must stay ≤ 650 KB.

- [ ] **Step 3:** Full browser pass at desktop + 375px over every route, using a real chapter; fix any console errors or layout overflow. Check anti-slop pre-flight from `docs/design/DESIGN.md`.

- [ ] **Step 4:** Update `docs/WEB-STATUS.md` with measured results and `README.md` with the new routes/features. Tick task checkbox.
