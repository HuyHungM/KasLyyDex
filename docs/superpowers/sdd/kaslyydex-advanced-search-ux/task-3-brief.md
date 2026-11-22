### Task 3: Axum multi-source search orchestration

**Files:**
- Create: `crates/core/src/search.rs`
- Modify: `crates/core/src/lib.rs`
- Modify: `crates/server/src/main.rs`
- Test: `crates/core/src/search.rs` inline tests
- Test: `web/scripts/search-source.test.mjs`

**Interfaces:**
- Consumes: Task 1 `contracts::SearchQuery`, Task 2 `Comick::search`, `Md::search_filtered`.
- Produces: `pub async fn search_all(md: &Md, comick: Option<&Comick>, query: &SearchQuery) -> Result<SearchResponse, Err>` in `crates/core`.
- Produces: `SearchResponse` with populated `partial` when any selected provider fails or cannot fully apply a filter.
- Produces: handler `/api/content/search` uses `search_all` for every `source` value.

- [ ] **Step 1: Write failing merge tests**

Add Rust tests:
- `search_mangadex_only_preserves_existing_behavior`
- `search_comick_only_uses_adapter`
- `search_all_keeps_provider_duplicates_separate`
- `search_all_merges_and_sorts_deterministically`
- `search_all_partial_when_one_provider_fails`

Assertions:
- `source=mangadex` never calls Comick and `partial == false`.
- `source=comick` never calls MangaDex.
- `source=all` keeps one MangaDex and one Comick entry with same normalized title as separate results.
- Stable sort order is `sort` value, then source label, then title, then id.
- Page slicing returns at most 24 items and total is the sum before slicing.

- [ ] **Step 2: Run tests to verify RED**

Run: `cargo test -p core search`
Expected: FAIL.

- [ ] **Step 3: Implement provider dispatch and merge**

Use `tokio::join!` for `source=all` with each provider call independently mapped to a provider result. Local-apply `lang`/`year` when provider cannot do it server-side; set `partial=true` if a filter cannot be guaranteed complete. Cache successful full query responses in the existing Axum content cache with a key containing all query fields.

- [ ] **Step 4: Wire Axum handler**

Replace `state.md.search_filtered(...)` with `search_all(&state.md, state.comick.as_ref(), &q)`. `ContentState.comick` is `Option<Comick>`; if it is `None` and the query requires Comick, return a structured `503 CONTENT_UNAVAILABLE` rather than panicking. For `source=mangadex`, proceed with MangaDex only and `partial=false`. Keep validation and structured errors. Ensure legacy `/api/search` alias uses the same handler.

- [ ] **Step 5: Run Rust tests to verify GREEN**

Run:
- `cargo test -p core search`
- `cargo test -p server search`
- `cargo clippy -p core -p server --all-targets -- -D warnings`

Expected: PASS.

- [ ] **Step 6: Write failing Node fixture integration test**

Create `web/scripts/search-source.test.mjs` using the real Axum server and loopback MangaDex/Comick fixtures. Cases:
- `source=mangadex` only hits MangaDex fixture.
- `source=comick` only hits Comick fixture.
- `source=all` returns both with correct `source_label`.
- Comick fixture 500 returns MangaDex results with `partial=true`.
- Bad `source/lang/year/page` returns structured 400.
- Cache key changes when source/lang/year changes.

- [ ] **Step 7: Run and implement until GREEN**

Build Axum first. Run:
- from `web/`: `node --import tsx --conditions=react-server --test scripts/search-source.test.mjs`
Expected: RED before Task 3 code, PASS after.

- [ ] **Step 8: Commit**

```bash
git add crates/core/src/search.rs crates/core/src/lib.rs crates/server/src/main.rs web/scripts/search-source.test.mjs
git commit -m "feat: aggregate search across content sources"
```
