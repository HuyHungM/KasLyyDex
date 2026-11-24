# Cloudflare Workers deployment

The Next.js app runs on Cloudflare Workers through vinext. The Northflank Axum
service is unchanged; the Worker reaches it through the same-origin content
proxy using `RUST_CONTENT_API_ORIGIN`.

## Bindings

`web/cloudflare.config.ts` declares:

- `DB` — D1 database `kaslyydex` (`b4f42144-16fb-471b-bdec-c4823337c939`)
- `ASSETS` — static assets
- `SESSION_SECRET` — secret binding used to sign session cookies

`GOOGLE_CLIENT_ID` is a plain Worker variable set in the dashboard, not a
binding.
The D1 baseline is `web/migrations/0000_cloudflare_d1.sql`. It was applied to
the provisioned database with `d1_query`; it creates the application tables,
`auth_users` and the deterministic realm seed. DDL is never destructive: no
table or column is dropped.

## Runtime configuration (names only)

```
SESSION_SECRET
GOOGLE_CLIENT_ID
RUST_CONTENT_API_ORIGIN
READER_TICKET_SECRET
OPERATOR_EMAIL_ALLOWLIST   # optional operator bootstrap
```

`SESSION_SECRET` must be at least 32 characters and is read from the Worker
secret binding. `GOOGLE_CLIENT_ID` is a public OAuth client id; no client secret
is used because Google ID tokens are verified against Google's JWKS in the
Worker. If it is absent, `/api/auth/callback` fails with structured
`AUTH_CONFIG_INVALID` / `missing: GOOGLE_CLIENT_ID`; no session is synthesized.

`READER_TICKET_SECRET` must be at least 32 characters; progression routes fail
closed without it. `RUST_CONTENT_API_ORIGIN` is the public URL of the Axum
content service on Northflank.

## Verification

```bash
cd web
npm ci
npm run build:wasm
npm run build:vinext
npm run build
npm run typecheck
npm run lint
npm run test:aggregate
```

Browser and E2E suites need a running Axum binary and a local browser. No live
provider, Google account or deployment verification is claimed here.

## Rollback

Redeploy the previous Worker version. D1 schema changes are additive only in
this migration; do not drop tables or columns during a rollback.
