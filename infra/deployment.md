# KasLyyDex release / deployment runbook

## Current status

Deployment is owner-gated. No cloud login, site/project creation, environment
write, deploy, domain change or rollback was performed. No Preview or Production
URL is asserted here. Non-empty values for secrets are intentionally absent from
Git. Platform details live in `infra/netlify.md` (frontend) and
`infra/northflank.md` (Axum content service); this document is the shared gate
and handoff checklist.

## Deterministic local release gate (secret-free)

The same commands run in `.github/workflows/ci.yml`; CI requests no secrets.

```bash
# repository root
node web/scripts/secret-scan.mjs .
cargo fmt --check -p domain -p contracts -p reader-core -p reader-wasm -p server
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
node web/scripts/whitespace-check.mjs .
```

Local Windows verification uses the installed Edge path discovered by
`web/scripts/browser.mjs`. CI installs Chromium; an operator can override the
binary with `PLAYWRIGHT_CHROMIUM_EXECUTABLE` when a system browser is already
available. Full-workspace `cargo fmt --check` remains a pre-existing Leptos/UI
baseline exception; CI scopes formatting to maintained packages.

## Required environment names

Set through the Netlify site settings or CLI, never in Git. See
`web/.env.example`; empty values only.

```
NETLIFY_DB_URL
READER_TICKET_SECRET
OPERATOR_EMAIL_ALLOWLIST   # optional operator bootstrap, provided out of band
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
RUST_CONTENT_API_ORIGIN    # Axum service origin used by the Next BFF
NEXT_PUBLIC_APP_URL
```

Identity is provisioned by Netlify Identity; it has no application environment
configuration. `READER_TICKET_SECRET` must be at least 32 characters; without it
progression routes fail closed. `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`
document owner-managed provider inputs; the Identity adapter does not read them
directly. Never prefix server secrets with `NEXT_PUBLIC_`.

## Health and observability

- `GET /api/v1/health` is liveness: no DB, ticket or upstream access and no
  secrets. `GET /api/v1/ready` checks configuration, DB and the Axum readiness
  route with 1.5s timeouts; its body contains only status/check names and missing
  env names. Axum readiness is configuration-only because Axum owns no DB.
- `node infra/healthcheck <baseUrl>` prints status codes only. Use
  `--liveness-only` before DB configuration exists.
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
  content pass-through are not instrumented. Locally the metric emitter is a
  no-op; deployed ingestion is unverified and paid Observability was not
  enabled.

## Manual external gates (not run by CI)

1. Owner links the Netlify site and injects the environment names above for the
   chosen deploy context. No project settings were changed by this migration.
2. Enable Netlify Identity, configure the Google provider with owner credentials
   and complete a real sign-in plus JWT/JWKS verification on an HTTPS Deploy
   Preview. Local browser tests use a loopback fixture only.
3. Point `RUST_CONTENT_API_ORIGIN` at the separately deployed Axum service and
   verify content proxy, liveness and readiness.
4. Create a dedicated database branch for any Preview. Apply migrations with
   `npx drizzle-kit migrate` using the owner-supplied connection string; confirm
   only application tables are created.
5. Verify the built app's health/ready, account, community and progression flows
   plus error paths in a real browser. Record the actual deploy URL/context. Do
   not call these gates passed until observed.

## Rollback (manual, owner-gated)

- Frontend: use Netlify deploy history to publish a previous successful deploy,
  then rerun `node infra/healthcheck <owner-supplied-deployment-url>`.
- Axum service: use the Northflank build rollback in `infra/northflank.md`.
- Database: capture the current migration log before applying migrations; there
  is no automatic down command. Stop writes, restore the database branch to the
  pre-migration point (or point the app at a known-good branch), then re-run
  read-only checks for profiles, library/progress, comments and progression
  rows. If only the latest additive migration was applied and no writes
  occurred, an operator may craft a reviewed compensating migration; never edit
  applied migration files in place.
- Auth/session changes: keep the previous published deploy until sign-in,
  callback and session checks pass on the candidate deploy.
