# SDD ledger — plan: docs/superpowers/plans/2026-11-21-kaslyydex-multi-source-fallback-and-reading-ux.md

Worktree: `C:\Users\Hungg\.local\share\opencode\worktree\d7572a\kaslyydex-multi-source-ux` on branch `feature/kaslyydex-multi-source-ux`.
Base commit: `5c649ec787e62982741ed61b49fb6d5ef7f378b0`.
Spec: `docs/superpowers/specs/2026-11-21-kaslyydex-multi-source-fallback-and-reading-ux-design.md`.
Owner-selected subagent model: `9router/opencode`.
Standard SDD workspace scripts are unreliable on Windows linked worktrees; briefs/reports/ledger are maintained manually in this directory.

## Task status

- [ ] Task 1: Additive source metadata contracts
- [ ] Task 2: Comick provider adapter and normalization
- [ ] Task 3: Chapter fallback orchestration, cache, and Axum routes
- [ ] Task 4: Per-source image proxy allowlist
- [ ] Task 5: Web source labels and fallback chapter UI
- [ ] Task 6: Source-aware reader tickets, progress, and XP
- [ ] Task 7: Shared accessible custom dropdown
- [ ] Task 8: Shape-matched skeletons and motion system
- [ ] Task 9: Reader theme auto-sync with site theme
- [ ] Task 10: Regression gate, documentation, and release notes

## Preflight conflict scan

| Tasks | Shared interface/files | Finding | Ruling |
|---|---|---|---|
| 1 ↔ 2 | source constants/labels | Task 2 consumes `mangadex`/`comick` labels from Task 1. | No conflict; Task 2 must use exact labels. |
| 1 ↔ 3 | Rust DTO source fields | Task 3 enriches DTOs created in Task 1. | No conflict; defaulted fields preserve legacy JSON. |
| 1 ↔ 5 | TS DTO source fields | Task 5 consumes optional TS fields/helper. | No conflict; UI must default to MangaDex. |
| 1 ↔ 6 | source-aware IDs | Task 1 adds metadata, Task 6 adds ID validation/ticket source. | Ruling: Task 1 does not change ID validation; Task 6 owns source-aware ID rules. Cost if wrong: one validator adjustment. |
| 2 ↔ 3 | Comick adapter types | Task 3 consumes `Comick`, `ComickChapter`, ID helper. | No conflict; Task 2 must expose stable public names. |
| 2 ↔ 4 | Comick CDN host | Task 4 allowlists host verified by Task 2. | Ruling: Task 2 records verified CDN host in code/report; Task 4 uses only that host. Cost if wrong: allowlist update. |
| 3 ↔ 4 | pages/proxy | Task 3 returns proxied URLs; Task 4 allows upstream CDN. | No conflict; browser never receives raw CDN URLs. |
| 3 ↔ 5 | chapter DTO source/readable | Task 5 renders fields produced by Task 3. | No conflict; external-only chapters remain unchanged when no match. |
| 3 ↔ 6 | chapter metadata/pages | Task 6 uses source-aware metadata from Task 3. | No conflict; ticket must bind source. |
| 5 ↔ 6 | ReaderClient/toolbar | Task 5 labels source; Task 6 passes source through progression calls. | Ruling: Task 6 preserves Task 5 labels and does not rewrite UI layout. Cost if wrong: small UI merge fix. |
| 5 ↔ 7 | ReaderToolbar | Both modify toolbar. | Ruling: Task 7 replaces selects after Task 5 labels are present; keep source label text. Cost if wrong: toolbar merge fix. |
| 7 ↔ 9 | SettingsForm/ReaderToolbar | Task 9 adds auto option using Task 7 dropdown. | No conflict; Task 9 must use shared Select. |
| 7 ↔ 8 | globals.css | Both add styles. | Ruling: Task 8 motion tokens must not override dropdown focus/ARIA styles. Cost if wrong: CSS ordering fix. |
| 8 ↔ 9 | globals.css/ReaderPages/ReaderClient | Both touch reader visuals. | Ruling: Task 9 theme variables compose with Task 8 motion; no animation logic in theme task. Cost if wrong: CSS variable fix. |
| 10 ↔ all | aggregate scripts/docs | Task 10 includes all new tests. | No conflict; do not skip failing tests. |

### Per-task self-consistency

| Task | Result | Ruling |
|---|---|---|
| 1 | Tests specify defaulted fields; code adds fields. Literal Rust constructors may break. | Ruling: update all affected constructors/tests in Task 1; do not leave compile failures for later tasks. Cost if wrong: extra compile fixes. |
| 2 | Requires official endpoint verification before HTTP code. | Ruling: if official Comick catalog cannot be verified, stop Task 2 and report blocker; do not invent endpoints. Cost if wrong: fallback delayed. |
| 3 | Changes Axum state and legacy aliases. | Ruling: preserve legacy `/api/*` behavior while adding source-aware dispatch. Cost if wrong: legacy client fix. |
| 4 | Allowlist depends on verified CDN. | No conflict; tests must reject spoofed hosts. |
| 5 | UI helper and browser fixture tests align. | No conflict. |
| 6 | Migration + ticket source + XP tests align. | Ruling: migration must be additive and default `mangadex`; no auth-table writes. Cost if wrong: migration revision. |
| 7 | Dropdown replaces native selects and updates tests. | Ruling: search GET form must submit unchanged values via hidden input. Cost if wrong: form integration fix. |
| 8 | Skeleton/motion tests align with CSS/markup. | No conflict; reduced motion required. |
| 9 | Rust Auto variant + TS auto default + CSS auto mode. | Ruling: update all wire/enum tests affected by Auto; manual overrides remain valid. Cost if wrong: settings normalization fix. |
| 10 | Full gate includes new tests. | No conflict; live provider verification remains manual. |

## Execution rulings

- Ruling: Use `9router/opencode` for implementer/reviewer subagents per owner preference. Cost if wrong: model capability may require escalation.
- Ruling: Cloud/deploy/push/merge remain paused; local implementation only. Cost if wrong: live integration may need follow-up.
- Ruling: Comick is first fallback adapter; if official catalog terms/endpoints cannot support spec, stop and revise rather than silently using unofficial scraping. Cost if wrong: feature delayed.

## Baseline

- First attempt failed only because aggregate tests ran before `cargo build -p server`; 24 content/feed tests could not find `target/debug/server.exe`. No code failure.
- Ruling: baseline command must build Axum before aggregate tests. Cost if wrong: false RED from missing binary.
- Retry PASS: 121/121 aggregate, 23/23 browser, 50 Rust tests. Worktree ready.
- Task 1 BASE: `5c649ec787e62982741ed61b49fb6d5ef7f378b0`.
- Task 1: implementation commit a9682916ab17e913c68f7f2f356c35f20ca95356; report RED 12 Rust compile errors + 1 TS failure, GREEN contracts7/7, workspace53/53, TS2/2, typecheck clean. Review dispatched.
- Cross-task handoff from Task 1: Rust `ChapterDto` does not yet have `readable`; Task 3 must add/derive it for fallback integration tests. Cost if wrong: source-fallback UI cannot rely on Rust response field.
- Task 1: complete (commits 5c649ec..a968291, review clean). Minor deferred: legacy TS assignability test is runtime no-op; source/source_label can diverge if producer sets one field only — Task 3 must set both together.
- Task 2 BASE: a9682916ab17e913c68f7f2f356c35f20ca95356.
- Task 2: implementation commit 5128e766162d0afec1f4741381475381d20d678c; report RED 4 failures, GREEN Comick4/4, core18/18, clippy clean. Verified official endpoints `/v1.0/search/`, `/v1.0/comic/{hid}/chapters`, `/chapter/{hid}/get_images`; CDN host `meo.comick.pictures`. Live chapter/image got 403; task-3 fixtures must cover HTTP wiring.
- Task 2: complete (commits a968291..5128e76, review clean). Minor deferred: comment overstates verified reader-image host; non-matching optimized URL errors instead of b2key fallback; b2key path permits encoded traversal chars; chapters fetch only page1/limit12; no prefix-strip HTTP tests; no 429 backoff.
- Task 3 BASE: 5128e766162d0afec1f4741381475381d20d678c.
- Task 3: implementation commit 445d8eca5215608dd89329c8b09479ee7d49db52; RED Rust 28 compile diagnostics + Node 3 pass/4 fail, GREEN fallback5/5, source-fallback7/7, notification-feed11/11, content-proxy13/13, clippy clean. Added Rust readable, paired source labels, cache/TTL, ContentState routes and legacy aliases.
- Task 3: complete (commits 5128e76..445d8ec, review clean). Minor deferred: inert language_rank sort/overstated vi-before-en comment, unused CachedMatch.comic_id, cache scan for mapped Comick metadata, extra md.manga() call, non-atomic cache writes.
- Task 4 BASE: 445d8eca5215608dd89329c8b09479ee7d49db52.
- Task 4: implementation commit 4ae012dbad988fd8d7519500a7c8ff46ccd9a5cc; RED 5 tests/2 failures (Comick host rejected, encoded traversal accepted), GREEN 5/5, core27/27, clippy clean, check workspace clean. Added exact `meo.comick.pictures`, HTTPS/443/no-credentials, raw encoding and decoded path traversal guards.
- Task 4: complete (commits 445d8ec..4ae012d, review clean). Minor deferred: conservative raw `%2e/%2f/%5c` rejection; `allowed()` private path gap; `b2key` raw `?/#/\`; two rustfmt hunks in comick.rs from Task 2 — fix in final gate task.
- Task 5 BASE: 4ae012dbad988fd8d7519500a7c8ff46ccd9a5cc.
- Task 5: implementation commit 5d662e471b3f2f58726b3cc2cc55a2932448a965; RED 1 missing export, GREEN source-ui3/3, source-contracts2/2, source-fallback7/7, typecheck clean, scoped lint 0 errors. Added `titleWithSource` and labels across cards/home/detail/chapter rows/reader toolbar.
- Ruling: reviewer minor `web/app/bxh/page.tsx` raw title conflicts with spec's source-after-title requirement; fix in Task 5 round 1 and add rendered assertions for manga-card/home/detail/bxh call sites so labels are regression-covered. Cost if wrong: small test/UI diff; avoids inconsistent source display.
- Task 5: fix round 1/5 (both ADDRESSED; commit b2a96f7589ee41f351551f8a3c991f2678857ce2; re-review independently ran focused source-ui 7/7 PASS).
- Task 5: complete (commits 4ae012d..b2a96f7, review clean). Minor deferred: SSR-stream test harness depends on React 19.3 internal path; no hydrated browser assertion for labels; metadata title intentionally unlabeled.
- Task 6 BASE: b2a96f7589ee41f351551f8a3c991f2678857ce2.
- Task 6: implementation commit 11c6add996543984e6fed20922afed06a8e7a131; RED meaningful 8 tests/4 failures, GREEN focused16/16, aggregate38/38, tsc/lint/drizzle check/secret scan clean. Added source-aware validators, ticket claims, session column migration0007, XP binding and fixture tests.
- Task 6: complete (commits b2a96f7..11c6add, review clean). Minor handoff to Task 10: add `source-progression.test.mjs` to `test:aggregate`/CI; currently not enforced there.
- Task 7 BASE: 11c6add996543984e6fed20922afed06a8e7a131.
- Task 7: implementation commit 3146a333760ea87ad0296945a4270e56465e6f3b; RED select6/6 failures, GREEN select7/7, account3/3, reader9/9, reader-sync/community/progression11/11, tsc/lint/build clean. Added shared Select and replaced native selects; wrapper-label reopen bug fixed with regression test.
- Ruling: reviewer minor `.select-chevron transition` outside `prefers-reduced-motion` guard violates global constraint; fix in Task 7 round1 together with Space/Home/End assertions. Cost if wrong: small CSS/test diff; avoids spec violation and untested keyboard paths.
- Task 7: fix round 1/5 (both ADDRESSED; commit d033d71a50f2b35ef2fbe11c6274122f9832be24; re-review PASS, focused select 11/11 claimed).
- Task 7: complete (commits 11c6add..d033d71, review clean). Minor deferred: CSS test reads source not compiled bundle; Home/End disabled edge fallback; dead `chapter-select` class retained as test locator; isolated tests use esbuild not Next hydration (browser suites cover hydration).
- Task 8 BASE: d033d71a50f2b35ef2fbe11c6274122f9832be24.
- Task 8 first dispatch failed on transient 429 but left uncommitted task changes; resumed dispatch inspected them, kept them, re-demonstrated RED via stash, then GREEN and committed.
- Task 8: implementation commit 1a4b46c75666d1ca088e36536d2c090fbfe91fb7; RED skeleton-motion 0/3, GREEN 3/3, reader9/9, reader-sync3/3, tsc/lint/build clean. Added shape skeletons, motion tokens, reduced-motion guards, image fade.
- Task 8: review Needs fixes, 0 Critical / 1 Important: `.img-fade{opacity:0}` is released only by `onLoad`, so failed reader images remain invisible behind permanent skeleton. Fix round1 dispatched to original implementer with onError + regression test.
- Task 8: fix round 1/5 (ADDRESSED; commit 10f57154ab1cc61fe3185bd6eaa797f8ef4db93e; re-review PASS, static verification of both onError branches and regression test).
- Task 8: complete (commits d033d71..10f5715, review clean after fix). Minor deferred: error path shares data-loaded with success; test uses small settle timeout; empty-src edge benign.
- Task 9 BASE: 10f57154ab1cc61fe3185bd6eaa797f8ef4db93e.
- Task 9: implementation commit 1c4524b38c70d3351d7989628ff5b6f807cff0da; RED domain compile + theme1/5 fail, GREEN domain/reader-core/reader-wasm10/10, theme+guest11/11, reader browser9/9, account/whitespace18/18, tsc/lint clean. Added Auto variant/default, guest/validator auto, CSS auto follows site, shared Select option, no-flash init.
- Task 9: complete (commits 10f5715..1c4524b, review clean). Minor deferred: SSR paints auto before hydration for stored manual bg; legacy Leptos UI can overwrite shared `auto` preference to light; DB default remains light with service fallback.
- Task 10 BASE: 1c4524b38c70d3351d7989628ff5b6f807cff0da.
- Task 10: implementation commit 12e1a7dbe7f5367dcea7b17ffdf74adc529cad15; report full gate PASS: aggregate175/175, browser23/23, Rust67/67, clippy/fmt/whitespace0-new/secrets/diff/tsc/lint clean. Added all new suites to aggregate/CI, Axum prebuild, 783-finding whitespace baseline, core/domain fmt fixes and docs.
- Task 10: complete (commits 1c4524b..12e1a7d, review clean). Minor deferred: task-10 report says 264 tracked files, actual 265 at HEAD; baseline delta 526→783 disclosed and verified pre-existing.
- Final whole-branch review: complete, merge-base 5c649ec..12e1a7d; Ready to merge YES, 0 Critical / 0 Important. Minor 1 (docs claim per-image retry), Minor 2 (comick.rs comment overstates live host verification), Minor 6 (Rust/TS opaque ID validators disagree) routed to one final fix wave; all other minors parked with reviewer rulings.
- Ruling: fix final-review minors 1,2,6 in one fix wave because they assert behavior or accept IDs inconsistently across layers. Cost if wrong: small docs/validator/test diff; avoids misleading docs and cross-layer 400/404 drift.
- Ruling: final-review Minor 5 (untracked SDD artifacts have trailing whitespace) is controller cleanup at finish: either leave untracked or extend baseline before committing artifacts. Do not silently commit whitespace-breaking docs.
- Final fix wave: commit bee48e9a47b60dd5ca1df52a274cc9cfb36ccf9f; docs/comment/ID validator aligned; RED comick1 fail, GREEN comick7/7, imgcache5/5, source suites25/25, fmt/clippy clean. Scoped re-review PASS, Ready to merge YES.
- All 10 tasks complete. Final HEAD bee48e9. Running final local gate before integration menu.
- Task 8: minor deferred: hero skeleton only class-checked, empty `.rank-num` skeleton gutter, shimmer tokens not required, transient status on `<ol>`, full prebuild not rerun locally.
- Ruling: whole-repo whitespace scan has 526 pre-existing findings in committed `docs/superpowers/sdd/kaslyydex-phase-1-2/*.diff`. Task 10 must use a scoped/baselined whitespace gate instead of editing prior-plan artifacts. Cost if wrong: final gate false RED unrelated to this plan.
- Task 6 blocked before work: dispatch with `9router/opencode` returned `429 FreeUsageLimitError` ("Free usage limit reached..."). No files changed. Owner confirmed quota reset and asked to continue with same model; re-dispatched.
- Cross-task handoffs to Task 3: set Rust `source` and `source_label` together; add Rust `readable` field; confirm Comick page1/limit12 suffices for chapter matching or add bounded pagination; local fixtures must exercise HTTP prefix-stripping and page URL use.
