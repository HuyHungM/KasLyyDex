# KasLyyDex infrastructure boundary

Phase 1–2 keeps the Next.js web workspace in `web/` and the Axum content
service in `crates/server/`. The web deployment may call the content service
through `RUST_CONTENT_API_ORIGIN`; deployment configuration and credentials
remain outside Git.

Environment variable names are listed in `web/.env.example`. Use separate
Development, Preview, and Production values and database branches. This task
does not provision or deploy Vercel, Neon, or any other external resource.

Android (Phase 3) and GPUI (Phase 4) remain deferred.
