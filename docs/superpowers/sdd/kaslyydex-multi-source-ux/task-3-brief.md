### Task 3: Chapter fallback orchestration, cache, and Axum routes

**Files:**
- Create: `crates/core/src/fallback.rs`
- Modify: `crates/core/src/lib.rs`
- Modify: `crates/server/src/main.rs`
- Test: `crates/core/src/fallback.rs` inline tests
- Test: `web/scripts/source-fallback.test.mjs`

**Interfaces:**
- Consumes: `Md`, `Comick`, Task 1 DTO source fields, Task 2 `ComickChapter`/`is_comick_chapter_id`.
- Produces: `pub struct ContentState { pub md: Md, pub comick: Option<Comick> }`.
- Produces: `pub async fn enrich_chapters(state: &ContentState, manga: &MangaSummaryDto, chapters: ChaptersResponse) -> Result<ChaptersResponse, Err>`.
- Produces: `pub async fn chapter_pages(state: &ContentState, chapter_id: &str) -> Result<PagesResponse, Err>`.
- Produces: `pub async fn chapter_metadata(state: &ContentState, chapter_id: &str) -> Result<ChapterMetadataDto, Err>`.
- Produces: cache helpers `fallback_cache_key(manga_id: &str, chapter: &str, lang: &str) -> String` and bounded TTL read/write using `imgcache::cache_dir()`.

- [ ] **Step 1: Write failing matching tests**

Add Rust tests:
- `fallback_skips_readable_mangadex_chapter`
- `fallback_matches_decimal_chapter_and_language`
- `fallback_rejects_mismatched_chapter_number`
- `fallback_prefers_vi_then_en`
- `fallback_negative_result_is_cached_briefly`

Assertions:
- A MangaDex chapter with `pages > 0` and no `external_url` is unchanged.
- Chapter `"10.1"` matches fallback `"10.1"` but not `"10"` or `"10.2"`.
- Language `vi` is preferred over `en` when both match.
- No confident match leaves original external/unreadable chapter unchanged.

- [ ] **Step 2: Run tests to verify RED**

Run: `cargo test -p core fallback`
Expected: FAIL.

- [ ] **Step 3: Implement conservative matching and cache helpers**

Implement normalization for chapter numbers, alias/title search candidate selection, deterministic first-match choice, positive TTL cache, and short negative TTL cache. Never fallback a readable MangaDex chapter. Cache failures must not fail the primary response.

- [ ] **Step 4: Run matching tests to verify GREEN**

Run: `cargo test -p core fallback`
Expected: PASS.

- [ ] **Step 5: Write failing Axum/Next integration test**

Create `web/scripts/source-fallback.test.mjs` using the existing real-Axum + local upstream fixture pattern. Fixture cases:
- MangaDex chapter is external-only; Comick returns matching chapter and pages.
- MangaDex chapter is readable; Comick must not be used.
- Comick fixture returns 500; MangaDex external link remains.
- Comick fixture returns no matching chapter; original chapter remains external.
- `/api/content/chapter/comick:<id>/pages` returns proxied `/api/content/img?u=...` URLs.

Assertions:
- Fallback chapter has `source == "comick"`, `source_label == "Comick"`, `readable == true`.
- Primary readable chapter remains `source == "mangadex"`.
- Failed fallback does not produce fake pages.
- Malformed `comick:` ID returns structured 400.

- [ ] **Step 6: Run integration test to verify RED**

Run from `web/`: `node --import tsx --conditions=react-server --test scripts/source-fallback.test.mjs`
Expected: FAIL because routes/state do not support fallback.

- [ ] **Step 7: Switch Axum state to `ContentState` and wire routes**

Replace `State<Md>` with `State<ContentState>` for content routes. Keep legacy `/api/*` aliases working. `chapters` calls `enrich_chapters`; `pages` and `chapter_metadata` dispatch by source-aware ID. Add `COMICK_API_ORIGIN` support through `Comick::with_origin` for fixtures. If Comick is unavailable, primary MangaDex routes still work.

- [ ] **Step 8: Run integration and Rust tests**

Run:
- `cargo test -p core -p server`
- from `web/`: `node --import tsx --conditions=react-server --test scripts/source-fallback.test.mjs`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add crates/core/src/fallback.rs crates/core/src/lib.rs crates/server/src/main.rs web/scripts/source-fallback.test.mjs
git commit -m "feat: fallback unreadable chapters to Comick"
```
