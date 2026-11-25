### Task 2: Typed contracts and Rust core crates

**Files:**
- Create: `crates/domain/Cargo.toml`, `crates/domain/src/lib.rs`
- Create: `crates/contracts/Cargo.toml`, `crates/contracts/src/lib.rs`
- Create: `crates/reader-core/Cargo.toml`, `crates/reader-core/src/lib.rs`
- Create: `crates/reader-core/src/tests.rs`
- Modify: workspace `Cargo.toml`
- Modify: `crates/server/src/main.rs`, `crates/core/src/mangadex.rs`

**Interfaces:**
- Produces `ReaderState`, `ReaderMode`, `ReaderBackground`, `ReaderSettings`, `ReadingProgress`, `ApiError`, `MangaSummaryDto`, `ChapterDto`, `PagesResponse`.
- `ReaderState::set_page`, `next_page`, `previous_page`, `progress_percent`, `can_next`, `can_previous`.

- [ ] **Step 1: Write failing Rust tests** for page boundaries, 80% progress, horizontal/vertical settings and invalid page counts.
- [ ] **Step 2: Run `cargo test -p reader-core`; expected RED because the crate/types do not exist.
- [ ] **Step 3: Implement the pure crates with no browser/UI/network dependencies.** Keep serialization stable and errors structured.
- [ ] **Step 4: Refactor server-facing public response types toward `contracts`; preserve existing API output fields as additive changes.
- [ ] **Step 5: Run `cargo test --workspace`, `cargo clippy --workspace --all-targets -- -D warnings`, and `cargo fmt --check`; expected GREEN.
- [ ] **Step 6: Commit** `feat: add portable Rust domain and reader core`.

---

