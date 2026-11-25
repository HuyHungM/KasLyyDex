# KasLyyDex Ranking Skeleton, Advanced Search and Source Badges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add advanced multi-source search, cover source badges, shape-matched ranking/genre skeletons, and top-3 ranking frames while removing the standalone genre route.

**Architecture:** Axum becomes the aggregation point for search across MangaDex and Comick provider adapters. Web reads normalized DTOs with source metadata and renders source as a cover badge. Catalog UX uses route-level/inner Suspense skeletons that match final item shapes.

**Tech Stack:** Rust/Axum/reqwest/moka, Next.js 16 App Router, TypeScript, shared `Select`, CSS tokens, Node test runner, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-22-kaslyydex-ranking-skeleton-advanced-search-and-source-badges-design.md`

## Global Constraints

- Search source values are exactly `all`, `mangadex`, `comick`; default `all`.
- Language values are exactly `all`, `vi`, `en`; default `all`.
- Advanced filters are source, language, year, status, sort, tags, page.
- Page size remains 24; `page` is clamped to the existing maximum.
- Source labels are exactly `MangaDex` and `Comick`.
- Source is displayed as a badge on cover images, not as a title suffix.
- `/the-loai` route and navigation item are removed with no redirect.
- Top ranks 1–3 have distinct frames using existing theme variables only.
- Skeletons match final item shapes, have accessible status, and do not overflow at 375px.
- All motion remains under `prefers-reduced-motion: no-preference`.
- No auth/XP/reader-WASM/deployment changes; no deploy, push, or merge during implementation.

## Review Focus

- Invalid `source`/`lang`/`year` query values must be rejected or defaulted deterministically; tested in Tasks 1 and 4.
- One provider failing during `source=all` must still return the other provider with `partial=true`; tested in Task 3.
- Merged search must sort/paginate deterministically and keep source identity; tested in Task 3.
- Source badges must be accessible and must not intercept cover links; tested in Task 5.
- Skeleton/top-frame states must not shift layout or overflow 375px; tested in Task 6.

---

### Task 1: Search query and DTO contract extension

**Files:**
- Modify: `crates/contracts/src/lib.rs`
- Modify: `crates/server/src/main.rs`
- Modify: `web/lib/contracts.ts`
- Test: `crates/contracts/src/lib.rs` inline tests
- Test: `crates/server/src/main.rs` inline tests
- Test: `web/scripts/search-contracts.test.mjs`

**Interfaces:**
- Consumes: existing `parse_search_query` logic in `crates/server/src/main.rs`; move it into `contracts` rather than duplicating it.
- Produces: Rust `SearchResponse.partial: Option<bool>` default `false`.
- Produces: `contracts::SearchQuery` with fields `source: String`, `lang: String`, `year: Option<i32>`, existing `q/page/tags/status/sort`, and public `contracts::parse_search_query(HashMap<String, String>) -> Result<SearchQuery, ApiError>`.
- Produces: `crates/server/src/main.rs` imports and uses `contracts::parse_search_query`; no server-local duplicate remains.
- Produces: TS `SearchParams` fields `source?: string`, `lang?: string`, `year?: number`, plus `partial?: boolean` on `SearchResponse`.
- Produces: `searchQuery(params: SearchParams): string` serializes all new fields; defaults omitted values so legacy URLs are unchanged.

- [ ] **Step 1: Write failing Rust query tests**

Add tests:
- `search_query_defaults_source_all_lang_all`
- `search_query_accepts_valid_source_lang_year`
- `search_query_rejects_invalid_source_lang_year`

Assertions:
- Missing source/lang/year default to `all`, `all`, `None`.
- `source=comick`, `lang=vi`, `year=2024` parse successfully.
- `source=bad`, `lang=fr`, `year=0`, non-numeric year, negative year, and page `0` are rejected.

- [ ] **Step 2: Run Rust tests to verify RED**

Run: `cargo test -p contracts search_query`
Expected: FAIL because fields/partial do not exist.

- [ ] **Step 3: Implement contract and parser changes**

Add `partial` to Rust `SearchResponse` with `#[serde(default)]`. Define `SearchQuery` and `parse_search_query` in `crates/contracts/src/lib.rs`, moving the existing server parser logic and extending it with exact allowlists. Keep existing status/sort/tag validation unchanged. Use `year` only when in a plausible range `1900..=current_year+1` (use `time::OffsetDateTime` if already available via existing deps; otherwise derive from `SystemTime` without a new dependency). Update the server handler to import the contracts parser.

- [ ] **Step 4: Run Rust tests to verify GREEN**

Run: `cargo test -p contracts -p server search`
Expected: PASS.

- [ ] **Step 5: Write failing TS contract test**

Create `web/scripts/search-contracts.test.mjs` asserting:
- `searchQuery({}) === ""`.
- `searchQuery({ source: "comick", lang: "vi", year: 2024 })` contains all three params.
- `searchQuery({ q: "slime", tags: ["a", "b"], status: "ongoing", sort: "rating", page: 2 })` preserves existing serialization.

- [ ] **Step 6: Run TS test to verify RED**

Run from `web/`: `node --import tsx --test scripts/search-contracts.test.mjs`
Expected: FAIL because new params are not serialized.

- [ ] **Step 7: Implement TS contract changes**

Add fields to `SearchParams`, `partial?: boolean` to `SearchResponse`, and new serialization in `searchQuery`. Do not change existing `ContentClient.search` signature shape beyond the extended params.

- [ ] **Step 8: Run TS test and typecheck**

Run from `web/`:
- `node --import tsx --test scripts/search-contracts.test.mjs`
- `npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add crates/contracts/src/lib.rs crates/server/src/main.rs web/lib/contracts.ts web/scripts/search-contracts.test.mjs
git commit -m "feat: extend search contracts with source filters"
```

---

### Task 2: Comick catalog search adapter

**Files:**
- Modify: `crates/core/src/comick.rs`
- Test: `crates/core/src/comick.rs` inline tests

**Interfaces:**
- Consumes: Task 1 `source`/`lang`/`year` values and `MangaSummaryDto`.
- Produces: `pub async fn search(&self, q: &str, lang: &str, year: Option<i32>, page: u32) -> Result<Vec<MangaSummaryDto>, Err>`.
- Produces: `pub fn search_path(q: &str, lang: &str, year: Option<i32>, page: u32) -> Result<String, Err>`.
- Produces: `pub fn normalize_search_hit(hit: &serde_json::Value) -> Result<MangaSummaryDto, Err>`.

- [ ] **Step 1: Verify official catalog search fields**

Read `https://api.comick.dev/docs/json` and record the exact search query names/limits for `q`, language, year and page in a code comment. Do not use OAuth endpoints. If fields differ from the spec, rule in the report and use documented names.

- [ ] **Step 2: Write failing adapter tests**

Add tests:
- `comick_search_path_encodes_filters`
- `comick_search_hit_sets_source_pair`
- `comick_search_hit_rejects_missing_title_or_id`

Assertions:
- `search_path("slime", "vi", Some(2024), 2)` contains encoded query, language, year, page, and only verified params.
- Normalized hit has `source == "comick"` and `source_label == "Comick"`.
- Missing id/title produces `Err` and does not fabricate fields.

- [ ] **Step 3: Run tests to verify RED**

Run: `cargo test -p core comick`
Expected: FAIL because functions do not exist.

- [ ] **Step 4: Implement path builder and normalizer**

Use existing `Comick` HTTP client/timeout/error style. Convert official cover keys to the existing verified CDN URL form. Preserve tags/year/status when present; missing optional fields use existing DTO defaults. Return generic `"Comick catalog unavailable"` on transport/status/shape errors.

- [ ] **Step 5: Implement HTTP `search` method**

Call the verified public catalog endpoint with bounded page size. Do not cache this task; caching belongs to Task 3 aggregation.

- [ ] **Step 6: Run tests and clippy**

Run:
- `cargo test -p core comick`
- `cargo clippy -p core --all-targets -- -D warnings`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add crates/core/src/comick.rs
git commit -m "feat: add Comick catalog search adapter"
```

---

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

---

### Task 4: Advanced Search UI and merged genre groups

**Files:**
- Modify: `web/app/search/page.tsx`
- Create: `web/components/search/GenreGroups.tsx`
- Create: `web/components/search/GenreGroupsSkeleton.tsx`
- Modify: `web/components/site-shell.tsx`
- Delete: `web/app/the-loai/page.tsx`
- Test: `web/scripts/advanced-search.test.mjs`

**Interfaces:**
- Consumes: Task 1 `SearchParams`, Task 3 `SearchResponse.partial`.
- Produces: `parseQuery` fields `source: "all"|"mangadex"|"comick"`, `lang: "all"|"vi"|"en"`, `year?: number`.
- Produces: `GenreGroups` renders grouped tags and writes selected tag ids into the existing `tags` form values.
- Produces: `GenreGroupsSkeleton` renders four group placeholders.

- [ ] **Step 1: Write failing browser/SSR test**

Create `web/scripts/advanced-search.test.mjs` asserting:
- `/search` form contains shared dropdowns for source, language, year.
- Selecting source/lang/year submits correct query params while preserving `q` and tags.
- Advanced panel contains four genre groups and a genre pill updates `tags`.
- `partial=true` renders a short warning.
- `/the-loai` navigation link is absent and direct route is gone.
- 375px no horizontal overflow.

- [ ] **Step 2: Run test to verify RED**

Run from `web/` after build: `node --test scripts/advanced-search.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Extend query parsing and filters**

Update `Query` type and `parseQuery` with exact allowlists, year bounds and page clamp. Keep existing status/sort/tags behavior. Use shared `Select` for new controls.

- [ ] **Step 4: Merge genre groups into advanced panel**

Move tag group rendering into `GenreGroups`. Use `GenreGroupsSkeleton` as Suspense fallback. Remove standalone `/the-loai` page and nav item. Keep page name "Khám phá".

- [ ] **Step 5: Run test and affected regressions**

Run from `web/`:
- `node --test scripts/advanced-search.test.mjs`
- `node --test scripts/reader-playwright.test.mjs`
- `npx tsc --noEmit`
- `npm run lint`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/app/search/page.tsx web/components/search web/components/site-shell.tsx web/app/the-loai
git commit -m "feat: add advanced search and merge genre groups"
```

---

### Task 5: Source badge on cover images

**Files:**
- Create: `web/components/source-badge.tsx`
- Modify: `web/components/manga-card.tsx`
- Modify: `web/app/page.tsx`
- Modify: `web/app/bxh/page.tsx`
- Modify: `web/app/manga/[id]/page.tsx`
- Modify: `web/app/globals.css`
- Test: `web/scripts/source-badge.test.mjs`

**Interfaces:**
- Produces: `SourceBadge({ source }: { source?: string })` returns `null` for unknown/empty source and a badge text of exactly `MangaDex` or `Comick`.
- Consumes: DTO `source`/`source_label` from Task 1/3.

- [ ] **Step 1: Write failing render/accessibility test**

Create `web/scripts/source-badge.test.mjs` asserting:
- Badge text is exact for both sources.
- Badge has accessible label `Nguồn: <label>`.
- Cover parent link still has the original href.
- Card/rank/feed/feature/detail covers contain a badge.
- Visible manga titles no longer contain `(MangaDex)` or `(Comick)`.

- [ ] **Step 2: Run test to verify RED**

Run from `web/`: `node --import tsx --conditions=react-server --test scripts/source-badge.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement badge and replace title suffix**

Add CSS for a compact top-left/top-right badge using theme variables. Remove `titleWithSource` usages from visible titles. Keep `sourceLabel` helper as the badge source of truth.

- [ ] **Step 4: Update existing source-ui tests**

Adjust `web/scripts/source-ui.test.mjs` expectations from title suffix to cover badge. Do not delete assertions.

- [ ] **Step 5: Run tests and scoped checks**

Run from `web/`:
- `node --import tsx --conditions=react-server --test scripts/source-badge.test.mjs scripts/source-ui.test.mjs`
- `node --test scripts/reader-playwright.test.mjs`
- `npx tsc --noEmit`
- `npm run lint`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/components/source-badge.tsx web/components/manga-card.tsx web/app/page.tsx web/app/bxh/page.tsx "web/app/manga/[id]/page.tsx" web/app/globals.css web/scripts/source-badge.test.mjs web/scripts/source-ui.test.mjs
git commit -m "feat: show source as a cover badge"
```

---

### Task 6: Ranking skeleton and top-3 frames

**Files:**
- Create: `web/components/rank-skeleton.tsx`
- Create: `web/app/bxh/loading.tsx`
- Modify: `web/app/bxh/page.tsx`
- Modify: `web/app/globals.css`
- Test: `web/scripts/ranking-skeleton.test.mjs`

**Interfaces:**
- Produces: `RankListSkeleton` renders 12 shape-matched rows; rows 1–3 carry `rank-top rank-1|rank-2|rank-3` classes.
- Produces: `Loading` route component matching the `/bxh` shell.

- [ ] **Step 1: Write failing skeleton/frame test**

Create `web/scripts/ranking-skeleton.test.mjs` asserting:
- Route loading shell contains intro, tabs, and 12 skeleton rows.
- Changing `kind` shows skeleton again before data.
- Top 3 real rows and top 3 skeleton rows have distinct frame classes.
- Skeleton/loaded rows have matching bounding boxes within 2px.
- 375px no overflow; reduced-motion disables shimmer.

- [ ] **Step 2: Run test to verify RED**

Run from `web/` after build: `node --test scripts/ranking-skeleton.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement skeleton and frames**

Replace empty outer fallback and generic inner fallback. Add `.rank-row.rank-top.rank-1/2/3` styles using existing theme variables. Keep row height stable on mobile.

- [ ] **Step 4: Run test and regressions**

Run from `web/`:
- `node --test scripts/ranking-skeleton.test.mjs`
- `node --test scripts/skeleton-motion.test.mjs`
- `npx tsc --noEmit`
- `npm run lint`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/components/rank-skeleton.tsx web/app/bxh web/app/globals.css web/scripts/ranking-skeleton.test.mjs
git commit -m "feat: add ranking skeleton and top rank frames"
```

---

### Task 7: Full gate, documentation and cleanup

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/WEB-STATUS.md`
- Modify: `infra/axum.md`
- Modify: `web/package.json` if new suites need aggregate registration

**Interfaces:**
- Consumes: all prior tasks.
- Produces: local-only release gate with all new suites included.

- [ ] **Step 1: Register new test suites**

Add `search-contracts`, `search-source`, `advanced-search`, `source-badge`, and `ranking-skeleton` tests to `test:aggregate` where applicable. Keep Axum prebuild ordering.

- [ ] **Step 2: Run full local gate**

Run from `web/`:
- `npm run build:wasm`
- `npm run build`
- `npm run test:aggregate`
- `npm run test:browser`
- `cargo build --manifest-path ../Cargo.toml -p server`
- `cargo test --manifest-path ../Cargo.toml --workspace`
- `cargo clippy --manifest-path ../Cargo.toml --workspace --all-targets -- -D warnings`
- `cargo fmt --manifest-path ../Cargo.toml --check -p domain -p contracts -p core -p reader-core -p reader-wasm -p server`
- `npm run check:whitespace`
- `npm run check:secrets`
- `git diff --check`

Expected: PASS.

- [ ] **Step 3: Update documentation**

Document advanced search filters, source badges on covers, removed `/the-loai`, ranking skeleton/top frames, `partial` warning, and manual live provider gates. No deployment claim.

- [ ] **Step 4: Commit**

```bash
git add web/package.json README.md CHANGELOG.md docs/WEB-STATUS.md infra/axum.md
git commit -m "chore: gate and document advanced search UX"
```

---

## Execution notes

- Use an isolated worktree at execution time.
- Live Comick/MangaDex verification remains a manual release gate.
- If official catalog fields differ from Task 2 assumptions, rule in the ledger and use documented fields rather than inventing params.
- Do not deploy, push, merge, or provision cloud resources as part of this plan.
