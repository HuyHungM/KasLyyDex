# Changelog

## Unreleased — advanced search UX and final local gate

- Extend `SearchParams`/`searchQuery` with `source`, `lang` and `year`; add
  `partial: bool` to `SearchResponse` and move query parsing into `contracts` so
  Axum and the web share the same allowlists and page clamp.
- Add a Comick catalog search adapter and Axum `search_all` orchestration.
  `source=all` queries both providers, keeps same-title hits from different
  providers distinct, sorts deterministically (`sort`, source, title, id) and
  slices to 24 per page. A locally-applied `lang`/`year` filter or a failing
  provider sets `partial`, surfaced as a short warning in the UI; a missing
  Comick adapter returns a structured 503.
- Move genre groups into the `/search` ("Khám phá") advanced panel with a
  four-group skeleton and write selected chips into `tags`. Remove the Next
  `/the-loai` page and its navigation link.
- Render source as a cover badge (`MangaDex`/`Comick`, accessible
  `Nguồn: <label>`) on cards, feed, ranking and detail covers; drop the
  `(MangaDex)`/`(Comick)` title suffixes.
- Add a shape-matched `/bxh` loading shell (12 rows) and `rank-top rank-1/2/3`
  frames for the top three rows, stable across tab changes and mobile widths.
- Register `search-contracts`, `search-source`, `advanced-search`,
  `source-badge` and `ranking-skeleton` in `test:aggregate` (12 suites total).
  CI installs Playwright Chromium before aggregate because three of the added
  suites are browser tests; the Axum prebuild hooks are unchanged.
- Run the full deterministic local gate: aggregate 203/203, browser 23/23,
  Rust workspace tests 90 passed/0 failed, build/clippy/scoped fmt/typecheck/
  lint/whitespace/secrets/diff clean. Exact commands and counts are in
  `docs/superpowers/sdd/kaslyydex-advanced-search-ux/task-7-report.md`.

No deployment, push, merge, provisioning or live provider verification was
performed. Live MangaDex/Comick catalog and ToS checks remain manual gates.

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
