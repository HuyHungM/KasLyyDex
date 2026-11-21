# Axum content service — `/api/content/*`

## What changed in Task 4

The Axum server now registers two route sets that share the same handlers and
`Md` state:

- Legacy: `/api/popular`, `/api/latest`, `/api/search`, `/api/tags`, `/api/rank`,
  `/api/manga/{id}`, `/api/manga/{id}/chapters`, `/api/chapter/{id}/pages`,
  `/api/img`.
- Browser namespace: the same paths under `/api/content/…`.

MangaDex access, DNS handling, at-home URL handling, caching and the image proxy
remain in Axum. Next does not duplicate that logic. Invalid content IDs are
rejected before any upstream call with the shared nested
`{ error: { code, message, details } }` envelope.

`MANGADEX_API_ORIGIN` is an optional local/test override for `Md`. It defaults to
`https://api.mangadex.org`; production code does not need to set it. The local
topology test uses a fixture server through this override so no remote MangaDex
request is required.

## Next boundary

The browser calls same-origin `/api/content/*`. `web/app/api/content/[...path]/route.ts`
proxies to `${RUST_CONTENT_API_ORIGIN}/api/content/*`, forwarding only safe request
headers and a small response-header allowlist. Cookies and authorization headers
are not forwarded. Missing or invalid origin yields a structured 503 on content
routes only. Upstream network failures yield a structured 502.

A route handler is used instead of a `next.config.ts` rewrite so the unconfigured
case can return a JSON 503 while public pages and builds stay credential-free.
`next.config.ts` only opts `pg` out of Server Component bundling.

## Local verification

```bash
cargo test -p server
cargo clippy --workspace --all-targets -- -D warnings
cargo build -p server
cd web && npm run test:task4
```

The content test starts a local MangaDex fixture, the real compiled Axum binary,
and a built Next server. It asserts legacy and `/api/content` routes both work,
the Next proxy passes through content and malformed-ID errors, and the missing
origin case returns 503.

`cargo fmt --check` still reports pre-existing formatting differences in unrelated
files; the two Rust files touched by Task 4 were formatted with `rustfmt --edition 2021`.

## Unverified

No Axum service was deployed, exposed publicly, or connected to live Neon/Google
configuration in this task. Docker was unavailable, so no PostgreSQL container was
created; the migration test used embedded PGlite as a dev/test-only engine and did
not touch any pre-existing database.

## Task 9 hardening

- `/api/v1/health` is liveness; `/api/v1/ready` is configuration-only readiness
  (Axum owns no database). Next's readiness route probes Axum `/api/v1/ready`
  with a bounded timeout.
- Every response gets the same security-header set as Next. CSP permits the
  same-origin image proxy and `'wasm-unsafe-eval'` for the legacy reader and
  lists no third-party origins.
- Structured JSON request logs include a generated `x-correlation-id`, method,
  normalized path (entity ids removed, query ignored), status and duration.
  Upstream error messages stay generic in responses and never reach clients.
- CI builds the Axum binary before Node/API tests and rebuilds the WASM before
  the Next build; see `.github/workflows/ci.yml`.
