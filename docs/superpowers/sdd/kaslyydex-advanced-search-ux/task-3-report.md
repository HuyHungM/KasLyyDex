# Task 3 report — Axum multi-source search orchestration

Status: complete (GREEN). Branch `feature/kaslyydex-advanced-search-ux`, base `d1d0997f9cf12e755b0a6a6c6ab87a09d7fb3559`.

## Files

- Created `crates/core/src/search.rs` — `search_all`, cache key, provider dispatch, local filters, deterministic merge/sort, 9 inline tests.
- Modified `crates/core/src/lib.rs` — registers `pub mod search`.
- Modified `crates/core/src/mangadex.rs` — `Md::with_origin` fixture seam plus `cached_search`/`cache_search` accessors for the existing content cache; `search_filtered` is unchanged.
- Modified `crates/core/src/comick.rs` — `is_comick_manga_id`, `Comick::detail` via verified `/v1.0/comic/{slug}/`, `comic_path`, `normalize_detail`, and 2 inline tests.
- Modified `crates/server/src/main.rs` — search handler uses `search_all`; source-aware detail/chapter routes; structured 503 `CONTENT_UNAVAILABLE`; 2 inline tests. Legacy `/api/search` already shared the search handler and still does.
- Created `web/scripts/search-source.test.mjs` — real Axum process + loopback MangaDex/Comick fixture integration tests.

## RED → GREEN

RED was captured before implementing `search_all` (stub returned `"not implemented"`) and before wiring the Axum server (binary built from the base code):

| Stage | Command | RED | GREEN |
| --- | --- | --- | --- |
| Rust merge | `cargo test -p core search` | 4 passed / **8 failed** (all new search tests) | **13 passed** / 0 failed (includes 2 new Comick tests) |
| Rust server | `cargo test -p server search`, full `-p server` | handler still called `md.search_filtered` only | 1 filtered pass; full suite **11 passed** / 0 failed |
| Rust whole core | `cargo test -p core` | n/a | **42 passed** / 0 failed |
| Lint | `cargo clippy -p core -p server --all-targets -- -D warnings` | n/a | clean, no warnings |
| Node fixtures | `node --import tsx --conditions=react-server --test scripts/search-source.test.mjs` (after `cargo build -p server`) | 4 passed / **6 failed** | **10 passed** / 0 failed |
| Regression | `node --import tsx --conditions=react-server --test scripts/source-fallback.test.mjs` | n/a | **7 passed** / 0 failed |

Fixture assertions cover modern Comick search-hit fields (`desc`, `status`, `genres`, `md_covers`) and prefixed comic IDs on both `/api/content/manga/{id}` and `/api/content/manga/{id}/chapters`. Bare UUID detail/chapter behavior is asserted unchanged.

## Verified official endpoints

Checked against the official Comick OpenAPI document at `https://api.comick.dev/docs/json` on 2026-11-22:

- `GET /v1.0/search/` — `q`, `page <= 50` with `limit <= 50`, `from`/`to`, `genres` (slugs), no `lang` or MangaDex-tag mapping.
- `GET /v1.0/comic/{slug}/` — path accepts a slug **or public HID**; returns `{ comic, authors, artists, langList, ... }`; detail uses `md_comic_md_genres[].md_genres.slug` and `md_covers`.
- `GET /v1.0/comic/{hid}/chapters?lang=...` — existing adapter, prefix-stripped.
- `GET /genre/` — official genre list with `id`, `name`, `slug`; **no endpoint maps a MangaDex tag UUID to a Comick genre slug**.

## Partial decisions (`partial: true`)

1. Comick selected and `lang != all`: `/v1.0/search/` has no language filter; language cannot be guaranteed, so results are not claimed complete.
2. Comick page > 50: outside the documented cap; no Comick request is made, the provider contributes no results and the response is partial.
3. Comick selected with MangaDex `tags`: tag IDs are MangaDex UUIDs. Although `/genre/` is a verified official endpoint, no official UUID→slug catalog exists. No slug is guessed or sent; partial is set and this is documented in code.
4. Comick `status`: locally filtered on the normalized status string because the Task 2 adapter has no status parameter; upstream page/ranking was not filtered, so partial.
5. Any selected provider HTTP/validation failure: other provider results are kept and partial is set. Complete failure returns a structured 502 `UPSTREAM_ERROR`; only the distinct "provider not configured" sentinel maps to 503 `CONTENT_UNAVAILABLE`, so an upstream 500 is never mislabeled as missing configuration.
6. MangaDex `year`: locally filtered on the returned 24-item page, partial because upstream pagination cannot guarantee full year coverage. MangaDex `lang != all`: partial because the summary DTO carries no language and the adapter has no language filter.

Only non-partial responses are stored in the existing `Md.search` cache under an `aggregate|...` key covering `q`, `page`, `tags`, `status`, `sort`, `source`, `lang` and `year`. `q` is JSON-quoted to avoid delimiter collisions between equal-length keywords.

## Concerns / skipped

- Comick search has no total-count envelope; its `total` contribution is the number of returned hits. MangaDex contributes its upstream `total`. Combined `total` is the sum before page slicing, as specified, but is not an exhaustive cross-provider catalog count.
- Comick's documented page size is 15 while the shared contract page size is 24. The query page is passed through to Comick and the merged list is sliced to 24; a Comick page therefore holds at most 15 results. Aligning page sizes would require changing Task 2's verified path and is out of scope.
- `sort=new` uses publication `year` as a proxy because `MangaSummaryDto` has no publish timestamp; ties fall through to source label, title and id as required.
- Direct Comick chapter DTOs report `pages: 0` / `readable: false` because page count requires a separate `/get_images` call per chapter. The reader resolves pages through the existing `comick:`-aware pages endpoint.
- MangaDex `lang != all` results are returned unfiltered but flagged partial; adding an upstream `availableTranslatedLanguage[]` filter was not attempted because it would change the preserved MangaDex adapter behavior.
- No authentication, deployment, cloud or live-Catalog dependency was added; all tests use loopback fixtures.

## Fix round 1 — language filter is no longer a no-op

HEAD before fix: `e163f1f4ea7c25daadca282ca2bfabb3d51569e5`.

### What changed

- `crates/core/src/mangadex.rs`: `Md::search_filtered` takes `lang: &str`; the path builder appends the **official** `availableTranslatedLanguage[]=vi|en` query parameter on `GET /manga` when `lang != all`. `lang=all` emits the exact legacy path (no language parameter). Any other value is rejected before a request is built. Verified in the official MangaDex spec `https://api.mangadex.org/docs/static/api.yaml` (`get-search-manga`, parameter `availableTranslatedLanguage[]`).
- `crates/core/src/search.rs`: passes `query.lang` to MangaDex; MangaDex `partial` no longer includes a language term because the filter is now enforced upstream. Comick keeps `partial=true` when `lang != all`: `/v1.0/search/` has no language field, the summary hit has no language data, and no per-title language lookup or invented parameter is performed. Year remains a local, partial filter.
- Tests: MangaDex path tests for `vi`, `en`, legacy `all`, and invalid `fr`; fixture tests asserting the upstream path for `source=mangadex` and `source=all&lang=vi`, Comick receiving no `lang=` param, and `partial=true` for the Comick side; Node fixture asserts the exact query reaching the MangaDex fixture.
- Scoped `cargo fmt -p core -p server` applied; it also normalized pre-existing formatting in the same task files.

### RED → GREEN (exact counts)

| Command | RED (before implementation) | GREEN |
| --- | --- | --- |
| `cargo test -p core search` (Axum scaffolding: `lang` accepted but ignored) | 13 passed / **3 failed** (`mangadex_lang_filters_upstream_and_all_keeps_legacy_path`, `source_all_lang_vi_filters_mangadex_and_marks_comick_partial`, `search_path_applies_official_language_filter_only_when_requested`) | **16 passed** / 0 failed |
| `cargo test -p core` | n/a | **45 passed** / 0 failed |
| `cargo test -p server` | n/a | **11 passed** / 0 failed |
| `cargo build -p server` then `node --import tsx --conditions=react-server --test scripts/search-source.test.mjs` (from `web/`) | 10 passed / **1 failed** (`lang=vi filters MangaDex upstream while Comick stays partial` — fixture saw no `availableTranslatedLanguage[]`) | **11 passed** / 0 failed |
| `cargo clippy -p core -p server --all-targets -- -D warnings` | n/a | clean |
| `cargo fmt -p core -p server -- --check` | drift in task files | clean |
| Regression `scripts/source-fallback.test.mjs` | n/a | **7 passed** / 0 failed |

This supersedes the original report's `partial` decision 6 and its MangaDex-language concern: language is now applied server-side for MangaDex and is not a source of `partial` there. The cache key already includes `lang`, so a language change cannot reuse a differently filtered response.

### Remaining concerns

- Comick results under `lang != all` are still unfiltered by language and explicitly marked `partial`; the UI must show that warning rather than implying full coverage.
- The MangaDex filter matches titles with at least one chapter in `vi`/`en`; it does not assert that every returned chapter has that language. That is the documented meaning of `availableTranslatedLanguage[]`.
