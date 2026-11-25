# Task 2 report: typed contracts and Rust core crates

## Scope

- Added the pure Rust `domain`, `contracts`, and `reader-core` workspace crates.
- Added validated reader page count/index state, deterministic page progress,
  navigation boundaries, and serializable vertical/horizontal reader settings.
- Added typed MangaDex/Axum DTOs for summaries, chapters, latest/search results,
  tags, pages, and structured API errors. Kept the existing response keys and
  used the shared DTOs in the server-facing content path.
- Preserved `crates/ui` and its Leptos reader unchanged. No WASM, Next.js,
  authentication, Neon, Android, or GPUI implementation was added.

## RED evidence

After adding the reader-core tests and before adding the crate to the workspace,
`cargo test -p reader-core` failed as expected:

```text
error: package ID specification `reader-core` did not match any packages
```

## GREEN evidence

- `cargo test --workspace`: passed, 31 tests, 0 failures.
- `cargo clippy --workspace --all-targets -- -D warnings`: passed.
- `cargo fmt --check -p domain -p contracts -p reader-core -p server`: passed.
- `git diff --check`: passed.
- Reader-core normal dependencies are domain-only; `serde_json` is test-only.

Reader-core tests cover first/last page boundaries, invalid page counts and
indices, 80% and 100% progress, `usize::MAX` page counts, and horizontal/vertical
settings wire values. Contract tests assert the legacy field names, flattened
latest-manga shape, page response shape, and nested error envelope. Domain tests
cover the cultivation level range and all realm boundaries.

## Known formatting limitation

The required full `cargo fmt --check` still reports pre-existing formatting
differences in untouched Leptos UI files and `crates/core/src/imgcache.rs` and
`crates/core/src/lib.rs`. Those unrelated files were intentionally not
reformatted. All newly added source and touched implementation files were
formatted; the changed-package check above passes.

## Files changed

- `Cargo.toml`, `Cargo.lock`
- `crates/domain/{Cargo.toml,src/lib.rs}`
- `crates/contracts/{Cargo.toml,src/lib.rs}`
- `crates/reader-core/{Cargo.toml,src/lib.rs,src/tests.rs}`
- `crates/core/Cargo.toml`, `crates/core/src/{dns.rs,mangadex.rs}`
- `crates/server/Cargo.toml`, `crates/server/src/main.rs`
- `docs/superpowers/sdd/kaslyydex-phase-1-2/task-2-report.md`

## Fix follow-up: reject upstream records without usable IDs

Addressed the review finding on low-severity fabricated IDs in
`crates/core/src/mangadex.rs`.

### Changes

- Tags are converted through `tag_dto`, which skips records whose `id` is
  missing, non-string, empty, or whitespace-only.
- Chapters are converted through `chapter_dto`; the feed skips such records
  instead of emitting `""`. `latest_groups` applies the same check so a blank
  chapter id cannot enter a latest-manga payload.
- Manga summaries go through `summary() -> Option<_>`; `summaries`,
  `with_stats`, `latest` and `manga` propagate the rejection. A single-manga
  lookup now returns an error rather than fabricating an empty id.
- Nested tag ids in summaries skip blank upstream values while tag names and
  every existing JSON field/key remain unchanged.
- Search results are matched by manga id instead of positional `zip`, so a
  skipped summary cannot shift `latest_chapter` onto the wrong result.

### RED evidence

With only the ID validation lines temporarily reverted to the previous
`unwrap_or_default()` behaviour, `cargo test -p core mangadex::tests` reported
`FAILED. 3 passed; 5 failed`:

```text
tag_conversion_rejects_missing_non_string_and_empty_ids ... FAILED
chapter_conversion_rejects_missing_non_string_and_empty_ids ... FAILED
manga_summary_conversion_rejects_missing_non_string_and_empty_ids ... FAILED
latest_chapter_conversion_never_emits_empty_ids ... FAILED
manga_summary_skips_empty_tag_ids_but_keeps_tag_names ... FAILED
  left: Array [String("tag-a"), String(""), String("   ")]
 right: Array [String("tag-a")]
```

### GREEN evidence

- `cargo test -p core`: 9 passed, 0 failed.
- `cargo test --workspace`: 36 passed, 0 failed across all binaries; 0 doc tests.
- `cargo clippy --workspace --all-targets -- -D warnings`: passed, no warnings.
- `cargo fmt --check -p domain -p contracts -p reader-core -p server`: passed.
- `cargo fmt --check -p core`: only the known pre-existing diffs in
  `crates/core/src/imgcache.rs` and `crates/core/src/lib.rs`; `mangadex.rs` is
  clean and those unrelated files were not reformatted.
- `git diff --check`: passed (only the existing LF/CRLF notice for
  `mangadex.rs`).

No auth, Neon, Next.js, WASM or native implementation was added.
