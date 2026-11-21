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
| `npm run test:task5` | **30/30 pass** (auth 6, database 3, content-proxy 13, guest-storage 5, reader-wasm 3) |
| `node --test scripts/smoke.test.mjs` | **2/2 pass** |
| `npm run test:e2e` | **9/9 Playwright pass** (Edge `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`, no Chrome assumed) |

Integration details proven by tests:

- Real compiled Axum serves a local MangaDex fixture; Next proxies `/api/content/*` to it. Page URLs are normalized to `/api/content/img?u=...`, and Next→Axum image responses carry identical PNG bytes, `content-type: image/png` and `Cache-Control: … immutable`.
- Legacy `/api/img?u=...` still returns the same Axum bytes and headers.
- Encoded/double-encoded dot segments are rejected before URL construction; raw `?u=` traversal is rejected before `new URL()` normalizes it; empty chapters stay `pages: []`; missing origin returns structured 503; browser cookies/authorization are not forwarded and upstream `Set-Cookie` does not cross the BFF.
- Playwright at 1280×800 and 375×812: dark-lime shell with **decodable test-only fixture covers**, desktop rail, mobile bottom tabs, `/search?q=Fixture` results + tag filter UI, clickable manga tag → `/search?tags=…`, `/the-loai`, `/bxh?kind=rating`, `/tu-truyen` empty state, theme persisted across reload. The earlier "real covers" wording is superseded: these bytes are generated fixtures served by the real Axum proxy, not live MangaDex images.
- Reader: real WASM reported `Trang 1/4 · 25%`; scroll tracking advanced to `2/4 · 50%`; horizontal button/key advanced to `3/4` then `4/4 · 100%`; mode/background came from Rust settings; reload restored page 4 only for the same chapter, re-applied persisted horizontal/dark settings through Rust, and the next chapter started at page 1. Every browser request to a `*.mangadex.org` host was asserted absent.
- Corrupt WASM bytes (Playwright route override) produced a visible retry panel with no rendered pages — no fake success.

## Review fix round 1 (load-bearing lifecycle bugs + UX findings)

**RED proof — image decode.** Added `img.decode()` + `naturalWidth > 0` assertions to the existing Playwright checks before touching fixtures. Current truncated PNG / invalid JPEG fixtures failed with:

```text
✖ desktop and 375px shells render ... (1)
  desktop feature poster did not decode: {"ok":false,"reason":"EncodingError: The source image cannot be decoded."}
✖ real WASM drives pages ... 
  vertical reader page 1 did not decode: {"ok":false,"reason":"EncodingError: The source image cannot be decoded."}
✖ 375px reader ...
  tests 6 / pass 3 / fail 3
```

Screenshots from that run contained broken-image icons; those claims are superseded by the new decode proof.

**Fixes**
- `web/scripts/image-fixtures.mjs`: generated, deterministic, genuinely decodable 600×900 PNG reader pages and real JPEG covers (`pngjs`/`jpeg-js`, dev/test-only). Both `content-proxy.test.mjs` and `reader-playwright.test.mjs` seed Axum's cache with these bytes; a Node test asserts 600×900 PNG dimensions. Browser tests now await `img.decode()`/`naturalWidth` for feature poster, card cover, vertical page and horizontal page, and fresh screenshots were recaptured.
- `ReaderPages.tsx`: observer effect depends only on `[mode, pages, onPage, containerRef]`; no `scrollIntoView` inside it. A closure `active` flag plus `disconnect()` ignores queued callbacks after chapter disposal, so natural scroll and auto-scroll are never fought.
- `ReaderClient.tsx`: each chapter is a keyed `ReaderSession`, so page/settings/loaded/error/running state and the WASM instance cannot leak across equal-page-count chapters or rapid navigation. Restoration is a separate once-per-load/mode scroll; initial page 1 is persisted from actual WASM values (`pageIndex()+1`, `totalPages()`) once that chapter's history row exists. `ReaderWasm.free()` is called on disposal, retry and partially failed init; the module import is cached. Fullscreen is capability-gated and promise rejections are swallowed (no dead control, no `pageerror`).
- `lib/format.ts` + manga detail: `Ch. N`/`Oneshot` replaced by `Chương N`/`Truyện ngắn`, covered by a unit test.
- `lib/content-proxy.ts` + both image routes: canonical `/api/content/img?u=` now applies the same raw traversal/source guard as legacy `/api/img`; a regression test checks both aliases for empty, `../`, `/../` and double-encoded traversal without widening other content endpoints.

**GREEN after fix (fresh commands)**
```bash
cd web
npm run lint                 # 0 errors
npx tsc --noEmit             # pass
npm run build                # pass
npm run test:task5           # 30/30 pass
node --test scripts/reader-playwright.test.mjs  # 9/9 pass
```
Rust suites re-run unchanged from this worktree: `cargo test --workspace` (42 pass), `clippy -D warnings` pass, scoped `cargo fmt --check` pass, `git diff --check` pass.

New browser proof: decodable images in both viewports; page 1 history saved without a page turn; equal-page chapter navigation resets to page 1 and does not inherit position; scroll position stays stable for 1.2 s after an observed page change; auto-scroll pauses on wheel with no stale RAF; corrupt WASM retry recovers and decodes pages; fullscreen absent/rejected paths produce no page errors; rapid chapter switches settle on the last chapter at page 1.

## Generated asset sizes

| File | Bytes |
|---|---:|
| `web/public/wasm/reader_core.25cb810c379e858e.wasm` | 150,508 |
| `web/generated/reader-wasm/reader_core.js` / `.mjs` (glue, each) | 11,417 |
| `web/generated/reader-wasm/reader_core.d.ts` / `.d.mts` (each) | 3,229 |
| `web/generated/reader-wasm/index.ts` | 373 |

Hash is derived from the wasm-bindgen transformed binary, so the immutable URL changes whenever the Rust state machine changes. Nothing under `web/generated`, `web/public/wasm` or `target/` is committed.

## Screenshots (local, gitignored)

`web/.test-screenshots/`: `home-desktop.png`, `home-mobile.png`, `search-desktop.png`, `library-empty.png`, `reader-desktop.png`, `reader-horizontal-dark.png`, `reader-mobile.png`, `reader-wasm-retry.png`, `reader-after-retry.png`, `reader-chapter-isolation.png`. All were recaptured after the decode fix; image decoding is asserted before each capture.

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
