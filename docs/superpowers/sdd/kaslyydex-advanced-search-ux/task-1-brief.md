### Task 1: Search query and DTO contract extension

**Files:**
- Modify: `crates/contracts/src/lib.rs`
- Modify: `crates/server/src/main.rs`
- Modify: `web/lib/contracts.ts`
- Test: `crates/contracts/src/lib.rs` inline tests
- Test: `crates/server/src/main.rs` inline tests
- Test: `web/scripts/search-contracts.test.mjs`

**Interfaces:**
- Consumes: existing `parse_search_query` logic in `crates/server/src/main.rs`; move it into `contracts` rather than duplicating it.
- Produces: Rust `SearchResponse.partial: Option<bool>` default `false`.
- Produces: `contracts::SearchQuery` with fields `source: String`, `lang: String`, `year: Option<i32>`, existing `q/page/tags/status/sort`, and public `contracts::parse_search_query(HashMap<String, String>) -> Result<SearchQuery, ApiError>`.
- Produces: `crates/server/src/main.rs` imports and uses `contracts::parse_search_query`; no server-local duplicate remains.
- Produces: TS `SearchParams` fields `source?: string`, `lang?: string`, `year?: number`, plus `partial?: boolean` on `SearchResponse`.
- Produces: `searchQuery(params: SearchParams): string` serializes all new fields; defaults omitted values so legacy URLs are unchanged.

- [ ] **Step 1: Write failing Rust query tests**

Add tests:
- `search_query_defaults_source_all_lang_all`
- `search_query_accepts_valid_source_lang_year`
- `search_query_rejects_invalid_source_lang_year`

Assertions:
- Missing source/lang/year default to `all`, `all`, `None`.
- `source=comick`, `lang=vi`, `year=2024` parse successfully.
- `source=bad`, `lang=fr`, `year=0`, non-numeric year, negative year, and page `0` are rejected.

- [ ] **Step 2: Run Rust tests to verify RED**

Run: `cargo test -p contracts search_query`
Expected: FAIL because fields/partial do not exist.

- [ ] **Step 3: Implement contract and parser changes**

Add `partial` to Rust `SearchResponse` with `#[serde(default)]`. Define `SearchQuery` and `parse_search_query` in `crates/contracts/src/lib.rs`, moving the existing server parser logic and extending it with exact allowlists. Keep existing status/sort/tag validation unchanged. Use `year` only when in a plausible range `1900..=current_year+1` (use `time::OffsetDateTime` if already available via existing deps; otherwise derive from `SystemTime` without a new dependency). Update the server handler to import the contracts parser.

- [ ] **Step 4: Run Rust tests to verify GREEN**

Run: `cargo test -p contracts -p server search`
Expected: PASS.

- [ ] **Step 5: Write failing TS contract test**

Create `web/scripts/search-contracts.test.mjs` asserting:
- `searchQuery({}) === ""`.
- `searchQuery({ source: "comick", lang: "vi", year: 2024 })` contains all three params.
- `searchQuery({ q: "slime", tags: ["a", "b"], status: "ongoing", sort: "rating", page: 2 })` preserves existing serialization.

- [ ] **Step 6: Run TS test to verify RED**

Run from `web/`: `node --import tsx --test scripts/search-contracts.test.mjs`
Expected: FAIL because new params are not serialized.

- [ ] **Step 7: Implement TS contract changes**

Add fields to `SearchParams`, `partial?: boolean` to `SearchResponse`, and new serialization in `searchQuery`. Do not change existing `ContentClient.search` signature shape beyond the extended params.

- [ ] **Step 8: Run TS test and typecheck**

Run from `web/`:
- `node --import tsx --test scripts/search-contracts.test.mjs`
- `npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add crates/contracts/src/lib.rs crates/server/src/main.rs web/lib/contracts.ts web/scripts/search-contracts.test.mjs
git commit -m "feat: extend search contracts with source filters"
```
