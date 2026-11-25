# KasLyyDex Multi-Source Fallback and Reading UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add chapter-level fallback reading from Comick when MangaDex cannot serve a chapter, show source labels, and upgrade skeletons, motion, reader theme sync, and dropdowns.

**Architecture:** Axum/core gains a provider layer: MangaDex remains primary, Comick is the first fallback adapter. Public `/api/content/*` routes keep compatible shapes and add optional source metadata. Web UI consumes source-aware DTOs, renders source labels, and uses one shared accessible dropdown. Reader theme defaults to `auto` and follows the site theme unless manually overridden.

**Tech Stack:** Rust/Axum/reqwest, existing disk cache, Next.js 16 client/server components, TypeScript, CSS variables, Node test runner, Playwright with installed Edge/Chromium.

**Spec:** `docs/superpowers/specs/2026-11-21-kaslyydex-multi-source-fallback-and-reading-ux-design.md`

## Global Constraints

- Primary source is `mangadex`; first fallback source is `comick`.
- Source labels are exactly `MangaDex` and `Comick`.
- Fallback is per chapter, never replaces a readable MangaDex chapter.
- Language preference for fallback matching is `vi`, then `en`.
- MangaDex chapter IDs remain UUIDs; Comick chapter IDs use `comick:<opaque-id>`.
- All reader images remain same-origin proxied through Axum; no raw upstream CDN URLs in browser DTOs.
- No arbitrary client-supplied image URL proxying; per-source HTTPS CDN allowlist only.
- Reader background default is `auto`; manual modes remain `light`, `sepia`, `dark`.
- Custom dropdown replaces native selects across the app and must support keyboard/outside-click/ARIA listbox behavior.
- Motion respects `prefers-reduced-motion`; no animation library dependency.
- No ads/paid access; preserve MangaDex and scanlation-group attribution.
- No deployment, cloud provisioning, remote push, merge, or auth rewrite in this plan.
- Existing guest reading, progress, library, XP integrity, and public build without Neon credentials must keep working.

## Review Focus

- Special/decimal/oneshot chapter numbers can cause wrong fallback matches; matching must be conservative and tested in Task 3.
- Comick catalog unavailable, rate-limited, or changed shape must not break MangaDex reading; tested in Tasks 2–3.
- Custom dropdown can break keyboard users, screen readers, or GET form filters; tested in Task 7.
- Reader `auto` theme can break saved manual overrides, fullscreen, or site-theme switching; tested in Task 9.
- Fallback CDN images can be blocked, hotlink-protected, or spoofed through proxy URLs; tested in Tasks 4 and 6.

---

### Task 1: Additive source metadata contracts

**Files:**
- Modify: `crates/contracts/src/lib.rs`
- Modify: `web/lib/contracts.ts`
- Test: `crates/contracts/src/lib.rs` inline tests
- Test: `web/scripts/source-contracts.test.mjs`

**Interfaces:**
- Produces: Rust DTO fields `source: String`, `source_label: String` on `MangaSummaryDto` and `ChapterDto`, defaulted to `mangadex`/`MangaDex` when omitted.
- Produces: Rust helper `pub fn source_label(source: &str) -> &'static str`.
- Produces: TS optional fields `source?: string`, `source_label?: string`, `readable?: boolean` on `MangaSummaryDto`/`ChapterDto`.
- Produces: TS helper `sourceLabel(source?: string): string` returning `Comick` for `comick`, otherwise `MangaDex`.

- [ ] **Step 1: Write failing Rust contract tests**

Add tests named:
- `manga_summary_defaults_source_to_mangadex`
- `chapter_defaults_source_to_mangadex`
- `source_label_maps_known_sources`

Assertions:
- Legacy JSON without `source` deserializes with `source == "mangadex"` and `source_label == "MangaDex"`.
- Explicit `source == "comick"` can deserialize and `source_label("comick") == "Comick"`.
- Unknown source label falls back to `MangaDex`.

- [ ] **Step 2: Run Rust tests to verify RED**

Run: `cargo test -p contracts source`
Expected: FAIL because fields/helper do not exist.

- [ ] **Step 3: Add defaulted Rust fields and helper**

In `MangaSummaryDto` and `ChapterDto`, add:

```rust
#[serde(default = "default_source")]
pub source: String,
#[serde(default = "default_source_label")]
pub source_label: String,
```

Add `default_source() -> String` returning `"mangadex"`, `default_source_label() -> String` returning `"MangaDex"`, and `source_label(source: &str) -> &'static str`.

Update existing Rust constructors/tests that build these DTOs literally to include the new fields or use `..Default::default()` only if a `Default` impl already exists; otherwise set fields explicitly.

- [ ] **Step 4: Run Rust tests to verify GREEN**

Run: `cargo test -p contracts`
Expected: PASS.

- [ ] **Step 5: Write failing TS contract test**

Create `web/scripts/source-contracts.test.mjs` asserting:
- `sourceLabel()` returns `MangaDex`.
- `sourceLabel("comick")` returns `Comick`.
- `sourceLabel("unknown")` returns `MangaDex`.
- A legacy `ChapterDto` object without source fields is still assignable/usable by existing helper code.

- [ ] **Step 6: Run TS test to verify RED**

Run from `web/`: `node --import tsx --test scripts/source-contracts.test.mjs`
Expected: FAIL because `sourceLabel` is absent.

- [ ] **Step 7: Add TS optional fields and helper**

Add optional fields to `MangaSummaryDto` and `ChapterDto`. Add `readable?: boolean` to `ChapterDto`. Export `sourceLabel(source?: string): string`.

- [ ] **Step 8: Run TS test and typecheck**

Run from `web/`:
- `node --import tsx --test scripts/source-contracts.test.mjs`
- `npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add crates/contracts/src/lib.rs web/lib/contracts.ts web/scripts/source-contracts.test.mjs
git commit -m "feat: add source metadata to content contracts"
```

---

### Task 2: Comick provider adapter and normalization

**Files:**
- Create: `crates/core/src/comick.rs`
- Modify: `crates/core/src/lib.rs`
- Test: `crates/core/src/comick.rs` inline tests

**Interfaces:**
- Consumes: Task 1 source constants/labels.
- Produces: `pub struct Comick` with `pub fn new() -> Self` and `pub fn with_origin(origin: String) -> Self`.
- Produces: `pub async fn search_titles(&self, query: &str) -> Result<Vec<ComickTitle>, Err>`.
- Produces: `pub async fn chapters(&self, hid: &str, lang: &str) -> Result<Vec<ComickChapter>, Err>`.
- Produces: `pub async fn page_urls(&self, chapter_id: &str) -> Result<Vec<String>, Err>`.
- Produces: `pub struct ComickTitle { pub hid: String, pub title: String, pub aliases: Vec<String> }`.
- Produces: `pub struct ComickChapter { pub id: String, pub chapter: Option<String>, pub lang: String, pub title: String, pub publish_at: String, pub group: String }`.
- Produces: `pub fn is_comick_chapter_id(id: &str) -> bool` accepting `comick:` followed by a non-empty opaque ID with no whitespace/control characters.

- [ ] **Step 1: Verify official Comick catalog endpoints**

Read `https://api.comick.dev/docs/` and the catalog explorer/OpenAPI if available. Record the exact public catalog endpoints for search, title chapters, and chapter images in a code comment at the top of `comick.rs`. Do not use OAuth/Library endpoints. If the official catalog cannot be verified, stop this task and report the blocker; do not invent endpoints.

- [ ] **Step 2: Write failing normalization and ID tests**

Add tests:
- `comick_id_requires_prefix_and_nonempty_opaque_id`
- `comick_chapter_normalizes_missing_title_and_language`
- `comick_page_urls_are_https_and_ordered`
- `comick_search_path_encodes_query`

Assertions:
- `is_comick_chapter_id("comick:abc123")` is true.
- `is_comick_chapter_id("abc123")`, `comick:`, `comick:bad id`, and empty string are false.
- Chapter normalization preserves `id`, `chapter`, `lang`, and defaults empty title to `""`.
- Page URL builder preserves provider order and rejects non-HTTPS image URLs.
- Search path builder percent-encodes query text.

- [ ] **Step 3: Run tests to verify RED**

Run: `cargo test -p core comick`
Expected: FAIL because module/functions do not exist.

- [ ] **Step 4: Implement adapter skeleton and pure helpers**

Create `Comick`, `ComickTitle`, `ComickChapter`, ID validation, path builders, and DTO normalization. Use `COMICK_API_ORIGIN` env override for tests, defaulting to the verified official catalog origin. HTTP methods may return `Err("Comick catalog unavailable")` until wired, but pure helpers must pass.

- [ ] **Step 5: Run tests to verify GREEN**

Run: `cargo test -p core comick`
Expected: PASS.

- [ ] **Step 6: Wire HTTP calls using verified endpoints**

Implement `search_titles`, `chapters`, and `page_urls` with bounded timeouts and generic upstream errors. Do not log secrets or raw auth headers. Return empty vectors only for valid empty responses; treat malformed shapes as errors.

- [ ] **Step 7: Run core tests and clippy**

Run:
- `cargo test -p core`
- `cargo clippy -p core --all-targets -- -D warnings`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add crates/core/src/comick.rs crates/core/src/lib.rs
git commit -m "feat: add Comick catalog provider adapter"
```

---

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

---

### Task 4: Per-source image proxy allowlist

**Files:**
- Modify: `crates/core/src/imgcache.rs`
- Test: `crates/core/src/imgcache.rs` inline tests

**Interfaces:**
- Consumes: Comick page URLs from Task 2/3.
- Produces: `fn allowed(url: &reqwest::Url) -> bool` extended with verified Comick CDN hosts while preserving MangaDex rules.
- Produces: test-visible helper `fn allowed_host(host: &str) -> bool` if useful.

- [ ] **Step 1: Write failing allowlist tests**

Add tests:
- `allows_verified_comick_cdn_https`
- `rejects_spoofed_comick_host_and_non_https`
- `rejects_credentials_and_nonstandard_port`

Use the exact Comick CDN host verified in Task 2. If Task 2 verified `meo.comick.pictures`, assert that host is allowed over HTTPS and these are rejected:
- `http://meo.comick.pictures/a.jpg`
- `https://meo.comick.pictures.example.com/a.jpg`
- `https://user:secret@meo.comick.pictures/a.jpg`
- `https://meo.comick.pictures:8080/a.jpg`

- [ ] **Step 2: Run tests to verify RED**

Run: `cargo test -p core imgcache`
Expected: FAIL for Comick host allowance.

- [ ] **Step 3: Extend allowlist minimally**

Add only the verified Comick CDN host(s). Keep HTTPS, port 443, no userinfo, and exact/suffix rules safe. Do not allow arbitrary hosts.

- [ ] **Step 4: Run tests to verify GREEN**

Run: `cargo test -p core imgcache`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/core/src/imgcache.rs
git commit -m "feat: allow verified Comick CDN through image proxy"
```

---

### Task 5: Web source labels and fallback chapter UI

**Files:**
- Modify: `web/lib/format.ts`
- Modify: `web/components/manga-card.tsx`
- Modify: `web/app/page.tsx`
- Modify: `web/app/manga/[id]/page.tsx`
- Modify: `web/components/chapter-list.tsx`
- Modify: `web/components/reader/ReaderToolbar.tsx`
- Test: `web/scripts/source-ui.test.mjs`

**Interfaces:**
- Consumes: Task 1 `sourceLabel`, Task 3 source-aware chapter DTOs.
- Produces: `titleWithSource(title: string, source?: string): string` in `web/lib/format.ts`.
- Produces: chapter rows and reader toolbar show source label for non-primary chapters.

- [ ] **Step 1: Write failing UI helper/browser test**

Create `web/scripts/source-ui.test.mjs` asserting:
- `titleWithSource("Slime", "mangadex") === "Slime (MangaDex)"`.
- `titleWithSource("Slime", "comick") === "Slime (Comick)"`.
- `titleWithSource("Slime") === "Slime (MangaDex)"`.
- In a fixture page with a Comick chapter, chapter row text contains `(Comick)`.
- Readable MangaDex chapter rows do not falsely show Comick.

- [ ] **Step 2: Run test to verify RED**

Run from `web/`: `node --import tsx --conditions=react-server --test scripts/source-ui.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement source label rendering**

Add `titleWithSource`. Use it in manga cards/detail/feature where title is shown. In `ChapterList`, append source label for chapters whose `source` is not `mangadex`. In reader toolbar/back title, show source when current chapter is fallback. Keep external links unchanged.

- [ ] **Step 4: Run test, typecheck, lint**

Run from `web/`:
- `node --import tsx --conditions=react-server --test scripts/source-ui.test.mjs`
- `npx tsc --noEmit`
- `npx eslint lib/format.ts components/manga-card.tsx components/chapter-list.tsx components/reader/ReaderToolbar.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/lib/format.ts web/components/manga-card.tsx web/app/page.tsx "web/app/manga/[id]/page.tsx" web/components/chapter-list.tsx web/components/reader/ReaderToolbar.tsx web/scripts/source-ui.test.mjs
git commit -m "feat: show reading source labels in web UI"
```

---

### Task 6: Source-aware reader tickets, progress, and XP

**Files:**
- Modify: `web/lib/validators.ts`
- Modify: `web/lib/progression-api.ts`
- Modify: `web/lib/db/schema.ts`
- Create: `web/drizzle/0007_reader_session_source.sql`
- Modify: `web/drizzle/meta/_journal.json` and snapshot files via Drizzle Kit
- Modify: `web/components/reader/ReaderClient.tsx`
- Test: `web/scripts/source-progression.test.mjs`

**Interfaces:**
- Consumes: Task 3 `chapter_metadata` with source, Task 5 source-aware UI.
- Produces: content ID validator accepting MangaDex UUID or `comick:<opaque-id>`.
- Produces: reader ticket claim `source` and `reader_sessions.source` column default `mangadex`.
- Produces: XP completion binds `source + chapter_id`; mismatched source rejects ticket.

- [ ] **Step 1: Write failing source-aware progression tests**

Create `web/scripts/source-progression.test.mjs` using existing PGlite + fixture harness. Assertions:
- MangaDex UUID ticket still works.
- Comick chapter with authoritative pages can create ticket and complete once.
- Ticket with changed `source` is rejected.
- Ticket with Comick ID but MangaDex metadata is rejected.
- Forged `percent`/`pageCount` still cannot award XP.
- Guest import still creates no XP.

- [ ] **Step 2: Run test to verify RED**

Run from `web/`: `node --import tsx --conditions=react-server --test scripts/source-progression.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Add migration and schema source column**

Add `reader_sessions.source TEXT NOT NULL DEFAULT 'mangadex'`. Generate Drizzle migration/snapshot/journal consistently. Do not touch Neon Auth tables.

- [ ] **Step 4: Update validators and ticket flow**

Allow source-aware content IDs. Fetch chapter metadata from Axum using the full source-aware ID. Bind `source` into signed ticket and persisted session. Verify claim/source/session match before checkpoint/completion. Keep existing elapsed/coverage/rate-limit rules.

- [ ] **Step 5: Update reader client requests**

Pass full chapter ID and source metadata through reader-session/checkpoint/complete calls. Do not change WASM page state logic.

- [ ] **Step 6: Run tests and migration harness**

Run from `web/`:
- `node --import tsx --conditions=react-server --test scripts/source-progression.test.mjs scripts/progression.test.mjs scripts/database.test.mjs`
- `npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web/lib/validators.ts web/lib/progression-api.ts web/lib/db/schema.ts web/drizzle web/components/reader/ReaderClient.tsx web/scripts/source-progression.test.mjs
git commit -m "feat: bind reader tickets and XP to content source"
```

---

### Task 7: Shared accessible custom dropdown

**Files:**
- Create: `web/components/ui/Select.tsx`
- Modify: `web/app/globals.css`
- Modify: `web/components/reader/ReaderToolbar.tsx`
- Modify: `web/components/account/SettingsForm.tsx`
- Modify: `web/components/moderation/ModerationQueue.tsx`
- Modify: `web/app/search/page.tsx`
- Test: `web/scripts/select.test.mjs`
- Modify: `web/scripts/account-playwright.test.mjs`
- Modify: `web/scripts/reader-playwright.test.mjs`

**Interfaces:**
- Produces: `Select` props:

```ts
type SelectOption = { value: string; label: string; disabled?: boolean };
type SelectProps = {
  id?: string;
  name?: string;
  value?: string;
  defaultValue?: string;
  options: SelectOption[];
  onChange?: (value: string) => void;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
};
```

- Produces: when `name` is provided, renders a hidden input with the current value so GET/POST forms submit unchanged.
- Produces: trigger button with `aria-expanded`, `aria-controls`; popup `role="listbox"`; options `role="option"` and `aria-selected`.

- [ ] **Step 1: Write failing dropdown behavior test**

Create `web/scripts/select.test.mjs` with Playwright assertions:
- Click opens listbox; Escape closes.
- Arrow Down/Up moves active option; Enter selects.
- Click outside closes.
- Selected value updates hidden input when `name` is present.
- Disabled select cannot open.
- Search filter form still submits selected `status`/`sort` values.

- [ ] **Step 2: Run test to verify RED**

Run from `web/`: `node --test scripts/select.test.mjs`
Expected: FAIL because component does not exist.

- [ ] **Step 3: Implement `Select` and styles**

Implement controlled/uncontrolled behavior, keyboard navigation, outside-click close, focus management, long-list scrolling, and theme-variable styling. Add subtle open/close transition under reduced-motion guard.

- [ ] **Step 4: Replace native selects**

Replace reader chapter/settings selects, account settings selects, moderation target select, and search filter selects. For search GET form, use `name` hidden-input behavior. Keep underlying values identical.

- [ ] **Step 5: Update existing Playwright select interactions**

Replace `selectOption` calls in account/reader tests with dropdown click/keyboard interactions. Keep test intent unchanged.

- [ ] **Step 6: Run dropdown and affected browser tests**

Run from `web/`:
- `node --test scripts/select.test.mjs`
- `node --test scripts/account-playwright.test.mjs scripts/reader-playwright.test.mjs`
- `npx tsc --noEmit`
- `npm run lint`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web/components/ui/Select.tsx web/app/globals.css web/components/reader/ReaderToolbar.tsx web/components/account/SettingsForm.tsx web/components/moderation/ModerationQueue.tsx web/app/search/page.tsx web/scripts/select.test.mjs web/scripts/account-playwright.test.mjs web/scripts/reader-playwright.test.mjs
git commit -m "feat: replace native selects with accessible dropdown"
```

---

### Task 8: Shape-matched skeletons and motion system

**Files:**
- Modify: `web/app/globals.css`
- Modify: `web/app/page.tsx`
- Modify: `web/components/manga-card.tsx`
- Modify: `web/app/search/page.tsx`
- Modify: `web/app/manga/[id]/page.tsx`
- Modify: `web/components/reader/ReaderPages.tsx`
- Test: `web/scripts/skeleton-motion.test.mjs`

**Interfaces:**
- Produces: CSS tokens `--dur-fast`, `--dur-base`, `--ease-out`.
- Produces: skeleton components/classes for hero, popular card, feed row, rank row, chapter row, reader page.
- Produces: image fade-in class applied after load/decode.

- [ ] **Step 1: Write failing skeleton/motion browser test**

Create `web/scripts/skeleton-motion.test.mjs` asserting:
- Home fallback skeletons have hero/card/feed/rank shapes, not a single generic block.
- Skeleton containers have accessible loading status.
- At 375px, skeleton and loaded pages have no horizontal overflow.
- With reduced motion emulated, shimmer/transition animations are disabled or reduced.
- Reader page images fade in only after decode/load.

- [ ] **Step 2: Run test to verify RED**

Run from `web/`: `node --test scripts/skeleton-motion.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Add motion tokens and skeleton markup/styles**

Add CSS variables and shape-matched skeletons. Replace generic Suspense fallbacks in home/search/manga pages. Add reader page skeleton/frame behavior without changing WASM state.

- [ ] **Step 4: Add restrained transitions**

Apply card hover, button press, image fade-in, reader horizontal transition, and progress bar transition using tokens. Guard all motion with `prefers-reduced-motion`.

- [ ] **Step 5: Run test and visual regression suites**

Run from `web/`:
- `node --test scripts/skeleton-motion.test.mjs`
- `node --test scripts/reader-playwright.test.mjs`
- `npm run lint`
- `npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/app/globals.css web/app/page.tsx web/components/manga-card.tsx web/app/search/page.tsx "web/app/manga/[id]/page.tsx" web/components/reader/ReaderPages.tsx web/scripts/skeleton-motion.test.mjs
git commit -m "feat: match skeletons to content and add restrained motion"
```

---

### Task 9: Reader theme auto-sync with site theme

**Files:**
- Modify: `crates/domain/src/lib.rs`
- Modify: `crates/contracts/src/lib.rs` if wire DTO tests need updates
- Modify: `web/lib/guest.ts`
- Modify: `web/app/globals.css`
- Modify: `web/components/reader/ReaderClient.tsx`
- Modify: `web/components/reader/ReaderToolbar.tsx`
- Modify: `web/components/account/SettingsForm.tsx`
- Test: `crates/domain/src/lib.rs` inline tests
- Test: `web/scripts/reader-theme.test.mjs`

**Interfaces:**
- Consumes: Task 7 dropdown for background mode selection.
- Produces: Rust `ReaderBackground::Auto` with wire value `auto`.
- Produces: TS `ReaderSettings["bg"] = "auto" | "light" | "sepia" | "dark"`.
- Produces: `DEFAULT_SETTINGS.bg = "auto"`.
- Produces: `.reader[data-bg="auto"]` uses site theme variables.

- [ ] **Step 1: Write failing Rust/TS theme tests**

Rust assertions:
- `ReaderBackground` accepts `auto`, `light`, `sepia`, `dark`.
- Existing wire values still roundtrip.

Create `web/scripts/reader-theme.test.mjs` asserting:
- Unset reader settings normalize to `bg: "auto"`.
- Saved `sepia`/`dark` remain unchanged.
- Reader in `auto` follows site light/dark dataset.
- Switching site theme updates reader colors without reload.
- Manual override persists after reload.

- [ ] **Step 2: Run tests to verify RED**

Run:
- `cargo test -p domain reader_background`
- from `web/`: `node --import tsx --conditions=react-server --test scripts/reader-theme.test.mjs`

Expected: FAIL.

- [ ] **Step 3: Add `auto` to domain and guest settings**

Add `Auto` variant and wire serialization. Update `normalizeSettings` so missing/invalid bg becomes `auto`, while valid manual values persist. Update affected Rust WASM/settings tests if they enumerate backgrounds.

- [ ] **Step 4: Add CSS auto mode and UI option**

Make `.reader[data-bg="auto"]` inherit site variables for background/surface/text/line/accent. Keep manual modes unchanged. Add `Tự động theo giao diện` option to reader settings and account settings dropdown.

- [ ] **Step 5: Run theme and reader regression tests**

Run:
- `cargo test -p domain -p reader-core -p reader-wasm`
- from `web/`: `node --import tsx --conditions=react-server --test scripts/reader-theme.test.mjs scripts/guest-storage.test.mjs`
- from `web/`: `node --test scripts/reader-playwright.test.mjs`
- `npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add crates/domain/src/lib.rs crates/contracts/src/lib.rs web/lib/guest.ts web/app/globals.css web/components/reader/ReaderClient.tsx web/components/reader/ReaderToolbar.tsx web/components/account/SettingsForm.tsx web/scripts/reader-theme.test.mjs
git commit -m "feat: sync reader theme with site by default"
```

---

### Task 10: Regression gate, documentation, and release notes

**Files:**
- Modify: `web/package.json`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/WEB-STATUS.md`
- Modify: `infra/axum.md`
- Test: existing aggregate/browser/Rust suites

**Interfaces:**
- Consumes: all previous tasks.
- Produces: `npm run test:source` or extended aggregate script covering new source/fallback/dropdown/theme/skeleton tests.
- Produces: documentation for source fallback, Comick adapter limits, source labels, reader theme auto, and custom dropdown behavior.

- [ ] **Step 1: Add new tests to aggregate scripts**

Update `web/package.json` so aggregate tests include:
- `source-contracts.test.mjs`
- `source-fallback.test.mjs`
- `source-ui.test.mjs`
- `source-progression.test.mjs`
- `select.test.mjs`
- `skeleton-motion.test.mjs`
- `reader-theme.test.mjs`

Keep existing tests included. Do not skip or silence failing tests.

- [ ] **Step 2: Run full local gate**

Run from `web/`:
- `npm ci`
- `npm run build:wasm`
- `npm run build`
- `npm run test:aggregate`
- `npm run test:browser`

Run from repo root:
- `cargo build -p server`
- `cargo test --workspace`
- `cargo clippy --workspace --all-targets -- -D warnings`
- `cargo fmt --check -p domain -p contracts -p reader-core -p reader-wasm -p server`
- `git diff --check`

Expected: PASS. If Comick live catalog is unavailable, fixture tests still pass and docs mark live verification pending.

- [ ] **Step 3: Update documentation**

Document:
- MangaDex primary, Comick fallback per chapter.
- Source label examples.
- `COMICK_API_ORIGIN` test override if added.
- Reader theme `auto` default and manual overrides.
- Custom dropdown keyboard behavior.
- Live provider/ToS verification remains a manual release gate.
- No deployment was performed.

- [ ] **Step 4: Commit**

```bash
git add web/package.json README.md CHANGELOG.md docs/WEB-STATUS.md infra/axum.md
git commit -m "chore: gate and document multi-source reading UX"
```

---

## Execution notes

- Use an isolated worktree at execution time.
- Verify official Comick catalog endpoints before writing HTTP adapter code.
- Keep fixture tests deterministic; do not require live Comick/MangaDex credentials in CI.
- If a task discovers that Comick catalog terms or endpoints cannot support the spec, stop and revise the spec before continuing.
- Do not deploy, push, merge, or provision cloud resources as part of this plan.
