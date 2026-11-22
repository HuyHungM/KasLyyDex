# Task 1 report: Search query and DTO contract extension

Status: complete.

Base: `bd9b8308d88981cade639b07e85a61ab26ae53dd`
Branch: `feature/kaslyydex-advanced-search-ux`

## Files changed

- `crates/contracts/src/lib.rs` — added `SearchResponse.partial`, `SearchQuery`, public `parse_search_query`, and three inline tests.
- `crates/server/src/main.rs` — imports `contracts::parse_search_query`, removed the server-local parser/struct, maps contract errors to HTTP 400, updated the existing inline test.
- `crates/core/src/mangadex.rs` — added `partial: Some(false)` to the only `SearchResponse` constructor (required for compilation; not listed in the brief).
- `web/lib/contracts.ts` — added `source`, `lang`, `year` to `SearchParams`, `partial` to `SearchResponse`, and serialization in `searchQuery`.
- `web/scripts/search-contracts.test.mjs` — new RED/GREEN TS contract tests.

## RED

1. `cargo test -p contracts search_query` (worktree root)
   - Failed to compile the test target: 3x `E0425 cannot find function parse_search_query`, 1x `E0609 no field partial on type SearchResponse`.
   - Tests run: 0 (compile failure). Failure reason matched the brief.

2. `node --import tsx --test scripts/search-contracts.test.mjs` (`web/`)
   - Tests: 3 total; 2 pass, 1 fail.
   - Failing test: `searchQuery serializes source, lang and year` — `source` was `null` instead of `comick`.

## GREEN

1. `cargo test -p contracts -p server search` (worktree root)
   - contracts: 3 passed, 0 failed, 7 filtered out (the three new `search_query_*` tests).
   - server: 1 passed, 0 failed, 8 filtered out (`search_rejects_invalid_filters_and_bounds_pagination`).

2. `cargo test -p contracts -p server -p core` (worktree root, full affected-crate suite)
   - 47 passed, 0 failed, 0 ignored across all test binaries (contracts 10, core 28, server 9, two doc/bin targets 0).

3. `node --import tsx --test scripts/search-contracts.test.mjs` (`web/`)
   - Tests: 3 passed, 0 failed.

4. `npx tsc --noEmit` (`web/`)
   - Exit 0, no output.

5. Extra checks:
   - `rustfmt --edition 2021 --check crates/contracts/src/lib.rs crates/server/src/main.rs crates/core/src/mangadex.rs` — clean.
   - `npm run check:whitespace` (`web/`) — 304 tracked files inspected, 0 new findings.

## Concerns / follow-ups

- `contracts` cannot depend on `core` (`core` already depends on `contracts`), so sort/status/UUID validation is mirrored locally with a `shortcut:` comment. If core's allowlists change, these must be kept in sync.
- `SearchResponse.partial` uses the brief's `#[serde(default)]` on `Option<bool>`: a legacy payload with the field absent deserializes to `None`, which is semantically false via `unwrap_or(false)`. The core constructor emits `Some(false)` so current server responses serialize `"partial": false`. Use a custom serde default if downstream requires `Some(false)` on legacy deserialization.
- New filters are parsed and serialized but not yet forwarded to the upstream search in this task; `source`, `lang`, and `year` do not change results yet.
- `current_year()` derives the year from `SystemTime` with an average-year divisor and no new dependency; it can disagree with the calendar year for roughly a day around New Year, but the `+1` upper bound keeps the accepted year range safe.
- `crates/core/src/mangadex.rs` had to be touched because adding a required field to `SearchResponse` breaks its only constructor.
- SDD scratch, including this report, is intentionally left untracked; only the five task files are committed.
