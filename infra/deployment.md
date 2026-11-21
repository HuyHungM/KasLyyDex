# KasLyyDex Phase 1–2 release / deployment runbook

## Current status

Deployment is paused by the owner. This document is a runbook only. Task 9 did
not deploy, create/link a Vercel project, provision Neon, change Vercel settings,
use real provider credentials, merge, or push. No Preview or Production URL was
verified. Non-empty values for secrets are intentionally absent from Git.

Two deployment facts must be resolved before any cloud action:

1. Vercel documentation states that the **first deployment of a new project is
   always Production**, even with `--target preview`. Decide the first target and
   domain with the owner before linking/deploying; do not assume a Preview URL.
2. A prior `create_project` attempt returned `402 resource_creation_blocked`
   because the Vercel team exceeded fair-use limits. Do not bypass that block
   with another team/account or temporary project. Wait for the owner to resolve
   the limit/team access.

## Deterministic local release gate (secret-free)

The same commands run in `.github/workflows/ci.yml`; CI requests no secrets.

```bash
# repository root
node web/scripts/secret-scan.mjs .
cargo fmt --check -p domain -p contracts -p reader-core -p server
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo build -p server

cd web
npm ci
npm run build:wasm        # must happen before the Next build
npm run build:web
npm run typecheck         # needs generated WASM glue and Next route types
npm run lint
npm run test:aggregate
npm run browser:install   # installs Playwright Chromium in CI
npm run test:browser
git diff --check
```

Local Windows verification uses the installed Edge path discovered by
`web/scripts/browser.mjs`. CI installs Chromium; an operator can override the
binary with `PLAYWRIGHT_CHROMIUM_EXECUTABLE` when a system browser is already
available. Full-workspace `cargo fmt --check` remains a pre-existing Leptos/UI
baseline exception; CI scopes formatting to maintained packages.

## Required environment names

Set through the owner's Vercel project/Neon branch secret store, never in Git.
See `web/.env.example`; empty values only.

```
NEON_AUTH_BASE_URL
NEON_AUTH_COOKIE_SECRET
DATABASE_URL
READER_TICKET_SECRET
OPERATOR_EMAIL_ALLOWLIST   # optional operator bootstrap
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
RUST_CONTENT_API_ORIGIN    # Axum service origin used by the Next BFF
NEXT_PUBLIC_APP_URL
```

`READER_TICKET_SECRET` must be at least 32 characters; without it progression
routes fail closed. `NEON_AUTH_COOKIE_SECRET` must also be at least 32
characters. `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` document owner-managed
provider inputs; the Next SDK adapter does not read them directly. Never prefix
server secrets with `NEXT_PUBLIC_`.

## Health and observability

- `GET /api/v1/health` is liveness: no DB, auth, ticket or upstream access and
  no secrets. `GET /api/v1/ready` checks configuration, DB and the Axum readiness
  route with 1.5s timeouts; its body contains only status/check names and missing
  env names. Axum readiness is configuration-only because Axum owns no DB.
- `node infra/healthcheck <baseUrl>` prints status codes only. Use
  `--liveness-only` before DB/auth configuration exists.
- Security headers are set on Next (`next.config.ts`) and Axum. CSP allows
  same-origin `/api/content/img` and `/_next/image`, `data:`/`blob:` images and
  `'wasm-unsafe-eval'`; it lists no third-party origins.
- Structured JSON logs carry `correlationId` and redact Cookie, Authorization,
  tickets, passwords, emails, database URLs and upstream keys. Upstream errors
  returned to clients are generic (`UPSTREAM_ERROR`, 502).
- Operator metric names (only bounded `operation`/`outcome` labels, no PII):
  `kaslyydex.user_requests`, `kaslyydex.user_request.duration_ms`. Operations:
  `auth`, `account`, `community`, `progression`; outcomes: `success`,
  `unauthenticated`, `forbidden`, `not_found`, `conflict`, `rate_limited`,
  `unavailable`, `client_error`, `server_error`. Health, static assets and
  content pass-through are not instrumented. Locally `metric()` is a no-op;
  Vercel ingestion is unverified and paid Observability was not enabled.

## Manual external gates (not run by CI)

1. Owner authenticates Vercel CLI and approves team access. Confirm first-deploy
   target and the 402 fair-use resolution.
2. Create/link the Vercel project manually; wire the environment names above for
   the chosen environment. No project settings were changed by Task 9.
3. Enable Neon Managed Auth on a branch; configure the Google provider with owner
   credentials; complete a real sign-in and live JWT/JWKS verification.
4. Create a separate Neon branch/database for Preview. Apply migrations with
   `cd web && npx drizzle-kit migrate` using a securely injected `DATABASE_URL`;
   confirm only application tables are created and `neon_auth` is untouched.
5. Deploy the built app manually, verify `health`/`ready`, content proxy, a real
   browser-to-Neon account/progression flow and error paths. Record the actual
   deployment URL/target. Do not call these gates passed until observed.

## Neon migration and rollback

Before migrating, create/verify a Neon branch or restore point and record the
current `drizzle.__drizzle_migrations` state. `drizzle-kit migrate` applies the
generated SQL files in `web/drizzle/0000..0006` idempotently using its migration
log; it has no automatic down command. Rollback procedure:

1. Stop writes to the affected environment (or point the app at a known-good
   branch) before changing `DATABASE_URL`.
2. Restore the Neon branch to the pre-migration restore point, or re-point
   `DATABASE_URL` to the previous branch after verifying its migration log.
3. Re-run `node infra/healthcheck <baseUrl>` and read-only checks for profiles,
   library/progress, comments and progression rows.
4. If only the latest additive migration was applied and application writes are
   absent, an operator may craft a reviewed compensating SQL migration; never
   edit applied migration files in place.

These steps were not executed against any live Neon branch.
