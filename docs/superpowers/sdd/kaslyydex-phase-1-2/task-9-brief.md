### Task 9: CI, security, observability and Phase 1–2 release gate

## Execution constraints

- Do not deploy, provision remote DB/auth, merge, push, change billing/security/team settings, or claim live external gates passed. Owner paused Vercel and approved local feature implementation.
- CI must run deterministic local/fixture tests without secrets using actual application migrations on PostgreSQL service or test-only PostgreSQL embedding. Separate real Neon/Google verification as an explicitly configured/manual release check.
- Resolve existing lint failures in active Next components during Task 5 migration, never disable rules or skip failing tests to mark green. If legacy Leptos formatting stays deferred, CI scopes Rust fmt to maintained core/contracts/server/reader-wasm packages and labels legacy exceptions honestly.
- Health/liveness is separate from readiness (configuration/DB/upstream). Public health never returns secrets. Privileged data is private/no-store. Use bounded upstream timeouts; JSON errors don't leak SQL/connection credentials.
- Structured logs redact Cookie, Authorization, tickets, password/email credentials, database URLs and upstream keys. No high-cardinality/user PII metrics. Consider CSP compatibility with Next and image/font sources using current docs.
- For meaningful Vercel Function business operations add compact `metric()` instrumentation using @vercel/functions >=3.9 only if not already instrumented, e.g. kaslyydex.user_requests and kaslyydex.user_request.duration_ms tagged by bounded operation/outcome; skip health/static/pass-through routes. Local runtime is a no-op and deployed ingestion is explicitly unverified. Never enable paid Observability or change project settings automatically. Record names for future operator lookup.
- Record WASM/source and transferred Brotli size, reader startup behavior, no horizontal overflow at 375px, desktop UI screenshots, API error paths, authenticated ownership tests and current external gates.
- Final report must list actual implemented routes/features and tests separately from unverified external dependencies; do not call all of Phase 1–2 complete until live auth/Neon and deployment checks really run.
- No subagents. Full report `docs/superpowers/sdd/kaslyydex-phase-1-2/task-9-report.md`.

**Files:**
- Create: `.github/workflows/ci.yml`, `infra/healthcheck`, `infra/deployment.md`
- Modify: `README.md`, `CHANGELOG.md`, `docs/WEB-STATUS.md`
- Add: security headers, structured logging and health checks in Next/Axum

- [ ] **Step 1: Add CI jobs** for Rust format/clippy/tests, Next lint/typecheck/build, WASM build and Playwright smoke.
- [ ] **Step 2: Add security headers, secret scanning, environment validation and structured request/error logs without tokens/passwords.
- [ ] **Step 3: Add Vercel Preview/Production deployment runbook and Neon migration runbook; include rollback procedure.
- [ ] **Step 4: Run the complete Phase 1–2 gate on a clean checkout; expected all tests/builds pass and Preview smoke passes.
- [ ] **Step 5: Update changelog and documentation with Phase 1–2 scope; commit** `chore: establish KasLyyDex phase release gates`.

