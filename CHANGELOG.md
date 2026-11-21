# Changelog

## Unreleased — Phase 1–2 local release gates

- Add secret-free GitHub Actions release gate: Rust scoped fmt/clippy/tests,
  Axum build, frozen npm install, typecheck/lint, WASM rebuild before Next build,
  aggregate Node/PGlite/API tests, Playwright browser suites and diff check.
- Add Next/Axum security headers. CSP allows same-origin images and WASM without
  third-party sources; health/readiness separated; readiness is bounded and
  returns only missing env names.
- Add structured JSON request/error logs with correlation ids and redaction,
  plus bounded `kaslyydex.user_requests` / `kaslyydex.user_request.duration_ms`
  metrics on account/auth/community/progression operations only.
- Add CI secret-pattern scan and env validation including `READER_TICKET_SECRET`.
- Document the manual Neon/Google/Vercel release gates, first-deploy-is-production
  caveat, prior Vercel 402 fair-use block and Neon migration/rollback runbook.

No deployment, provisioning, provider credential use, Vercel setting change,
merge or push was performed for this entry. Live external gates remain unverified.
