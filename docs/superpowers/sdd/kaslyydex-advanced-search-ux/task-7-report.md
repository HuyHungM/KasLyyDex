# Task 7 report — Full gate, documentation and cleanup

Branch: `feature/kaslyydex-advanced-search-ux` · Base: `d06886764f4e3dcd54058459aadb3f207f9db152` (HEAD before this task)

## What changed

- `web/package.json`: appended `search-contracts.test.mjs`, `search-source.test.mjs`,
  `advanced-search.test.mjs`, `source-badge.test.mjs` and
  `ranking-skeleton.test.mjs` to `test:aggregate`: 28 aggregate test files
  (7 source + 5 new among them). `pretest:aggregate` / `pretest:browser` /
  `pretest:source` Axum prebuild hooks and the seven-suite `test:source` script
  are unchanged.
- `.github/workflows/ci.yml`: moved "Install Playwright Chromium" ahead of the
  aggregate step. Two of the five newly registered suites are Playwright
  tests (`advanced-search`, `ranking-skeleton`); `source-badge` is SSR/Node.
  Aggregate therefore needs a browser binary on runners with no local Edge.
  CI still builds Axum before Node suites and WASM before Next build.
- `README.md`, `CHANGELOG.md`, `docs/WEB-STATUS.md`, `infra/axum.md`: documented
  advanced search filters and source dispatch, `partial` warning, merged genre
  groups and four-group skeleton, removal of Next `/the-loai`, cover source
  badges, `/bxh` loading skeleton and top-3 frames, the new aggregate count and
  CI ordering, and the manual live provider gates / no-deployment stance.

`npm ci` was not rerun: dependencies were already installed in
`web/node_modules` and no Windows file-lock error occurred. No deploy, push,
merge, cloud operation or provisioning was performed.

## Full local gate (all commands and counts)

All `npm` commands ran from `web/`; `git diff --check` ran from the repo root.
Exit codes were captured explicitly with `$LASTEXITCODE` where needed.

| Command | Result |
| --- | --- |
| `npm run build:wasm` | exit 0 — `wasm-release` finished in 0.11s; `wasm asset /wasm/reader_core.3cb2ff76a326cf7c.wasm (150623 bytes)` |
| `npm run build` | exit 0 — `prebuild` rebuilt WASM in 0.09s, TypeScript in 2.6s; `.next/BUILD_ID` generated |
| `npm run test:aggregate` | exit 0 — **tests 203, suites 0, pass 203, fail 0, cancelled 0, skipped 0, todo 0**, duration 51571.8391 ms; `pretest:aggregate` Axum build finished in 0.47s |
| `npm run test:browser` | exit 0 — **tests 23, suites 0, pass 23, fail 0, cancelled 0, skipped 0, todo 0**, duration 28120.8505 ms; `pretest:browser` Axum build passed |
| `cargo build --manifest-path ../Cargo.toml -p server` | exit 0 — `dev` profile finished in 0.25s |
| `cargo test --manifest-path ../Cargo.toml --workspace` | exit 0 — unit binaries 10 + 45 + 2 + 5 + 3 + 11 + 14 = **90 passed / 0 failed**, plus five doc-test binaries at 0 passed / 0 failed |
| `cargo clippy --manifest-path ../Cargo.toml --workspace --all-targets -- -D warnings` | exit 0 — no warnings; first uncached run 55.79s, confirmation run 0.41s |
| `cargo fmt --manifest-path ../Cargo.toml --check -p domain -p contracts -p core -p reader-core -p reader-wasm -p server` | exit 0 — no diff (includes `core`) |
| `npm run check:whitespace` | exit 0 — `314 tracked files inspected, 0 new findings (1130 baselined)` |
| `npm run check:secrets` | exit 0 — `238 tracked text files, 0 candidates` |
| `git diff --check` | exit 0 — no output |
| `npm run typecheck` | exit 0 — `tsc --noEmit` clean |
| `npm run lint` | exit 0 — **0 errors, 7 warnings**, all pre-existing `@next/next/no-img-element` |

`npm run test:aggregate` was executed twice: the first run exited 0 but its
console summary was clipped by the shell transport, so the second run captured
the summary to a temporary log; that log was deleted afterwards. No test was
skipped, suppressed or marked todo to obtain a green gate.

## Concerns

1. CI was reordered but not executed here (no cloud/deploy action allowed).
   The local gate used the Windows Edge binary preferred by
   `web/scripts/browser.mjs`; the CI Linux path via Playwright Chromium was not
   exercised. Parallel Playwright suites inside `test:aggregate` could be
   slower or more timing-sensitive on CI than the standalone browser suites;
   this is unverified remotely.
2. The whitespace gate reports **1130 baselined** findings (783 prior
   `kaslyydex-phase-1-2` + 347 `kaslyydex-multi-source-ux`). Older Task 10
   entries in `README.md` / `docs/WEB-STATUS.md` quote 783 as the then-current
   figure and remain historical. The fix wave corrected the baseline header
   from 783 to 1130 with a prior + current label; no baseline entry was added
   or removed.
3. `docs/superpowers/sdd/kaslyydex-advanced-search-ux/` remains untracked
   scratch as instructed (this report included). The whitespace gate inspects
   tracked files only, so none of those artifacts were flagged. No SDD artifact
   was staged. The controller must decide whether to keep, commit or remove
   them.
4. Live MangaDex/Comick catalog, API-shape and ToS verification, and any
   deployment/push/merge, remain manual gates and are explicitly not claimed
   as done.
5. `lint` still emits seven pre-existing `@next/next/no-img-element` warnings;
   they are unchanged by this task and do not fail the gate.

## Fix wave — documentation corrections

Final review found three important documentation defects and one minor; all
were fixed in tracked files only (plus this untracked scratch report). No
production code, test list, CI step or full gate was changed.

- Corrected the aggregate count in `CHANGELOG.md`, `README.md` (run commands and
  Release gates), `docs/WEB-STATUS.md`, `infra/axum.md` and this report: the
  script registers **28 aggregate test files (7 source + 5 new among them)**,
  not 12. `web/package.json` itself was already correct and is untouched.
- Corrected the browser-suite count: of the five new suites only
  `advanced-search` and `ranking-skeleton` are Playwright; `source-badge` is
  SSR/Node. "Three" is now "two" in all five documents. The CI Chromium reorder
  stays in place.
- Removed the two dangling references to this untracked report from
  `CHANGELOG.md` and `docs/WEB-STATUS.md`; the report remains in SDD scratch
  and is not staged.
- Corrected the `web/scripts/whitespace-baseline.txt` header from `# 783 entries`
  to `# 1130 entries (prior + current baselines)` and labelled both sources:
  prior `kaslyydex-phase-1-2/*.diff` (783) plus current
  `kaslyydex-multi-source-ux/*.diff` (347). No baseline entry was added or
  removed. Historical 783 mentions in tracked docs are about the Task 10
  figure and were left as-is.

Docs-only checks after the fixes (from `web/` unless noted):

| Command | Result |
| --- | --- |
| `npm run check:whitespace` | exit 0 — `314 tracked files inspected, 0 new findings (1130 baselined)` |
| `npm run check:secrets` | exit 0 — `238 tracked text files, 0 candidates` |
| `git diff --check` (repo root) | exit 0 — no output |

Remaining concerns: the CI Chromium path and live provider checks are still
unverified remotely; the 28-file wording is correct but the full aggregate
gate was not rerun for this docs-only fix wave (no test file changed).
