# Task 2 report — Comick provider adapter and normalization

Status: DONE

## Files

- Created `crates/core/src/comick.rs`
- Modified `crates/core/src/lib.rs` (`pub mod comick;`, `pub use comick::Comick;`)
- Inline tests in `crates/core/src/comick.rs`

No auth, DB, deploy, push, or merge work was done.

## Official catalog verification (before writing HTTP calls)

Source: official Comick API docs at <https://api.comick.dev/docs/>, which load the
OpenAPI document from <https://api.comick.dev/docs/json> (fetched and parsed
2026-11-21). The doc declares OpenAPI 3.0.3, title "Comick API", version 1.1,
production base URL `https://api.comick.dev`. No OAuth/Library endpoint is used.

Verified public catalog endpoints and limits recorded at the top of `comick.rs`:

| Operation | Exact path | Verified limits / behavior |
|---|---|---|
| Search | `GET /v1.0/search/?q=...&page=1&limit=15` | Bare array response (no total envelope). Defaults `page=1`, `limit=15`. Declared combinations: `page <= 50` with `limit <= 50`, or `page <= 5` with `limit <= 300`. |
| Title chapters | `GET /v1.0/comic/{hid}/chapters?lang=...&page=1&limit=12` | Returns `{ chapters, total, limit, checkVol2Chap1 }`. Default page size 12; no maximum declared; prefer small pages. `lang` is comma-separated; this adapter sends one code. |
| Chapter images | `GET /chapter/{hid}/get_images` | Ordered image-metadata array (`h`, `w`, `name`, `s`, `b2key`, `optimized`); may be `[]`. Raw metadata, not image bytes. |

Additional official limits/constraints:

- Origin budget: **200 requests/minute/client IP**; honor 429/backoff in clients.
- Verified CDN image host: **`meo.comick.pictures`** (HTTPS). This is the only
  host shown for cover/example image URLs in the official OpenAPI document.
  Task 4 should allowlist exactly this host, not a wildcard or look-alikes.

## RED → GREEN evidence

Commands run from the worktree root:

1. RED (stubbed helpers, real assertions): `cargo test -p core comick`
   - `test result: FAILED. 0 passed; 4 failed; 0 ignored; 0 measured; 14 filtered out`
   - Failing: `comick_id_requires_prefix_and_nonempty_opaque_id`,
     `comick_chapter_normalizes_missing_title_and_language`,
     `comick_page_urls_are_https_and_ordered`, `comick_search_path_encodes_query`.
2. GREEN: `cargo test -p core comick`
   - `test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 14 filtered out`
3. Full crate: `cargo test -p core`
   - `test result: ok. 18 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out`
   - Doc tests: `0 passed; 0 failed`.
4. Lint: `cargo clippy -p core --all-targets -- -D warnings`
   - Finished clean; no warnings.

## Implementation notes

- `Comick::new()` reads `COMICK_API_ORIGIN` (default `https://api.comick.dev`);
  `Comick::with_origin(String)` supports explicit local fixtures. Both build a
  `reqwest::Client` with a 10 s overall timeout and 3 s connect timeout.
- All transport, HTTP-status, and JSON-shape failures collapse to the generic
  `Err("Comick catalog unavailable")`. No upstream body, header, secret, or PII
  is logged. Only a valid empty array is an empty result; wrong shapes are errors.
- Provider-prefixed IDs are produced as required by the design: `ComickTitle.hid`
  and `ComickChapter.id` are `comick:<opaque-id>`. `is_comick_chapter_id` requires
  the prefix and a non-empty opaque value with no whitespace/control characters.
  Catalog request helpers still accept bare HIDs for internal calls.
- Chapter normalization preserves `chapter` and `lang` when present, falls back
  to the requested language when absent, and defaults a missing/null `title` to
  `""`. Numeric chapter labels are accepted as strings.
- Page URLs preserve provider order, prefer an explicit HTTPS URL on the verified
  CDN host, otherwise build `https://meo.comick.pictures/<b2key>`. Non-HTTPS,
  non-CDN, credentialed, or non-443 URLs are rejected before they reach Task 4.
- Source metadata handoff from review: this module intentionally emits provider
  structs without `source`/`source_label` fields (brief's exact interface).
  Task 3 must set both fields together when constructing `contracts` DTOs.

## Concerns / follow-ups

- From this environment, `GET /v1.0/comic/{hid}/chapters` and
  `GET /chapter/{hid}/get_images` returned `403` (likely Cloudflare) while
  `GET /v1.0/search/` worked. Endpoint paths and limits are taken from the
  official OpenAPI document, not invented; live chapter/image responses were
  not available here. Task 3's local fixture tests should cover HTTP wiring.
- The OpenAPI document describes image metadata fields but not a reader-image
  URL template. URLs are built only from the official `meo.comick.pictures`
  host plus a validated `b2key` path segment. If Comick serves reader images
  from a different host, Task 4's allowlist must be updated from a new official
  verification.
- `optimized` is treated as an optional URL string; if it is a flag/number the
  code falls back to `b2key`, which is the documented metadata field.

## Commit

`5128e766162d0afec1f4741381475381d20d678c` — `feat: add Comick catalog provider adapter`
(task product files only; SDD scratch/report left untracked).
