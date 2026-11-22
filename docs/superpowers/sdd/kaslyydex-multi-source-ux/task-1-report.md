# Task 1 report: Additive source metadata contracts

## Scope implemented

- Rust DTOs `MangaSummaryDto` and `ChapterDto` gained `source: String` and
  `source_label: String`, both serde-defaulted (`mangadex` / `MangaDex`) so legacy
  JSON deserializes unchanged.
- Added `default_source()`, `default_source_label()` and public
  `source_label(&str) -> &'static str` (`comick` → `Comick`, everything else →
  `MangaDex`).
- Updated the two Rust literal constructors in `crates/core/src/mangadex.rs`
  and the existing inline `ChapterDto` test literal so the workspace compiles.
- TS `MangaSummaryDto`/`ChapterDto` gained optional `source` and `source_label`;
  `ChapterDto` also gained optional `readable`. Added exported `sourceLabel`
  helper (`comick` → `Comick`, otherwise `MangaDex`).

## RED evidence (tests written first)

1. Rust, from repo root:

   ```bash
   cargo test -p contracts source
   ```

   Result: exit 101, compile failure with **12 errors** (8 × `E0609` unknown
   `source` / `source_label` fields, 4 × `E0425` missing `source_label`
   function). No tests ran.

2. TS, from `web/`:

   ```bash
   node --import tsx --test scripts/source-contracts.test.mjs
   ```

   Result: exit 1, `SyntaxError: The requested module '../lib/contracts.ts'
   does not provide an export named 'sourceLabel'`. Counts: tests 1, pass 0,
   fail 1.

## GREEN evidence (after implementation)

Commands and exact outcomes:

| Command (working dir) | Result |
| --- | --- |
| `cargo test -p contracts` (repo root) | exit 0; **7 passed, 0 failed**, 0 ignored; 0 doc tests |
| `cargo test --workspace` (repo root) | exit 0; **53 passed, 0 failed** across all unit/doc test binaries |
| `cargo check --workspace` (repo root) | exit 0 |
| `node --import tsx --test scripts/source-contracts.test.mjs` (`web/`) | exit 0; **2 passed, 0 failed** |
| `npx tsc --noEmit` (`web/`) | exit 0, no diagnostics |

New Rust tests (all passing): `manga_summary_defaults_source_to_mangadex`,
`chapter_defaults_source_to_mangadex`, `source_label_maps_known_sources`.
Existing JSON-shape tests were kept and still pass.

## Files changed (committed)

- `crates/contracts/src/lib.rs` — DTO fields, helpers, 3 new tests, existing test literal updated.
- `crates/core/src/mangadex.rs` — primary-provider constructors set `mangadex` / `MangaDex`.
- `web/lib/contracts.ts` — optional TS fields and `sourceLabel` helper.
- `web/scripts/source-contracts.test.mjs` — new TS contract test file.

SDD ledger/brief/report files under `docs/superpowers/sdd/` were left untracked.

## Concerns

- Rust serialization now always emits `source` and `source_label` on manga
  summaries and chapters. This is additive for JSON consumers, but any strict
  schema validator expecting the old exact key set would need updating; none
  exists in this repo.
- TS fields are optional by design, so legacy objects remain assignable.
- `readable` was added only to the TS `ChapterDto` per this brief. Task 3's
  integration expectations (`readable == true` on Comick chapters) will need a
  corresponding Rust field/derivation; that is outside Task 1's scope.
- Comick ID validation (`comick:<opaque-id>`) is not implemented here.
- Web integration tests that need a Next build were not run; this task is a
  contract-only change and the required TS unit test plus typecheck pass.
