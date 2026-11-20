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
