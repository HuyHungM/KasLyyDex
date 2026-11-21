### Task 4: Neon Managed Auth, application schema and Axum content boundary

**Files:**
- Modify: `web/package.json`, `web/next.config.ts`, `web/.env.example`
- Create: `web/lib/auth/server.ts`, `web/lib/auth/client.ts`, `web/lib/db/client.ts`, `web/lib/db/schema.ts`, `web/lib/contracts.ts`
- Create: `web/app/api/auth/[...path]/route.ts`, `web/drizzle.config.ts`, `web/drizzle/0000_application.sql`
- Modify: `crates/server/src/main.rs`, `crates/core/src/mangadex.rs`
- Create/update: `infra/vercel.md`, `infra/axum.md`

**Interfaces:**
- Neon Managed Auth (`@neon/auth/next/server`, `@neon/auth/next`), email/password + Google.
- Drizzle owns application tables only. Neon Auth-managed identity/session tables are never created/altered by Drizzle migrations.
- `profiles.user_id` is opaque text; never assume auth user IDs are UUIDs.
- Browser content API is same-origin `/api/content/*` rewritten/proxied to Axum at `RUST_CONTENT_API_ORIGIN`.
- Axum rejects invalid IDs and keeps MangaDex access/DNS/cache logic server-side.

- [ ] **Step 1: Write failing auth tests** for email/password + Google setup, secure production cookies, JWT/JWKS endpoint and application migration not touching Neon Auth tables.
- [ ] **Step 2: Configure Neon integration on the already-deployed Vercel Preview branch.** Enable Managed Auth for the development/preview branch and configure Google OAuth with owner-supplied credentials. Never write credential values into the repo or logs.
- [ ] **Step 3: Add `.env.example` variable names** `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET`, `DATABASE_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `RUST_CONTENT_API_ORIGIN`, `NEXT_PUBLIC_APP_URL`. Implement auth server/client using the documented Neon Next entry points. Validate required server env and never expose DATABASE_URL to browser bundles.
- [ ] **Step 4: Add the application-owned `profiles` table and migration with opaque text `user_id`; do not manage Neon Auth tables. Run/check migration against the preview app schema only.
- [ ] **Step 5: Write failing content-proxy tests** for `/api/content/latest` and malformed content ID through local Next→Axum topology.
- [ ] **Step 6: Implement Next rewrite/proxy and Axum content namespace.** Preserve current MangaDex logic in Axum; don't duplicate it in Next.
- [ ] **Step 7: Run auth tests, application migration/schema tests, JWT/JWKS verifier fixture, proxy smoke, lint, typecheck and build. Verify preview responses/logs expose no credentials.
- [ ] **Step 8: Commit** `feat: connect Neon auth and Axum content service`.

## Constraints

- Execution override (owner's latest request): Vercel deployment stays paused. Implement local SDK/schema/content integration and tests first. Do not provision Neon, set OAuth credentials, deploy, link external projects, or push. Preview deployment, actual Neon migrations, and Google sign-in remain explicit unverified gates.
- Resolve the current Neon Managed Auth npm package and exports from official docs/package metadata before installing; the older `@neon/auth` example path is not authoritative if the published package uses `@neondatabase/auth`.
- Missing external configuration must return a structured service-not-configured response only on routes that need it. Public pages, health and builds must still work without credentials. Never substitute a fake authenticated session.

- Worktree: `D:\Code\nodejs\kaslyydex\.worktrees\kaslyydex-phase-1-2`.
- Preview deploy must already exist from Task 3 before connecting Neon.
- Task 4 depends on user-provided OAuth credentials/Neon project authorization. If unavailable, report the exact missing action; do not invent credentials or claim auth integration verified.
- Do not implement user library/comments/EXP in this task; those belong to Tasks 6–8.
- No subagents. Write full report to `docs/superpowers/sdd/kaslyydex-phase-1-2/task-4-report.md`.
