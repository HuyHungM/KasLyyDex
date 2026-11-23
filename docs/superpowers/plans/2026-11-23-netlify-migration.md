# Netlify Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Vercel and Neon with Netlify (frontend, identity, application data) and Northflank (Axum backend) while preserving the existing product behavior.

**Architecture:** Next.js 16 stays in `web/` and deploys via Netlify's zero-config OpenNext adapter. Vercel-only metric emission becomes a local no-op. Neon Managed Auth becomes Netlify Identity behind the existing `/api/auth` surface; Neon Postgres becomes Netlify Database behind the existing Drizzle/`pg` boundary. Axum builds from a root `Dockerfile` and runs as a Northflank combined service with a persistent `CACHE_DIR` volume; Netlify sets `RUST_CONTENT_API_ORIGIN` to that service URL.

**Tech Stack:** Next.js 16.4.6, Netlify Next.js adapter v5 (OpenNext), Netlify Identity + `@netlify/identity`, Netlify Database + `NETLIFY_DB_URL`, Drizzle ORM, `pg`, Node 22, existing Playwright/Node test harness.

**Spec:** `docs/superpowers/specs/2026-11-23-netlify-migration-design.md`

## Global Constraints

- `netlify.toml`: `base = "web"`, `command = "npm run build"`, `NODE_VERSION = "22"`. Do not pin the Next adapter or set `publish`.
- No tracked source may import `@vercel/functions`, `@neon/auth`, or reference Neon/Vercel deploy commands (historical SDD artifacts excluded).
- Env template names are exactly `NETLIFY_DB_URL`, `RUST_CONTENT_API_ORIGIN`, `READER_TICKET_SECRET`; `DATABASE_URL`, `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET` are removed.
- `RUST_CONTENT_API_ORIGIN` local value stays `http://127.0.0.1:3100`; at deploy time the operator supplies the Northflank public URL.
- Axum runs on Northflank as a Dockerfile-based combined service on port `3100`, with liveness `/api/v1/health`, readiness `/api/v1/ready`, and a persistent volume mounted at `CACHE_DIR`.
- Auth IDs remain opaque strings; `profiles.user_id` stays `text`. Client-supplied `role`, `level`, `totalXp`, `percent`, `pageCount` remain rejected.
- Migrations live at repository-root `netlify/database/migrations/` with `<number>_<slug>.sql` names and no `--> statement-breakpoint` markers; relative order preserved.
- No secrets in tracked files; `.env.local` stays gitignored and is not read by tests.
- No Netlify login, site creation, migration execution against a live DB, or deploy during implementation.

## Review Focus

- Missing `NETLIFY_DB_URL` must fail closed with `DATABASE_NOT_CONFIGURED`, never fall back to Neon/PGlite in runtime code — pinned in Task 3's config test.
- Netlify Identity users must map to `AccountIdentity` without trusting browser fields or granting roles — pinned in Task 4's identity mapping test.
- Existing `/api/auth/get-session` callers must keep working after the provider swap — pinned in Task 4's route test and Task 5's aggregate run.
- Migration relocation must keep all eight files in identical order and valid plain SQL — pinned in Task 3's file-list/contents test.
- Observability must keep bounded outcomes and correlation ids after removing Vercel metrics — pinned in Task 1's source/behavior tests.

---

### Task 1: Remove Vercel-only metrics

**Files:**
- Modify: `web/lib/observability.ts`
- Modify: `web/package.json`, `web/package-lock.json`
- Test: `web/scripts/observability.test.mjs`

**Interfaces:**
- Consumes: existing `logStructured`, `OBSERVED_OPERATIONS`, `outcomeFor`, `withObservedRoute`.
- Produces: `emitMetrics(operation: ObservedOperation, outcome: string, durationMs: number): void` as a local no-op; no exported `@vercel/functions` symbols.

- [ ] **Step 1: Write failing tests** in `web/scripts/observability.test.mjs`:
  - read `web/lib/observability.ts` and assert it does not contain `@vercel/functions`;
  - keep the existing "metric outcomes are bounded and never echo request detail" assertions;
  - keep the existing "observed routes add correlation ids without changing status or body" assertions.

- [ ] **Step 2: Run the focused test and confirm it fails** on the import assertion.

  Run: `node --test scripts/observability.test.mjs`
  Expected: FAIL with the `@vercel/functions` import still present.

- [ ] **Step 3: Replace the import and `emitMetrics` body** in `web/lib/observability.ts` with a local function that documents platform-neutral structured logging and does nothing. Keep every other export and signature unchanged.

- [ ] **Step 4: Remove the dependency** with `npm uninstall @vercel/functions` from `web/`.

- [ ] **Step 5: Run the focused test and confirm PASS.**

- [ ] **Step 6: Commit** with `test: keep observability platform-neutral`.

### Task 2: Netlify build config and env/doc cleanup

**Files:**
- Create: `netlify.toml`
- Modify: `web/.env.example`, `README.md`
- Rename: `infra/vercel.md` → `infra/netlify.md`
- Test: `web/scripts/env-validation.test.mjs`

**Interfaces:**
- Consumes: spec's exact config values and env names.
- Produces: Netlify build config file and tracked env template with no Neon names.

- [ ] **Step 1: Write failing assertions** in `web/scripts/env-validation.test.mjs`:
  - `netlify.toml` exists at repository root and contains `base = "web"`, `command = "npm run build"`, `NODE_VERSION = "22"`;
  - `web/.env.example` contains `NETLIFY_DB_URL=`, `RUST_CONTENT_API_ORIGIN=`, `READER_TICKET_SECRET=`;
  - `web/.env.example` does not contain `DATABASE_URL`, `NEON_AUTH_BASE_URL`, or `NEON_AUTH_COOKIE_SECRET`;
  - `infra/netlify.md` exists and `infra/vercel.md` does not.

- [ ] **Step 2: Run the focused test and confirm FAIL.**

  Run: `node --test scripts/env-validation.test.mjs`
  Expected: FAIL on the missing `netlify.toml`.

- [ ] **Step 3: Create `netlify.toml`**, edit `web/.env.example`, rename and rewrite `infra/netlify.md` for Netlify CLI/site link/env/rollback/Axum limitation, and update README references from Vercel to Netlify. Leave `docs/superpowers/sdd/` historical artifacts untouched.

- [ ] **Step 4: Run the focused test and confirm PASS.**

- [ ] **Step 5: Commit** with `chore: switch build config and docs to Netlify`.

### Task 3: Netlify Database config and migration relocation

**Files:**
- Modify: `web/lib/db/client.ts`, `web/drizzle.config.ts`, `web/scripts/database.test.mjs`
- Move: `web/drizzle/0000_application.sql` … `web/drizzle/0007_reader_session_source.sql` → `netlify/database/migrations/`
- Test: `web/scripts/database.test.mjs`, `web/scripts/env-validation.test.mjs`

**Interfaces:**
- Consumes: `NETLIFY_DB_URL`; Drizzle schema in `web/lib/db/schema.ts`; `pg.Pool`.
- Produces: `readDatabaseConfig(env = process.env): { url: string }` reading `NETLIFY_DB_URL`; `getDatabase()` using that config with `getConnectionString()` fallback only in a Netlify runtime.

- [ ] **Step 1: Write failing tests**:
  - in `env-validation.test.mjs`, assert `readDatabaseConfig({ NETLIFY_DB_URL: "postgresql://u:p@localhost/db" })` returns that URL and `readDatabaseConfig({})` throws `DATABASE_NOT_CONFIGURED` with `missing: ["NETLIFY_DB_URL"]`;
  - in `database.test.mjs`, change `migrationUrls` to the eight files under `../../netlify/database/migrations/`;
  - add an assertion that no migration file contains `--> statement-breakpoint` and that the ordered filenames end with `_application`, `_account_data`, `_comments_moderation`, `_community_cursor_scrub`, `_notification_feed_cursor`, `_notification_pending`, `_progression`, `_reader_session_source`.

- [ ] **Step 2: Run focused tests and confirm FAIL.**

  Run: `node --test scripts/env-validation.test.mjs scripts/database.test.mjs`
  Expected: FAIL on config name and migration path.

- [ ] **Step 3: Implement config change** in `web/lib/db/client.ts`; install `@netlify/database` in `web/`; update `web/drizzle.config.ts` `out` to `../netlify/database/migrations`.

- [ ] **Step 4: Move and normalize migration files** to repository-root `netlify/database/migrations/`, preserving SQL statements but deleting `--> statement-breakpoint` markers.

- [ ] **Step 5: Run focused tests and confirm PASS.**

- [ ] **Step 6: Verify no production code reads `DATABASE_URL`** with a grep over `web/` excluding historical SDD docs.

- [ ] **Step 7: Commit** with `feat(db): use Netlify Database connection and migrations`.

### Task 4: Netlify Identity server adapter

**Files:**
- Modify: `web/lib/auth/server.ts`, `web/lib/auth/identity.ts`, `web/app/api/auth/[...path]/route.ts`
- Test: `web/scripts/auth.test.mjs`

**Interfaces:**
- Consumes: `@netlify/identity` exports `signup`, `login`, `logout`, `getUser`, `oauthLogin`, `handleAuthCallback`.
- Produces: `getAuth(): NetlifyIdentityAdapter` with `getSession(): Promise<AccountIdentity | null>`; `identityFromNetlifyUser(user: unknown): AccountIdentity | null`; existing `/api/auth/get-session` response shape retained.

- [ ] **Step 1: Write failing tests** in `web/scripts/auth.test.mjs`:
  - `identityFromNetlifyUser` maps a Netlify user with `id`, `email`, `email_verified: true`, `user_metadata.full_name` into `AccountIdentity` with `emailVerified: true`;
  - it returns `null` for missing/oversized `id` and for `email_verified: false`;
  - it ignores `user.app_metadata.role`, `role`, and any client-supplied privilege field;
  - `AUTH_NOT_CONFIGURED` is returned when Netlify Identity is unavailable in the runtime, with `service: "auth"` in details.

- [ ] **Step 2: Run the focused test and confirm FAIL.**

  Run: `node --test scripts/auth.test.mjs`
  Expected: FAIL because `identityFromNetlifyUser` does not exist.

- [ ] **Step 3: Implement the adapter**:
  - `identity.ts`: add `identityFromNetlifyUser` and keep `AccountIdentity` unchanged; `sessionId` is the Identity user id.
  - `server.ts`: replace Neon auth creation/JWKS verification with a lazy adapter over `getUser()`; keep `AuthConfigurationError`, `authErrorResponse`, and structured error logging.
  - `route.ts`: keep `GET/POST` for `get-session`, `sign-in`, `sign-up`, `sign-out`, `callback`; return `405` with `Allow` for other methods.

- [ ] **Step 4: Run focused tests and confirm PASS.**

- [ ] **Step 5: Commit** with `feat(auth): swap Neon Managed Auth for Netlify Identity`.

### Task 5: Update auth callers and UI

**Files:**
- Modify: `web/lib/auth/client.ts`, `web/components/account/AuthPanel.tsx`, `web/lib/account/client.ts`, `web/lib/me/handlers.ts`, `web/lib/community/handlers.ts`, `web/lib/progression-api.ts`
- Test: `web/scripts/account.test.mjs`, `web/scripts/community.test.mjs`, `web/scripts/progression.test.mjs`

**Interfaces:**
- Consumes: Task 4's `getAuth().getSession()` and `identityFromNetlifyUser`; existing `AccountIdentity`.
- Produces: browser sign-in/up/out and Google OAuth via `@netlify/identity`; server session resolution into the same `identity` used by account/community/progression handlers.

- [ ] **Step 1: Write/adjust failing tests**:
  - account test: sign-out posts to `/api/auth/sign-out` and clears local guest state only after a successful response;
  - community/progression tests: forged `role`/`totalXp` in a request body still cannot grant privileges when session identity is absent;
  - existing session tests now inject a Netlify-shaped user.

- [ ] **Step 2: Run the focused tests and confirm FAIL.**

  Run: `node --test scripts/account.test.mjs scripts/community.test.mjs scripts/progression.test.mjs`
  Expected: FAIL on old auth client calls.

- [ ] **Step 3: Replace client calls** in `client.ts`/`AuthPanel.tsx` with `@netlify/identity` `signup/login/logout/oauthLogin("google")`, and call `handleAuthCallback()` on page load.

- [ ] **Step 4: Replace server session resolution** in `me`, `community`, and `progression` handlers with Task 4's adapter and mapping. Keep every authorization check and error envelope unchanged.

- [ ] **Step 5: Run focused tests and confirm PASS.**

- [ ] **Step 6: Commit** with `feat(auth): wire Netlify Identity through account UI and handlers`.

### Task 6: Northflank Axum service packaging

**Files:**
- Create: `Dockerfile`
- Create: `infra/northflank.md`
- Modify: `web/.env.example`
- Test: `web/scripts/env-validation.test.mjs`

**Interfaces:**
- Consumes: Axum workspace at `crates/server`, binary `server`, port `3100`, health routes `/api/v1/health` and `/api/v1/ready`, env `CACHE_DIR`/`DIST_DIR`.
- Produces: a Dockerfile that builds and runs `server`; documented Northflank combined-service settings and `RUST_CONTENT_API_ORIGIN` value shape.

- [ ] **Step 1: Write failing assertions** in `web/scripts/env-validation.test.mjs`:
  - root `Dockerfile` exists and contains a Rust builder stage, a runtime stage, `EXPOSE 3100`, and no hardcoded secrets;
  - `infra/northflank.md` exists and names the Dockerfile build type, combined service, public port `3100`, liveness `/api/v1/health`, readiness `/api/v1/ready`, `CACHE_DIR` volume, and build rollback;
  - `web/.env.example` still contains `RUST_CONTENT_API_ORIGIN=` with no literal Northflank hostname.

- [ ] **Step 2: Run the focused test and confirm FAIL.**

- [ ] **Step 3: Create the multi-stage Dockerfile** and `infra/northflank.md` with the values pinned above. Document that preview pipelines need split build/deployment services and are out of scope.

- [ ] **Step 4: Run the focused test and confirm PASS.**

- [ ] **Step 5: Commit** with `chore: package Axum for Northflank deployment`.

### Task 7: Full gate and reference sweep

**Files:**
- Test only: repository-wide assertions in `web/scripts/env-validation.test.mjs`

**Interfaces:**
- Consumes: all previous tasks.
- Produces: a green local gate and proof that no Neon/Vercel runtime references remain.

- [ ] **Step 1: Add a source sweep test** asserting tracked source/doc files outside `docs/superpowers/sdd/` contain no `@neon/auth`, `NEON_AUTH_`, `DATABASE_URL`, `@vercel/functions`, or `vercel deploy` strings.

- [ ] **Step 2: Run the sweep and confirm FAIL before earlier tasks are merged; once merged, confirm PASS.**

- [ ] **Step 3: Run the full gate** in `web/`:
  - `npm run build`
  - `npm run test:aggregate`
  - `npm run test:browser`
  - `npm run check:whitespace`
  - `npm run check:secrets`
  - `git diff --check`
  - from repo root: `cargo test --workspace`

  Expected: all green. Any auth test that requires HTTPS/Deploy Preview is documented as an operator check, not skipped by disabling a test.

- [ ] **Step 4: Commit** with `test: verify Netlify migration gates and reference sweep`.
