# Northflank deployment — Axum content service

## No cloud work in this task

No Northflank login, project or service creation, volume provisioning, domain
change, deploy or rollback was performed here. Cloud work remains an
owner-gated operation. This document records the settings an operator applies
to a Dockerfile-built service; it does not claim any service exists.

## Build

Rust is not in Northflank's documented buildpack stack, so the service uses the
**Dockerfile** build type with the repository root as build context:

- Dockerfile: `Dockerfile` at the repository root.
- Builder stage: `rust:1.85-bookworm`, `cargo build --release --locked -p server`.
- Runtime stage: `debian:bookworm-slim`, binary at `/usr/local/bin/server`.

The container image contains no credentials or runtime configuration.

## Service settings

Create a **combined service** (long-lived process, not a job) from the linked
Git repository with these settings:

| Setting | Value |
| --- | --- |
| Build type | Dockerfile (root `Dockerfile`) |
| Public port | `3100` (HTTP, public) |
| Liveness probe | `GET /api/v1/health` on port `3100` |
| Readiness probe | `GET /api/v1/ready` on port `3100` |
| Persistent volume | Mount at `CACHE_DIR` (image default `/cache`) |

The Axum binary binds `0.0.0.0:3100` by default. Do not point the probes at a
different port unless `PORT` is deliberately overridden, and keep the public
port aligned with that value.

The volume must be writable and attached on every deployment so the image cache
survives redeploys. `DIST_DIR` is optional for the content API; set it only if
the service also serves UI assets from a mounted path. Optional upstream
upstream override is `MANGADEX_API_ORIGIN`. Inject every value
in Northflank service settings; none belongs in the tracked image or repository.

## Content origin on Cloudflare

`RUST_CONTENT_API_ORIGIN` is set on the Cloudflare Worker, not on this service.
Its value is this service's public origin only:
`https://<northflank-service-host>`, with scheme and host, no path, query or
trailing slash. The local value stays `http://127.0.0.1:3100`. The browser
continues to call same-origin `/api/content/*` on the Worker, so no CORS change
is needed.

## Database migrations

The Worker uses D1; Drizzle's schema is SQLite and its `out` is `web/migrations`.
The baseline `0000_cloudflare_d1.sql` and `meta/` journal are committed beside
each other and the SQL was applied to D1 with `d1_query`. Future
`drizzle-kit generate` output is numbered, additive SQL; never drop tables or
columns as part of a rollback.

## Preview environments

Combined services cannot be part of Northflank pipelines. Preview pipelines
would need a split build service plus separate deployment services; that split
is out of scope for this change and no preview URL is asserted here.

## Rollback

Use Northflank build rollback (select a previous successful build) for the
backend. It does not undo database migrations; coordinate any schema change
with the Cloudflare rollback procedure in `infra/cloudflare.md`.
