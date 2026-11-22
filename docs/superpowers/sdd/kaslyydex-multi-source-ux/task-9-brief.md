### Task 9: Reader theme auto-sync with site theme

**Files:**
- Modify: `crates/domain/src/lib.rs`
- Modify: `crates/contracts/src/lib.rs` if wire DTO tests need updates
- Modify: `web/lib/guest.ts`
- Modify: `web/app/globals.css`
- Modify: `web/components/reader/ReaderClient.tsx`
- Modify: `web/components/reader/ReaderToolbar.tsx`
- Modify: `web/components/account/SettingsForm.tsx`
- Test: `crates/domain/src/lib.rs` inline tests
- Test: `web/scripts/reader-theme.test.mjs`

**Interfaces:**
- Consumes: Task 7 dropdown for background mode selection.
- Produces: Rust `ReaderBackground::Auto` with wire value `auto`.
- Produces: TS `ReaderSettings["bg"] = "auto" | "light" | "sepia" | "dark"`.
- Produces: `DEFAULT_SETTINGS.bg = "auto"`.
- Produces: `.reader[data-bg="auto"]` uses site theme variables.

- [ ] **Step 1: Write failing Rust/TS theme tests**

Rust assertions:
- `ReaderBackground` accepts `auto`, `light`, `sepia`, `dark`.
- Existing wire values still roundtrip.

Create `web/scripts/reader-theme.test.mjs` asserting:
- Unset reader settings normalize to `bg: "auto"`.
- Saved `sepia`/`dark` remain unchanged.
- Reader in `auto` follows site light/dark dataset.
- Switching site theme updates reader colors without reload.
- Manual override persists after reload.

- [ ] **Step 2: Run tests to verify RED**

Run:
- `cargo test -p domain reader_background`
- from `web/`: `node --import tsx --conditions=react-server --test scripts/reader-theme.test.mjs`

Expected: FAIL.

- [ ] **Step 3: Add `auto` to domain and guest settings**

Add `Auto` variant and wire serialization. Update `normalizeSettings` so missing/invalid bg becomes `auto`, while valid manual values persist. Update affected Rust WASM/settings tests if they enumerate backgrounds.

- [ ] **Step 4: Add CSS auto mode and UI option**

Make `.reader[data-bg="auto"]` inherit site variables for background/surface/text/line/accent. Keep manual modes unchanged. Add `Tự động theo giao diện` option to reader settings and account settings dropdown.

- [ ] **Step 5: Run theme and reader regression tests**

Run:
- `cargo test -p domain -p reader-core -p reader-wasm`
- from `web/`: `node --import tsx --conditions=react-server --test scripts/reader-theme.test.mjs scripts/guest-storage.test.mjs`
- from `web/`: `node --test scripts/reader-playwright.test.mjs`
- `npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add crates/domain/src/lib.rs crates/contracts/src/lib.rs web/lib/guest.ts web/app/globals.css web/components/reader/ReaderClient.tsx web/components/reader/ReaderToolbar.tsx web/components/account/SettingsForm.tsx web/scripts/reader-theme.test.mjs
git commit -m "feat: sync reader theme with site by default"
```
