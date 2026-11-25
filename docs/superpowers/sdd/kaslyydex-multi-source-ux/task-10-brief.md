### Task 10: Regression gate, documentation, and release notes

**Files:**
- Modify: `web/package.json`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/WEB-STATUS.md`
- Modify: `infra/axum.md`
- Test: existing aggregate/browser/Rust suites

**Interfaces:**
- Consumes: all previous tasks.
- Produces: `npm run test:source` or extended aggregate script covering new source/fallback/dropdown/theme/skeleton tests.
- Produces: documentation for source fallback, Comick adapter limits, source labels, reader theme auto, and custom dropdown behavior.

- [ ] **Step 1: Add new tests to aggregate scripts**

Update `web/package.json` so aggregate tests include:
- `source-contracts.test.mjs`
- `source-fallback.test.mjs`
- `source-ui.test.mjs`
- `source-progression.test.mjs`
- `select.test.mjs`
- `skeleton-motion.test.mjs`
- `reader-theme.test.mjs`

Keep existing tests included. Do not skip or silence failing tests.

- [ ] **Step 2: Run full local gate**

Run from `web/`:
- `npm ci`
- `npm run build:wasm`
- `npm run build`
- `npm run test:aggregate`
- `npm run test:browser`

Run from repo root:
- `cargo build -p server`
- `cargo test --workspace`
- `cargo clippy --workspace --all-targets -- -D warnings`
- `cargo fmt --check -p domain -p contracts -p reader-core -p reader-wasm -p server`
- `git diff --check`

Expected: PASS. If Comick live catalog is unavailable, fixture tests still pass and docs mark live verification pending.

- [ ] **Step 3: Update documentation**

Document:
- MangaDex primary, Comick fallback per chapter.
- Source label examples.
- `COMICK_API_ORIGIN` test override if added.
- Reader theme `auto` default and manual overrides.
- Custom dropdown keyboard behavior.
- Live provider/ToS verification remains a manual release gate.
- No deployment was performed.

- [ ] **Step 4: Commit**

```bash
git add web/package.json README.md CHANGELOG.md docs/WEB-STATUS.md infra/axum.md
git commit -m "chore: gate and document multi-source reading UX"
```
