# Task 2 report: Comick catalog search adapter

Status: complete.

Base: `f24593be31d02dcdce3a881472160af131ebd34d`
Branch: `feature/kaslyydex-advanced-search-ux`

## Files changed

- `crates/core/src/comick.rs` — added `Comick::search`, public `search_path` and
  `normalize_search_hit`; reused the existing HTTP client, CDN URL guard and
  generic error. Updated `search_titles` for the new path-builder signature and
  replaced its old one-argument path test with the three brief tests.
- `docs/superpowers/sdd/kaslyydex-advanced-search-ux/task-2-report.md` — this
  report (SDD scratch, intentionally untracked).

## Official endpoint verification (2026-11-22)

Source: `https://api.comick.dev/docs/json` (OpenAPI 3.0.3, Comick API 1.1),
plus a live anonymous sample of `GET /v1.0/search/?q=slime&page=1&limit=10`
(HTTP 200, `application/json`, bare array — no envelope).

- `GET /v1.0/search/` is public catalog search. Response is a bare array.
- Verified query fields: `q` (keyword), `page` (default 1; documented bound
  50 with `limit` <= 50, or 5 with `limit` <= 300), `limit` (default 15),
  `from`/`to` (inclusive publication year), `status` (1 ongoing, 2 completed,
  3 cancelled, 4 hiatus), `genres` (numeric genre ids), `media_type` (default
  manga), plus content-rating/country/sort filters not used here.
- Verified hit fields used: `hid`, `title`, `desc`, `year`, `status`, `genres`,
  `md_covers[].b2key`, `bayesian_rating`, `user_follow_count`, `last_chapter`.
- No OAuth/Library endpoint is used.

### Rule against the brief's assumed fields

The brief assumed search parameters named `lang` and `year`, and a test
assertion that language is encoded into the path. The official search route has
**no `lang` parameter**, and publication year is expressed as `from`/`to`, not
`year`. Per instruction, no invented parameter was sent: `search_path` emits
`q`, `page`, `limit` and `from=<year>&to=<year>` only. `lang` is accepted by the
shared contract, validated, and documented as locally applied by Task 3. The
`comick_search_path_encodes_filters` test asserts the absence of `lang=` and
exactly five verified parameters. The rule is recorded in both the code comment
above the adapter and in this report.

## RED

Command (worktree root): `cargo test -p core comick`

- Result: compile failure in the `core` lib test target.
- 4 errors: `E0061` (`search_path` took 1 argument, 4 supplied), `E0599`
  (`expect` on `String` because of the wrong signature), and 2x `E0425`
  (`normalize_search_hit` not found).
- Tests run: 0. Failure reason matched the brief (functions did not exist).

## GREEN

1. `cargo test -p core comick` — 9 passed, 0 failed, 21 filtered out. Includes
   the three new tests: `comick_search_path_encodes_filters`,
   `comick_search_hit_sets_source_pair`,
   `comick_search_hit_rejects_missing_title_or_id`.
2. `cargo test -p core` — 30 passed, 0 failed, 0 ignored; doc-tests 0 passed.
3. `cargo clippy -p core --all-targets -- -D warnings` — clean, no warnings.
4. `rustfmt --edition 2021 crates/core/src/comick.rs` — applied; `git diff --check`
   clean after restoring the file's CRLF line endings.

## Implementation notes

- `source: "comick"` and `source_label: "Comick"` are set together in the
  normalizer; missing `hid`/`title` (or an opaque id with path delimiters)
  returns the generic `Comick catalog unavailable` error, with no fabricated
  fields.
- `md_covers[0].b2key` is converted through the existing `image_url` guard to
  the verified CDN form `https://meo.comick.pictures/<b2key>`; non-HTTPS or
  foreign-host cover URLs and traversal-like keys yield no cover rather than an
  unverified URL.
- Numeric `status` is mapped to the DTO's canonical strings used by the search
  contract. Numeric `genres` are preserved as string ids in `tags`/`tag_ids`
  (no name lookup or invented slugs). `bayesian_rating`, `user_follow_count`
  and `last_chapter` populate the optional rating/follows/latest-chapter fields.
- Page is bounded to 1..=50 with `limit=15`; out-of-range page, empty/overlong
  query, invalid language or impossible year return the generic upstream error.
- `search()` uses the existing `get_json` client (10s total / 3s connect
  timeout), maps non-success status and non-array/shape errors to the same
  generic error, and performs no caching (Task 3 owns aggregation caching).

## Concerns / follow-ups

- Language cannot be filtered server-side on this endpoint. Search hits also do
  not expose a per-title language list (verified in the sampled response keys),
  so Task 3's local `lang` filter needs extra per-title chapter lookups or must
  set `partial=true`; it cannot be guaranteed complete from this call alone.
- `cover_file` now carries a full Comick CDN URL, while the current UI
  `cover_url()` helper always builds a MangaDex uploads URL. Source-aware cover
  rendering is needed before Comick cards display images.
- Comick `genres` are numeric ids, not MangaDex UUIDs or slugs; UI tag pills and
  the shared `tags` filter will not match without a `/genre/` id-to-slug mapping.
- No committed HTTP integration test exercises `search()` against a loopback
  fixture or the live origin; the method reuses the already-tested `get_json`
  path and the normalizer/path tests above. Upstream response shape was sampled
  live but may change; the docs also warn about 200 req/min/IP and Cache-Control
  windows, which no code here enforces.
- SDD scratch, including this report, is intentionally left untracked; only
  `crates/core/src/comick.rs` is committed.

## Fix round 1 (review of `bd26b2d23599e43f0aa1629502e748b04120decc`)

### Changes (all in `crates/core/src/comick.rs`)

- Critical: `normalize_search_hit` now emits `format!("comick:{hid}").into()`
  instead of a bare HID. The existing helpers already handle the prefix:
  `request_opaque` strips `comick:` before catalog calls, and
  `title_from_value` / `chapter_from_value` add the same prefix. The test
  assertion at `comick_search_hit_sets_source_pair` now expects
  `comick:zZc_AAsE` and additionally asserts the round trip
  `request_opaque(dto.id.as_str()) == Some("zZc_AAsE")`.
- Important: `search_path` accepts empty/whitespace-only `q` and omits the
  `q` parameter entirely (official docs allow keyword-less browse). New test
  `comick_search_path_allows_browse_without_query` asserts both the empty and
  whitespace cases, with and without the year filter.
- Comment-only: the verified-field comment now distinguishes request `genres`
  (slugs from `/genre/`) from response `genres` (numeric ids). No genre mapping
  code was added; Task 3 owns the handoff.

### RED (before fixes)

Command (worktree root): `cargo test -p core comick`

- 10 tests run: 8 passed, 2 failed, 0 ignored, 21 filtered out.
- `comick_search_hit_sets_source_pair` — left `"zZc_AAsE"`, right
  `"comick:zZc_AAsE"`.
- `comick_search_path_allows_browse_without_query` —
  `browse without q: "Comick catalog unavailable"` because empty `q` was
  rejected.

### GREEN (after fixes)

1. `cargo test -p core comick -v` — 10 passed, 0 failed, 0 ignored,
   21 filtered out.
2. `cargo test -p core -v` — 31 passed, 0 failed, 0 ignored, 0 filtered out;
   doc-tests 0 passed.
3. `cargo clippy -p core --all-targets -- -D warnings` — clean, exit 0.
4. `rustfmt --edition 2021 --check crates/core/src/comick.rs` — clean, exit 0.
   CRLF line endings and `git diff --check` restored/verified after formatting.

Note: the first GREEN compile attempt produced `E0308` (`expected MangaId, found
String`) at the new id expression; it was fixed with `.into()` before the
passing runs above. No other checks were skipped.

### Concerns after fix

- Prefixed ids now satisfy the server's source guards, but downstream routes
  that assume MangaDex UUIDs still need source-aware handling (Task 3/4).
- Keyword-less browse is now allowed; with broad filters it can return up to
  15 results per page, so callers should bound pages (the adapter caps at 50).
- Genre slugs vs numeric response ids remain unconverted here by design.
- No committed HTTP fixture test for `search()` was added in this fix; the id
  and path changes are covered by unit tests and the verified docs sample.
- SDD scratch, including this report, remains untracked; only
  `crates/core/src/comick.rs` is committed in this fix.
