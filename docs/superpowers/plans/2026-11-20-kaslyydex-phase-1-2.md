# KasLyyDex Phase 1–2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing KasLyyDex baseline into a deployable Next.js/Vercel web platform with Neon-backed authentication and user features, while extracting a portable Rust Reader Core/WASM adapter for later Android and GPUI clients.

**Architecture:** Next.js owns web UI, SEO, authentication and `/api/v1/*` user BFF routes. Axum remains a separate content service for MangaDex, chapter/page access, DNS handling and image caching. Pure Rust domain/contracts/reader-core crates are shared by web WASM and future native adapters.

**Tech Stack:** Next.js 16.4.6, React 19.3, TypeScript, Tailwind CSS 4.3, Better Auth (email/password + Google + JWT/JWKS), Neon PostgreSQL, Drizzle ORM/Drizzle Kit, Zod, Axum, Rust WASM via wasm-bindgen/wasm-pack, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-20-kaslyydex-platform-design.md`

## Global Constraints

- Product name: `KasLyyDex`; keep native UI work deferred to Phase 3 Android and Phase 4 GPUI.
- Vercel runs Next.js/user BFF; Axum content service runs separately and is reached through `/api/content/*`.
- Auth is email/password + Google OAuth. Browser sessions use HttpOnly/Secure/SameSite cookies; native clients later use JWT/JWKS.
- EXP is 100 per valid chapter at ≥80% progress, once per user/chapter; level is `min(1000, 1 + floor(total_xp / 200))`.
- Cultivation titles are cosmetic/profile labels only; `user`, `moderator`, `admin` are separate authorization roles.
- Comments are manga- and chapter-scoped, visible immediately, support one-level replies, spoiler flag, reports and moderation actions.
- PostgreSQL invariants: unique completions, idempotent XP events, unique user/manga library, unique progress per user/manga/chapter/language, UTC timestamps.
- No secrets in Git; `.env*` is ignored except `.env.example`.
- Every user BFF mutation re-checks session, validates input, checks ownership/role, performs a transaction, and returns the structured error envelope.
- Phase 3/4 are not implemented by this plan; only their contracts and JWT/WASM compatibility are prepared.

## Review Focus

- Vercel/Neon preview and production environments must never share a mutable database branch: test environment selection and migration commands in Task 3.
- Guest localStorage merge must not overwrite newer server progress or duplicate library/completion/XP rows: test conflict resolution and idempotency in Task 5.
- A client cannot award XP by posting `percent=100`: test server-owned page count/ticket validation and duplicate completion in Task 6.
- A user cannot edit/delete another user’s comment or access moderator routes: test ownership and role checks in Task 7.
- Native token compatibility must be proven before Phase 3: test Better Auth JWT/JWKS verification against a separate verifier in Task 3.

---

## File Structure

| File/Directory | Responsibility |
|---|---|
| `web/` | Next.js application migrated from `legacy-next/` |
| `web/app/api/v1/` | Typed user BFF route handlers |
| `web/lib/auth.ts` | Better Auth config and providers |
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
- [ ] **Step 4: Add `.env.example` with variable names only**: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `RUST_CONTENT_API_ORIGIN`, `NEXT_PUBLIC_APP_URL`.
- [ ] **Step 5: Run `npm install`/`npm run build` from `web/` and `cargo test --workspace`; expected: existing behavior still builds.
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

### Task 3: Next/Vercel/Neon foundation and auth

**Files:**
- Modify: `web/package.json`, `web/next.config.ts`, `web/tsconfig.json`
- Create: `web/lib/db/client.ts`, `web/lib/db/schema.ts`, `web/lib/auth.ts`, `web/lib/auth-client.ts`
- Create: `web/app/api/auth/[...all]/route.ts`, `web/app/api/v1/health/route.ts`
- Create: `web/drizzle.config.ts`, `web/drizzle/0000_initial_auth.sql`
- Create: `infra/vercel.md`, `infra/env.example`

**Interfaces:**
- Auth uses Better Auth with Drizzle/Postgres, email/password, Google and JWT/JWKS plugin.
- `GET /api/v1/health` returns `{ ok: true, version: string }` without secrets.

- [ ] **Step 1: Add a failing auth configuration test** asserting email/password and Google provider are enabled, cookie settings are secure in production, and JWT/JWKS endpoints are present.
- [ ] **Step 2: Run the focused test with no database credentials; expected RED for missing config/schema.
- [ ] **Step 3: Add Drizzle/Neon client using a pooled Node runtime connection, Better Auth adapter, provider config and route handler. Validate env at startup without logging secret values.
- [ ] **Step 4: Create the initial migration for auth/profile support and a safe admin bootstrap mechanism based on an explicit email allowlist, not automatic level elevation.
- [ ] **Step 5: Add Vercel/Neon instructions for Development, Preview and Production variables; configure Neon preview branch/migration workflow. Do not deploy with real credentials in the repository.
- [ ] **Step 6: Run `npm run lint`, `npx tsc --noEmit`, and `npm run build`; expected GREEN with missing external credentials handled only in runtime config, not build output.
- [ ] **Step 7: Run the JWT/JWKS spike: obtain a test token from the auth endpoint and verify its signature using a standard Rust JWT/JWKS verifier fixture. Record the result.
- [ ] **Step 8: Commit** `feat: add Neon auth and Vercel foundation`.

---

### Task 4: Deploy Next skeleton to Vercel and route Axum content

**Files:**
- Modify: `web/next.config.ts`, `web/app/layout.tsx`, `web/app/page.tsx`
- Create: `web/lib/content-api.ts`, `web/app/api/content/[...path]/route.ts` or rewrite configuration
- Create: `infra/vercel.md`, `infra/axum.md`, health endpoint changes in `crates/server`

**Interfaces:**
- Browser calls `/api/content/*`; server rewrites/proxies to `RUST_CONTENT_API_ORIGIN`.
- Axum exposes content health and rejects invalid content IDs with structured errors.

- [ ] **Step 1: Add a failing smoke test** that requests `/`, `/api/v1/health`, `/api/content/latest`, and an invalid content ID through the intended local topology.
- [ ] **Step 2: Run it before proxy configuration; expected RED for `/api/content/*` and health route.
- [ ] **Step 3: Implement local proxy/rewrite and Axum content namespace without duplicating MangaDex logic in Next.
- [ ] **Step 4: Add Vercel project settings and deployment checklist; deploy a public Preview only after the user’s Vercel authorization is available.
- [ ] **Step 5: Verify Preview returns Next HTML, content data, compressed static assets and no secret leakage. Record the deployment URL in a local handoff, not source code.
- [ ] **Step 6: Commit** `feat: connect Next web to Axum content service`.

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
