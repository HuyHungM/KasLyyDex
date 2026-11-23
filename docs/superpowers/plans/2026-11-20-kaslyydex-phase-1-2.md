# KasLyyDex Phase 1–2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing KasLyyDex baseline into a deployable Next.js/Vercel web platform with Neon-backed authentication and user features, while extracting a portable Rust Reader Core/WASM adapter for later Android and GPUI clients.

**Architecture:** Next.js owns web UI, SEO, authentication and `/api/v1/*` user BFF routes. Axum remains a separate content service for MangaDex, chapter/page access, DNS handling and image caching. Pure Rust domain/contracts/reader-core crates are shared by web WASM and future native adapters.

**Tech Stack:** Next.js 16.4.6, React 19.3, TypeScript, Tailwind CSS 4.3, Neon Managed Auth (Better Auth email/password + Google + JWT/JWKS), Neon PostgreSQL, Drizzle ORM/Drizzle Kit for application tables, Zod, Axum, Rust WASM via wasm-bindgen/wasm-pack, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-20-kaslyydex-platform-design.md`

## Execution update — owner paused cloud deployment

The owner requested GitHub publication first, then continued local implementation
using subagents with `9router/opencode`. `main` and the feature branch were pushed
through commit `4af9f17`. Vercel deployment and Neon/OAuth provisioning remain
paused. Complete Tasks 4–9 locally using real SDK adapters, SQL migrations and
tests; retain live Neon, Google OAuth, Preview and Production checks as unverified
release gates. Do not deploy, create cloud resources, merge or push further
changes as an automatic consequence of this local execution.

Use test-only PostgreSQL embedding for migration/transaction verification if a
local PostgreSQL server is unavailable; this does not replace or certify Neon
integration. No fake sessions, default auth secrets or in-memory production
database fallbacks are allowed.

The latest execution decisions and task-specific acceptance details live in
`docs/superpowers/sdd/kaslyydex-phase-1-2/progress.md` and `task-N-brief.md`.

## Global Constraints

- Product name: `KasLyyDex`; keep native UI work deferred to Phase 3 Android and Phase 4 GPUI.
- Vercel runs Next.js/user BFF; Axum content service runs separately and is reached through `/api/content/*`.
- Task 3 deploys a credential-free Vercel Preview before Task 4 provisions/configures Neon; never deploy Production before security and migration gates pass.
- Auth is Neon Managed Auth (Better Auth): email/password + Google OAuth. Browser sessions use HttpOnly/Secure/SameSite cookies; native clients later use JWT/JWKS.
- Neon Auth owns identity/session schema; Drizzle migrations manage only KasLyyDex application tables and never alter Neon-managed auth tables.
- EXP is 100 per valid chapter at ≥80% progress, once per user/chapter; level is `min(1000, 1 + floor(total_xp / 200))`.
- Cultivation titles are cosmetic/profile labels only; `user`, `moderator`, `admin` are separate authorization roles.
- Comments are manga- and chapter-scoped, visible immediately, support one-level replies, spoiler flag, reports and moderation actions.
- PostgreSQL invariants: unique completions, idempotent XP events, unique user/manga library, unique progress per user/manga/chapter/language, UTC timestamps.
- No secrets in Git; `.env*` is ignored except `.env.example`.
- Every user BFF mutation re-checks session, validates input, checks ownership/role, performs a transaction, and returns the structured error envelope.
- Phase 3/4 are not implemented by this plan; only their contracts and JWT/WASM compatibility are prepared.

## Review Focus

- Vercel/Neon preview and production environments must never share a mutable database branch: test environment selection and migration commands in Task 4.
- Guest localStorage merge must not overwrite newer server progress or duplicate library/completion/XP rows: test conflict resolution and idempotency in Task 5.
- A client cannot award XP by posting `percent=100`: test server-owned page count/ticket validation and duplicate completion in Task 6.
- A user cannot edit/delete another user’s comment or access moderator routes: test ownership and role checks in Task 7.
- Native token compatibility must be proven before Phase 3: test Neon Managed Auth JWT/JWKS verification against a separate verifier in Task 4.

---

## File Structure

| File/Directory | Responsibility |
|---|---|
| `web/` | Next.js application migrated from `legacy-next/` |
| `web/app/api/v1/` | Typed user BFF route handlers |
| `web/lib/auth/server.ts`, `web/lib/auth/client.ts` | Neon Managed Auth server/client adapters |
| `web/lib/db/` | Drizzle client, schema, migrations and seed helpers |
| `web/lib/contracts.ts` | TypeScript API contracts and Zod schemas |
| `web/lib/progression.ts` | Pure XP/level/realm calculations |
| `web/lib/merge.ts` | Guest-to-account merge logic |
| `crates/domain/` | Platform-independent Rust domain types |
| `crates/contracts/` | Shared Rust API DTOs and errors |
| `crates/reader-core/` | Platform-independent reader state machine |
| `crates/reader-wasm/` | wasm-bindgen package consumed by Next client reader |
| `crates/server/` | Existing Axum content API, moved under content namespace |
| `infra/` | Vercel/Axum deployment docs, env examples, health checks |
| `.github/workflows/` | CI for Rust, Next, migrations and browser tests |

---

### Task 1: Baseline rename and workspace boundaries

**Files:**
- Modify: `README.md`, `Cargo.toml`, `.gitignore`
- Move: `legacy-next/` → `web/`
- Create: `web/.env.example`, `infra/README.md`
- Modify: `crates/core`, `crates/server`, `crates/ui` product strings only

**Interfaces:**
- Produces the stable project layout consumed by Tasks 2–10.

- [ ] **Step 1: Write the failing repository checks**: a shell check must find no user-facing `TruyệnViệt` product title in the root/web metadata except migration notes, and `web/package.json` must exist while `legacy-next/package.json` must not.
- [ ] **Step 2: Run the check** and record RED against the current layout.
- [ ] **Step 3: Move/rename the web app and update product metadata** to `KasLyyDex`; do not alter behavior or UI in this task.
- [ ] **Step 4: Add `.env.example` with variable names only**: database connection URL, `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `RUST_CONTENT_API_ORIGIN`, `NEXT_PUBLIC_APP_URL`. Values remain empty; Task 3 does not read or configure auth.
- [ ] **Step 5: Run `npm ci`, `npm run build` from `web/` and `cargo test --workspace`; expected: existing behavior still builds.
- [ ] **Step 6: Commit** `chore: establish KasLyyDex web workspace`.

---

### Task 2: Typed contracts and Rust core crates

**Files:**
- Create: `crates/domain/Cargo.toml`, `crates/domain/src/lib.rs`
- Create: `crates/contracts/Cargo.toml`, `crates/contracts/src/lib.rs`
- Create: `crates/reader-core/Cargo.toml`, `crates/reader-core/src/lib.rs`
- Create: `crates/reader-core/src/tests.rs`
- Modify: workspace `Cargo.toml`
- Modify: `crates/server/src/main.rs`, `crates/core/src/mangadex.rs`

**Interfaces:**
- Produces `ReaderState`, `ReaderMode`, `ReaderBackground`, `ReaderSettings`, `ReadingProgress`, `ApiError`, `MangaSummaryDto`, `ChapterDto`, `PagesResponse`.
- `ReaderState::set_page`, `next_page`, `previous_page`, `progress_percent`, `can_next`, `can_previous`.

- [ ] **Step 1: Write failing Rust tests** for page boundaries, 80% progress, horizontal/vertical settings and invalid page counts.
- [ ] **Step 2: Run `cargo test -p reader-core`; expected RED because the crate/types do not exist.
- [ ] **Step 3: Implement the pure crates with no browser/UI/network dependencies.** Keep serialization stable and errors structured.
- [ ] **Step 4: Refactor server-facing public response types toward `contracts`; preserve existing API output fields as additive changes.
- [ ] **Step 5: Run `cargo test --workspace`, `cargo clippy --workspace --all-targets -- -D warnings`, and `cargo fmt --check`; expected GREEN.
- [ ] **Step 6: Commit** `feat: add portable Rust domain and reader core`.

---

### Task 3: Deploy the Next.js skeleton to Vercel before Neon setup

**Files:**
- Modify: `web/package.json`, `web/next.config.ts`, `web/app/layout.tsx`, `web/app/page.tsx`
- Create: `web/app/api/v1/health/route.ts`, `infra/vercel.md`

**Interfaces:**
- `GET /api/v1/health` returns `{ ok: true, version: string }` without secrets.

- [ ] **Step 1: Add a failing smoke test** asserting the Next root and `/api/v1/health` return 200, expose KasLyyDex branding, and do not require Neon/auth credentials.
- [ ] **Step 2: Run the smoke test** and record RED because the health route and deployment shell are absent.
- [ ] **Step 3: Add the minimal Vercel-ready shell and health route.** Keep existing legacy routes intact; do not add auth or database code in this task.
- [ ] **Step 4: Run `npm run lint`, `npx tsc --noEmit`, and `npm run build`; expected GREEN without Neon credentials.
- [ ] **Step 5: Link the existing Vercel account/project and deploy a Preview before provisioning or connecting Neon.** Do not deploy Production. If Vercel CLI authentication or project linkage is unavailable, stop at a reproducible local build and record the exact user action needed; Task 4 cannot begin until Preview URL is verified.
- [ ] **Step 6: Verify Preview root and health route, then record Preview URL in the ignored SDD report, never source code.
- [ ] **Step 7: Commit** `feat: deploy KasLyyDex web foundation`.

---

### Task 4: Neon Managed Auth, application schema and Axum content boundary

**Files:**
- Modify: `web/package.json`, `web/next.config.ts`, `web/.env.example`
- Create: `web/lib/auth/server.ts`, `web/lib/auth/client.ts`, `web/lib/db/client.ts`, `web/lib/db/schema.ts`, `web/lib/contracts.ts`
- Create: `web/app/api/auth/[...path]/route.ts`, `web/drizzle.config.ts`, `web/drizzle/0000_application.sql`
- Modify: `web/package.json`, `web/.env.example`
- Modify: `crates/server/src/main.rs`, `crates/core/src/mangadex.rs`
- Create/update: `infra/vercel.md`, `infra/axum.md`

**Interfaces:**
- Auth uses a managed auth SDK's Next server/client entry points, email/password + Google. Do not create or migrate managed auth tables with Drizzle.
- Drizzle owns application tables only; `profiles.user_id` stores opaque auth user ID text and does not assume UUID format.
- Browser content requests use `/api/content/*` and proxy to `RUST_CONTENT_API_ORIGIN`.
- Axum exposes the content namespace and rejects invalid content IDs with structured errors.

- [ ] **Step 1: Write failing auth tests** for email/password, Google provider config, secure cookies, and JWT/JWKS availability; write a migration test that app schema does not own Neon Auth tables.
- [ ] **Step 2: Configure Neon integration on the already-verified Vercel Preview branch.** Enable Neon Managed Auth for the development/preview branch and configure the Google OAuth provider using owner-supplied credentials; never write secrets into repository files.
- [ ] **Step 3: Add `.env.example` names for the managed auth base URL and cookie secret, the database connection URL, Google OAuth client values and `RUST_CONTENT_API_ORIGIN`. Implement managed auth server/client handlers using documented Next entry points. Use Drizzle for application tables only; validate env on the server and never expose database credentials in client bundles.
- [ ] **Step 4: Add an application-owned profile migration with opaque `user_id` text; do not migrate the `neon_auth` schema. Run the initial Drizzle migration only after verifying it targets the application schema/branch.
- [ ] **Step 5: Write failing local proxy tests** for `/api/content/latest` and invalid content ID through Next→Axum; expected RED before proxy/route namespace changes.
- [ ] **Step 6: Implement Next rewrites/proxy and Axum content route namespace without duplicating MangaDex logic in Next.
- [ ] **Step 7: Run auth config tests, application migration tests, JWT/JWKS verifier fixture, content proxy smoke, lint, typecheck and build. Verify Preview does not leak secrets.
- [ ] **Step 8: Commit** `feat: connect Neon auth and Axum content service`.

---

### Task 5: Next.js web migration and Rust WASM reader

**Files:**
- Create: `crates/reader-wasm/Cargo.toml`, `crates/reader-wasm/src/lib.rs`
- Create: `web/components/reader/ReaderClient.tsx`, `ReaderToolbar.tsx`, `ReaderPages.tsx`
- Modify: `web/app/page.tsx`, `web/app/search/page.tsx`, `web/app/manga/[id]/page.tsx`, `web/app/read/[chapterId]/page.tsx`, `web/app/globals.css`
- Remove after parity: direct MangaDex calls in `web/lib/mangadex.ts` and duplicate `/api/pages` logic

**Interfaces:**
- WASM exposes reader-core state methods through wasm-bindgen.
- Next reader receives typed manga/chapter/pages DTOs and keeps browser-only behavior in Client Components.

- [ ] **Step 1: Write failing WASM tests/build checks** for exported initialization, page boundary and progress methods.
- [ ] **Step 2: Run `wasm-pack build crates/reader-wasm --target web` and Next typecheck; expected RED.
- [ ] **Step 3: Implement the wasm-bindgen adapter and client initialization only in a browser-safe Client Component.
- [ ] **Step 4: Port the redesigned UI routes from the existing Leptos/legacy Next behavior to Next Server Components while reading data from Axum.
- [ ] **Step 5: Preserve reader features: vertical/horizontal, swipe, progress, settings, external chapter link, retry, local guest history.
- [ ] **Step 6: Run `npm run lint`, `npx tsc --noEmit`, `npm run build`, WASM build and Playwright smoke tests at 375px/desktop.
- [ ] **Step 7: Commit** `feat: migrate KasLyyDex web to Next and reader wasm`.

---

### Task 6: User profile, library, progress and guest merge

**Files:**
- Modify: `web/lib/db/schema.ts`, add migration
- Create: `web/lib/merge.ts`, `web/lib/validators.ts`
- Create: `web/app/api/v1/me/route.ts`, `library/route.ts`, `progress/route.ts`, `level/route.ts`
- Modify: `web/components/header.tsx`, `web/components/library/*`, `web/components/reader/*`

**Interfaces:**
- `GET/PATCH /api/v1/me`
- `GET/PUT/DELETE /api/v1/me/library/:mangaId`
- `PUT /api/v1/me/progress/:chapterId`
- `GET /api/v1/me/level`

- [ ] **Step 1: Write failing tests** for ownership, unique library rows, progress merge precedence (server newer wins unless local has a later timestamp), and unauthenticated responses.
- [ ] **Step 2: Run tests; expected RED.
- [ ] **Step 3: Add typed schema, validators, transaction-safe BFF handlers and guest merge endpoint.
- [ ] **Step 4: Add logged-in UI for profile, library, continue reading and cross-device progress.
- [ ] **Step 5: Verify duplicate requests are idempotent and a user cannot read/update another user’s rows.
- [ ] **Step 6: Run database migration tests, TypeScript tests and Playwright auth/library/progress flows.
- [ ] **Step 7: Commit** `feat: add synced user reading data`.

---

### Task 7: Comments, reports, moderation and in-app notifications

**Files:**
- Modify: `web/lib/db/schema.ts`, add migration
- Create: `web/app/api/v1/comments/route.ts`, `web/app/api/v1/comments/[id]/route.ts`, reports and moderation routes
- Create: `web/lib/moderation.ts`, `web/components/comments/*`, `web/components/notifications/*`

**Interfaces:**
- Comments target either manga or chapter; one-level `parentId` only.
- Comment status: `visible`, `hidden`, `removed`, `locked`.
- Moderator/admin route checks are required inside every mutation handler.

- [ ] **Step 1: Write failing tests** for comment ownership, one-level reply rejection, spoiler flag persistence, rate limit, report uniqueness and moderator-only actions.
- [ ] **Step 2: Run tests; expected RED.
- [ ] **Step 3: Implement typed schema, structured errors, rate limits and moderation transaction paths.
- [ ] **Step 4: Add UI for story/chapter comments, spoiler reveal, report dialog, moderation queue and unread notifications.
- [ ] **Step 5: Verify sanitized rendering and authorization with Playwright and route-level tests.
- [ ] **Step 6: Commit** `feat: add moderated comments and notifications`.

---

### Task 8: Progression, cultivation titles and anti-abuse

**Files:**
- Create: `web/lib/progression.ts`, tests
- Create: `web/app/api/v1/reader-sessions/route.ts`, `progress/complete/route.ts`
- Modify: progress schema/migrations and reader components
- Create: `web/components/profile/CultivationBadge.tsx`

**Interfaces:**
- `createReaderSession(chapterId) -> signed ticket`
- `checkpointReaderSession(ticket, lastPageSeen) -> progress`
- `completeChapter(ticket) -> { awarded: boolean, xp: number, level: number, title: string }`

- [ ] **Step 1: Write failing pure tests** for all 13 realm boundaries, level 1/1000 clamps, progression_v1 formula, and duplicate completion.
- [ ] **Step 2: Run tests; expected RED.
- [ ] **Step 3: Implement signed reader tickets, monotonic checkpoints, page range validation, rate limits and transactional completion/XP event.
- [ ] **Step 4: Add cultivation badge/profile UI and in-app level-up notification.
- [ ] **Step 5: Verify a forged percent value cannot award EXP and completion is idempotent under concurrent requests.
- [ ] **Step 6: Run full tests plus Playwright reader completion/level-up flow.
- [ ] **Step 7: Commit** `feat: add cultivation progression and xp integrity`.

---

### Task 9: CI, security, observability and Phase 1–2 release gate

**Files:**
- Create: `.github/workflows/ci.yml`, `infra/healthcheck`, `infra/deployment.md`
- Modify: `README.md`, `CHANGELOG.md`, `docs/WEB-STATUS.md`
- Add: security headers, structured logging and health checks in Next/Axum

- [ ] **Step 1: Add CI jobs** for Rust format/clippy/tests, Next lint/typecheck/build, WASM build and Playwright smoke.
- [ ] **Step 2: Add security headers, secret scanning, environment validation and structured request/error logs without tokens/passwords.
- [ ] **Step 3: Add Vercel Preview/Production deployment runbook and Neon migration runbook; include rollback procedure.
- [ ] **Step 4: Run the complete Phase 1–2 gate on a clean checkout; expected all tests/builds pass and Preview smoke passes.
- [ ] **Step 5: Update changelog and documentation with Phase 1–2 scope; commit** `chore: establish KasLyyDex phase release gates`.

---

## Deferred Phase 3–4 plan

After Task 9 is accepted:

- Phase 3: Android Compose, UniFFI, OAuth/PKCE native spike, DataStore/Room,
  FCM only after in-app notifications are stable.
- Phase 4: GPUI spike on Windows first; only port full UI after reader-core,
  JWT/JWKS and contracts pass parity tests.

## Plan self-review

- Spec coverage: rename/Git, Vercel/Neon, auth, contracts, WASM, Next migration,
  user data, comments, moderation, notifications, progression, anti-abuse,
  testing and release gates each map to a task.
- Interface consistency: Task 2 creates contracts consumed by Tasks 3–8;
  Task 3 creates auth/session consumed by Tasks 6–8; Task 5 creates reader
  ticket/checkpoint callers used by Task 8.
- Scope: Android and GPUI are explicitly deferred after Phase 1–2.
- Open external prerequisite: Vercel/Neon authorization and Google OAuth
  credentials are user-owned deployment inputs and must be supplied during
  Task 3/4, never committed.
