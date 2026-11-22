# Task 5 report — Web source labels and fallback chapter UI

## What changed

- `web/lib/format.ts`: added `titleWithSource(title, source?)` using Task 1 `sourceLabel()`; it always appends the exact label (`MangaDex`/`Comick`).
- `web/components/manga-card.tsx`, `web/app/page.tsx` (featured, latest feed, ranking), `web/app/manga/[id]/page.tsx`: manga titles now render through `titleWithSource`.
- `web/components/chapter-list.tsx`: appends ` (label)` only for chapters whose `source` is not `mangadex`; MangaDex and legacy rows are byte-identical.
- `web/components/reader/ReaderToolbar.tsx`: back link shows the source label when the current chapter is a fallback; the native chapter `<select>` is untouched (Task 7 owns it).
- `web/scripts/source-ui.test.mjs`: new helper + rendered-component test.
- `web/scripts/reader-playwright.test.mjs`: one stale exact-title assertion updated to the labeled title.

## RED

Command (from `web/`):

```
node --import tsx --conditions=react-server --test scripts/source-ui.test.mjs
```

Result: **FAIL** — `tests 1 / pass 0 / fail 1`. Module load error: `... '../lib/format.ts' does not provide an export named 'titleWithSource'`.

## GREEN

Same command after implementation:

```
node --import tsx --conditions=react-server --test scripts/source-ui.test.mjs
```

Result: **PASS** — `tests 3 / suites 0 / pass 3 / fail 0` (duration ~938 ms).

Tests cover: exact `titleWithSource` strings (MangaDex, Comick, default), Comick chapter row text `Fallback 1 (Comick)`, readable MangaDex row unchanged with no `Comick` text anywhere, and fallback reader back title `← Slime (Comick)`.

## Other verification

| Command (from `web/`) | Result |
| --- | --- |
| `npx tsc --noEmit` | clean, no output |
| `npx eslint lib/format.ts components/manga-card.tsx components/chapter-list.tsx components/reader/ReaderToolbar.tsx` | 0 errors, 1 pre-existing `@next/next/no-img-element` warning in `manga-card.tsx:11` |
| `node --import tsx --conditions=react-server --test scripts/source-contracts.test.mjs` | 2 tests, 2 pass, 0 fail |
| `node --import tsx --conditions=react-server --test scripts/source-fallback.test.mjs` | 7 tests, 7 pass, 0 fail |

## Concerns

1. The suite runs under `--conditions=react-server`, which resolves React's RSC build (no `useState`/`createContext`). The new test renders the real components in a short-lived child process **without** that condition and asserts on their rendered markup, because `react-dom/server` refuses to run in the RSC build. Assertions exercise shipped JSX, not a hand-written stand-in.
2. Per the brief's third assertion, `titleWithSource` always appends `(MangaDex)` when `source` is missing. Every manga title in cards, featured, feed, ranking and detail now carries a visible label, including primary MangaDex content. Chapter rows do **not** follow that rule — only non-primary chapters get a label, so readable MangaDex rows are unchanged.
3. `web/scripts/reader-playwright.test.mjs:213` asserted the exact old featured title; it was updated to `Fixture Manga (MangaDex)`. No other test file asserts an exact manga title. The e2e suite itself was not run here (the brief requires only the helper test, typecheck and scoped lint, and it needs a fresh `next build` plus a browser).
4. External links and hrefs are unchanged; URL construction in `chapter-list.tsx` still uses the chapter id and language exactly as before.

## Fix round 1 — `/bxh` call site and title test coverage

Controller finding: `web/app/bxh/page.tsx:41` still rendered raw `{manga.title}`, so ranking rows on `/bxh` lacked the source label. Fixed by importing the existing `titleWithSource` and wrapping that expression only; the `<Link href>`, `.rank-row`, `.rank-cover`, `.rank-title`, `<small>` follows count and `.rank-rating` markup are untouched. Metadata titles and native selects were deliberately left alone.

Test gap closed in `web/scripts/source-ui.test.mjs` (7 tests now, each surface asserted from its own rendered markup so deleting a call site fails that assertion):
- `manga-card.tsx` `MangaCard` → `<h3 class="card-title">Slime (Comick)</h3>` (plus href preserved).
- `app/page.tsx` Home stream → `<h1 id="featured-title">`, feed `<h3><a href="/manga/m1">`, and `<span class="rank-title">` all labeled.
- `app/manga/[id]/page.tsx` → `<h1 class="manga-title">Slime (Comick)</h1>`.
- `app/bxh/page.tsx` → `<span class="rank-title">Slime (Comick)<small>…</small></span>`.

Pages are async Server Components, so the child-process renderer now registers a data-URL loader that redirects only `lib/content-server.tsx` to a fixture client fed by `SOURCE_UI_FIXTURE` (`serverContent()` otherwise calls request-scoped `connection()` and imports `server-only`). Rendering uses `renderToPipeableStream` and reads the stream to completion, which includes the resolved Suspense content.

Commands and counts (from `web/`):

| Command | Result |
| --- | --- |
| RED `node --import tsx --conditions=react-server --test scripts/source-ui.test.mjs` | `tests 7 / pass 6 / fail 1` — only `ranking page titles show the source label` failed; rendered HTML showed `<span class="rank-title">Slime<small>…` |
| GREEN same command | `tests 7 / pass 7 / fail 0` (duration ~3003 ms) |
| `npx tsc --noEmit` | clean, no output |
| `npx eslint app/bxh/page.tsx lib/format.ts components/manga-card.tsx components/chapter-list.tsx components/reader/ReaderToolbar.tsx scripts/source-ui.test.mjs` | 0 errors, 1 pre-existing `@next/next/no-img-element` warning in `manga-card.tsx:11` |
| `node --import tsx --conditions=react-server --test scripts/source-contracts.test.mjs` | 2 tests, 2 pass, 0 fail |
| `node --import tsx --conditions=react-server --test scripts/source-fallback.test.mjs` | 7 tests, 7 pass, 0 fail |

Remaining concern: the page assertions inspect streamed SSR markup, where resolved Suspense content is emitted in hidden `<div id="S:…">` blocks. They verify shipped JSX output but not a hydrated browser interaction; no e2e/browser run was performed for this fix.
