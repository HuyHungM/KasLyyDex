# Task 9 report — reader theme auto-sync with site theme

## Result

GREEN. `ReaderBackground` gained `Auto` (wire `auto`, now the default), TS `bg` accepts
`"auto"`, `DEFAULT_SETTINGS.bg = "auto"`, and `.reader[data-bg="auto"]` follows the site
light/dark dataset. Manual `light`/`sepia`/`dark` overrides still work and persist.

## RED (before implementation)

- `cargo test -p domain reader_background`: FAIL — compile error, `ReaderBackground::Auto`
  did not exist (2 errors, 0 tests run).
- `node --import tsx --conditions=react-server --test scripts/reader-theme.test.mjs`:
  FAIL — 6 tests: 1 pass / 5 fail (auto normalize, manual persistence with auto,
  validator boundary, auto follows site dataset, live site-theme repaint).

## GREEN (after implementation)

- `cargo test -p domain -p reader-core -p reader-wasm`: 10 pass / 0 fail
  (domain 2, reader-core 5, reader-wasm 3).
- `node --import tsx --conditions=react-server --test scripts/reader-theme.test.mjs scripts/guest-storage.test.mjs`:
  11 pass / 0 fail (6 theme + 5 guest-storage).
- `node --test scripts/reader-playwright.test.mjs` (after `npm run build` + `cargo build -p server`):
  9 pass / 0 fail.
- Focused account/whitespace suites (`account.test.mjs`, `whitespace-check.test.mjs`): 18 pass / 0 fail.
- `npx tsc --noEmit`: clean. `npm run lint`: clean.

## Changes

- `crates/domain/src/lib.rs`: `ReaderBackground::Auto` variant, `#[default]`, `as_str` →
  `"auto"`; `ReaderSettings::default().bg = Auto`; new inline test
  `reader_background_accepts_auto_and_roundtrips_wire_values`.
- `crates/reader-wasm/src/lib.rs`: `parse_background` accepts `"auto"`; test asserts auto
  set + reject of unknown; default settings literal now `"bg":"auto"`.
- `crates/reader-core/src/tests.rs`: default wire literals now `"bg":"auto"`; asserts
  `Auto.as_str() == "auto"`.
- `web/lib/guest.ts`: `ReaderSettings["bg"]` adds `"auto"`; `DEFAULT_SETTINGS.bg = "auto"`;
  `normalizeSettings` keeps `auto/light/sepia/dark`, anything else → `auto`.
- `web/lib/validators.ts`: DTO union + `DEFAULT_READER_SETTINGS.bg = "auto"`;
  `parseSettingsInput` accepts `auto` (needed so account sync accepts the new default).
- `web/lib/me/service.ts`: no-row settings fallback returns `bg: "auto"`.
- `web/app/globals.css`: base `.reader` no longer hardcodes a light palette; `auto` maps
  `--reader-bg: var(--bg)` and inherits surface/text/line/accent/... from the site root;
  `light`/`sepia` now carry their full palettes (same visual values as before), `dark`
  unchanged.
- `web/components/reader/ReaderClient.tsx`: initial settings state from `getSettings()`
  so a persisted manual override renders on first paint (no auto flash).
- `web/components/reader/ReaderToolbar.tsx`, `web/components/account/SettingsForm.tsx`:
  shared `Select` gains `Tự động theo giao diện` (`auto`) as the first option.
- `web/scripts/reader-theme.test.mjs` (new): guest normalization, validator boundary, and
  real-browser cascade checks (headless Chromium over the extracted theme CSS, no app
  server): auto follows site dataset, live site-theme switch repaints without reload,
  manual dark ignores site theme and persists across reload.

## Concerns

- `crates/ui` (legacy Leptos app) still treats `bg` as `light|sepia|dark` and would discard
  a stored `auto`; left untouched per scope (web reader only). Its storage default remains
  `light`.
- DB column default for `readerPreferences.bg` is still `'light'`; new accounts get `auto`
  via the service fallback, and every write sends an explicit value, so no migration was
  made (no-deploy constraint).
- No WASM state-machine, progress, XP, or auth logic changed; only the background enum,
  its wire parse, and literals/tests referencing it.
