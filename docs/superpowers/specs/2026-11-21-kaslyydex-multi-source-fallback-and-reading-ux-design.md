# KasLyyDex Multi-Source Fallback and Reading UX Upgrade

Date: 2026-11-21
Status: approved in chat; awaiting written-spec review
Scope: Phase 2 web/Axum content layer and reading UX. No cloud deployment, auth rewrite, Android, or GPUI work.

## 1. Problem

KasLyyDex currently reads content through MangaDex via Axum. Some manga/chapters are unavailable in-app because MangaDex has no readable chapter, only an external link, or no page images. The UI also has generic loading states, limited motion, a reader theme that does not follow the site theme by default, and native select controls that feel inconsistent with the rest of the interface.

## 2. Goals

1. Keep MangaDex as the primary source.
2. Add chapter-level fallback to another public source when a MangaDex chapter cannot be read in-app.
3. Start with Comick as the first fallback adapter.
4. Show the active source after the manga title and on fallback chapters, for example `Tensei Shitara Slime datta Ken (MangaDex)` or `Chương 12 (Comick)`.
5. Keep all page images proxied through Axum with per-source CDN allowlists.
6. Upgrade loading skeletons to match the shape of the items they replace.
7. Add restrained, consistent animation/transition across cards, reader, panels, and dropdowns.
8. Make reader theme follow the site theme by default while preserving manual reader background overrides.
9. Replace native selects with one accessible custom dropdown component used across the app.

## 3. Non-goals

- No multi-source merged chapter list in this iteration.
- No MangaPlus adapter in this iteration.
- No background scheduler or automatic polling worker.
- No Vercel/Neon deployment, auth provider changes, or production secret provisioning.
- No payment, ads, ratings/reviews, or tradeable XP changes.
- No claim that fallback sources are permanent or guaranteed; adapters must degrade safely.

## 4. Approved decisions

- Fallback purpose: fill missing/unreadable MangaDex chapters, not aggregate all sources.
- Fallback granularity: per chapter.
- Source selection: propose public sources; Comick is the first adapter.
- Architecture: provider adapters inside Axum/core, not a third-party aggregator gateway.
- Reader theme: default `auto` follows site theme; manual `light`, `sepia`, `dark` overrides remain saved.
- Dropdown scope: shared custom dropdown across the app.

## 5. Content architecture

### 5.1 Provider layer

Add a provider abstraction in the Rust content layer:

- `MangaDexProvider`: wraps the existing MangaDex client behavior.
- `ComickProvider`: new adapter for public catalog search, title details, chapters, and reader-image metadata.
- `ContentService`: orchestrates primary lookup and chapter-level fallback.

The public Axum routes remain under `/api/content/*`. Existing response shapes stay compatible. New source metadata is additive.

Comick adapter requirements:

- Use the public Comick Catalog API documented at `https://api.comick.dev/docs/`.
- Basic catalog requests must not require OAuth or user credentials.
- Before implementation, verify the exact catalog endpoints and limits from the official explorer/docs.
- If the catalog API is unavailable or returns an unusable shape, the adapter reports unavailable; fallback is skipped without breaking MangaDex pages.
- Do not use Comick Library/OAuth APIs for this feature.

### 5.2 Source identity

Add a stable source identifier:

- `mangadex`
- `comick`

Source labels:

- `MangaDex`
- `Comick`

MangaDex chapter IDs remain UUIDs. Fallback chapter IDs are provider-prefixed opaque strings, for example `comick:<chapter-id>`.

Content ID validation becomes source-aware:

- MangaDex IDs must remain valid UUIDs.
- Comick IDs must match the adapter’s validated opaque ID format.
- Empty, malformed, or unknown-source IDs are rejected before upstream calls.

### 5.3 DTO additions

Add optional/defaulted fields to existing content contracts:

Manga summary:

- `source?: string`, default `mangadex`
- `source_label?: string`, default `MangaDex`

Chapter:

- `source?: string`, default `mangadex`
- `source_label?: string`, default `MangaDex`
- `readable?: boolean`, derived from having in-app pages and no external-only restriction
- existing `external_url` remains for chapters that still cannot be read in-app

Pages response:

- remains an ordered list of proxied image URLs
- may include `source` metadata if needed by the reader, but the browser must not receive raw upstream CDN URLs

TypeScript contracts in `web/lib/contracts.ts` and Rust contracts must stay aligned.

## 6. Chapter fallback flow

1. UI requests manga chapters through `/api/content/manga/:id/chapters`.
2. Axum fetches MangaDex chapters first.
3. For each chapter that is not readable in-app:
   - check cached fallback mapping;
   - if absent, search the fallback provider by manga title/aliases;
   - match by chapter number and language;
   - prefer `vi`, then `en`;
   - if a confident match exists, cache the mapping and return the fallback chapter as readable.
4. If no confident match exists, keep the original external link or unreadable state.
5. Reader requests pages using the source-aware chapter ID.
6. Axum fetches pages from the owning provider and returns proxied image URLs.

Matching rules:

- Normalize chapter numbers as strings/numbers consistently, including decimal chapters such as `10.1`.
- Do not match solely by fuzzy title similarity.
- Require chapter number equality after normalization and compatible language.
- If multiple fallback candidates match equally, choose the first deterministic candidate by provider order and cache that choice.
- Never replace a readable MangaDex chapter with a fallback chapter.

## 7. Cache and persistence

Use Axum’s existing cache mechanism for fallback mappings and provider metadata where appropriate.

Mapping key:

- primary manga ID
- chapter number
- language
- fallback source

Mapping value:

- fallback manga/title ID
- fallback chapter ID
- source
- matched language
- timestamp/TTL metadata

Rules:

- Cache successful mappings with a bounded TTL.
- Cache negative results briefly to avoid hammering fallback search for known missing chapters.
- Do not store user credentials or auth tokens in content cache.
- Cache failure must not break primary MangaDex reading.

No application database migration is required for fallback mapping unless implementation proves Axum cache insufficient; if that happens, stop and revise the spec before adding DB tables.

## 8. Image proxy and security

All reader images continue to use the same-origin Axum proxy.

Requirements:

- Per-source CDN allowlist.
- No arbitrary client-supplied URL proxying.
- Reject traversal, malformed URLs, non-HTTPS upstream image URLs, and disallowed hosts.
- Do not forward app cookies, authorization headers, or reader tickets to upstream image hosts.
- Preserve existing cache-control behavior where safe.
- Upstream image failure returns a structured error; reader shows retry, not a fake image.

## 9. Source attribution and source policy

UI must show source attribution:

- Manga title: `Title (SourceLabel)`.
- Chapter row/reader: show source label when the chapter is not from the primary source, and optionally always show it in detail views.
- Footer/source credit remains present.

Policy requirements:

- Keep MangaDex credit and scanlation-group attribution obligations.
- Only enable a fallback adapter if its public API/content usage terms allow the intended reading/proxy behavior.
- If a source requests removal or becomes unsuitable, disable that adapter without breaking MangaDex.
- Do not add ads or paid access to content provided by these APIs.

## 10. Reading UX upgrades

### 10.1 Shape-matched skeletons

Replace generic loading blocks with skeletons that match final layout:

- Home hero: poster block, title lines, meta lines, description lines, button block.
- Popular rail: cover + two text lines per card.
- Latest feed: cover + title + chapter pill rows.
- Rank panel: rank number + cover + title + rating.
- Search/manga grids: card-shaped skeletons.
- Chapter list: row-shaped skeletons.
- Reader: page-frame skeleton with stable aspect/height behavior.

Skeleton requirements:

- `role="status"` or `aria-busy` where appropriate.
- No horizontal overflow at 375px.
- No major layout shift when real content replaces skeleton.
- Shimmer/breathe animation respects reduced motion.

### 10.2 Motion system

Add small CSS motion tokens:

- fast duration for hover/focus/press;
- base duration for panels/dropdowns/page transitions;
- shared easing curve.

Apply to:

- card hover lift and cover zoom;
- button/tab pressed states;
- image fade-in after load/decode;
- reader horizontal page transition;
- progress bar width transition;
- dropdown/settings/notification panel open/close.

Rules:

- No animation library dependency.
- All motion disabled or reduced under `prefers-reduced-motion`.
- Motion must not interfere with reader scrolling, WASM state, or auto-scroll pause behavior.

### 10.3 Reader theme sync

Add reader background mode `auto` and make it the default for new/unset preferences.

Modes:

- `auto`: reader uses the site’s current light/dark theme variables.
- `light`: manual light reader background.
- `sepia`: manual warm paper background.
- `dark`: manual dark reader background.

Rules:

- Existing saved manual choices remain valid.
- If no saved reader background exists, use `auto`.
- Reader toolbar, settings panel, buttons, bottom nav, and reader comments use the active reader theme variables.
- Site theme changes while reader is in `auto` update reader colors without reload.
- Do not change WASM reader state, progress restoration, XP, or auth logic.

### 10.4 Shared custom dropdown

Create one accessible client component, for example `web/components/ui/Select.tsx`, and replace native selects across the app.

Target locations:

- reader chapter selector;
- reader settings selects;
- search/filter selects;
- account/settings selects where present.

Behavior:

- Trigger button shows current value and expanded state.
- Popup uses `role="listbox"` and options use `role="option"`.
- Keyboard: Enter/Space opens, Arrow Up/Down moves, Home/End jumps, Enter selects, Escape closes.
- Click outside closes.
- Selected option is visually marked and announced.
- Long lists scroll inside the popup.
- Disabled state is supported.
- Focus remains managed and visible.

Visual:

- Uses existing theme variables.
- Matches current border/radius/surface language.
- Subtle open/close transition.
- Does not cover critical reader controls.

Compatibility:

- Existing tests that use native select APIs must be updated to interact with the custom dropdown.
- Forms must still submit the same underlying values.

## 11. Error handling

- Fallback provider timeout/error: log structured error, keep primary content usable.
- No fallback match: keep external link/unreadable state; do not invent pages.
- Fallback pages empty: treat as unreadable, not successful empty chapter.
- Image proxy failure: reader retry path remains visible.
- Invalid source-aware ID: structured 400 before upstream call.
- Missing provider configuration: primary MangaDex continues; fallback disabled gracefully.
- Errors must not expose secrets, raw auth headers, or internal upstream credentials.

## 12. Compatibility

- Existing MangaDex UUID chapter URLs continue to work.
- Existing library/history/progress data is not deleted or rewritten.
- Fallback progress uses source-aware chapter identity so it does not overwrite MangaDex progress for a different chapter.
- XP remains server-validated: readable pages, authoritative page count, distinct coverage, elapsed-time rule, and idempotent completion.
- Guest reading remains available without auth/database.
- Public pages must still build/render without Neon credentials.

## 13. Testing

Rust/Axum:

- provider DTO normalization;
- source-aware ID validation;
- chapter matching by number/language;
- fallback does not override readable MangaDex chapters;
- fallback provider failure degrades safely;
- image proxy allowlist rejects disallowed hosts/traversal;
- cache mapping hit/miss/negative TTL behavior.

Web/API:

- contracts include source fields with safe defaults;
- manga/chapter pages render source labels;
- reader can open a fallback chapter fixture;
- missing fallback keeps external link;
- XP ticket binds source and rejects mismatched source/chapter.

Browser/UI:

- skeleton shapes match target layouts and do not overflow at 375px;
- reduced-motion disables animation;
- reader `auto` follows site theme;
- manual reader background override persists;
- dropdown mouse/keyboard/outside-click behavior;
- dropdown replacement does not break chapter selection or settings;
- existing reader WASM/progress/image-decode tests still pass.

Gate:

- lint, typecheck, build, relevant Rust tests/clippy/scoped fmt, and affected browser suites must pass locally.
- Live provider verification is a manual release gate, not a local CI requirement.

## 14. Risks

- Comick public catalog endpoints/limits may differ from older community examples; implementation must verify official docs first.
- Fallback matching can be wrong for special chapters/oneshots; conservative matching is required.
- Source CDNs may block hotlinking or change URLs; proxy allowlists and retry/error paths must handle this.
- Custom dropdowns can introduce accessibility regressions; keyboard/screen-reader tests are required.
- Reader theme sync must not break manual sepia/dark preferences or fullscreen behavior.

## 15. Implementation boundary

This spec permits planning and implementation of the local feature only. It does not authorize deployment, cloud provisioning, pushing to remote, merging to main, or enabling paid services. Those remain owner-gated actions.
