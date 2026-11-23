# Netlify migration design — KasLyyDex (2026-11-23)

## Status

Design only. No application code, dependencies, deployments, or cloud resources
are changed by this document. Implementation starts only after this spec is
reviewed and an implementation plan is approved.

## Context

KasLyyDex currently runs as:

- a Next.js 16.4.6 frontend in `web/`,
- an Axum content API in `crates/server` (`RUST_CONTENT_API_ORIGIN`), targeted at Northflank as a containerized service,
- Neon Managed Auth (`@neon/auth`, `NEON_AUTH_*`) for identity,
- Neon Postgres (`DATABASE_URL`) via Drizzle + `pg` for application data,
- `@vercel/functions` for metric emission in `web/lib/observability.ts`.

There is no committed `vercel.json`. CI is GitHub Actions and contains no
Vercel-specific step. `infra/vercel.md` and several docs still describe Vercel
deploy steps. Local `.env.local` currently holds a Neon Postgres URL and is
gitignored.

The operator wants to remove Vercel and Neon entirely:

- deploy the Next frontend on Netlify using the zero-config OpenNext adapter,
- replace Neon Managed Auth with Netlify Identity,
- replace Neon Postgres with Netlify Database,
- keep the Axum content API as a separate runtime,
- host the Axum content API on Northflank with a Dockerfile;
- keep local `RUST_CONTENT_API_ORIGIN` as `http://127.0.0.1:3100` and leave the
  public Northflank URL for the operator to supply at deploy time.

## Goals

1. No Vercel runtime dependency in application code or docs.
2. No Neon runtime dependency in application code, env template, or docs.
3. Next.js App Router, PPR, route handlers, and streaming keep working on
   Netlify.
4. Axum builds and runs on Northflank as a long-lived container with a health
   check and persistent cache volume.
5. Existing application schema and Drizzle models remain the source of truth.
6. CI quality gates stay green before any deploy.
7. No credentials in tracked files.

## Non-goals

- No Netlify or Northflank login approval, project creation, or deploy in this
  change.
- No Axum on Netlify, no Kubernetes/BYOC cluster, and no Rust buildpack:
  Northflank's documented Rust path is a Dockerfile.
- No data copy from the existing Neon database. The only Neon data created so
  far was a smoke-test profile/library row that was deleted; no user data is
  being moved.
- No Auth0 extension, no third-party OAuth provider setup, no custom email
  templates, no invite-only mode.
- No Cloudflare/ToS workaround for Comick.
- No change to content provider adapters or UI behaviour.

## Architecture

### Frontend runtime

Netlify's Next.js adapter v5 (OpenNext) supports Next.js 13.5+ with zero
configuration, including App Router, PPR, route handlers, streaming, image
optimization, and middleware. Do not pin `@netlify/plugin-nextjs`; Netlify
updates the adapter automatically.

Add a minimal `netlify.toml` at the repository root:

```toml
[build]
  base = "web"
  command = "npm run build"

[build.environment]
  NODE_VERSION = "22"
```

No `publish` is set: the adapter provisions the correct output. No adapter
version is pinned.

### Axum content boundary on Northflank

Northflank supports Dockerfile builds and long-lived combined services from a
linked Git repository. Rust is not in Northflank's documented buildpack stack
list, so the backend ships as a multi-stage Dockerfile at repository root:

- builder stage compiles the workspace release binary `server`;
- runtime stage copies the binary and serves public HTTP on port `3100`;
- liveness probe `GET /api/v1/health`, readiness probe `GET /api/v1/ready`;
- a persistent volume is mounted at `CACHE_DIR` so the image cache survives
  redeploys;
- runtime secrets/variables are injected by Northflank (`CACHE_DIR`, `DIST_DIR`,
  optional `MANGADEX_API_ORIGIN`/`COMICK_API_ORIGIN`).

`RUST_CONTENT_API_ORIGIN` remains a server-only env var on Netlify. Its local
value stays `http://127.0.0.1:3100`. At deploy time the operator sets it to the
Northflank public URL; the browser keeps calling Next's same-origin
`/api/content/*` BFF, so no CORS change is needed. Preview environments require
a split build service + deployment services in a Northflank pipeline because
combined services cannot be part of pipelines; that split is not part of this
change.

### Observability

`web/lib/observability.ts` currently imports `metric` from `@vercel/functions`
and emits two bounded-name metrics. Replace `emitMetrics` with a local no-op
that documents the platform-neutral telemetry model:

- structured logs already carry `operation`, `outcome`, `status`, `durationMs`,
  and correlation id;
- no paid observability sink is enabled;
- no new dependency is added.

Remove `@vercel/functions` from `web/package.json` and regenerate
`package-lock.json`. Keep `OBSERVED_OPERATIONS`, `outcomeFor`, redaction, and
`withObservedRoute` unchanged. Update `observability.test.mjs` only if a direct
import of the removed module exists (current tests do not import it).

### Authentication — Netlify Identity

Use `@netlify/identity` with Netlify Identity. Official docs confirm Identity
is supported on all credit-based plans, provides email/password and OAuth
(Google, GitHub, GitLab, Bitbucket), server-side verification via `getUser()`
in Functions/Edge Functions, role-based access, and event functions. It
requires HTTPS. Netlify's knowledge base notes Identity does not work under
`netlify dev`; auth flows are verified on a Deploy Preview.

Implementation shape:

- `web/lib/auth.ts` becomes a provider adapter over `@netlify/identity`:
  `signup`, `login`, `logout`, `getUser`, `oauthLogin`, `handleAuthCallback`.
- Keep the `/api/auth/[...path]` route surface used by existing UI code where
  practical (`get-session`, sign-in, sign-up, sign-out, callback). If a route
  name must change, update its callers in the same change.
- Netlify Identity user IDs are opaque strings; store them directly in the
  existing `profiles.user_id` text primary key. No UUID conversion.
- Keep the existing role bootstrap rule: only a verified email on the explicit
  operator allowlist may receive a moderator role. Use the Identity user's
  verified-email state, never a client-supplied role field.
- Remove `@neon/auth` and all `NEON_AUTH_*` env references from code,
  `.env.example`, README, and docs.

### Database — Netlify Database

Netlify Database is Postgres-compatible. Official docs allow any Postgres
driver through `NETLIFY_DB_URL` or `getConnectionString()` from
`@netlify/database`; Drizzle ORM is supported. Keep the existing Drizzle schema
and `pg` driver in `web/lib/db/client.ts`, changing only configuration lookup:

- production/deploy: `NETLIFY_DB_URL`;
- local `netlify dev`: the local Netlify Database connection string;
- standalone scripts: an explicitly supplied `NETLIFY_DB_URL`.

Add `@netlify/database` so Netlify auto-provisions the database and so
`getConnectionString()` is available in Netlify Functions when the env var is
not injected. `getDatabase()` resolves `NETLIFY_DB_URL` first and falls back to
`getConnectionString()` only inside a Netlify runtime. Standalone scripts keep
requiring the env var and fail closed when it is absent.

Migration strategy:

- Move the eight existing SQL migrations from `web/drizzle/` to
  `netlify/database/migrations/` at the repository root, keeping their order.
- Rename them to Netlify's `<number>_<slug>.sql` pattern if the current names do
  not already satisfy it; preserve relative order lexicographically.
- Strip Drizzle-only `--> statement-breakpoint` markers from the copies so
  each file is plain SQL.
- Netlify applies migrations automatically immediately before publishing a
  production deploy and on each Deploy Preview's database branch.
- Update `web/scripts/database.test.mjs` to read the new path.
- Keep Drizzle Kit for generating future migrations; set `drizzle.config.ts`
  `out` to the Netlify migrations directory. Do not run both Netlify's migrator
  and `drizzle-kit migrate` against the same production database.

### Environment

Tracked `.env.example` becomes:

```
NETLIFY_DB_URL=
RUST_CONTENT_API_ORIGIN=
READER_TICKET_SECRET=
```

Netlify UI/CLI stores real secrets. `web/.env.local` stays gitignored and local
only; it is not a source for this change. Remove `DATABASE_URL`,
`NEON_AUTH_BASE_URL`, and `NEON_AUTH_COOKIE_SECRET` from tracked templates and
docs.

### Docs and CI

- Rename `infra/vercel.md` to `infra/netlify.md`; rewrite it for Netlify CLI,
  site link, env vars, Deploy Preview verification, rollback, and the Northflank
  URL used as `RUST_CONTENT_API_ORIGIN`.
- Create `infra/northflank.md` for the Dockerfile build, combined service, port
  `3100`, health probes, `CACHE_DIR` volume, secrets, domain, and build rollback.
- Update README and any SDD docs that instruct Vercel login/deploy. Historical
  SDD artifacts under `docs/superpowers/sdd/` remain unchanged as records.
- `.github/workflows/ci.yml` has no Vercel step; keep it. Optionally add a
  comment pointing to `infra/netlify.md`; no CI behaviour change.
- Keep `.gitignore` entries for `.vercel` harmlessly, or remove only if no
  tracked file depends on them.

## Data flow

1. Browser → Next.js on Netlify (OpenNext adapter).
2. Next.js route handlers → Netlify Identity for session/user verification.
3. Next.js server code → Netlify Database (`NETLIFY_DB_URL`) via Drizzle/`pg`
   for profiles, library, progress, comments, notifications, XP.
4. Next.js server code → Northflank Axum service public URL for manga content.
5. Netlify deploys apply SQL migrations before publish; Deploy Previews use a
   database branch.

## Error handling and security

- Missing `NETLIFY_DB_URL` must fail closed with the existing structured
  `DATABASE_NOT_CONFIGURED` 503, not fall back to Neon or in-memory storage.
- Identity verification failures must produce the existing unauthenticated/
  forbidden envelopes; never trust client-provided `role`/`totalXp`/`level`.
- All auth and DB errors continue through `redactSecrets` and
  `logStructured`. Connection strings and tokens are never logged.
- Public content routes may still work when auth is disabled; private routes
  fail closed.
- No secret is written to a tracked file, CI log, or commit message.

## Testing

Before any deploy:

- `npm run build`
- `npm run test:aggregate`
- `npm run test:browser`
- `npm run check:whitespace`
- `npm run check:secrets`
- `git diff --check`
- `cargo test --workspace` (no Rust change expected, but confirms boundary)

Add/adjust tests in the same change:

- replace any assertion that expects `@vercel/functions` with a platform-neutral
  assertion on bounded outcomes and correlation ids;
- update `database.test.mjs` migration paths;
- add a unit test that `readDatabaseConfig` accepts `NETLIFY_DB_URL` and rejects
  a missing/empty value;
- add a unit test that auth mapping never accepts a client-supplied role.

Auth end-to-end verification happens on a Netlify Deploy Preview because
Identity requires HTTPS and is not supported under `netlify dev`. Content and
UI flows can be checked with `netlify dev` plus a local Axum server.

## Rollback

- Frontend rollback: Netlify deploy history / previous published deploy.
- Backend rollback: Northflank build rollback / select a previous build; it does
  not undo database migrations.
- Database rollback: Netlify does not auto-revert schema. Any breaking schema
  change must use expand/contract across deploys. This change only relocates
  existing migrations; it introduces no new schema change.
- Auth rollback: keep the previous published deploy until Identity flows pass
  on a Deploy Preview; no dual-auth runtime is planned.

## Acceptance criteria

- `netlify.toml` exists with base `web`, command `npm run build`, Node 22.
- No tracked source imports `@vercel/functions`, `@neon/auth`, or `@/lib/neon`.
- No tracked env template or infra doc names `DATABASE_URL`, `NEON_AUTH_*`, or
  Vercel deploy commands outside historical SDD artifacts.
- `netlify/database/migrations/` contains the eight migrations in order, with
  no `--> statement-breakpoint` markers.
- `infra/netlify.md` and `infra/northflank.md` exist; `infra/vercel.md` is gone.
- A root `Dockerfile` builds the Axum server and exposes port `3100`.
- Local gates listed under Testing are green.
- No Netlify login, site creation, migration execution against a live Netlify
  database, or deploy occurs during implementation of this spec.

## Risks

- Netlify Database migration directory resolution in a monorepo with `base =
  "web"` must be verified during implementation; the spec chooses repository
  root `netlify/database/migrations` and the plan must confirm it against
  current docs before moving files.
- Netlify Identity's user/session API differs from Neon Managed Auth; the
  existing UI call surface may need small adjustments.
- Deployed content will be unavailable until the Northflank public URL is
  supplied as `RUST_CONTENT_API_ORIGIN`.
- Northflank's free-tier card requirement conflict is unresolved in its own
  docs; operator must confirm billing before project creation.
- MangaDex/Comick egress-IP blocking from Northflank was not verified; if it
  occurs, a static egress IP or provider allowlist is a separate decision.
- Identity cannot be tested under `netlify dev`; Deploy Preview testing needs
  operator approval for Netlify login.
- Removing Neon means the existing gitignored `.env.local` must be updated or
  ignored locally; it is not evidence that production env is configured.
