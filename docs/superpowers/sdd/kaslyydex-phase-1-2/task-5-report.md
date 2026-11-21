# Task 5 report — Next.js web migration and Rust WASM reader

## Scope and decisions

- Worktree: `D:\Code\nodejs\kaslyydex\.worktrees\kaslyydex-phase-1-2`, base `483cfe9` (Task4 `fd76b04` included). No subagents, no push/merge/deploy/provisioning; Vercel/Neon remain paused and auth/database modules from Task4 were left intact.
- All runtime content and image traffic goes to Axum. Next uses the Task4 typed DTO/client from `web/lib/contracts.ts`, extended (not duplicated) with search/tags/rank/latest types and `contentImageUrl`.
- Task4 handoff resolved on both sides:
  - `crates/core/src/mangadex.rs::Md::pages()` now emits `/api/content/img?u=...`; Axum keeps both `/api/img` and `/api/content/img`.
  - Next `/api/img` is now only a forwarding compatibility alias to Axum's `/api/img` (for the old Leptos client / cached HTML). No second MangaDex fetcher remains in Next.
  - Legacy direct-MangaDex files removed after parity: `web/lib/mangadex.ts`, `web/lib/http.ts`, `web/lib/types.ts`, `web/lib/history.ts`, `web/components/reader.tsx`, `web/app/api/pages/[chapterId]/route.ts`.
- Reader state is Rust-only: `crates/reader-wasm` wraps `reader-core::ReaderState` through wasm-bindgen. React only mirrors values returned by actual WASM calls (`setPage`, `nextPage`, `previousPage`, `setMode`, `setBackground`, `setFit`, `setSpeed`, `progressPercent`, `settingsJson`). No JS shadow state machine and no fake fallback: a failed `init()` shows a visible error panel with a working **Thử lại** button.
- WASM build is explicit and reproducible: `npm run build:wasm` (cargo `--profile wasm-release --target wasm32-unknown-unknown -p reader-wasm`, then local `wasm-bindgen 0.2.130 --target web`). `prebuild` runs it before every `next build`. Generated glue, declarations and the content-hashed asset are uncommitted (`.gitignore`), and CI must run the script before Next.
- Browser-only APIs (WASM import, localStorage, fullscreen, observers, rAF) live only in Client Components; server pages call Axum directly and are wrapped in `<Suspense>` for Cache Components.

## RED → GREEN

**RED** — before the WASM crate existed:

```bash
cd web && node --test scripts/reader-wasm.test.mjs
```

Result: `3 tests / 0 pass / 3 fail` — `reader-wasm crate must exist`, no generated declarations, no instantiated state.

**GREEN** — after implementation:

```bash
cd web && npm run test:wasm
```

Result: `3 tests / 3 pass / 0 fail`; real WASM enforced page bounds (`setPage(4)` on a 4-page chapter threw and left page index 3), progress `25 → 100%`, and `setMode("diagonal")` threw from Rust validation. A second Node test also verified only one hashed asset exists in `public/wasm`.

## Changes

### Rust
- `crates/reader-wasm/Cargo.toml`, `crates/reader-wasm/src/lib.rs`: `ReaderWasm` binding + 3 native unit tests; workspace member added.
- `crates/core/src/mangadex.rs`: content-namespace image path helper + regression test; existing page pipeline otherwise unchanged.
- `crates/contracts/src/lib.rs`: contract test updated to the new page URL shape.

### Web
- `web/scripts/build-wasm.mjs`, `web/scripts/reader-wasm.test.mjs`: reproducible build and real-WASM tests. `wasm-bindgen-cli 0.2.130` installed locally with cargo (not global in the repo).
- `web/lib/content-proxy.ts`: shared origin validation, repeated-decode dot-segment rejection (`unsafeSegment`, `hasTraversal`), safe request/response header allowlists (no Cookie/Authorization/Set-Cookie), structured 502/400 errors.
- `web/app/api/content/[...path]/route.ts`: hardened; `web/app/api/img/route.ts`: Axum forwarding alias.
- `web/lib/contracts.ts`: new DTOs, `contentImageUrl`/`coverImageUrl`, `normalizePageUrls`, `searchQuery`, extended `createContentClient`.
- `web/lib/content-server.tsx`: server-only Axum client using `connection()`.
- `web/lib/guest.ts`: one normalization boundary for camelCase Next + snake_case Leptos history/library/settings/theme, chapter-local `restoredPage`, non-fatal storage failures, change subscription for `useSyncExternalStore`.
- `web/lib/format.ts`, `web/components/site-shell.tsx`, `site-header.tsx`, `theme-toggle.tsx`, `manga-card.tsx`, `continue-reading.tsx`, `manga-actions.tsx`, `chapter-list.tsx`, `library-view.tsx`.
- `web/components/reader/ReaderClient.tsx`, `ReaderToolbar.tsx`, `ReaderPages.tsx`: WASM-driven reader with scroll/paged modes, swipe/tap/keys, lazy images, next-chapter prefetch, auto-scroll with pause, independent reader backgrounds, fullscreen, progress, external-chapter link, retry.
- Pages: `app/page.tsx`, `search/page.tsx`, `manga/[id]/page.tsx`, `read/[chapterId]/page.tsx`, new `the-loai`, `bxh`, `tu-truyen`; `app/layout.tsx`; `app/globals.css` copied/adapted from `crates/ui/style.css` (dark/lime shell, real covers, desktop rail, mobile bottom tabs).
- `web/scripts/guest-storage.test.mjs`, `web/scripts/content-proxy.test.mjs` (extended), `web/scripts/reader-playwright.test.mjs`, package scripts `build:wasm`, `test:wasm`, `test:task5`, `test:e2e`, Playwright dev dependency, README.

## Verification (all commands run in this worktree)

| Command | Result |
|---|---|
| `npm run lint` | **0 errors**, 5 expected `@next/next/no-img-element` warnings (proxied MangaDex images cannot use the Next optimizer). The four baseline `react-hooks/set-state-in-effect` errors in `chapter-list`, `continue-reading`, `manga-actions`, `reader` are gone without suppressions. |
| `npx tsc --noEmit` | pass |
| `npm run build` | pass (12 routes; generated WASM built by `prebuild`) |
| `cargo test --workspace` | pass — **42 tests** including 3 new wasm-adapter tests and the page-namespace test |
| `cargo clippy --workspace --all-targets -- -D warnings` | pass |
| `cargo fmt --check -p domain -p contracts -p reader-core -p reader-wasm -p server` | pass |
| `git diff --check` | pass |
| `npm run test:task5` | **27/27 pass** (auth 6, database 3, content-proxy 11, guest-storage 4, reader-wasm 3) |
| `node --test scripts/smoke.test.mjs` | **2/2 pass** |
| `npm run test:e2e` | **6/6 Playwright pass** (Edge `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`, no Chrome assumed) |

Integration details proven by tests:

- Real compiled Axum serves a local MangaDex fixture; Next proxies `/api/content/*` to it. Page URLs are normalized to `/api/content/img?u=...`, and Next→Axum image responses carry identical PNG bytes, `content-type: image/png` and `Cache-Control: … immutable`.
- Legacy `/api/img?u=...` still returns the same Axum bytes and headers.
- Encoded/double-encoded dot segments are rejected before URL construction; raw `?u=` traversal is rejected before `new URL()` normalizes it; empty chapters stay `pages: []`; missing origin returns structured 503; browser cookies/authorization are not forwarded and upstream `Set-Cookie` does not cross the BFF.
- Playwright at 1280×800 and 375×812: dark-lime shell with real covers, desktop rail, mobile bottom tabs, `/search?q=Fixture` results + tag filter UI, clickable manga tag → `/search?tags=…`, `/the-loai`, `/bxh?kind=rating`, `/tu-truyen` empty state, theme persisted across reload.
- Reader: real WASM reported `Trang 1/4 · 25%`; scroll tracking advanced to `2/4 · 50%`; horizontal button/key advanced to `3/4` then `4/4 · 100%`; mode/background came from Rust settings; reload restored page 4 only for the same chapter and the next chapter started at page 1. Every browser request to a `*.mangadex.org` host was asserted absent.
- Corrupt WASM bytes (Playwright route override) produced a visible retry panel with no rendered pages — no fake success.

## Generated asset sizes

| File | Bytes |
|---|---:|
| `web/public/wasm/reader_core.25cb810c379e858e.wasm` | 150,508 |
| `web/generated/reader-wasm/reader_core.js` / `.mjs` (glue, each) | 11,417 |
| `web/generated/reader-wasm/reader_core.d.ts` / `.d.mts` (each) | 3,229 |
| `web/generated/reader-wasm/index.ts` | 373 |

Hash is derived from the wasm-bindgen transformed binary, so the immutable URL changes whenever the Rust state machine changes. Nothing under `web/generated`, `web/public/wasm` or `target/` is committed.

## Screenshots (local, gitignored)

`web/.test-screenshots/`: `home-desktop.png`, `home-mobile.png`, `search-desktop.png`, `library-empty.png`, `reader-desktop.png`, `reader-horizontal-dark.png`, `reader-mobile.png`, `reader-wasm-retry.png`.

## Concerns / external gates

- Vercel and Neon remain paused. No deployment, provisioning, OAuth setup, push or merge was performed. Live auth/JWKS, Neon connectivity and deployed Preview smoke remain external gates from Tasks 3/4.
- The image fixture pre-seeds Axum's disk cache with test-only bytes; it does not prove live MangaDex at-home availability. No production fake host/content/auth was added.
- Full-workspace `cargo fmt --check` still fails on pre-existing untouched files (documented Task2 baseline); the scoped crate check above is green.
- Five `no-img-element` warnings remain by design: images are same-origin Axum proxies, and Next's optimizer must not fetch MangaDex hosts in this environment.
- `web/generated` must be rebuilt after any Rust reader-core change before `next build`/`tsc`; `prebuild` handles the normal path. CI for Task9 must include `npm run build:wasm` plus a check that no generated artifact is committed.
- Auto-scroll is intentionally paused on pointer/key/wheel input; fullscreen depends on browser support (the button is always rendered).

## Commits

- `85462d7` — `feat: add real reader-core wasm adapter and reproducible build`
- Task5 main implementation commit — see `git log` in this worktree.
