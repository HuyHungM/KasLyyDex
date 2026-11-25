### Task 2: Comick catalog search adapter

**Files:**
- Modify: `crates/core/src/comick.rs`
- Test: `crates/core/src/comick.rs` inline tests

**Interfaces:**
- Consumes: Task 1 `source`/`lang`/`year` values and `MangaSummaryDto`.
- Produces: `pub async fn search(&self, q: &str, lang: &str, year: Option<i32>, page: u32) -> Result<Vec<MangaSummaryDto>, Err>`.
- Produces: `pub fn search_path(q: &str, lang: &str, year: Option<i32>, page: u32) -> Result<String, Err>`.
- Produces: `pub fn normalize_search_hit(hit: &serde_json::Value) -> Result<MangaSummaryDto, Err>`.

- [ ] **Step 1: Verify official catalog search fields**

Read `https://api.comick.dev/docs/json` and record the exact search query names/limits for `q`, language, year and page in a code comment. Do not use OAuth endpoints. If fields differ from the spec, rule in the report and use documented names.

- [ ] **Step 2: Write failing adapter tests**

Add tests:
- `comick_search_path_encodes_filters`
- `comick_search_hit_sets_source_pair`
- `comick_search_hit_rejects_missing_title_or_id`

Assertions:
- `search_path("slime", "vi", Some(2024), 2)` contains encoded query, language, year, page, and only verified params.
- Normalized hit has `source == "comick"` and `source_label == "Comick"`.
- Missing id/title produces `Err` and does not fabricate fields.

- [ ] **Step 3: Run tests to verify RED**

Run: `cargo test -p core comick`
Expected: FAIL because functions do not exist.

- [ ] **Step 4: Implement path builder and normalizer**

Use existing `Comick` HTTP client/timeout/error style. Convert official cover keys to the existing verified CDN URL form. Preserve tags/year/status when present; missing optional fields use existing DTO defaults. Return generic `"Comick catalog unavailable"` on transport/status/shape errors.

- [ ] **Step 5: Implement HTTP `search` method**

Call the verified public catalog endpoint with bounded page size. Do not cache this task; caching belongs to Task 3 aggregation.

- [ ] **Step 6: Run tests and clippy**

Run:
- `cargo test -p core comick`
- `cargo clippy -p core --all-targets -- -D warnings`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add crates/core/src/comick.rs
git commit -m "feat: add Comick catalog search adapter"
```
