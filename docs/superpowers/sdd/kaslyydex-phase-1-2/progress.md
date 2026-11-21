# SDD ledger — plan: docs/superpowers/plans/2026-11-20-kaslyydex-phase-1-2.md

Worktree: `D:\Code\nodejs\kaslyydex\.worktrees\kaslyydex-phase-1-2` on branch `feature/kaslyydex-phase-1-2`.
The standard SDD workspace helper cannot resolve Windows-linked-worktree paths, so this ledger and task briefs are maintained manually in the plan workspace.

## Preflight conflict scan

| Tasks | Shared interface/files | Finding | Ruling |
|---|---|---|---|
| 1 ↔ 2 | workspace `Cargo.toml`, product naming | Task 1 changes workspace metadata while Task 2 adds crates. | No conflict; Task 1 must preserve a valid workspace and Task 2 adds members afterward. |
| 1 ↔ 3–5 | `legacy-next` → `web`, product strings | Later tasks require `web/`; Task 1 owns the move. | No conflict; later tasks consume the moved path. |
| 2 ↔ 5 | `contracts`, `reader-core`, WASM adapter | Task 5 consumes exact Rust types and reader methods from Task 2. | Ruling: Task 2 owns stable public names; Task 5 may add only bindings, not rename core APIs. Cost if wrong: adapter-only rename. |
| 2 ↔ 8 | reader progress and page-count semantics | Task 8 requires server-verified progress, while Task 2 defines pure progress. | Ruling: reader-core computes deterministic progress only; server ticket/anti-abuse policy belongs to Task 8. Cost if wrong: extra adapter field. |
| 3 ↔ 6–8 | auth/session/schema | User features consume Better Auth identity and DB schema. | No conflict; Tasks 6–8 add additive migrations and route handlers. |
| 3 ↔ 4 | env and content origin | Task 3 defines env names; Task 4 wires Axum origin and deployment. | No conflict; Task 4 consumes `RUST_CONTENT_API_ORIGIN`. |
| 4 ↔ 5 | `/api/content/*` | Task 5 needs the content proxy before replacing direct MangaDex calls. | No conflict; Task 4 must preserve same-origin API behavior. |
| 6 ↔ 8 | progress/completion | Task 6 stores progress; Task 8 awards completion/EXP. | Ruling: Task 6 owns ordinary progress writes; Task 8 owns completion endpoint and XP transaction. |
| 7 ↔ 8 | user profile/notifications | Task 8 creates level-up notification records used by Task 7 UI. | Ruling: Task 7 notification schema/UI supports `type`/payload generically; Task 8 emits progression notifications. |
| 9 ↔ all | CI/release gates | Task 9 validates all previous task outputs. | No conflict. |

### Per-task self-consistency scan

| Task | Self-consistency result | Ruling |
|---|---|---|
| 1 | Product rename and move to `web/` match its checks; preserving native prototypes and reader behavior is consistent. | Ruling: the RED branding check applies to user-facing product UI/metadata, not historical migration documents, cache directory names, or persisted localStorage keys; preserve those to avoid breaking existing data. Cost if wrong: old cache/storage identifiers may remain visible to maintainers. |
| 2 | Tests specify page bounds/settings and API DTOs; file list includes workspace/server contracts needed by consumers. | Ruling: keep reader-core pure and page-count agnostic except for validated `total_pages`; progress is integer pages and percent is derived. Cost if wrong: one API field/type adjustment before the WASM adapter. |
| 3 | Auth configuration tests can run without external credentials, but online JWT/Google proof requires environment setup. | Ruling: run config/unit/JWKS fixture tests locally; make Google OAuth + deployed Neon smoke a gated Preview check that cannot print secrets. The native OAuth/PKCE end-to-end spike is a Phase 3 gate, not a Phase 1 implementation dependency. Cost if wrong: Phase 3 may need an auth boundary adjustment. |
| 4 | Smoke tests cover `/`, health, content path and invalid IDs; deployment requires an external Vercel account. | Ruling: implement proxy via Next rewrites (not a body-buffering Route Handler) to Axum; verify locally first. Attempt Preview deploy only if this environment is already authenticated; otherwise report the exact manual prerequisite and continue local verification. Cost if wrong: rewrite semantics may require a small Route Handler adapter. |
| 5 | Task consumes stable Task 2 Rust API and Task 4 content proxy; build commands and browser paths match the moved app. | Ruling: `web/` is the canonical app; remove only duplicate direct-MangaDex/page-fetch paths after Axum parity tests pass. Cost if wrong: reverting one client data path. |
| 6 | Schema/migration tests, BFF routes and ownership tests align; guest merge has a timestamp conflict rule. | Ruling: client timestamps choose merge precedence only for non-privileged progress/history; they never grant EXP. Server timestamps govern completions and XP. Cost if wrong: guest progress merge may prefer an older position. |
| 7 | Comment/report/moderation tests align, but thread locking needs an owner separate from individual comment status. | Ruling: add a `comment_threads` row keyed by `(target_type,target_id)` for lock state; keep comment statuses visible/hidden/removed. Cost if wrong: one migration/table refactor. |
| 8 | Ticket/checkpoint/completion methods align with database uniqueness; anti-abuse claims need bounded semantics. | Ruling: signed ticket binds user/chapter/page count/expiry; checkpoint monotonic; completion once; do not claim bot-proof reading. Cost if wrong: progression rules may require recalibration, not data-loss migration. |
| 9 | CI and release verification cover all prior outputs, while external Preview depends on credentials. | Ruling: make CI deterministic and secret-free; deploy Preview smoke is conditional on configured Vercel/Neon secrets and is a documented release gate. Cost if wrong: manual Preview verification remains before production. |

### Shared-interface rulings

- Task 3 creates `infra/vercel.md`; Task 4 extends the same file with Axum routing/auth deployment notes rather than creating a duplicate.
- Task 4 configures Neon Managed Auth; Drizzle owns application tables only. Task 6 adds library/progress; Task 7 adds comments/moderation/thread locks; Task 8 adds completion/XP/reader-ticket tables.
- Task 6 progress merge is not the XP authority; Task 8 alone owns the transactional completion and XP award path.
- Task 7 creates generic notification storage/UI; Task 8 emits level-up events through that interface.
- Task 5 adapter consumes Task 2 `ReaderState` API without changing core names; Phase 3/4 adapt the same domain contracts.

## Task status

- [x] Task 1: Baseline rename and workspace boundaries
- [x] Task 2: Typed contracts and Rust core crates
- [ ] Task 3: Local implementation reviewed; deployment verification deferred by owner
- [ ] Task 4: Neon Managed Auth, application schema and Axum content boundary
- [ ] Task 5: Next.js web migration and Rust WASM reader
- [ ] Task 6: User profile, library, progress and guest merge
- [ ] Task 7: Comments, reports, moderation and in-app notifications
- [ ] Task 8: Progression, cultivation titles and anti-abuse
- [ ] Task 9: CI, security, observability and Phase 1–2 release gate

## Completed tasks

- Task 1: complete (commit 62ed66675c2bdf2c0cccd1be08847d27aaa720f9, review APPROVE; reported tests pass, reviewer did not rerun them).
- Task 2: fix round 1/5 (1 addressed, 0 open — upstream missing/non-string IDs are rejected or skipped; commits a0967a8..0b3f9f3).
- Task 2: minor (deferred): duplicate upstream manga IDs in search choose the first latest-chapter metadata match; reported low residual, valid MangaDex search is expected to return unique manga IDs.
- Task 2: complete (commits a0967a8..0b3f9f3, re-review ADDRESSED; reported 36 workspace tests/Clippy pass and scoped fmt pass; full fmt baseline exception ruled below).
- Task 3: local complete (commit 4af9f17; reviewer APPROVED local scope; smoke, typecheck, focused lint and build reported passing; full lint has four pre-existing errors). Preview deployment is blocked on Vercel access approval.

Ruling: The plan's full-workspace `cargo fmt --check` gate is not achievable without unrelated reformatting: I ran it against a clean archive of baseline `fc7389b` and confirmed the same pre-existing failures in untouched `crates/core/src/imgcache.rs`, `crates/core/src/lib.rs`, and Leptos UI files. Keep the change scoped and require `cargo fmt --check -p domain -p contracts -p reader-core -p server` plus `git diff --check`; record full-workspace fmt as a baseline limitation. Cost if wrong: baseline formatting debt remains and full fmt is not a green repository-wide gate.

## Additional execution ruling

- Ruling: Owner paused Vercel deployment, pushed the current branches to GitHub, and requested continued implementation. Continue local Tasks 4–9 with real SDK adapters, migrations and focused tests; defer Vercel deployment, Neon provisioning and live Google sign-in to external integration gates. Do not fake successful auth or mark those gates complete. Cost if wrong: live integration may require follow-up fixes after credentials/services are connected.
- Current remote: `https://github.com/HuyHungM/KasLyyDex.git`; `main` and `feature/kaslyydex-phase-1-2` pushed through `4af9f17`. Owner-selected subagent model: `9router/opencode`.
- Ruling: Docker CLI exists but the daemon is unavailable; use a dev/test-only embedded PostgreSQL engine to execute real SQL migrations/constraints and test transactions. Production stays pooled PostgreSQL/Drizzle. Cost if wrong: SQL/driver differences still need live Neon smoke before release.
- Reader Core portability check: `cargo +stable-x86_64-pc-windows-msvc check -p reader-core --target wasm32-unknown-unknown -q` passed on the local toolchain.
- Ruling: Ordinary reread progress can decrease, but XP proof tracks distinct validated pages and monotonic session coverage separately. Phase 2 tickets expire after 30 minutes; minimum server elapsed time is max(10 seconds, 2 seconds per required page), rate limit 20 checkpoints/minute/account. Cost if wrong: reading-speed thresholds may need tuning; XP remains cosmetic.
- Ruling: Comment limits are 5 new comments/minute and 10 reports/hour per user, enforced in PostgreSQL; bodies are plain text of 1–2000 trimmed characters. On-demand library refresh creates deduplicated new-chapter notifications, without pretending a background scheduler is running. Cost if wrong: limits and polling policy may need tuning after usage data.

- `Ruling: Task 3 deployment order — First deploy the Next.js skeleton to Vercel without Neon/auth configuration, verify Preview, then connect Neon and implement auth — this honors the accepted requirement that Vercel deployment precedes Neon setup while keeping an incomplete auth app out of production — cost if wrong: one temporary preview deployment and a small task reorder.`
- `Ruling: Task 3 cannot deploy Preview with current Vercel CLI state — `vercel whoami` returned Logged out; implement/test the local skeleton first, then require owner login and verify Preview before Task 4/Neon setup — cost if wrong: execution pauses at deployment until the user authenticates Vercel.`
- `Ruling: Task 2 full fmt gate exception — reproduced `cargo fmt --check` against a clean archive of baseline fc7389b; same formatting diffs exist in untouched imgcache/lib/legacy Leptos files. Require scoped fmt checks and diff check; do not reformat unrelated files — cost if wrong: old formatting drift remains, but does not affect behavior.`
- `Ruling: Task 3 remains externally blocked — Vercel team project list is empty until owner approves the one-time team-access consent; this is required before creating/linking the Preview project, so Task 4/Neon setup stays paused — cost if wrong: local Phase 1 cannot advance to deployment verification until the link is approved.`
