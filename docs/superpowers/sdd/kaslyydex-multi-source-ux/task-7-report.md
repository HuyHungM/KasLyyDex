# Task 7 report — shared accessible dropdown

## Outcome

Implemented and verified. Native selects replaced in reader toolbar/settings, account settings, moderation queue and search GET filters with one shared `Select` client component.

## RED

`node --test scripts/select.test.mjs` (before component existed):

- tests 6, pass 0, fail 6
- Every failure was `Could not resolve "./components/ui/Select.tsx"` from the test harness bundle.

## GREEN

`node --test scripts/select.test.mjs` (after implementation):

- tests 7, pass 7, fail 0
- Added one more regression case after finding a wrap-in-`<label>` reopen bug during the account suite; the final GREEN run is 7/7.

Cases: click opens / Escape closes, arrow keys skip disabled options and Enter selects, outside click closes, hidden input updates with `name`, option click inside a wrapping `<label>` stays closed, disabled select cannot open, search GET form submits `status`/`sort` with `q` preserved.

## Affected browser suites

- `node --test scripts/account-playwright.test.mjs` — 3 tests, 3 pass, 0 fail.
- `node --test scripts/reader-playwright.test.mjs` — 9 tests, 9 pass, 0 fail.
- `node --test scripts/reader-sync-playwright.test.mjs scripts/community-playwright.test.mjs scripts/progression-playwright.test.mjs` — 11 tests, 11 pass, 0 fail (includes the moderation queue; no selectOption remained).

## Static checks

- `npx tsc --noEmit` — clean.
- `npm run lint` — 0 errors; 7 pre-existing `@next/next/no-img-element` warnings in unrelated files.
- `npm run build` — succeeded (next 16.4.6).
- `npm run check:secrets` — clean.
- `npm run check:whitespace` — one pre-existing SDD scratch diff (`kaslyydex-phase-1-2/final-review.diff`) has 56 trailing-whitespace matches; no task file flagged.

## Notable fix

`Select` options call `preventDefault()` + `stopPropagation()` on click. Without it, a wrapping `<label>` (account settings, moderation, reader settings, search filters) forwards the option click back to the combobox button and reopens the list. Covered by the labelled-harness test.

## Concerns

- The isolated behavior tests bundle the real component with esbuild and mount it in a blank page; they do not use Next hydration. The four browser suites cover the hydrated app paths.
- The search submission test starts `next start` against the current `.next` build, so it requires a build beforehand (same as the other Playwright suites here).
- No auth/db/deploy/push/merge changes; XP/progression logic and source labels untouched.

## Fix round 1 (reduced motion + keyboard coverage)

Controller finding: `web/app/globals.css` had `.select-chevron { transition: transform .12s ease; }` outside the `prefers-reduced-motion: no-preference` guard. Moved only the transition into the existing guard; the static rotated state and all dropdown behavior are unchanged.

Test gap closed in `web/scripts/select.test.mjs`: Space opens and selects, Home/End move the active option and Enter commits, Home/End never activate disabled endpoint options, and a computed-style check asserts `transition-duration: 0s` under `reducedMotion: "reduce"` and `0.12s` under `no-preference`.

RED (before CSS fix), from `web/`:
- `node --test scripts/select.test.mjs` — tests 11, pass 10, fail 1. Sole failure: `chevron transition is disabled under reduced motion`, actual `0.12s` vs expected `0s`. The three new keyboard tests already passed, closing the coverage gap.

GREEN (after CSS fix), from `web/`:
- `node --test scripts/select.test.mjs` — tests 11, pass 11, fail 0.
- `npm run build` — succeeded.
- `npx tsc --noEmit` — clean.
- `npm run lint` — 0 errors, 7 pre-existing `@next/next/no-img-element` warnings.
- `node --test scripts/account-playwright.test.mjs scripts/reader-playwright.test.mjs scripts/community-playwright.test.mjs` — tests 18, pass 18, fail 0.

Commit: `fix: keep dropdown chevron transition under reduced-motion guard` (only `web/app/globals.css` and `web/scripts/select.test.mjs`; this report stays untracked SDD scratch).
