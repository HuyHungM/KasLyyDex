# Task 4 report — Advanced Search UI and merged genre groups

Status: complete (RED → GREEN, regressions green).

## Scope delivered

- `web/app/search/page.tsx`
  - `Query`/`parseQuery` now accept `source` (`all|mangadex|comick`), `lang` (`all|vi|en`) and `year` (`1900..UTC year + 1`, exact 4-digit match). Page stays clamped to `1..416`; status/sort/tags behavior unchanged.
  - New filters are shared `Select` controls (source, language, year) alongside status and sort.
  - URL state uses Task 1's `searchQuery` serializer for both the form-adjacent links and pagination, so `q`, comma-separated `tags`, `status`, `sort` and `page` URLs remain byte-compatible; new filters are appended only when non-default.
  - `partial === true` renders one short `role="status"` warning: “Lưu ý: kết quả có thể chưa đầy đủ do giới hạn từ nguồn dữ liệu.” No success/completeness claim when partial.
  - Page name stays “Khám phá truyện”.
- `web/components/search/GenreGroups.tsx` — grouped tag pills (genre/theme/format/content) as checkboxes writing into the existing `tags` form field; preserves checked state from the URL.
- `web/components/search/GenreGroupsSkeleton.tsx` — four `role="status"` group placeholders; animation reuses the existing `.skel` rule, which is already disabled under `prefers-reduced-motion`.
- `web/components/site-shell.tsx` — `/the-loai` nav item and its unused `genres` icon removed.
- `web/app/the-loai/page.tsx` — deleted.
- `web/scripts/advanced-search.test.mjs` — new browser suite.
- `web/scripts/reader-playwright.test.mjs` — genre assertion moved from the removed page to the advanced panel, plus a 404 assertion for the old route.
- `web/README.md` — route list no longer advertises `/the-loai`; documents the new search params.

No source badge or cover URL code was touched (Task 5 ownership preserved). No auth, deploy, cloud or redirect behavior added.

## RED → GREEN

RED, baseline `1690cb6` build, `node --test scripts/advanced-search.test.mjs`: **5 tests, 0 pass, 5 fail**.

| Test | RED failure |
| --- | --- |
| advanced dropdowns submit with q/tags | 0 source comboboxes found |
| four genre groups + pill writes tags | 0 `.genre-group` found |
| partial warning | `.partial-warning` never appeared (30 s timeout) |
| route/nav removal | 2 `/the-loai` nav links found |
| 375px overflow check | no genre group to measure (30 s timeout) |

GREEN, after rebuild: **5 tests, 5 pass, 0 fail** (7.8 s).

## Removed-route proof

- `web/app/the-loai/page.tsx` is deleted; `git status` reports ` D web/app/the-loai/page.tsx`.
- No `/the-loai` link in either the desktop rail or mobile tabs (`a[href="/the-loai"]` count = 0 in browser).
- Browser navigation to `/the-loai` returns HTTP **404** with no redirect (`response.status() === 404`, final URL still `/the-loai`). Verified in both `advanced-search.test.mjs` and `reader-playwright.test.mjs`.
- No `redirect()`/`next.config` rewrite was introduced.

## Verification

| Check | Result |
| --- | --- |
| `npm run build` (twice: baseline RED + GREEN) | pass |
| `node --test scripts/advanced-search.test.mjs` | 5/5 pass |
| `node --test scripts/reader-playwright.test.mjs` | 9/9 pass |
| `node --test scripts/skeleton-motion.test.mjs` | 4/4 pass (reduced-motion assertions included) |
| `node --import tsx --conditions=react-server --test scripts/search-contracts.test.mjs scripts/source-ui.test.mjs scripts/select.test.mjs` | 21/21 pass |
| `node --test scripts/search-source.test.mjs` | 11/11 pass (Task 1/3 API + partial contract) |
| `npx tsc --noEmit` | pass after rebuild (stale generated route types needed the rebuild) |
| `npm run lint` | 0 errors, 7 pre-existing `no-img-element` warnings |
| `npm run check:whitespace` | pass, 0 new findings |

## Concerns

1. The legacy Leptos shell (`crates/ui/src/views.rs`) still declares `/the-loai` and its nav link. The task's file list and web design scope cover the Next app only; removing the Leptos route would be a separate change needing owner confirmation.
2. Mobile bottom tabs still hide `/search` (`mobileHidden: true`), so the old “Thể loại” tab is gone without a replacement tab. Genres remain reachable through the header search form → `/search` → Bộ lọc; no regression surfaced in the 375px tests.
3. `GenreGroups` skips a group when the catalog returns zero tags for it (same behavior as the old page); the skeleton always shows four. Verified with a four-group fixture; live MangaDex currently supplies all four.
4. `README.md` and `reader-playwright.test.mjs` were touched beyond the brief's explicit file list because they directly documented/asserted the removed route. No SDD scratch files are staged.
5. The year dropdown enumerates 1900…current+1 (128 years) plus “Tất cả” (129 options total) in the shared scrollable listbox; no searchable combo behavior was added.

## Fix round 1 (controller minors)

- `web/components/search/GenreGroupsSkeleton.tsx`: each of the four group placeholders now renders **9** `.skel-pill` skeletons (approved 8–10 range) instead of 2; the four-group structure and `role="status"` / `aria-label="Đang tải thể loại"` are unchanged.
- `web/app/search/page.tsx`: the outer filter Suspense fallback now wraps `GenreGroupsSkeleton` in the same `<fieldset className="filter-tags"><legend>Thể loại</legend>` shape as the loaded panel, replacing the generic one-line/one-pill filter skeleton. The generic `GridSkeleton` for results is untouched.
- `web/scripts/advanced-search.test.mjs`: the fixture can delay `/api/content/tags` (`tagsDelay`), and a new first-render test captures the streamed fallback with `waitUntil: "commit"`, then asserts four `.genre-group.skel` sections, `>= 8` pills in each, and the accessible loading status.
- Concern 5 above corrected: 1900…current+1 is **128 years**, plus “Tất cả” = **129 options** (was incorrectly recorded as 127).

### RED → GREEN (fix round 1)

- RED on `3f41d3f` implementation with the new assertion: `node --test scripts/advanced-search.test.mjs` → **6 tests, 5 pass, 1 fail**; the new test failed with pill counts `[2,2,2,2]`.
- GREEN after the fixes and rebuild: **6 tests, 6 pass, 0 fail**.

### Verification (fix round 1)

| Check | Result |
| --- | --- |
| `npm run build` | pass |
| `node --test scripts/advanced-search.test.mjs` | 6/6 pass |
| `node --test scripts/skeleton-motion.test.mjs` | 4/4 pass (reduced motion intact) |
| `npx tsc --noEmit` | pass |
| `npm run lint` | 0 errors, 7 pre-existing warnings |

Scope guard: the parked Leptos `/the-loai` route, mobile tabs and reset-state behavior were not touched. The outer fallback keeps its `role="status" aria-label="Đang tải bộ lọc"` while `GenreGroupsSkeleton` adds an inner status region; if voice-over users report duplicate announcements, drop the outer role in a follow-up.
