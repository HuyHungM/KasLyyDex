### Task 7: Bookshelf and follow flow

**Files:** Create `crates/ui/src/library_view.rs`; modify `crates/ui/src/manga.rs`, `crates/ui/src/views.rs`, `crates/ui/src/main.rs`.

**Interfaces:**
- Consumes: `library::*`, `/api/manga/{id}/chapters`, `MangaCard`.
- Produces: `LibraryPage()`, route `/tu-truyen`; `FollowButton(manga_id, title, cover_file, lang)` used by the manga page; `library::has_any_update(latest_ids: &[(String, String)]) -> bool` for the bottom-tab dot.

- [ ] **Step 1:** Implement `FollowButton`: toggle add/remove via `library`, updates label "＋ Theo dõi" / "✓ Đang theo dõi"; reflect state after navigation away and back.

- [ ] **Step 2:** Implement `LibraryPage()`: grid of followed manga; batch-check new chapters with max 4 concurrent `/api/manga/{id}/chapters` calls, compare newest readable non-external chapter id with `last_chapter_id`, show "Chương mới" badge; "Đọc" updates `last_chapter_id` and navigates; "Xóa" removes entry. Empty library → CTA "Khám phá truyện". Set the red dot state for `BottomTabs` (Task 4) when any update exists.

- [ ] **Step 3:** Verify in browser: follow from manga page → appears in bookshelf; second visit shows new-chapter badge after history advances; remove works; corrupt localStorage shows empty state; no console errors.

- [ ] **Step 4:** Tick task checkbox.

---

