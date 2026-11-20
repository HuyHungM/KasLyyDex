### Task 5: Home feed redesign

**Files:** Create `crates/ui/src/home.rs`; modify `crates/ui/src/views.rs`, `crates/ui/src/main.rs`.

**Interfaces:**
- Consumes: `/api/latest` enriched (Task 2), `library`, `rel_date`, `show_error`.
- Produces: `Home()`, `ContinueReading()`, `MangaCard`.

- [ ] **Step 1:** Implement `MangaCard` (cover, ★ only when rating present, chapter label, relative time), `ContinueReading` (horizontal snap + progress bar) and the **signature feed** from `/api/latest`: each row = 46px cover, title → `/manga/{id}`, up to 3 chapter pills (`{id, chapter, publish_at}`); newest pill uses accent-soft + `rel_date`; language pill on the right. Error → `show_error` with refetch.

- [ ] **Step 2:** Implement the popular horizontal rail (rank numbers 1–6, ★) and desktop right column with mini ranking (top 5 from `/api/rank?kind=follows`) + bookshelf card (empty CTA "Khám phá truyện").

- [ ] **Step 3:** Verify in browser at desktop + 375px: feed renders with real chapters, pill click opens reader, rail scroll-snaps without page overflow, empty history/bookshelf show CTA, no console errors.

- [ ] **Step 4:** Tick task checkbox.

---

