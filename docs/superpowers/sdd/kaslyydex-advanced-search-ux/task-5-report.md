# Task 5 report — Source badge on cover images

## Status

Implemented and committed on `feature/kaslyydex-advanced-search-ux` (base `f8de0d0`).

## Changes

- New `web/components/source-badge.tsx`: named `SourceBadge({ source })`, returns `null` for empty/unknown source, otherwise exact `MangaDex` / `Comick` via `sourceLabel`, with `role="img"` and `aria-label="Nguồn: <label>"`.
- Cover badges added in card, home feature/feed/rank, ranking and manga detail covers; all manga title suffixes removed. Chapter-row and reader-toolbar suffixes (fallback chapters) intentionally unchanged.
- Parent cover links (`/manga/<id>`) unchanged; badge is a sibling of the image inside the existing cover container.
- `web/lib/contracts.ts`: `coverImageUrl` now passes absolute HTTPS `meo.comick.pictures` URLs for `source === "comick"` through `contentImageUrl`; non-HTTPS/foreign/unparseable URLs return `null`; MangaDex URL construction unchanged. Callers that omit `source` still compile because the DTO field is optional.
- CSS: compact theme-variable badge top-right; bottom strip variant for the 40–48px feed/rank covers; positioned cover containers. No animation added, existing reduced-motion guards untouched.
- Tests updated: `source-ui.test.mjs` manga-title expectations became badge expectations (chapter/toolbar assertions preserved); `reader-playwright.test.mjs` stale feature-title suffix assertion became title + badge assertions.

## RED → GREEN

| Run | Command | Result |
| --- | --- | --- |
| RED | `node --import tsx --conditions=react-server --test scripts/source-badge.test.mjs` | **0 pass / 5 fail** (missing component, title suffixes present, Comick URL built as MangaDex URL) |
| GREEN | `node --import tsx --conditions=react-server --test scripts/source-badge.test.mjs scripts/source-ui.test.mjs` | **12 pass / 0 fail** |

## Scoped checks

- `npx tsc --noEmit` — pass (no output).
- `npm run lint` — 0 errors, 7 pre-existing `@next/next/no-img-element` warnings (one in `manga-card.tsx`, line moved by this change).
- `npm run build` — pass.
- `node --test scripts/reader-playwright.test.mjs` — first run **8 pass / 1 fail** (`Fixture Manga (MangaDex)` expected by a stale assertion); after updating that assertion to the badge behavior: **9 pass / 0 fail**. Screenshots inspected at desktop and 375px: badges visible on feature/card covers, no rank-number overlap, no horizontal overflow.
- Task 4 / regression unit set (`advanced-search`, `search-source`, `search-contracts`, `source-contracts`, `skeleton-motion`, `content-proxy`): **39 pass / 0 fail**, including genre skeleton shape, partial-results warning and reduced-motion guards.

## Concerns / limits

- Feed cover links already had `aria-label="Xem truyện <title>"`, which overrides the link's computed name; the badge itself still carries `role="img"` + `aria-label` and is present in the accessibility tree. If screen-reader link announcements must name the source too, that parent label would need a separate change.
- On the 40–48px feed/rank covers the exact-text badge is rendered as a full-width bottom strip at 8px font; legibility at very small cover sizes is a design tradeoff.
- Comick cover passthrough is limited to `https://meo.comick.pictures` (the Axum proxy allowlist host); other Comick CDN hosts would yield no cover until the allowlist is extended. No auth/deploy/cloud work was touched.
- Full aggregate and all browser suites were not run; only the focused suites above.
