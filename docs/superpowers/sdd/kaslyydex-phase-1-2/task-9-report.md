# Task 9 report — CI, security, observability and Phase 1–2 release gate

Worktree: `D:\Code\nodejs\kaslyydex\.worktrees\kaslyydex-phase-1-2`
Branch: `feature/kaslyydex-phase-1-2`
Base: `6a1496f7a18b000bd45436eb792e5a99aa19e516`
Initial implementation commit: `902f77c` (`chore: establish KasLyyDex phase release gates`)
Fix round 1 applied on top of `902f77c`; no cloud/provider writes, deploy, merge or push.

## Fix round 1 — security redaction and honest gates

Important 1 (redaction) and Important 2 (runbook), plus the controller-ruled
cheap gate fixes, were implemented in this round. No Rust source changed.

| Fix-round command | Result |
|---|---|
| `node --import tsx --conditions=react-server --test scripts/observability.test.mjs` (`web/`, RED) | FAIL as expected — 5 tests, 2 pass / 3 fail: opaque Bearer token leaked, repeated/no-colon header token leaked, `logStructured` leaked arbitrary field values. |
| Same command after fix (GREEN, final suite) | PASS — 6/6 tests, 0 skipped. Covers opaque Bearer, multi-value Cookie/Set-Cookie, Proxy/X-Forwarded-Authorization, OAuth `code=`, URL query token, DB URL credentials, repeated headers, no-colon headers, serialized-log defense in depth, valid JSON, and ordinary prose preservation. |
| `node --test scripts/whitespace-check.test.mjs` (`web/`) | PASS — 2/2. The fixture test seeds a tracked trailing-whitespace file, asserts the gate exits 1 with `trailing.txt:1: trailing-whitespace`, then cleans the file and asserts exit 0. |
| `node scripts/whitespace-check.mjs ..` (`web/`) | PASS — 221 tracked files inspected, 0 findings after removing one historical trailing space in `task-5-report.md` (whitespace-only). |
| `node --import tsx --conditions=react-server --test scripts/observability.test.mjs scripts/env-validation.test.mjs scripts/smoke.test.mjs scripts/whitespace-check.test.mjs` (`web/`, focused) | PASS — 14/14 at the time of that focused run; final observability suite then grew to 6 tests and aggregate below is authoritative. |
| `node ../infra/healthcheck 'http://127.0.0.1:9/?token=supersecret123'` (`web/`) | PASS — exit 1, output contained status codes only; supplied URL/token were not echoed. |
| CI YAML sanity (`js-yaml.load` + assertions) | PASS — parsed 19 steps; real whitespace gate and `-p reader-wasm` fmt present. |
| `cargo fmt --check -p domain -p contracts -p reader-core -p reader-wasm -p server` | PASS — no Rust changes, maintained-package scope now includes `reader-wasm`. |
| `npm run build:web`, `npm run typecheck`, `npm run lint` (`web/`) | PASS — build clean; typecheck clean; lint 0 errors / 7 pre-existing warnings. |
| `npm run test:aggregate` (`web/`, final) | PASS — **121/121** tests, 0 skipped, 33.7s. |

Security rationale: the previous key/value regex stopped at the first whitespace
token, so `Authorization: Bearer <opaque>` kept the opaque token, multi-value
cookies kept later `k=v` pairs, forwarded authorization was not covered, and
`logStructured` could serialize arbitrary fields unredacted. The fix redacts the
whole header value for Authorization/Proxy-Authorization/X-Forwarded-Authorization
and whole Cookie/Set-Cookie values, supports `code=`/query secrets and repeated
headers, and applies redaction to the serialized log line as defense in depth.
Generic prose without a credential separator is preserved so error messages stay
diagnostic. No raw headers/bodies are logged; metric labels remain bounded.

Runbook fix: `infra/deployment.md` now has an owner-gated manual Vercel
rollback/promote-previous-successful-deployment step with
`node infra/healthcheck <url>` verification, clearly separate from Neon migration
rollback. No automatic rollback or token handling; first-deploy caveat unchanged.
`infra/healthcheck` no longer echoes the operator-supplied base URL.

## Final local gate status

**PASS — local, deterministic, secret-free.** No deployment, provisioning,
provider credential use, Vercel setting change, merge or push was performed.
Preview/Production, live Neon/Google and real Vercel metric ingestion were not
verified and are not claimed.

Toolchain: Windows local verification with Node `v24.19.0`, npm `11.17.0`,
`rustc 1.100.0`, `cargo 1.100.0`, `rustfmt 1.11.0-stable`, `wasm-bindgen 0.2.130`.
Browser suites used the installed Edge binary discovered by
`web/scripts/browser.mjs`; CI installs Playwright Chromium instead.

## Exact commands and counts

Clean-state preparation (generated-only artifacts removed; none were tracked):

```powershell
Remove-Item -Recurse -Force web\generated\reader-wasm, web\public\wasm, web\.next -ErrorAction SilentlyContinue
```

| Command (directory) | Result |
|---|---|
| `npm ci` (`web/`) | PASS — 439 packages added, 440 audited. 4 moderate advisories reported by npm; `npm audit fix --force` was not run (out of scope, could change dependencies). |
| `node scripts/secret-scan.mjs ..` (`web/`) | PASS — 168 tracked text files scanned, 0 candidates. |
| `cargo fmt --check -p domain -p contracts -p reader-core -p reader-wasm -p server` | PASS. Initial implementation needed `cargo fmt -p server`; fix-round recheck with `reader-wasm` included is clean. Full-workspace fmt remains a documented baseline exception. |
| `cargo clippy --workspace --all-targets -- -D warnings` | PASS — 0 warnings. |
| `cargo test --workspace` | PASS — 50 tests, 0 failed: contracts 4, core 14, domain 1, reader-core 5, reader-wasm 3, server 9, legacy UI 14; doc-tests 0. |
| `cargo build -p server` | PASS. |
| `npm run build:wasm` (`web/`) | PASS — generated `/wasm/reader_core.25cb810c379e858e.wasm`, 150,508 source bytes. Explicitly run before the Next build after generated files were removed. |
| `npm run build:web` (`web/`) | PASS — Next 16.4.6 build, `/api/v1/ready` listed among dynamic routes. |
| `npm run typecheck` (`web/`) | PASS after WASM/Next generated types exist. On a truly empty `.next` this must run after `build:web`; CI ordering was corrected accordingly. |
| `npm run lint` (`web/`) | PASS — 0 errors, 7 pre-existing `@next/next/no-img-element` warnings, none suppressed. |
| `npm run test:aggregate` (`web/`) | Initial implementation PASS 116/116; after fix-round additions final PASS 121/121 tests, 0 skipped, 33.7s. |
| `npm run test:browser` (`web/`) | PASS — 23/23 tests, 0 skipped, 25.2s. |
| `node scripts/whitespace-check.mjs ..` (`web/`) | Replaced vacuous clean-checkout `git diff --check`; final PASS, 221 tracked files inspected, 0 findings. Fixture proof is in the fix-round table above. |

Logs were written outside the repository (`C:\Users\Hungg\AppData\Local\Temp\opencode\task9-final-*.log`)
and are not committed.

## Evidence recorded

- **WASM size**: source 150,508 bytes; local Brotli computation 43,875 bytes
  for asset `reader_core.25cb810c379e858e.wasm`. Generated glue and `.wasm`
  files remain ignored/untracked; only `build:wasm` recreates them.
- **Startup behaviour**: browser tests instantiate the real WASM module and
  assert decoded pages, chapter-local restoration, guest no-XP behaviour and a
  visible retry when the WASM response is corrupt. No fake reader success path.
- **375px**: home suite asserts document/body scroll width is at most viewport
  width + 1px; the reader suite repeats the check on `/read/...`. Desktop and
  mobile screenshots are written to ignored `web/.test-screenshots/`
  (`home-desktop.png`, `home-mobile.png`, `search-desktop.png`,
  `reader-desktop.png`, `reader-mobile.png`, `reader-horizontal-dark.png`,
  plus account/community/progression screenshots).
- **API error paths**: aggregate evidence covers missing auth/content/DB/ticket
  config (structured 503), malformed IDs and traversal (400), generic upstream
  failures (502), cross-origin mutation rejection, forged/expired/mismatched
  tickets, invalid checkpoints and insufficient coverage/elapsed-time failures.
- **Auth ownership evidence**: real SDK session fixtures prove role fields and
  client input grant nothing; comments, library/progress, notifications and
  completions are scoped to the authenticated identity; completion/EXP is
  transactional and idempotent.
- **Security/observability**: Next/Axum CSP permits same-origin images and
  `'wasm-unsafe-eval'` with no third-party source; health is credential-free
  liveness, readiness is bounded and returns only env names/status. After fix
  round 1, structured JSON logs carry correlation IDs and redact whole
  Authorization/Proxy-Authorization/X-Forwarded-Authorization and Cookie/
  Set-Cookie values, OAuth `code=`/query secrets, DB URL credentials, JWTs,
  emails and repeated headers; the serialized log line is redacted as defense
  in depth. No raw headers/bodies are logged. `metric()` is a local no-op with
  bounded `operation`/`outcome` labels on auth/account/community/progression only.

## Implemented in this task

- Added `.github/workflows/ci.yml`: one secret-free gate job with secret scan,
  scoped Rust fmt, workspace clippy/tests, Axum build, frozen npm install,
  explicit WASM rebuild before Next build, typecheck/lint, aggregate tests,
  Playwright install and browser suites, and whitespace check.
- Added Next security headers, separate `/api/v1/ready`, Axum security headers,
  health/readiness, correlation-id request logging, normalized log paths and
  generic upstream errors.
- Added `web/lib/observability.ts`, `lib/health.ts`, `infra/healthcheck`,
  secret-pattern scan/env validation tests, tracked-file whitespace gate and
  browser executable discovery. Fix round 1 hardened whole-value redaction and
  removed URL echo from `infra/healthcheck`.
- Added `@vercel/functions@^3.11.3` solely for `metric()`; operators can query
  `kaslyydex.user_requests` and `kaslyydex.user_request.duration_ms`.
- Updated `README.md`, `CHANGELOG.md`, `docs/WEB-STATUS.md`, `infra/README.md`,
  `infra/vercel.md`, `infra/axum.md`, and added `infra/deployment.md`.

## Implemented routes/features vs external dependencies

Implemented and locally verified: public content proxy and image paths, auth
configuration fail-closed routes, account/library/progress/settings/import,
comments/reports/moderation/notifications, reader-session/checkpoint/complete
progression, WASM reader, security headers, health/readiness, structured logs,
bounded metrics and release-gate documentation.

Unverified external dependencies: Neon Managed Auth enablement, Google provider
configuration and real sign-in/JWKS, live Neon migrations and browser-to-Neon
SQL, live MangaDex behaviour, Vercel project/team/first-deploy target, any
Preview or Production deployment/domain/env wiring, and Vercel metric ingestion.
The prior Vercel team `402 resource_creation_blocked` fair-use block remains
unresolved; the first deployment of a new Vercel project is always Production.
No Preview or Production smoke was run or claimed.

## Deferred final-review items (not fixed or claimed here)

- Full-workspace Rust `fmt --check` baseline debt in legacy Leptos/UI files.
- Secret scan uses a tracked-text extension allowlist; it is not a binary or
  generated-artifact scanner.
- Vercel first-deploy/external gates, team access and the 402 fair-use block.
- Task 5's uncommitted generated-WASM/CI rebuild requirement is now covered by
  CI and the clean-state gate above; generated files are still not committed.
- Task 6: stale-paint/loading, discarded GET, unordered PUT, forwarded-host
  trust, import truncation without skipped count, and AuthPanel copy.
- Task 7: 500-reply cap without pagination, rejected self/duplicate reports not
  consuming quota, persistent partial notification cohort, and tie replay
  one-off behaviour.
- Task 8: 1ms `lastReadAt` drift on idempotent completion, missing FK from
  `reading_completions.reader_session_id`, and concurrent PUT/completion race.

These are honest final-review items; none were silently changed by Task 9.
