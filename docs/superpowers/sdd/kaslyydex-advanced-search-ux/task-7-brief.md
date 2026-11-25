### Task 7: Full gate, documentation and cleanup

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/WEB-STATUS.md`
- Modify: `infra/axum.md`
- Modify: `web/package.json` if new suites need aggregate registration

**Interfaces:**
- Consumes: all prior tasks.
- Produces: local-only release gate with all new suites included.

- [ ] **Step 1: Register new test suites**

Add `search-contracts`, `search-source`, `advanced-search`, `source-badge`, and `ranking-skeleton` tests to `test:aggregate` where applicable. Keep Axum prebuild ordering.

- [ ] **Step 2: Run full local gate**

Run from `web/`:
- `npm run build:wasm`
- `npm run build`
- `npm run test:aggregate`
- `npm run test:browser`
- `cargo build --manifest-path ../Cargo.toml -p server`
- `cargo test --manifest-path ../Cargo.toml --workspace`
- `cargo clippy --manifest-path ../Cargo.toml --workspace --all-targets -- -D warnings`
- `cargo fmt --manifest-path ../Cargo.toml --check -p domain -p contracts -p core -p reader-core -p reader-wasm -p server`
- `npm run check:whitespace`
- `npm run check:secrets`
- `git diff --check`

Expected: PASS.

- [ ] **Step 3: Update documentation**

Document advanced search filters, source badges on covers, removed `/the-loai`, ranking skeleton/top frames, `partial` warning, and manual live provider gates. No deployment claim.

- [ ] **Step 4: Commit**

```bash
git add web/package.json README.md CHANGELOG.md docs/WEB-STATUS.md infra/axum.md
git commit -m "chore: gate and document advanced search UX"
```
