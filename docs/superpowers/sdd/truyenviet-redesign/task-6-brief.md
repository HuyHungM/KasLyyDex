### Task 6: Search filters, genres, rankings pages

**Files:** Create `crates/ui/src/catalog.rs`; modify `crates/ui/src/views.rs` (routes), `crates/ui/src/main.rs`.

**Interfaces:**
- Consumes: `/api/tags`, `/api/search` extended, `/api/rank`, `filter_url`, `tag_label`, `MangaCard`.
- Produces: `Search()`, `Genres()`, `Ranking()` and routes `/the-loai`, `/bxh`.

- [ ] **Step 1:** Implement `Search()` with a collapsible filter panel: tag chips (max 8), status select, sort select; state taken from and written to URL `q,tags,status,sort,page`. Result grid uses `MangaCard`; pagination preserves filters. Empty result → "Không tìm thấy truyện nào cho …" + "Xóa bộ lọc" link.

- [ ] **Step 2:** Implement `Genres()` grouping `/api/tags` by `group` (genre/theme first, then content/format) using `tag_label`; chip click → `/search?tags={id}&tagname={name}`.

- [ ] **Step 3:** Implement `Ranking()` with 3 tabs (Theo dõi / Đánh giá / Mới cập nhật), numbered rows 1–24, ★ shown only when rating exists, follows displayed; "Mới" reuses `/api/latest`.

- [ ] **Step 4:** Verify in browser: tag click produces correct URL and results; all 3 sort options change API request; invalid URL params don't panic; 375px filter panel expands and collapses; no console errors.

- [ ] **Step 5:** Tick task checkbox.

---

