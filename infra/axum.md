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

## Chapter enrichment (Tasks 2–4, gated in Task 10)

- MangaDex is the only content source. Chapter lists come straight from the
  MangaDex adapter; external-only and unreadable chapters keep their original
  external link. There is no alternate provider fallback and no provider-prefixed
  ID rewriting. The MangaDex response shape is unchanged and legacy `/api/*`
  aliases behave the same.
- `MANGADEX_API_ORIGIN` overrides the MangaDex origin (default
  `https://api.mangadex.org`) and lets the Axum content tests run against a
  loopback fixture — no remote call, credential, or deployment.
- The image proxy allowlists only the verified MangaDex image origins
  (`uploads.mangadex.org` and `*.mangadex.network`, HTTPS/443, no credentials)
  with raw and decoded path-traversal rejection; the browser only ever receives
  same-origin `/api/img` URLs.
- Source labels come from the shared contracts and default to `MangaDex` for
  legacy DTOs; reader tickets and progression records bind the chapter source.

## Advanced search (Tasks 1–3, gated in Task 7)

- `contracts::SearchQuery` is the single parser for `/api/content/search` and
  its legacy `/api/search` alias. It accepts `source` (`all`/`mangadex`, default
  `all`), `lang` (`all`/`vi`/`en`, default `all`), `year`
  (1900…current year + 1), and keeps the existing `q`/`tags`/`status`/`sort`/
  `page` validation. `SearchResponse.partial` defaults to `false` for older DTOs.
- The handler calls `core::search_all`, which queries MangaDex, sorts by
  `sort` → source label → title → id and slices to at most 24 items per page.
  `lang` is applied by MangaDex through `availableTranslatedLanguage[]`; year
  has no upstream filter and is applied locally, marking the response
  `partial: true`. Successful full responses are cached under a key containing
  every query field. Upstream failures yield a structured 502.
- The local MangaDex fixture override keeps the search tests on loopback; no
  remote call or credential is involved.

## Gate notes (Task 10)

- `cargo fmt -p core` fixed the known pre-existing rustfmt hunks in the core
  sources; `core` is now part of the scoped `cargo fmt --check` set in CI.
  Full-workspace fmt still carries older
  Leptos debt, so it stays out of scope.
- The tracked-file whitespace gate runs with
  `web/scripts/whitespace-baseline.txt` (783 pre-existing findings in committed
  `docs/superpowers/sdd/kaslyydex-phase-1-2/*.diff`); new findings still fail.
- `npm run test:aggregate`/`test:browser` build the Axum binary via pretest
  before suites spawn it; CI builds it as its own step first.

## Gate notes (Task 7)

- `test:aggregate` now includes `search-contracts`, `search-source`,
  `advanced-search`, `source-badge` and `ranking-skeleton`: 28 aggregate test
  files (7 source + 5 new among them). Two of the added suites are browser
  based and need Playwright Chromium, so CI installs it before the aggregate
  step; the Axum prebuild ordering is untouched.
- The full local gate passed: aggregate 203/203, browser 23/23, workspace Rust
  tests 90/0, `cargo build -p server`, clippy `-D warnings`, scoped
  `cargo fmt --check` including `core`, typecheck/lint, whitespace/secrets and
  `git diff --check`. No deploy, push or merge was performed.

## Unverified

No Axum service was deployed, exposed publicly, or connected to live provider
configuration in this task. The web migration tests use a local SQLite harness
for D1-shaped queries; they never touch a pre-existing database.

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
