# Final whole-branch fix wave — notes

BASE: `4f1da19f7eabb6456c502f425cf5fa1522a86267`
Branch: `feature/kaslyydex-advanced-search-ux`

## Scope (all three review items)

1. **IMPORTANT — pagination prefix bug** in `crates/core/src/search.rs`.
   - `mangadex_page` now loops pages `1..=query.page` through the existing
     `Md::search_filtered` adapter (offset 0, 24/page), keeping the upstream
     `total` from page 1 and accumulating a full prefix.
   - `comick_page_for` now fetches pages `1..=ceil(page*24/15)` (15 hits/page),
     capped at the documented `page <= 50`; `partial` is set when the cap
     prevents a full prefix. Page 1 keeps its single legacy request, and
     `page > 50` keeps the existing no-call/partial response.
   - The single post-merge `skip((page-1)*24).take(24)` is unchanged; only the
     provider prefix feeding it changed. Cache keys, legacy UUID detail/chapter
     routes, and source validation are untouched.
   - Test fixture `respond` now honors MangaDex `offset`/`limit` and Comick
     `page`, so prefix tests exercise real pagination.
   - RED first: added `source_all_page_2_uses_full_prefix_before_slicing` and
     `comick_page_2_fetches_full_prefix`; before the production change both
     failed with `left: []` vs 24 expected IDs (16 passed / 2 failed of 18).
   - GREEN: after the fix 19/19 `core search` tests pass (including a third
     `comick_prefix_capped_at_documented_page_is_partial` test asserting 50
     capped requests and `partial = true`).
2. `README.md:140` — baseline count corrected `783` -> `1130`, artifact set now
   names both `kaslyydex-phase-1-2/*.diff` and
   `kaslyydex-multi-source-ux/*.diff` (matches the baseline file header).
3. `.github/workflows/ci.yml` — two comments reworded (aggregate is Node-only,
   Chromium is for the separate browser suites; baseline covers prior and
   multi-source SDD diff artifacts, 1130 entries). No CI behavior changed.

## Exact commands and results

All run from worktree root unless noted.

| Command | Result |
| --- | --- |
| `cargo test -p core search` (RED, after tests only) | 16 passed, 2 failed, 0 ignored (18 total) |
| `cargo fmt -p core` | applied; then `cargo fmt --check -p core` exit 0 |
| `cargo test -p core search` (GREEN) | 19 passed, 0 failed, 0 ignored (19 total) |
| `cargo fmt --check -p domain -p contracts -p reader-core -p reader-wasm -p server -p core` | exit 0 |
| `cargo clippy --workspace --all-targets -- -D warnings` | exit 0 |
| `cargo test -p server` | 11 passed, 0 failed |
| `cargo build -p server` | exit 0 |
| `node --import tsx --conditions=react-server --test scripts/search-source.test.mjs` (in `web/`, after Axum build) | 11 tests, 11 pass, 0 fail |
| `npm run check:whitespace` (in `web/`) | exit 0 — 314 tracked files, 0 new findings (1130 baselined) |
| `npm run check:secrets` (in `web/`) | exit 0 — 238 tracked text files, 0 candidates |
| `git diff --check` | exit 0 |
| `npm run typecheck` (in `web/`) | exit 0 |
| `npm run lint` (in `web/`) | exit 0 — 0 errors, 7 pre-existing `@next/next/no-img-element` warnings |

## Notes / concerns

- Comick has no upstream `total`; the aggregator still reports the fetched
  prefix count as before (page 1 behavior unchanged) and marks `partial` when
  the page cap prevents a full prefix. No exhaustive total is implied for the
  capped case.
- Deep pages (>32 for `source=comick`, >50 for a direct request) are marked
  partial by design; page 51 still makes zero Comick calls as before.
- MangaDex prefix fetching issues `page` sequential adapter calls (24 hits each)
  instead of one; page 1 remains a single call. This is the smallest change that
  keeps the existing MangaDex API shape and cache keys intact.
- No push, merge, deploy, cloud, or subagent actions were taken. SDD scratch
  stays untracked; only `.github/workflows/ci.yml`, `README.md`, and
  `crates/core/src/search.rs` are staged for the task commit.
