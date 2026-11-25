# Task 6 report — Ranking skeleton and top-3 frames

Branch: `feature/kaslyydex-advanced-search-ux` · Base: `c3b1291ded938a59bf4de73e9be3db54b74d36a6`

## Files

- Created `web/components/rank-skeleton.tsx` — `RankListSkeleton`, 12 shape-matched rows reusing existing `.skel-rank` bar rules; rows 1–3 carry `rank-top rank-1|rank-2|rank-3`; `<ol className="rank-list" role="status" aria-label="Đang tải xếp hạng">`.
- Created `web/app/bxh/loading.tsx` — route loading shell with the `/bxh` intro, three tabs, and the same 12-row skeleton.
- Modified `web/app/bxh/page.tsx` — both the outer and inner (`key={kind}`) fallbacks now use `RankListSkeleton`; real rows 1–3 get `rank-top rank-N`. Source badge on cover and no title suffixes (Task 5) left intact.
- Modified `web/app/globals.css` — added `.rank-row.rank-top.rank-1/2/3` inset box-shadow frames + tinted backgrounds from existing theme variables; removed dead `.rank-loading` rules. Inset shadows do not change layout, so no shift.
- Created `web/scripts/ranking-skeleton.test.mjs` — 3 browser tests (Playwright, 375px fixture-backed Next server).

## RED / GREEN

| Phase | Command | Result |
| --- | --- | --- |
| RED (after baseline build, before implementation) | `node --test scripts/ranking-skeleton.test.mjs` | **0 pass / 3 fail** — all three timed out waiting for `.rank-list .rank-row.skel` |
| GREEN (after implementation + rebuild) | `node --test scripts/ranking-skeleton.test.mjs` | **3 pass / 0 fail** |

GREEN assertions covered:
1. Loading shell: intro `Bảng xếp hạng`, 3 tabs, 12 skeleton rows, `role="status"` + accessible name, 375px no overflow.
2. Top 3 skeleton rows and top 3 real rows carry `rank-top rank-1/2/3`; row 4 has no `rank-top`; three real rows have distinct, non-`none` computed `box-shadow`.
3. Skeleton and loaded first-row bounding boxes match within 2px in both width and height.
4. Tab change (`kind=follows` → `rating`) re-shows the 12-row skeleton before the new data.
5. `prefers-reduced-motion: reduce` → `animation-name: none`; `no-preference` → `shimmer`.

## Regressions and checks

| Command | Result |
| --- | --- |
| `node --test scripts/skeleton-motion.test.mjs` | 3 pass / 1 fail — see Concern 1 |
| `node --import tsx --conditions=react-server --test scripts/source-ui.test.mjs scripts/source-badge.test.mjs scripts/select.test.mjs` | 23 pass / 0 fail (Tasks 4 & 5 preserved) |
| `npx tsc --noEmit` | pass |
| `npm run lint` | 0 errors, 7 warnings (all pre-existing `@next/next/no-img-element`) |
| `npm run build` | pass |
| `npm run check:whitespace` | pass — 0 new findings |

## Concerns

1. **Pre-existing failure in `web/scripts/skeleton-motion.test.mjs:154`** — `assert.match(await page.locator(".card-title:visible").first().textContent(), /MangaDex/, "source label must stay visible")`. Base commit `c3b1291` (Task 5) moved the source into `.source-badge` and removed title suffixes, but this older test was not updated (last touched in `1a4b46c`). Actual text is now `Fixture Manga`. This is unrelated to Task 6 (no source-badge work here), so it was deliberately not changed. Suggested follow-up: assert `.source-badge` instead of `.card-title`.
2. Frame distinctness was verified in the default dark theme only. Light-theme variables (`--accent: #455e13`, `--muted: #5d6258`, mixed rank-3) remain distinct by construction but were not browser-asserted.
3. The skeleton shows 12 rows while a loaded ranking can render up to 24 — this matches the brief's "12 rows" skeleton requirement, not a row-count mismatch.

## Fix round 1 — stale source-label assertions in skeleton-motion test

Concern 1 above is resolved. Only `web/scripts/skeleton-motion.test.mjs` changed; no production code, no title suffixes re-added, no rebuild required.

- Line 154 (home, after skeleton replacement): `.card-title:visible` → `.source-badge:visible` first match, still asserting `/MangaDex/` with the message "source badge label must stay visible".
- Line 176 (manga detail): the same stale pattern was present and would have failed next — `.manga-title:visible` → `.manga-cover .source-badge:visible`, still asserting `/MangaDex/`. Both had to change for the suite to reach GREEN; both preserve the original intent that source labels remain visible after skeleton replacement. The badge's accessible name (`Nguồn: MangaDex`) continues to be covered by `source-badge.test.mjs`.

Exact commands and counts (from `web/`):

| Command | Result |
| --- | --- |
| `node --test scripts/skeleton-motion.test.mjs` | tests 4, suites 0, **pass 4 / fail 0**, cancelled 0, skipped 0, todo 0 |
| `node --import tsx --conditions=react-server --test scripts/source-badge.test.mjs scripts/source-ui.test.mjs` | tests 12, suites 0, **pass 12 / fail 0**, cancelled 0, skipped 0, todo 0 |

Remaining concerns from the original report: items 2 and 3 above (light-theme frames not browser-asserted; 12-row skeleton vs up to 24 loaded rows by design). No new concerns.
