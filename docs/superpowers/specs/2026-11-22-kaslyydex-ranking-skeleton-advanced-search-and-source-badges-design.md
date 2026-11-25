# KasLyyDex Ranking Skeleton, Advanced Search and Source Badges Design

Date: 2026-11-22
Status: approved in chat; awaiting written-spec review
Scope: web catalog UX and Axum search boundary. Extends the multi-source reading branch already merged locally.

## 1. Problem

The ranking page and the genre tags inside search still show weak loading states: `/bxh` has an empty outer Suspense fallback and a single-line inner skeleton, while genre groups have one generic block. Navigation feels slow even when content is available. Search currently supports basic query/tags/status/sort/page only and cannot search Comick catalog. Source attribution is currently appended after manga titles, which clutters titles and does not communicate source at a glance.

## 2. Goals

1. Show a shape-matched skeleton immediately when entering or changing `/bxh`.
2. Give ranks 1–3 a distinct visual frame in both real and skeleton states.
3. Show a shape-matched skeleton for genre groups immediately inside Advanced Search.
4. Add advanced search filters: source, language, year, status, sort, tags, page.
5. Search MangaDex and Comick catalogs through Axum; `source=all` returns both.
6. Replace title suffix labels with a source badge rendered on the cover image.
7. Keep all existing local-only and no-deployment constraints.

## 3. Non-goals

- No merged duplicate-title identity across providers; results from both providers remain separate entries with source badges.
- No MangaPlus adapter.
- No changes to chapter fallback/cache logic from the previous plan except sharing source metadata.
- No user auth, XP, moderation, notification, reader WASM, or deployment changes.
- No claim that live Comick/MangaDex availability is verified; manual release gate remains.

## 4. Approved decisions

- Search approach: Axum search aggregation over provider adapters.
- `source` values: `all`, `mangadex`, `comick`.
- Advanced filters: source, language, year, status, sort, tags, page.
- Source display: badge on cover image; remove `(MangaDex)` / `(Comick)` suffix from titles.
- Top ranks 1–3 have distinct frames using the existing theme accent system.
- Skeletons must match target item shape and appear before data arrives.

## 5. Ranking page design

### 5.1 Loading behavior

- The static page shell (title, intro, rank tabs) renders without waiting for data.
- Inner `Suspense` wraps only the rank list and uses `key={kind}` so changing tab immediately shows the skeleton again.
- Add `web/app/bxh/loading.tsx` so navigation from another route also shows the full shell plus skeleton immediately.
- Replace the empty outer fallback with the same shell plus skeleton.

### 5.2 `RankListSkeleton`

- New reusable component, for example `web/components/rank-skeleton.tsx`.
- Renders 12 rows matching `.rank-row`:
  - rank number slot,
  - cover slot with 2/3 aspect ratio,
  - two title/meta lines,
  - rating slot.
- Uses `role="status"`, `aria-busy`, and `aria-label="Đang tải xếp hạng"`.
- Decorative inner nodes are `aria-hidden="true"`.
- Rows 1–3 use the same rank-frame classes as real top rows so the transition does not shift layout.

### 5.3 Top 1–3 frames

- Use existing theme variables only; no new color palette.
- `#1`: filled accent rank badge, stronger accent border and subtle gradient background.
- `#2`: outlined accent rank badge, thinner accent-tinted border.
- `#3`: outlined rank badge with lower emphasis and softer border.
- Cover images for top rows get an accent frame.
- Row height remains unchanged on mobile; only border/badge/background emphasis changes.
- Hover/focus states retain existing motion tokens and reduced-motion guard.

## 6. Genre groups merged into Advanced Search

- Remove the standalone `/the-loai` route and its navigation entry entirely.
- The page keeps the name and route `Khám phá` (`/search`).
- Genre/tag groups move into the advanced search panel as a section titled "Thể loại":
  - "Thể loại chính",
  - "Chủ đề",
  - "Định dạng",
  - "Nội dung".
- Add a `GenreGroupsSkeleton` rendering four group sections with a heading bar and 8–10 pill skeletons wrapping like real tags.
- The same skeleton is used while the advanced panel loads tags and while filters reset.
- Selecting a genre pill updates the visible `tags` filter and submits through the existing search form.
- No overflow at 375px; pill skeleton widths are bounded.

## 7. Advanced search and Axum aggregation

### 7.1 Query contract

`/api/content/search` accepts:

```text
q        string   existing search text
source   all | mangadex | comick     default all
lang     all | vi | en               default all
year     integer or empty
status   existing status enum or empty
sort     existing sort enum          default follows
tags     comma-separated tag ids     max 8
page     integer >= 1                default 1
```

Web URL uses the same names so search state is bookmarkable.

### 7.2 Provider behavior

- `MangaDexProvider` uses existing search filtering for supported fields.
- `ComickProvider` uses the public Catalog API verified in the previous plan.
- `source=mangadex` calls only MangaDex; `source=comick` calls only Comick; `source=all` calls both concurrently with bounded timeouts.
- If one provider fails or times out, the other provider's results are returned and `partial=true` is set.
- If both fail, return the existing structured content error.
- Unsupported provider filters are applied locally on the normalized page where possible; if not possible, mark `partial=true`.

### 7.3 Normalization and merge

- Normalize provider results into `MangaSummaryDto` with required source metadata:
  - `source`: `mangadex` or `comick`,
  - `source_label`: `MangaDex` or `Comick`,
  - `lang` when known,
  - `year` when known,
  - existing title/cover/status/tags/rating/follows fields.
- For `source=all`, keep provider duplicates separate because source is part of identity.
- Sort merged results by the requested `sort` using a stable secondary key: source label, then title, then id.
- Paginate after merge with the existing page size of 24.
- Keep response shape compatible; add `partial?: boolean` to `SearchResponse`.

### 7.4 Caching and limits

- Axum cache keys include all query parameters and provider set.
- Bound provider result pages to a reasonable limit before merge to prevent fan-out.
- Use existing content cache and timeout behavior; no user credentials are cached.
- No background refresh or polling.

## 8. Web advanced search UI

- Extend the existing `<details>` filter panel on `/search` and rename nothing: the page remains "Khám phá".
- Add controls using the shared `Select` component:
  - Nguồn: `Tất cả`, `MangaDex`, `Comick`.
  - Ngôn ngữ: `Tất cả`, `Tiếng Việt`, `English`.
  - Năm: empty plus recent years descending.
- Include the merged genre/tag groups from Section 6 inside the same advanced panel.
- Keep existing status, sort, tags and pagination behavior; genre pills write into the same `tags` filter.
- Form `GET /search` submits all values; hidden `q` remains.
- `parseQuery` validates source/lang/year and clamps page.
- Show a short warning when `SearchResponse.partial === true` without claiming full results.

## 9. Source badge on cover

- Remove `titleWithSource` usage from visible manga titles on cards, home feature/feed/rank, manga detail and `/bxh`.
- Add `SourceBadge` component rendered inside cover containers:
  - `.card-cover`,
  - `.rank-cover`,
  - `.feed-cover`,
  - feature poster/art container,
  - manga detail cover.
- Badge text is exactly `MangaDex` or `Comick`.
- Badge uses theme variables, small size, high contrast, `aria-label` such as `Nguồn: Comick`.
- It must not cover the whole cover image or intercept clicks; link semantics remain on the parent.
- Skeleton cover slots reserve the badge position for card/rank/feed skeletons.

## 10. Compatibility

- Existing search URLs without new params default to `source=all`, `lang=all`, no year, preserving current behavior.
- The `/the-loai` route and navigation item are removed; no redirect is kept. Existing bookmarks to that path will 404 by explicit owner decision.
- Existing MangaDex results keep UUID ids and gain source metadata.
- Comick catalog results use provider-prefixed ids and never collide with MangaDex ids in progress/history.
- Reader fallback rules remain unchanged: fallback is still chapter-level and never replaces readable MangaDex chapters.
- Guest/public use remains available without auth credentials.

## 11. Testing

Rust/Axum:
- query parser accepts/rejects source/lang/year/page values;
- provider dispatch for mangadex, comick, all;
- one-provider failure returns other results with `partial=true`;
- normalization sets source/source_label together;
- deterministic merged sort and 24-item pagination;
- cache key includes all query params.

Web:
- URL serialization/deserialization for new filters;
- advanced search controls submit expected values;
- advanced panel contains merged genre groups and no separate `/the-loai` route remains;
- partial warning renders;
- source badge appears on all cover surfaces and title has no suffix;
- ranking skeleton appears on entry and tab change;
- top 1/2/3 frame classes are present in real and skeleton states;
- genre skeleton renders four groups inside the advanced search panel;
- 375px no horizontal overflow in all three pages;
- reduced-motion guard remains intact.

Run the full local gate: build, aggregate, browser, Rust tests, clippy, scoped fmt, whitespace/secrets/diff checks.

## 12. Manual release gates

- Live Comick catalog search fields, limits, and ToS.
- Live MangaDex search behavior with new params.
- CDN/image delivery for Comick results.
- Deployment/auth/database configuration remains owner-gated.

## 13. Risks

- Comick catalog may not support some filters natively; local filtering may reduce result completeness and requires `partial` disclosure.
- `source=all` doubles upstream calls; bounded timeout/cache is required.
- Source badges on small mobile covers can crowd artwork; keep badge compact and test 375px.
- Removing title suffixes may reduce textual source visibility for screen readers; badge must carry an accessible label.
