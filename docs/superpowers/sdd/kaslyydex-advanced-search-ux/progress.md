# SDD ledger — plan: docs/superpowers/plans/2026-11-22-kaslyydex-ranking-skeleton-advanced-search-source-badges.md

Worktree: `C:\Users\Hungg\.local\share\opencode\worktree\067788\kaslyydex-advanced-search-ux` on branch `feature/kaslyydex-advanced-search-ux`.
Base commit: `bd9b8308d88981cade639b07e85a61ab26ae53dd`.
Spec: `docs/superpowers/specs/2026-11-22-kaslyydex-ranking-skeleton-advanced-search-and-source-badges-design.md`.
Owner-selected subagent model: `9router/opencode`.
SDD scripts unreliable on Windows linked worktrees; ledger/briefs/reports maintained manually here.

## Task status

- [ ] Task 1: Search query and DTO contract extension
- [ ] Task 2: Comick catalog search adapter
- [ ] Task 3: Axum multi-source search orchestration
- [ ] Task 4: Advanced Search UI and merged genre groups
- [ ] Task 5: Source badge on cover images
- [ ] Task 6: Ranking skeleton and top-3 frames
- [ ] Task 7: Full gate, documentation and cleanup

## Preflight conflict scan

| Tasks | Shared interface/files | Finding | Ruling |
|---|---|---|---|
| 1 ↔ 3 | `SearchQuery`/`parse_search_query` | Must be shared in `contracts`, not duplicated in server. | Ruling: move parser to `contracts`; server imports it. Cost if wrong: duplicate validation. |
| 1 ↔ 4 | TS `SearchParams`/`searchQuery` | Web query must match Rust keys. | No conflict if exact names `source/lang/year/page`. |
| 2 ↔ 3 | Comick search adapter | Task 3 consumes Task 2 functions. | No conflict; Task 2 owns stable names. |
| 3 ↔ 4 | `SearchResponse.partial` | Task 4 renders partial warning. | No conflict; default false. |
| 4 ↔ 6 | `/search`, `/bxh`, skeletons, CSS | Both touch CSS and catalog pages. | Ruling: Task 4 owns search route/genre groups; Task 6 owns `/bxh` skeleton/top frames. Cost if wrong: CSS merge fix. |
| 5 ↔ 4/6 | source badge vs title suffix | Task 5 removes title suffix after badges exist. | Ruling: Task 5 after Task 4/6 know surfaces; update source-ui tests in Task 5. Cost if wrong: tests updated in same task. |
| 7 ↔ all | aggregate scripts/docs | Task 7 includes new suites. | No conflict; do not skip tests. |

## Execution rulings

- Ruling: use `9router/opencode` for subagents per owner preference. Cost if wrong: possible quota/rate limit; controller may pause/resume.
- Ruling: no deploy/push/merge/cloud; local fixtures only; live Comick/MangaDex remain manual gates. Cost if wrong: follow-up after release.

## Baseline

- PASS: 175/175 aggregate, 23/23 browser, 67 Rust tests, Axum build-first ordering works in this worktree.
- Task 1 BASE: `bd9b8308d88981cade639b07e85a61ab26ae53dd`.
- Task 1: implementation commit f24593be31d02dcdce3a881472160af131ebd34d; RED Rust compile + TS 1/3 fail, GREEN contracts/server/core47/47, TS3/3, tsc clean. Moved parser to contracts, added partial/source/lang/year.
- Task 1: complete (commits bd9b830..f24593b, review clean). Minor deferred: Option<bool> partial deserializes absent to None (use false at consumers), mirrored allowlists can drift, current_year approximation, upper year bound untested.
- Task 2 BASE: f24593be31d02dcdce3a881472160af131ebd34d.
- Task 2: implementation commit bd26b2d23599e43f0aa1629502e748b04120decc; RED compile 4 errors, GREEN comick9/9, core30/30, clippy clean. Official search uses q/page/limit/from/to (no lang); normalized hits set source pair.
- Task 2: review Needs fixes, 1 Critical (bare Comick HID not provider-prefixed, unopenable), 2 Important owned here (empty q rejected; misleading genres comment). Fix round1 dispatched.
- Task 2: fix round 1/5 (all 3 ADDRESSED; commit d1d0997f9cf12e755b0a6a6c6ab87a09d7fb3559; re-review PASS).
- Task 2: complete (commits f24593b..d1d0997, review clean after fix).
- Ruling: Task 3 must make `/api/content/manga/{id}` and `/api/content/manga/{id}/chapters` source-aware for `comick:` IDs; otherwise Comick search results cannot open. Cost if wrong: search returns dead cards.
- Ruling: Task 3 sets `partial=true` for Comick when `lang != all`, Comick page > 50, or tags filter cannot be mapped to verified Comick genre slugs. Cost if wrong: filters silently lie about coverage.
- Task 3 BASE: d1d0997f9cf12e755b0a6a6c6ab87a09d7fb3559.
- Task 3: implementation commit e163f1f4ea7c25daadca282ca2bfabb3d51569e5; RED core8 failures/Node6 failures, GREEN core13, server11, Node10, core42, source-fallback7, clippy clean. Added search_all, source-aware detail/chapters, partial rules, cache key.
- Ruling: reviewer Important `lang` no-op is load-bearing because language is an approved advanced filter. Fix round1: apply `availableTranslatedLanguage[]` for MangaDex, keep Comick unfilterable with `partial=true`. Cost if wrong: broader fix touching MangaDex adapter but filter actually works.
- Task 3: fix round 1/5 (ADDRESSED; commit 1690cb6b096bffe78f7eca88eb3678a147634fc1; re-review ran scoped core test 16/16 PASS).
- Task 3: complete (commits d1d0997..1690cb6, review clean after fix). Minor deferred: Comick total/page-size/sort proxy, direct chapter pages:0, MangaDex language means ≥1 chapter in language.
- Cross-task handoff to Task 4: UI must render `partial` warning when Comick-inclusive language/tag/status/deep-page search is incomplete.
- Task 4 BASE: 1690cb6b096bffe78f7eca88eb3678a147634fc1.
- Task 4: implementation commit 3f41d3fb6d87ae2635027ed589641d05e8e8989b; RED advanced-search 0/5, GREEN 5/5, reader9/9, skeleton4/4, contracts/source-ui/select21/21, search-source11/11, build/tsc/lint/whitespace clean. Added source/lang/year filters, partial warning, merged genre groups, removed /the-loai.
- Task 4: review PASS, but controller ruled two skeleton minors load-bearing for this skeleton-focused task: GenreGroupsSkeleton must show 8–10 pills/group and the filter Suspense fallback must use it.
- Task 4: fix round 1/5 (all 3 ADDRESSED; commit f8de0d04fd2e6c29e97df0df0d1ec200d94593cd; re-review PASS).
- Task 4: complete (commits 1690cb6..f8de0d0, review clean). Minor deferred: nested role=status duplicate announcement; legacy Leptos /the-loai; mobile /search hidden from bottom tabs (baseline).
- Task 5 BASE: f8de0d04fd2e6c29e97df0df0d1ec200d94593cd.
- Task 5: implementation commit c3b1291ded938a59bf4de73e9be3db54b74d36a6; RED source-badge0/5, GREEN source-badge+source-ui12/12, reader9/9, regression39/39, build/tsc/lint clean. Added SourceBadge on covers, removed title suffix, source-aware coverImageUrl.
- Task 5: complete (commits f8de0d0..c3b1291, review clean). Minor deferred: 8px rank-cover strip clipping, feed aria-label overrides link name (badge still separate node), dead titleWithSource helper, web-side cover host check lets Axum reject crafted port/userinfo.
- Task 6 BASE: c3b1291ded938a59bf4de73e9be3db54b74d36a6.
- Task 6: implementation commit 215b7dad61b975f68c8fe2459acd8a4dbf8b6d27; RED ranking 0/3, GREEN 3/3, source-ui/source-badge/select23/23, but skeleton-motion 3/4 due stale Task5 title-suffix assertion.
- Task 6: fix round 1/5 (stale assertions to `.source-badge`; commit d06886764f4e3dcd54058459aadb3f207f9db152; skeleton-motion4/4, badge/source-ui12/12).
- Task 6: complete (commits c3b1291..d068867, review clean). Minor deferred: light-theme frame distinctness not browser-asserted; 12 skeleton rows vs up to 24 loaded rows by brief.
- Task 7 BASE: d06886764f4e3dcd54058459aadb3f207f9db152.
- Task 7: implementation commit 5b6273965e01d555daf5789c4079ea98b07afd44; full local gate PASS aggregate203/203, browser23/23, Rust90/90, clippy/fmt/whitespace/secrets/diff/typecheck/lint clean. Registered five suites, reordered CI Chromium install, docs updated.
- Task 7: review Needs fixes (3 Important docs-only): aggregate suite count 28 not 12, Playwright new suites 2 not 3, tracked docs reference untracked SDD report.
- Task 7: fix wave 1/5 (all 4 ADDRESSED; commit 4f1da19f7eabb6456c502f425cf5fa1522a86267; re-review PASS).
- Task 7: complete (commits d068867..4f1da19, review clean after fix). Minor deferred: CI Chromium path unverified, historical 783 docs, CI comment about baseline source, untracked SDD scratch.
- Final whole-branch review: complete, merge-base bd9b830..4f1da19; assessment With fixes — 0 Critical, 1 Important (merged pagination drops page>=2 results), minors parked.
- Final fix wave awaiting scoped re-review (commit 88ddc43e23786ac3bf53666c9fc1cbd808cf367f; RED pagination 2 failures, GREEN core19, server11, Node11, clippy/fmt/whitespace/secrets/diff/typecheck/lint clean).
- Ruling: fix final pagination defect in one wave; include cheap README/CI comment corrections, skip visual-only minors. Cost if wrong: larger cross-crate fix but bookmarkable page filter becomes correct.
- Ruling: legacy Leptos `/the-loai` route is parked as out-of-scope legacy shell; user-facing Next route is removed. Cost if wrong: legacy Axum-served SPA still exposes old nav until Phase 3/4 cleanup.
- Ruling: assign cross-task handoffs explicitly — Task 3 owns lang partial/page clamp/numeric genre mapping-or-partial; Task 5 owns source-aware `coverImageUrl` (add `web/lib/contracts.ts` to its scope). Cost if wrong: Comick cards/tags broken or false completeness.
