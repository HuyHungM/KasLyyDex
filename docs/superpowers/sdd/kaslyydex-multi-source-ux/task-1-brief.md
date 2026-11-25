### Task 1: Additive source metadata contracts

**Files:**
- Modify: `crates/contracts/src/lib.rs`
- Modify: `web/lib/contracts.ts`
- Test: `crates/contracts/src/lib.rs` inline tests
- Test: `web/scripts/source-contracts.test.mjs`

**Interfaces:**
- Produces: Rust DTO fields `source: String`, `source_label: String` on `MangaSummaryDto` and `ChapterDto`, defaulted to `mangadex`/`MangaDex` when omitted.
- Produces: Rust helper `pub fn source_label(source: &str) -> &'static str`.
- Produces: TS optional fields `source?: string`, `source_label?: string`, `readable?: boolean` on `MangaSummaryDto`/`ChapterDto`.
- Produces: TS helper `sourceLabel(source?: string): string` returning `Comick` for `comick`, otherwise `MangaDex`.

- [ ] **Step 1: Write failing Rust contract tests**

Add tests named:
- `manga_summary_defaults_source_to_mangadex`
- `chapter_defaults_source_to_mangadex`
- `source_label_maps_known_sources`

Assertions:
- Legacy JSON without `source` deserializes with `source == "mangadex"` and `source_label == "MangaDex"`.
- Explicit `source == "comick"` can deserialize and `source_label("comick") == "Comick"`.
- Unknown source label falls back to `MangaDex`.

- [ ] **Step 2: Run Rust tests to verify RED**

Run: `cargo test -p contracts source`
Expected: FAIL because fields/helper do not exist.

- [ ] **Step 3: Add defaulted Rust fields and helper**

In `MangaSummaryDto` and `ChapterDto`, add:

```rust
#[serde(default = "default_source")]
pub source: String,
#[serde(default = "default_source_label")]
pub source_label: String,
```

Add `default_source() -> String` returning `"mangadex"`, `default_source_label() -> String` returning `"MangaDex"`, and `source_label(source: &str) -> &'static str`.

Update existing Rust constructors/tests that build these DTOs literally to include the new fields or use `..Default::default()` only if a `Default` impl already exists; otherwise set fields explicitly.

- [ ] **Step 4: Run Rust tests to verify GREEN**

Run: `cargo test -p contracts`
Expected: PASS.

- [ ] **Step 5: Write failing TS contract test**

Create `web/scripts/source-contracts.test.mjs` asserting:
- `sourceLabel()` returns `MangaDex`.
- `sourceLabel("comick")` returns `Comick`.
- `sourceLabel("unknown")` returns `MangaDex`.
- A legacy `ChapterDto` object without source fields is still assignable/usable by existing helper code.

- [ ] **Step 6: Run TS test to verify RED**

Run from `web/`: `node --import tsx --test scripts/source-contracts.test.mjs`
Expected: FAIL because `sourceLabel` is absent.

- [ ] **Step 7: Add TS optional fields and helper**

Add optional fields to `MangaSummaryDto` and `ChapterDto`. Add `readable?: boolean` to `ChapterDto`. Export `sourceLabel(source?: string): string`.

- [ ] **Step 8: Run TS test and typecheck**

Run from `web/`:
- `node --import tsx --test scripts/source-contracts.test.mjs`
- `npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add crates/contracts/src/lib.rs web/lib/contracts.ts web/scripts/source-contracts.test.mjs
git commit -m "feat: add source metadata to content contracts"
```
