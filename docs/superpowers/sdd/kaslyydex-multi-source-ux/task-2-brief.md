### Task 2: Comick provider adapter and normalization

**Files:**
- Create: `crates/core/src/comick.rs`
- Modify: `crates/core/src/lib.rs`
- Test: `crates/core/src/comick.rs` inline tests

**Interfaces:**
- Consumes: Task 1 source constants/labels.
- Produces: `pub struct Comick` with `pub fn new() -> Self` and `pub fn with_origin(origin: String) -> Self`.
- Produces: `pub async fn search_titles(&self, query: &str) -> Result<Vec<ComickTitle>, Err>`.
- Produces: `pub async fn chapters(&self, hid: &str, lang: &str) -> Result<Vec<ComickChapter>, Err>`.
- Produces: `pub async fn page_urls(&self, chapter_id: &str) -> Result<Vec<String>, Err>`.
- Produces: `pub struct ComickTitle { pub hid: String, pub title: String, pub aliases: Vec<String> }`.
- Produces: `pub struct ComickChapter { pub id: String, pub chapter: Option<String>, pub lang: String, pub title: String, pub publish_at: String, pub group: String }`.
- Produces: `pub fn is_comick_chapter_id(id: &str) -> bool` accepting `comick:` followed by a non-empty opaque ID with no whitespace/control characters.

- [ ] **Step 1: Verify official Comick catalog endpoints**

Read `https://api.comick.dev/docs/` and the catalog explorer/OpenAPI if available. Record the exact public catalog endpoints for search, title chapters, and chapter images in a code comment at the top of `comick.rs`. Do not use OAuth/Library endpoints. If the official catalog cannot be verified, stop this task and report the blocker; do not invent endpoints.

- [ ] **Step 2: Write failing normalization and ID tests**

Add tests:
- `comick_id_requires_prefix_and_nonempty_opaque_id`
- `comick_chapter_normalizes_missing_title_and_language`
- `comick_page_urls_are_https_and_ordered`
- `comick_search_path_encodes_query`

Assertions:
- `is_comick_chapter_id("comick:abc123")` is true.
- `is_comick_chapter_id("abc123")`, `comick:`, `comick:bad id`, and empty string are false.
- Chapter normalization preserves `id`, `chapter`, `lang`, and defaults empty title to `""`.
- Page URL builder preserves provider order and rejects non-HTTPS image URLs.
- Search path builder percent-encodes query text.

- [ ] **Step 3: Run tests to verify RED**

Run: `cargo test -p core comick`
Expected: FAIL because module/functions do not exist.

- [ ] **Step 4: Implement adapter skeleton and pure helpers**

Create `Comick`, `ComickTitle`, `ComickChapter`, ID validation, path builders, and DTO normalization. Use `COMICK_API_ORIGIN` env override for tests, defaulting to the verified official catalog origin. HTTP methods may return `Err("Comick catalog unavailable")` until wired, but pure helpers must pass.

- [ ] **Step 5: Run tests to verify GREEN**

Run: `cargo test -p core comick`
Expected: PASS.

- [ ] **Step 6: Wire HTTP calls using verified endpoints**

Implement `search_titles`, `chapters`, and `page_urls` with bounded timeouts and generic upstream errors. Do not log secrets or raw auth headers. Return empty vectors only for valid empty responses; treat malformed shapes as errors.

- [ ] **Step 7: Run core tests and clippy**

Run:
- `cargo test -p core`
- `cargo clippy -p core --all-targets -- -D warnings`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add crates/core/src/comick.rs crates/core/src/lib.rs
git commit -m "feat: add Comick catalog provider adapter"
```
