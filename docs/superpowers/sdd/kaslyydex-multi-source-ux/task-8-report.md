# Task 8 Report: Shape-matched skeletons and motion system

**Branch:** `feature/kaslyydex-multi-source-ux` (base `d033d71`)
**Commit:** `1a4b46c` — `feat: match skeletons to content and add restrained motion` (7 files, +452/-26)
**Status:** DONE — RED demonstrated, GREEN confirmed, committed. SDD scratch left untracked.

## Resumed partial-change handling

A previous dispatch died on a transient 429 after writing uncommitted changes. On resume, `git status` showed the 6 modified task files plus the untracked test. Each file was inspected line-by-line against `task-8-brief.md` before any new work:

- `web/scripts/skeleton-motion.test.mjs` (new): all 5 brief assertions present — shape-matched home skeletons (hero/card/feed/rank, not one generic block), accessible `role="status"` containers, 375px no-overflow for skeleton and loaded states, reduced-motion disabling, reader fade-in only after load/decode. Kept as-is.
- `web/app/globals.css`: tokens `--dur-fast`/`--dur-base`/`--ease-out` in `:root`; shape-matched skeleton classes (`.skel-hero/.skel-card/.skel-feed/.skel-rank/.skel-chapter/.reader-page[data-loaded="false"]`); `.img-fade` opacity states; all animation/transition rules inside `@media (prefers-reduced-motion: no-preference)`; tokenized `progress::` transitions; Task 7 `.select-chevron` guard intact (still inside the no-preference guard, now tokenized). Kept.
- `web/app/page.tsx`: `HeroSkeleton`/`FeedSkeleton`/`RankSkeleton` replace generic Suspense fallbacks; popular rail uses `CardSkeleton rank`. Kept.
- `web/app/search/page.tsx`: filter + grid shape-matched fallbacks. Kept.
- `web/app/manga/[id]/page.tsx`: manga-head + chapter-list row skeletons with `role="status"`. Kept.
- `web/components/manga-card.tsx`: exported `CardSkeleton` (card cover/title/year/rank shape), reused by `GridSkeleton`. Kept.
- `web/components/reader/ReaderPages.tsx`: `img-fade` class + `data-loaded` flip on load; WASM state untouched. Kept.

No missing steps were found; nothing had to be re-authored, so no duplicated work.

## RED / GREEN

RED was not recorded by the previous dispatch, so it was re-run explicitly: the 6 tracked edits were stashed (untracked test kept), `npx next build` run at base, then:

- RED: `node --test scripts/skeleton-motion.test.mjs` → **0 pass / 3 fail**
  (no `.skel-hero`, missing motion tokens, reader image missing `img-fade`).

Changes restored via `git stash pop` (diff verified identical: +160/-26 across the 6 files), rebuilt, then GREEN:

- `node --test scripts/skeleton-motion.test.mjs` → **3 pass / 0 fail**
- `node --test scripts/reader-playwright.test.mjs` → **9 pass / 0 fail**
- `node --test scripts/reader-sync-playwright.test.mjs` → **3 pass / 0 fail**
- `npx tsc --noEmit` → clean
- `npm run lint` → 0 errors (7 pre-existing `no-img-element` warnings, unchanged)
- `npx next build` → success (wasm artifacts already generated; `build:web` used)

## Constraint checklist

- Shape-matched skeletons for hero, popular card, feed row, rank row, chapter row, reader page — yes, asserted by test.
- No layout shift: skeleton vs loaded widths compared within 2px at 375px — asserted.
- Accessible loading status: `role="status"` + `aria-label` on every skeleton container — asserted.
- Tokens `--dur-fast`, `--dur-base`, `--ease-out` produced and used — asserted.
- All motion under `prefers-reduced-motion: no-preference`; reduced-motion run shows `animationName: none` and `0s` transitions — asserted.
- No animation library added — none.
- WASM/progress/XP/auth untouched — `ReaderPages.tsx` change is class/attribute only; reader suites pass.
- Task 7 `.select-chevron` reduced-motion guard intact — verified in CSS and by the reduced-motion assertions.
- Task 5 source labels (`titleWithSource`) still rendered after skeletons replaced — asserted (`/MangaDex/` in `.card-title` and `.manga-title`).

## Concerns

- Lint warnings on `<img>` in touched files are pre-existing pattern (raw `<img>` used throughout with eslint-disable in some places); not introduced by this task.
- `npm run build` (with `prebuild` wasm rebuild) was not run; `npx next build` (`build:web`) passed and the committed wasm artifacts were already present. If CI requires the full `prebuild`, run `npm run build` once in CI.
- RED was demonstrated by stash + rebuild rather than by the original test-only-first run; result (3/3 fail at base) is equivalent and recorded here.

---

## Fix round 1 — broken reader images stuck behind fade gate

**Finding (Important):** `web/components/reader/ReaderPages.tsx:65` / `:112` released `.img-fade`'s `opacity: 0` only from `onLoad`. A failed request left `data-loaded="false"` forever: invisible image, permanent grey skeleton frame and `min-height: 300px`, with no failure indication; base code showed a native broken-image icon.

**Fix:** one `onError` sibling per branch sets `data-loaded="true"`, releasing the fade gate and skeleton frame so the browser's native broken-image/alt rendering is visible. No WASM, progress, XP, or auth code touched.

**RED test written first** (appended to `web/scripts/skeleton-motion.test.mjs`): aborts `**/api/content/img*` requests, asserts `data-loaded="true"`, `naturalWidth === 0` (no faked decode), computed `opacity: 1` and transparent background (no permanent skeleton), for both vertical and horizontal reader modes.

Commands and counts from `web/`:

| Command | Result |
| --- | --- |
| `node --test scripts/skeleton-motion.test.mjs` (RED, test only, HEAD app code) | 3 pass / **1 fail** — new test timed out waiting for `data-loaded="true"` |
| `npx next build` (after fix) | success |
| `node --test scripts/skeleton-motion.test.mjs` (GREEN) | **4 pass** / 0 fail |
| `node --test scripts/reader-playwright.test.mjs` | **9 pass** / 0 fail |
| `node --test scripts/reader-sync-playwright.test.mjs` | **3 pass** / 0 fail |
| `npx tsc --noEmit` | clean, no output |
| `npm run lint` | 0 errors, 7 pre-existing `no-img-element` warnings (unchanged) |

Fix commit: task files `web/components/reader/ReaderPages.tsx` and `web/scripts/skeleton-motion.test.mjs` only; SDD scratch remains untracked.
