### Task 1: Pure UI helpers with tests

**Files:**
- Modify `crates/ui/src/api.rs`
- Create `crates/ui/src/library.rs`, `crates/ui/src/reader_settings.rs`
- Modify `crates/ui/src/main.rs` (module declarations only)

**Interfaces:**
- Consumes: `Chapter`, `MangaSummary` from `api.rs`.
- Produces: `rel_date(iso: &str, now_ms: f64) -> String`; `LibraryEntry { manga_id, title, cover_file, lang, followed_at, last_chapter_id }`, `library::get()/add()/remove()/set_last()/has_updates(id, latest_id)`; `ReaderSettings { mode: "vertical"|"horizontal", fit, bg, speed }`, `reader_settings::get()/save()`; `tag_label(en: &str) -> &str`; `filter_url(q, tags, status, sort, page) -> String`.

- [ ] **Step 1: Write failing tests in `api.rs`** for `rel_date`: now → "vừa xong"; 3 min → "3 phút trước"; 5 h → "5 giờ trước"; yesterday → "hôm qua"; 9 days → "9 ngày trước"; 40 days → `dd/mm/yyyy`; `""` → `""`. Use fixed `now_ms` values, not wall clock. Also test `tag_label("Action") == "Hành động"` and unknown tag passes through unchanged.

- [ ] **Step 2:** Run `cargo test -p ui`; expect FAIL (functions missing). If the host target cannot compile the bin crate, move these three helpers into a `crates/ui/src/pure.rs` module with no wasm imports and test that module instead.

- [ ] **Step 3: Implement** the functions above with serde derives and safe JSON fallback (bad JSON → empty vec / default settings). `library` max 200 entries, newest first, dedupe by `manga_id`. No date crate.

- [ ] **Step 4:** Run `cargo test -p ui`; expect PASS. Add a corrupt-JSON test for `library::get()` and `reader_settings::get()`.

- [ ] **Step 5:** Tick task checkbox.

---

