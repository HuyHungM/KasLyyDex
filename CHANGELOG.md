# Changelog

## Unreleased — multi-source reading UX and final local gate

- Read MangaDex as the primary catalog and fall back to Comick **per chapter**
  when a chapter is external-only/unreadable; keep the last external link when
  no match is found or the fallback fails. Chapter IDs are provider-prefixed
  (`comick:`) and progression/XP bind to the chapter source.
- Show `MangaDex`/`Comick` source labels after titles on cards, detail, chapter
  rows and the reader toolbar. Legacy DTOs without `source` still display
  `MangaDex`.
- Add per-source image proxy allowlisting for Comick's CDN, plus
  `COMICK_API_ORIGIN` as a local/test override (default `https://api.comick.dev`).
- Replace native selects with an accessible custom dropdown (Arrow/Home/End/
  Enter/Space/Escape/Tab, disabled options, hidden form input) and add
  shape-matched skeletons with reduced-motion-guarded transitions; failed
  reader images are released from the skeleton gate.
- Default reader theme to `auto` (follows the site theme) with manual
  `light`/`sepia`/`dark` overrides persisted per preference.
- Gate all new suites (`source-contracts`, `source-fallback`, `source-ui`,
  `source-progression`, `select`, `skeleton-motion`, `reader-theme`) through
  `test:source` and `test:aggregate`; pretest hooks build the Axum binary before
  aggregate/browser tests spawn it. CI uses the same ordering.
- Baseline pre-existing whitespace findings in committed prior-plan SDD diff
  artifacts; the gate stays strict for new findings. Run `cargo fmt -p core`
  for the two known `comick.rs` hunks and add `core` to the scoped fmt check.
- Document source fallback, labels, theme, dropdown, skeleton/motion, and the
  release gate in `README.md`, `docs/WEB-STATUS.md` and `infra/axum.md`.

No deployment, provisioning, provider credential use, push or merge was
performed. Live MangaDex/Comick catalog and ToS verification remains a manual
release gate; no live verification is claimed here.

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
