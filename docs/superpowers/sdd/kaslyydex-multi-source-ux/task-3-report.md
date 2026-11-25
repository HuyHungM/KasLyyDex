# Task 3 report — chapter fallback orchestration, cache, and Axum routes

Status: DONE

## Scope

- Created `crates/core/src/fallback.rs`.
- Modified `crates/core/src/lib.rs`, `crates/core/src/mangadex.rs`,
  `crates/contracts/src/lib.rs`, and `crates/server/src/main.rs`.
- Added `web/scripts/source-fallback.test.mjs`.
- No auth, database, deployment, push, or merge work was done.

## RED → GREEN evidence

### Rust matching tests

1. RED: `cargo test -p core fallback`
   - Compile-failed before implementation (28 unresolved-name/type diagnostics in
     `fallback.rs`); 0 tests executed.
   - Tests written first: `fallback_skips_readable_mangadex_chapter`,
     `fallback_matches_decimal_chapter_and_language`,
     `fallback_rejects_mismatched_chapter_number`,
     `fallback_prefers_vi_then_en`, and
     `fallback_negative_result_is_cached_briefly`.
2. GREEN: `cargo test -p core fallback`
   - `test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out`.
   - Full core harness: `23 passed; 0 failed`.
   - Contracts harness: `7 passed; 0 failed`.
   - Server harness: `9 passed; 0 failed`.
   - `cargo clippy -p core -p server -p contracts --all-targets -- -D warnings`: clean.
   - `rustfmt --check --edition 2021` on the task Rust files: clean.

The shell environment suppresses Cargo's test-harness stdout for `cargo test`, so
the pass counts above were confirmed by running the freshly built test
executables directly; `cargo test -p core -p server -p contracts --no-run`
completed successfully first.

### Node real-Axum fixture test

Command from `web/`:

```powershell
node --import tsx --conditions=react-server --test scripts/source-fallback.test.mjs
```

1. RED: `tests 7; pass 3; fail 4`. Failures were missing fallback chapter
   source/readable fields and rejection of `comick:` chapter IDs.
2. GREEN: `tests 7; pass 7; fail 0`.

Additional relevant Node suites after GREEN:

- `scripts/source-contracts.test.mjs`: 2 passed, 0 failed.
- `scripts/notification-feed.test.mjs`: 11 passed, 0 failed (feed behavior preserved).
- `scripts/content-proxy.test.mjs`: 13 passed, 0 failed (legacy aliases/image proxy preserved).

## Fixture cases

The Node test starts one real Axum process with loopback MangaDex and Comick
fixtures and a per-run `CACHE_DIR`. It asserts:

1. External-only MangaDex chapter (`10.1`, 0 pages) is replaced by
   `comick:chap-101` with `source == "comick"`, `source_label == "Comick"`,
   `readable == true`, `external_url == null`, and `pages == 2`.
2. A readable MangaDex chapter is returned unchanged as `source == "mangadex"`
   and makes no Comick request at all.
3. Comick `500` leaves the original external chapter, external URL, and page count intact.
4. A Comick chapter list without `10.1` leaves the original external chapter intact.
5. `/api/content/chapter/comick:<id>/pages` returns two `/api/content/img?u=...`
   URLs whose upstream values are exactly the fixture's returned
   `https://meo.comick.pictures/page-1.jpg` and `page-2.jpg`; no raw CDN URL is exposed.
6. Legacy `/api/chapter/comick:<id>/pages` aliases the same source-aware dispatch.
7. Malformed `comick:` ID returns structured `VALIDATION_ERROR` 400 before any upstream call.

Prefix stripping is asserted explicitly: decoded fixture requests are
`/v1.0/comic/comic-1/chapters?lang=vi&page=1&limit=12` and
`/chapter/chap-101/get_images`, not encoded `comick:` values.

## Implementation notes

- `ContentState { md, comick }` is the Axum state for every content route;
  legacy `/api/*` and canonical `/api/content/*` routes share the handlers.
- `enrich_chapters` returns immediately when every MangaDex chapter is readable,
  so Comick is only consulted for actual gaps. Search/chapter failures are
  swallowed and the primary list is returned unchanged.
- Matching requires canonical chapter-number equality and compatible language;
  `vi` ranks before `en`, and provider order breaks ties. Non-numeric labels
  fail closed. `10.1` is distinct from `10` and `10.2`.
- Candidate titles are selected by exact normalized title/alias equality from
  search metadata, capped at three titles.
- Positive mappings are written only after Comick returns a non-empty image
  list; the returned image count becomes the fallback chapter `pages` value.
  Missing/empty/failed pages produce a short negative result and leave the
  external chapter untouched.
- `fallback_cache_key` hashes source + primary manga ID + normalized chapter
  + language into a path-safe filename under `imgcache::cache_dir()`. Entries
  have TTLs (1 h positive, 60 s negative, 24 h hard cap), a 4 KiB size cap,
  and a 512-file cap. Cache read/write failures never fail the MangaDex response.
- `ChapterDto.readable` was added with a serde default and is derived from
  `pages > 0 && external_url.is_none()` in the shared MangaDex mapper. Source
  and source label are always written as a pair (`mangadex`/`MangaDex`,
  `comick`/`Comick`).
- `chapter_pages` validates IDs before upstream calls and proxies all Comick
  image URLs to `/api/content/img?u=...`. `chapter_metadata` resolves Comick
  IDs through the same cache mapping used by the chapter list.
- Notification feed handlers were switched to `state.md` without changing
  query validation, ordering, continuation, or `no-store` behavior.

## Pagination decision

`Comick::chapters()` remains at page 1 / limit 12 (reviewer handoff 3). This is
sufficient for this conservative fallback: title identity comes from exact
normalized search/title metadata, not fuzzy comparison; chapter matching
requires exact number and language; and at most three title candidates are
examined (one search + up to six chapter-list calls per list request). The
first 12 entries per language cover the recent chapters this gap-filling flow
targets. Older chapters deliberately fail closed (external link stays), and the
60 s negative cache prevents repeated upstream calls for known misses. Adding
pagination would increase requests against the 200/minute origin budget without
increasing match confidence, so it was not added.

## Reviewer handoffs

1. Rust `readable` added to `ChapterDto` and derived in the MangaDex mapper.
2. `source` and `source_label` are set together in every DTO constructor.
3. Page-1/limit-12 decision justified above.
4. Node fixtures assert `comick:` prefixes are stripped before Comick HTTP calls
   and that returned page URLs drive the proxied URLs.

## Concerns

- `imgcache::allowed()` still only allows MangaDex image hosts. The URLs are
  correctly same-origin proxied, but the proxy will reject the Comick CDN until
  Task 4 adds `meo.comick.pictures` to the allowlist.
- Comick metadata for a chapter ID requires a prior chapter-list mapping; a
  cold direct metadata request returns a structured 502 rather than inventing
  a manga ownership claim.
- Disk cache writes are not atomic; a torn file is treated as a miss. This is
  safe for reading but can momentarily lose a mapping after a crash.
- Exact title/alias matching plus 12 recent chapters means older or oddly
  titled releases remain external-only. This is intentional fail-closed behavior.

## Commit

`445d8eca5215608dd89329c8b09479ee7d49db52` — `feat: fallback unreadable chapters to Comick`
(6 task product files; SDD scratch/report left untracked).
