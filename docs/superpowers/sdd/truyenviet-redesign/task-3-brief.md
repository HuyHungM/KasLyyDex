### Task 3: Server routes and validation

**Files:** Modify `crates/server/src/main.rs`

**Interfaces:**
- Consumes: `Md` methods from Task 2.
- Produces: routes `/api/tags`, `/api/rank`, `/api/search` (extended), `/api/latest` (enriched), `/api/manga/{id}` (with stats).

- [ ] **Step 1: Write failing tests** for a pure `parse_search_query(HashMap<String,String>) -> Result<SearchQuery, (StatusCode,String)>`: valid sort/status/8 tags parse; `sort=bogus`, `status=bogus`, 9 tags, malformed UUID → `Err` with 400; empty q allowed.

- [ ] **Step 2:** Run `cargo test -p server --release`; expect FAIL.

- [ ] **Step 3: Implement** `parse_search_query` and handlers. `/api/tags` max-age=86400; `/api/rank` max-age=300; manga still 300/whatever existing; invalid `kind` → 400. Preserve existing cache policy function untouched.

- [ ] **Step 4:** Run `cargo test -p server --release`; expect PASS. Verify with curl: `/api/tags` 200, `/api/rank?kind=follows` 200 with 24 items and rating fields, `/api/search?sort=bogus` 400, `/api/latest` items have `chapters`.

- [ ] **Step 5:** Tick task checkbox.

---

