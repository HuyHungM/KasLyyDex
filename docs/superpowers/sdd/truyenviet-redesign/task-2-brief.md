### Task 2: Core client — filters, statistics, tags, rankings, richer feed

**Files:** Modify `crates/core/src/mangadex.rs`

**Interfaces:**
- Consumes: `Md`, existing `LIST_PARAMS`, `summaries`.
- Produces: `pub fn sort_param(sort: &str) -> Option<&'static str>` (follows→`order[followedCount]=desc`, rating→`order[rating]=desc`, new→`order[latestUploadedChapter]=desc`, year→`order[year]=desc`, title→`order[title]=asc`); `pub fn status_param(s: &str) -> Option<&'static str>`; `pub async fn tags(&self)`, `pub async fn search_filtered(&self, q, page, tags: &[String], status: Option<&str>, sort: &str)`, `pub async fn rank(&self, kind: &str)`, `pub async fn stats(&self, id: &str)`, enriched `latest()` with `chapters` field.

- [ ] **Step 1: Write failing unit tests** in `mangadex.rs`: all 5 sort mappings, 4 statuses, unknown values → `None`; UUID list join produces `includedTags[]=a&includedTags[]=b`.

- [ ] **Step 2:** Run `cargo test -p manga-core`; expect FAIL.

- [ ] **Step 3: Implement.** `tags()`: GET `/manga/tag`, map to `{id,name: pick(name),group}`. `rank()`: GET `/manga?limit=24&<sort>` then one `/statistics/manga?manga[]=…` call, merge `rating.bayesian` + `follows` into each summary (null → omit key). `stats()`: `/statistics/manga/{id}`. Extend `latest()`: while iterating the already-fetched chapter feed, collect up to 3 readable chapters per manga `{id, chapter, publish_at}` and attach to each returned summary. Reuse existing caches with distinct keys.

- [ ] **Step 4:** Run `cargo test -p manga-core`; expect PASS.

- [ ] **Step 5:** Tick task checkbox.

---

