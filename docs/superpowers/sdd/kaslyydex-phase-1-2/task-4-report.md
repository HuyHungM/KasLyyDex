# Task 4 report — Neon Managed Auth, application schema, Axum content boundary

## Scope and decisions

- Base: `4af9f17c04518efed0c41a2490104c7075a2acf0`, worktree
  `D:\Code\nodejs\kaslyydex\.worktrees\kaslyydex-phase-1-2`.
- No subagents, deployment, Vercel/Neon provisioning, OAuth setup, live database
  mutation, push, credentials or external project creation.
- Official npm metadata and Neon docs were checked before installing. The current
  published package is `@neon/auth@0.8.2`, with `@neon/auth/next/server` and
  `@neon/auth/next` entry points. The older `@neondatabase/auth` package resolves
  to a `0.7.0-beta` release and was not used.
- Vercel remains paused. No Preview or Production deployment exists from this task.
  A previous `create_project` attempt returned `402 resource_creation_blocked`;
  no project was created and no bypass was attempted. Vercel's current docs state
  the first deployment of a new project is always Production even with
  `--target preview`, so first-deploy target/domain is an owner decision.

## Implemented

- `web/lib/auth/server.ts`: real `createNeonAuth` adapter, lazy singleton, explicit
  `NEON_AUTH_BASE_URL` / `NEON_AUTH_COOKIE_SECRET` validation, structured 503 for
  missing/invalid config, no fake sessions, EdDSA JWT/JWKS verifier using the
  documented `/.well-known/jwks.json` endpoint and origin `iss`/`aud`.
- `web/lib/auth/client.ts`: real `createAuthClient` from `@neon/auth/next` and a
  typed Google social sign-in helper; no OAuth credentials in the browser bundle.
- `web/app/api/auth/[...path]/route.ts`: catch-all GET/POST/PUT/PATCH/DELETE
  handlers delegating to the SDK; config failures return the shared error envelope.
- `web/lib/db/client.ts` + `web/lib/db/schema.ts`: lazy pooled `pg`/Drizzle client,
  application-owned `profiles` table with opaque text `user_id` and UTC timestamps.
  No Neon Auth identity/session table is referenced or managed.
- `web/drizzle.config.ts`, `web/drizzle/0000_application.sql`,
  `web/drizzle/meta/*`: generated application-only migration and journal.
- `web/lib/contracts.ts`: browser-safe shared error envelope, typed content DTOs,
  `contentPath` and a typed `createContentClient`.
- `web/app/api/content/[...path]/route.ts`: same-origin proxy to
  `${RUST_CONTENT_API_ORIGIN}/api/content/*`; safe header forwarding, structured
  503 when unconfigured and structured 502 on upstream transport failure.
- `web/next.config.ts`: `serverExternalPackages: ["pg"]`; no rewrite is needed
  because the route handler can return a JSON 503 when the origin is absent.
- `crates/server/src/main.rs`: adds `/api/content/*` routes sharing handlers with
  untouched legacy `/api/*` paths; invalid IDs return the shared error envelope.
- `crates/core/src/mangadex.rs`: shared `is_uuid` guard and optional
  `MANGADEX_API_ORIGIN` fixture override, defaulting to the real MangaDex origin.
- `web/package.json`, `web/package-lock.json`, `web/.env.example`: real SDK/ORM/test
  dependencies and owner-supplied variable names only.
- `infra/vercel.md`, `infra/axum.md`: local status, unverified gates and runbooks.
- Tests: `web/scripts/test-helpers.mjs`, `auth.test.mjs`, `database.test.mjs`,
  `content-proxy.test.mjs`; `npm run test:task4` builds Next and Axum then runs them.

## RED → GREEN

RED command, before implementation:

```bash
cd web
npm run build
cargo build -p server
node --conditions=react-server --test scripts/auth.test.mjs scripts/database.test.mjs scripts/content-proxy.test.mjs
```

RED result: 3/3 test files failed because the new auth/database/contract modules
did not exist (`ERR_MODULE_NOT_FOUND`); no auth 503, migration assertions or
content namespace tests could pass. A local test-harness bug (a raw `node:net`
server used as an HTTP fixture) was fixed while wiring GREEN; it was not a product
change or a suppression.

GREEN command:

```bash
cd web
node --import tsx --conditions=react-server --test \
  scripts/auth.test.mjs scripts/database.test.mjs scripts/content-proxy.test.mjs
```

GREEN result: **13/13 tests passed**.

- Auth config validation rejects missing, malformed and short-secret configuration.
- Real SDK lazily constructs a server instance only with valid config.
- Missing auth env returns 503 `AUTH_NOT_CONFIGURED` on two auth routes and no
  `Set-Cookie`; health remains 200.
- Fixture-only local upstream verifies email/password and Google social proxy
  requests, and that session cookies are rewritten with `Secure`, `HttpOnly`,
  `SameSite=Lax` in production.
- Fixture-only Ed25519 token/JWKS test verifies signature, issuer and audience,
  and rejects a wrong issuer.
- PGlite applies the actual generated SQL migration; only `public.profiles` exists,
  `user_id` is text PK, opaque ids work, duplicates fail, transaction rollback works,
  and no `neon_auth` schema is created.
- Real compiled Axum serves both legacy and `/api/content/latest` from a local
  MangaDex fixture; Next proxy passes content and malformed-ID 400 through; missing
  origin returns 503 `CONTENT_NOT_CONFIGURED`.

## Other verification

- `npm run test:task4`: Next build + Axum build + all 13 tests, GREEN.
- `npm run test:smoke` and `node --test scripts/smoke.test.mjs`: 2/2 GREEN with
  auth/database/content env removed; root and health stay public.
- `npx tsc --noEmit`: GREEN.
- Focused ESLint on all changed web files: GREEN, 0 errors/warnings.
- `npm run lint`: 4 pre-existing `react-hooks/set-state-in-effect` errors remain in
  `chapter-list.tsx`, `continue-reading.tsx`, `manga-actions.tsx`, `reader.tsx`.
  None were suppressed or refactored.
- `cargo test --workspace`: GREEN (35 tests including the new content guard test).
- `cargo clippy --workspace --all-targets -- -D warnings`: GREEN.
- `cargo fmt --check`: fails on pre-existing formatting differences in unrelated
  files; `rustfmt --check --edition 2021` on the two Rust files touched here is GREEN.

## Dev/test-only PostgreSQL note

Docker is installed but its daemon is unavailable and no `psql` client exists. No
container, cloud database, schema or existing database was created or changed. The
migration and transaction tests use `@electric-sql/pglite` strictly as an embedded
dev/test PostgreSQL engine. Runtime code still uses pooled real PostgreSQL via
`pg`/Drizzle. This does not certify Neon connectivity or permissions.

## Fixture-only and explicitly unverified

The auth proxy and JWT/JWKS tests are fixture-only: they use local HTTP servers and
a generated Ed25519 key. They do **not** prove any of the following:

- Neon Managed Auth is enabled on any branch.
- Google OAuth is configured with owner-supplied credentials.
- A real Google sign-in or live session token works.
- A live Neon JWT was verified against a live JWKS endpoint.
- The application migration was applied in Neon or that branch permissions allow it.
- Any Vercel Preview/Production deployment, environment variable wiring or domain
  was created or verified.

No credentials, tokens, secrets, deployment URLs or live project identifiers are
recorded in this report or in source.
