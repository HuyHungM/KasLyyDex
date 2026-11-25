# Task 10 report — regression gate, documentation, and release notes

Worktree: `C:\Users\Hungg\.local\share\opencode\worktree\d7572a\kaslyydex-multi-source-ux`
Branch: `feature/kaslyydex-multi-source-ux`
BASE: `1c4524b38c70d3351d7989628ff5b6f807cff0da` (Task 9)
Scope: local deterministic gate + docs only. No deploy, push, merge, cloud
provisioning, or provider credential use.

## Files changed

| File | Change |
|---|---|
| `web/package.json` | 7 new suites in `test:aggregate`; new `test:source`; `pretest:aggregate`/`pretest:browser`/`pretest:source` build Axum first; `check:whitespace` uses the baseline. |
| `web/scripts/whitespace-check.mjs` | Optional `--baseline <file>`: matching findings are reported as baselined, new findings still fail; legacy output preserved. |
| `web/scripts/whitespace-check.test.mjs` | New regression test proving baseline tolerates listed findings and still fails new ones. |
| `web/scripts/whitespace-baseline.txt` | 783 committed pre-existing findings (`file:line:rule`), all in prior-plan SDD diff artifacts. |
| `.github/workflows/ci.yml` | Whitespace step uses `npm run check:whitespace` with baseline; scoped fmt adds `-p core`; comments record both rulings. |
| `crates/core/src/comick.rs` | `cargo fmt -p core` fixed exactly the two known rustfmt hunks (~119, ~159). |
| `crates/domain/src/lib.rs` | One rustfmt hunk in the Task 9 wire-conversion test, required by the brief's scoped fmt (`domain` was already in CI scope). |
| `README.md` | Source fallback, source labels, `COMICK_API_ORIGIN`, reader theme auto/manual, custom dropdown keyboard, skeletons/motion, gate ordering and baseline, manual gates, no deployment. |
| `CHANGELOG.md` | Unreleased entry covering tasks 1–10 and explicit non-verification statement. |
| `docs/WEB-STATUS.md` | Task 10 section: verified local results and remaining manual release gates. |
| `infra/axum.md` | Multi-source fallback/labels/allowlist, gate notes, fmt and whitespace rulings. |

## Gate ordering fix

Existing aggregate and browser suites (`content-proxy`, `notification-feed`,
`source-fallback`, three Playwright suites) spawn `target/debug/server.exe`.
The brief listed `cargo build -p server` after the Node suites; that makes a
clean checkout fail with "build Axum first" false REDs (recorded in the SDD
ledger baseline). Fixed in two places:

1. `web/package.json`: `pretest:aggregate`, `pretest:browser`, and
   `pretest:source` all run `cargo build --manifest-path ../Cargo.toml -p server`.
   `npm run test:aggregate` / `test:browser` / `test:source` are now safe to run
   directly from `web/`.
2. `.github/workflows/ci.yml` already builds Axum before the Node steps; kept
   that ordering and noted it.

The full local gate below was executed in Axum-first order. No test was skipped,
silenced, or xfail-marked.

## Whitespace baseline ruling

The tracked-file whitespace check found **783** findings at this BASE, all in
committed `docs/superpowers/sdd/kaslyydex-phase-1-2/*.diff` artifacts of the
previous plan (17 files; handoff noted 526 — the measured count on this
checkout is 783). Editing those committed review artifacts would rewrite
prior-plan history, so the gate is baselined instead:

- `web/scripts/whitespace-baseline.txt` lists the exact `file:line:rule` keys.
- `node scripts/whitespace-check.mjs --baseline <file> <repo>` ignores only
  exact matches; a changed/added line at a different number fails the gate.
- `npm run check:whitespace` and CI use the baseline. Result:
  `264 tracked files inspected, 0 new findings (783 baselined)`.
- New test in `whitespace-check.test.mjs` proves both sides: a new finding is
  RED even when the old one is baselined; with both listed it is GREEN.

## Rust fmt ruling

`cargo fmt -p core` touched only `crates/core/src/comick.rs` (2 hunks), exactly
the known Task 2 debt; `core` was added to the scoped `cargo fmt --check` set
so the fix is enforced. A Task 9 test in `crates/domain/src/lib.rs` was also
unformatted and would fail the brief's existing `domain` fmt scope, so one
rustfmt hunk was applied there. Full-workspace fmt remains out of scope
(older Leptos debt) and is documented as such in `README.md`/`infra/axum.md`.

## Exact commands and results (all PASS)

Executed from `web/` unless marked root; Axum build first:

1. root `cargo build -p server` → `Finished dev profile in 13.42s`.
2. `npm ci` → completed (npm logged expected `allow-scripts` approval warnings).
3. `npm run build:wasm` → `wasm asset /wasm/reader_core.3cb2ff76a326cf7c.wasm (150623 bytes)`.
4. `npm run build` → Next build completed; all routes compiled.
5. `npm run test:aggregate` → **175/175 pass, 0 fail** (23 suite files: 16 prior + 7 new: `source-contracts`, `source-fallback`, `source-ui`, `source-progression`, `select`, `skeleton-motion`, `reader-theme`); 45.2s.
6. `npm run test:browser` → **23/23 pass, 0 fail**; 26.5s.
7. root `cargo test --workspace` → **67 passed, 0 failed** across 12 test groups.
8. root `cargo clippy --workspace --all-targets -- -D warnings` → clean.
9. root `cargo fmt --check -p domain -p contracts -p reader-core -p reader-wasm -p server -p core` → clean.
10. `npm run check:whitespace` → 264 tracked files, 0 new findings, 783 baselined.
11. `npm run check:secrets` → 204 tracked text files, 0 candidates.
12. root `git diff --check` → clean (only CRLF normalization warnings from `core.autocrlf=true`).
13. Extra CI parity: `npm run typecheck` clean; `npm run lint` 0 errors, 7 pre-existing `<img>` warnings.

`npm run test:source` was exercised through `pretest:source` and the same seven
suites pass as part of `test:aggregate`; no separate duplicate run was needed.

## Documentation written

- `README.md`: MangaDex primary + per-chapter Comick fallback (external/unreadable
  chapters only, original link kept on no match/error), `MangaDex`/`Comick`
  labels after titles, `comick:` IDs, source-bound progress/XP,
  `COMICK_API_ORIGIN` test override, reader theme `auto` default and manual
  `light`/`sepia`/`dark`, dropdown keyboard behavior, shape skeletons and
  reduced-motion guard, gate order, baseline and scoped fmt, manual gates.
- `CHANGELOG.md`, `docs/WEB-STATUS.md`, `infra/axum.md`: same behavior plus
  local verification counts and explicit no-deployment statement.
- No doc claims live MangaDex/Comick verification or successful deployment.

## Remaining manual release gates

- Live Comick catalog endpoints (`/v1.0/search/`, `/v1.0/comic/{hid}/chapters`,
  `/chapter/{hid}/get_images`) and CDN host behavior, plus provider ToS review.
  Task 2 observed a 403 on a live chapter/image request; fixtures cover wiring
  offline, not live availability.
- Live MangaDex catalog/proxy behavior against the real service.
- Neon/Google/Vercel configuration and deployment, first-deploy-is-production
  caveat, prior 402 fair-use block, migrations/rollback (`infra/deployment.md`).
- Real-browser hydration assertions for source labels and dropdown behavior
  beyond the current SSR/isolated + Playwright coverage are future work; no
  deployment or external verification was performed in this task.
