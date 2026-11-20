# TruyệnViệt Redesign + Tier A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Leptos WASM manga site to the approved "App Đọc Truyện" mockup and ship Tier A features (new-chapter feed, follows/bookshelf, advanced search, genres, rankings, professional reader) without accounts or a database.

**Architecture:** Extend the existing `core` MangaDex client with filters/statistics/tags/rankings, expose them as new Axum `/api` routes with proxy caching, and rebuild the Leptos CSR UI around small focused modules. Per-user state (theme, library, reader settings, history) lives only in localStorage; MangaDex data always goes through the existing proxy.

**Tech Stack:** Rust 2024 toolchain (MSVC for Trunk on this machine), Leptos 0.8 CSR, leptos_router 0.8, Axum 0.8/tower-http 0.6, moka cache, Be Vietnam Pro, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-20-truyenviet-redesign-design.md`
**Mockup:** `docs/design/mockups/m3-app-doc-truyen.html`

## Global Constraints

- No new dependencies. No database, accounts, comments, user ratings, or Slint changes.
- Theme default **light**; toggle persisted at `localStorage truyenviet:theme`; pre-paint script in `index.html`.
- localStorage keys exactly: `truyenviet:history`, `truyenviet:library`, `truyenviet:theme`, `truyenviet:reader`.
- UI strings: use "Chương N" (never "Ch. N"); relative dates under 30 days, `dd/mm/yyyy` beyond.
- Touch targets ≥ 44px; body font 16px; mobile 375px: zero horizontal scroll.
- API constraints: `sort` ∈ follows|rating|new|year|title; `status` ∈ ongoing|completed|hiatus|cancelled; max 8 tag UUIDs; invalid → 400. `tags` → MangaDex `includedTags[]`.
- Rankings are Top Follows / Top Rated / Recently Updated — never claim "top ngày/tuần" (MangaDex has no view counts).
- Hide ★ chip when rating is null; never display `0.0`.
- WASM bundle ≤ ~650 KB (currently 510 KB). Build with `$env:RUSTUP_TOOLCHAIN='stable-x86_64-pc-windows-msvc'; trunk build --release` in `crates/ui`.
- This workspace is **not a git repo**: replace every "Commit" step with ticking the task checkbox; no git commands.
- Verify before claiming done: `cargo test -p server --release`, `cargo test -p manga-core`, `cargo test -p ui`, Trunk build, browser checks.

## Review Focus

- Invalid API params (`sort=bogus`, `status=bogus`, 9 tags, malformed UUID) → 400 with Vietnamese message, not a silent default: test in Task 3.
- Empty library / history / search with filters → real empty state + CTA, no panic or blank screen: test in Tasks 5 and 7.
- Upstream 429 / null rating / external-only chapter → Vietnamese error + retry, hidden ★, source link panel: tests in Tasks 2, 6, 8.
- Corrupt or missing localStorage (`truyenviet:theme`, `:library`, `:reader`) → safe fallback (light / empty / vertical), no flash of wrong theme: tests in Tasks 1 and 4.
- Reader with 0 pages, horizontal mode at first/last page, and touch swipe → no crash, disabled buttons, correct page index: test in Task 8.

---

## File Structure

| File | Responsibility |
|---|---|
| `crates/core/src/mangadex.rs` | Extend `Md`: `tags()`, `search_filtered()`, `rank()`, `stats()`, enriched `latest()` |
| `crates/server/src/main.rs` | New routes, query parsing/validation, cache headers |
| `crates/ui/src/api.rs` | Client types, `rel_date`, filter URL builder, tag-name map |
| `crates/ui/src/library.rs` | NEW — library JSON storage/helpers |
| `crates/ui/src/reader_settings.rs` | NEW — reader preferences JSON storage |
| `crates/ui/src/views.rs` | App shell, Header, theme, bottom tabs, SectionTitle, shared empty/error helpers |
| `crates/ui/src/home.rs` | NEW — home feed, continue reading, popular rail |
| `crates/ui/src/catalog.rs` | NEW — search + filters, genres, ranking pages |
| `crates/ui/src/library_view.rs` | NEW — bookshelf page |
| `crates/ui/src/manga.rs` | NEW — manga detail + chapter list + follow button |
| `crates/ui/src/reader.rs` | NEW — ReadPage + Reader (both modes, settings, fullscreen) |
| `crates/ui/src/main.rs` | Module declarations + mount (Leptos CSR entry) |
| `crates/ui/src/style.css` | Full redesign to M3 tokens (via Trunk CSS link) |
| `crates/ui/index.html` | Pre-paint theme script + existing Trunk config |
| `docs/design/DESIGN.md` | NEW — design source of truth (tokens, signature, bans) |

Split `views.rs` rather than growing it past 700 lines; move existing components into the files above without changing their behavior except where a task says so.

---

### Task 1: Pure UI helpers with tests

**Files:**
- Modify `crates/ui/src/api.rs`
- Create `crates/ui/src/library.rs`, `crates/ui/src/reader_settings.rs`
- Modify `crates/ui/src/main.rs` (module declarations only)

**Interfaces:**
- Consumes: `Chapter`, `MangaSummary` from `api.rs`.
- Produces: `rel_date(iso: &str, now_ms: f64) -> String`; `LibraryEntry { manga_id, title, cover_file, lang, followed_at, last_chapter_id }`, `library::get()/add()/remove()/set_last()/has_updates(id, latest_id)`; `ReaderSettings { mode: "vertical"|"horizontal", fit, bg, speed }`, `reader_settings::get()/save()`; `tag_label(en: &str) -> &str`; `filter_url(q, tags, status, sort, page) -> String`.

- [x] **Step 1: Write failing tests in `api.rs`** for `rel_date`: now → "vừa xong"; 3 min → "3 phút trước"; 5 h → "5 giờ trước"; yesterday → "hôm qua"; 9 days → "9 ngày trước"; 40 days → `dd/mm/yyyy`; `""` → `""`. Use fixed `now_ms` values, not wall clock. Also test `tag_label("Action") == "Hành động"` and unknown tag passes through unchanged.

- [x] **Step 2:** Run `cargo test -p ui`; expect FAIL (functions missing). If the host target cannot compile the bin crate, move these three helpers into a `crates/ui/src/pure.rs` module with no wasm imports and test that module instead.

- [x] **Step 3: Implement** the functions above with serde derives and safe JSON fallback (bad JSON → empty vec / default settings). `library` max 200 entries, newest first, dedupe by `manga_id`. No date crate.

- [x] **Step 4:** Run `cargo test -p ui`; expect PASS. Add a corrupt-JSON test for `library::get()` and `reader_settings::get()`.

- [x] **Step 5:** Tick task checkbox.

---

### Task 2: Core client — filters, statistics, tags, rankings, richer feed

**Files:** Modify `crates/core/src/mangadex.rs`

**Interfaces:**
- Consumes: `Md`, existing `LIST_PARAMS`, `summaries`.
- Produces: `pub fn sort_param(sort: &str) -> Option<&'static str>` (follows→`order[followedCount]=desc`, rating→`order[rating]=desc`, new→`order[latestUploadedChapter]=desc`, year→`order[year]=desc`, title→`order[title]=asc`); `pub fn status_param(s: &str) -> Option<&'static str>`; `pub async fn tags(&self)`, `pub async fn search_filtered(&self, q, page, tags: &[String], status: Option<&str>, sort: &str)`, `pub async fn rank(&self, kind: &str)`, `pub async fn stats(&self, id: &str)`, enriched `latest()` with `chapters` field.

- [ ] **Step 1: Write failing unit tests** in `mangadex.rs`: all 5 sort mappings, 4 statuses, unknown values → `None`; UUID list join produces `includedTags[]=a&includedTags[]=b`.

- [ ] **Step 2:** Run `cargo test -p manga-core`; expect FAIL.

- [ ] **Step 3: Implement.** `tags()`: GET `/manga/tag`, map to `{id,name: pick(name),group}`. `rank()`: GET `/manga?limit=24&<sort>` then one `/statistics/manga?manga[]=…` call, merge `rating.bayesian` + `follows` into each summary (null → omit key). `stats()`: `/statistics/manga/{id}`. Extend `latest()`: while iterating the already-fetched chapter feed, collect up to 3 readable chapters per manga `{id, chapter, publish_at}` and attach to each returned summary. Reuse existing caches with distinct keys.

- [ ] **Step 4:** Run `cargo test -p manga-core`; expect PASS.

- [ ] **Step 5:** Tick task checkbox.

---

### Task 3: Server routes and validation

**Files:** Modify `crates/server/src/main.rs`

**Interfaces:**
- Consumes: `Md` methods from Task 2.
- Produces: routes `/api/tags`, `/api/rank`, `/api/search` (extended), `/api/latest` (enriched), `/api/manga/{id}` (with stats).

- [ ] **Step 1: Write failing tests** for a pure `parse_search_query(HashMap<String,String>) -> Result<SearchQuery, (StatusCode,String)>`: valid sort/status/8 tags parse; `sort=bogus`, `status=bogus`, 9 tags, malformed UUID → `Err` with 400; empty q allowed.

- [ ] **Step 2:** Run `cargo test -p server --release`; expect FAIL.

- [ ] **Step 3: Implement** `parse_search_query` and handlers. `/api/tags` max-age=86400; `/api/rank` max-age=300; manga still 300/whatever existing; invalid `kind` → 400. Preserve existing cache policy function untouched.

- [ ] **Step 4:** Run `cargo test -p server --release`; expect PASS. Verify with curl: `/api/tags` 200, `/api/rank?kind=follows` 200 with 24 items and rating fields, `/api/search?sort=bogus` 400, `/api/latest` items have `chapters`.

- [ ] **Step 5:** Tick task checkbox.

---

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

### Task 9: Manga detail, final integration and documentation

**Files:** Modify `crates/ui/src/manga.rs`, `crates/ui/src/views.rs`, `docs/WEB-STATUS.md`, `README.md`.

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1:** Port and redesign `MangaPage`/`ChapterList` into `manga.rs`: mockup layout (cover left, info right), rating/follows chips (hidden when null), follow button, chapter rows with "Chương N" + `rel_date` + read ticks, vi/en tabs.

- [ ] **Step 2:** Final build: `cargo test -p manga-core`, `cargo test -p server --release`, `cargo test -p ui`, Trunk build with MSVC. Record bundle size; must stay ≤ 650 KB.

- [ ] **Step 3:** Full browser pass at desktop + 375px over every route, using a real chapter; fix any console errors or layout overflow. Check anti-slop pre-flight from `docs/design/DESIGN.md`.

- [ ] **Step 4:** Update `docs/WEB-STATUS.md` with measured results and `README.md` with the new routes/features. Tick task checkbox.
