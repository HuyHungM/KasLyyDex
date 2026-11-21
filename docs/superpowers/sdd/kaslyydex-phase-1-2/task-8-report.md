# Task 8 — Progression, cultivation titles and anti-abuse (local report)

Base: `0c4a5e4c2b9de3e5e61192b2b509876f4845131e`. Branch: `feature/kaslyydex-phase-1-2`.
Vercel/Neon/OAuth provisioning, deploy, push and merge stayed paused. No live provider was mutated.

## RED → GREEN evidence (exact commands)

From `web/`:

| Phase | Command | Result |
| --- | --- | --- |
| RED (modules absent) | `node --import tsx --conditions=react-server --test scripts/progression.test.mjs` | `tests 1; pass 0; fail 1` — file-level `ERR_MODULE_NOT_FOUND ... lib/progression.ts` |
| RED (tests authored, service incomplete) | same command | `tests 14; pass 4; fail 10` — missing secret mapping, malformed fixture shape, checkpoint/rollback assertions |
| RED (post-migration regressions) | `node --import tsx --conditions=react-server --test scripts/database.test.mjs scripts/account.test.mjs scripts/community.test.mjs scripts/notification-feed.test.mjs` | failures because legacy harnesses migrated only through `0005` while the Drizzle schema now includes `profiles.level`; fixed by applying `0006` in every harness (legacy cursor tests keep their original pre-`0005` shape plus `0006` only for schema parity) |
| GREEN (task 8) | `node --import tsx --conditions=react-server --test scripts/progression.test.mjs` | `tests 16; pass 16; fail 0` |
| GREEN (aggregate SQL/API/pure) | `node --import tsx --conditions=react-server --test scripts/auth.test.mjs scripts/database.test.mjs scripts/content-proxy.test.mjs scripts/guest-storage.test.mjs scripts/reader-wasm.test.mjs scripts/account.test.mjs scripts/account-resource.test.mjs scripts/reader-sync.test.mjs scripts/community.test.mjs scripts/notification-feed.test.mjs scripts/progression.test.mjs` | `tests 103; pass 103; fail 0` |
| GREEN (browser) | `node --test scripts/account-playwright.test.mjs scripts/reader-sync-playwright.test.mjs scripts/community-playwright.test.mjs scripts/progression-playwright.test.mjs scripts/reader-playwright.test.mjs` | `tests 23; pass 23; fail 0`, including 2 new progression tests |
| GREEN (focused browser) | `node --test scripts/progression-playwright.test.mjs` | `tests 2; pass 2; fail 0` |
| GREEN (Rust) | `cargo test -p core -p contracts -p server -p domain` | all suites pass, including `chapter_metadata_uses_the_real_entity_shape_and_manga_relationship` and the existing 13-boundary Rust realm test |
| GREEN (lint/types/build) | `npx tsc --noEmit`; `npx eslint`; `npm run build` | typecheck clean, ESLint 0 errors (8 pre-existing `no-img-element` warnings), Next build emits all three new dynamic API routes |
| GREEN (Rust quality) | `cargo clippy -p core -p contracts -p server --all-targets -- -D warnings`; `cargo fmt -p domain -p contracts -p reader-core -p server -- --check`; `rustfmt --edition 2021 --check crates/core/src/mangadex.rs` | clean. Repository-wide `cargo fmt --check` still fails on untouched `crates/core/src/imgcache.rs`, `crates/core/src/lib.rs` and Leptos UI files — the documented Task 5 baseline limitation, not repaired here |

`npm run test:task8` and `npm run test:task8:e2e` wrap the aggregate commands above with `build` and `cargo build -p server`.

## Authority and integrity proof

- `POST /api/v1/reader-sessions` accepts only `{chapterId, mangaId, lang}` (strict 2 KiB JSON, Origin check, managed-session identity, UUID content IDs). Axum `GET /api/content/chapter/{id}` fetches MangaDex `GET /chapter/{id}?includes[]=manga`; the BFF compares `id`, manga relationship `manga_id`, `lang`, `external_url`, `isUnavailable`, metadata `pages` and the **actual** image list. Wrong manga/chapter, `en/vi` mismatch, external, unavailable, zero-page, page-count mismatch and malformed/missing metadata are rejected. Missing content metadata returns structured `503 CONTENT_METADATA_UNAVAILABLE`.
- The HS256 ticket (installed `jose`, no new dependency) binds `sid/sub/cid/mid/lang/pages/iat/exp` with `exp - iat = 1800s`, issuer/audience and a persisted `reader_sessions` row. Verification rejects forged signatures, expired tickets, claim-shape drift, changed chapter/manga/language/count and tickets presented by a different account. `READER_TICKET_SECRET` must be at least 32 characters; missing secret gives `503 READER_TICKET_NOT_CONFIGURED` at the real Next route with `private, no-store`. No fallback key exists.
- Checkpoints persist distinct `(session_id, page)` rows; `lastPageSeen` adds exactly one page and never implies a range. Out-of-range pages are rejected; duplicates are deduplicated. 20 requests/minute/account use the durable `action_events` table plus `pg_advisory_xact_lock`, not memory.
- Completion requires `ceil(0.8 * authoritative_pages)` distinct pages and server elapsed `max(10s, 2s * requiredPages)`. Client `percent`, `pageCount`, `totalXp`, `role` and similar fields are rejected by strict key allowlists. Ordinary current-page/reread updates still go through Task 6 `PUT /me/progress`; the monotone union is separate XP evidence.

## Transaction and concurrency proof

One `db.transaction()` in `completeChapter` performs: durable completion rate limit, `pg_advisory_xact_lock(hashtext('progression-profile:' + userId))`, validated progress upsert (current page may move, `max_page` uses `greatest`), `reading_completions` unique insert, `xp_events` unique insert, profile `total_xp`/`level` increment and `emitNotification(tx, ...)` with `eventKey = level:<level>`. The profile row is also locked with `SELECT ... FOR UPDATE`. Profile increment happens only when the XP event insert actually returns a row; retries and other languages/sessions return `awarded:false` with the same total. Level is `min(1000, 1 + floor(total_xp / 200))`, clamped at 1; all 13 realm boundaries match the spec and Rust `CultivationRealm`, seeded deterministically in `cultivation_realms`. Roles are read only from `user_roles`; XP never changes them.

Test proof: two concurrent chapter completions produced `total_xp=200`, `level=2`, two `xp_events`, one deduplicated `level:2` notification and zero roles; an injected failure at the final hook left completions, events, progress and notifications empty and profile at `0/1`, and a retry then awarded normally. Guest imports created progress rows but no completions, checkpoints, XP or level.

## UI and browser scope

- `CultivationBadge` renders `/api/v1/me/level` on the account page; the Task 6 placeholder was replaced with real profile XP/level/title.
- `ReaderClient` starts a ticket only after the Task 6 restore gate, real WASM state is loaded and the account session is authenticated. It observes only decoded, intersecting `img[data-index]` elements, checks `document.visibilityState`, batches at most 15 checkpoint requests/minute and aborts timers/observers/requests on chapter, language or account changes. Completion/level text is rendered only from the server response; guests and local imports make no progression calls.
- Browser proof used real Axum, a real local Neon SDK session fixture, real WASM and real decoded page images. The progression API responses were **intercepted fixtures** (`reader-sessions`, `progress/checkpoint`, `progress/complete`, `me/settings`, `me/progress`) because no live Postgres is wired to the browser harness; SQL/atomicity proof is the PGlite harness above. A hidden-document override proved no additional checkpoints are sent while backgrounded.

## Files, routes and configuration

- New routes: `POST /api/v1/reader-sessions`, `POST /api/v1/progress/checkpoint`, `POST /api/v1/progress/complete`; `GET /api/v1/me/level` now returns real data.
- New modules: `web/lib/progression.ts` (pure/realm rules), `web/lib/progression-api.ts` (server-only signed sessions, validation, transaction, handlers), `web/components/profile/CultivationBadge.tsx`.
- Schema/migration: `web/drizzle/0006_progression.sql` (+ journal/snapshot) adds `profiles.level`, `reader_sessions`, `reader_checkpoints`, `reading_completions`, `xp_events`, 13 seeded `cultivation_realms`; no auth-schema writes.
- Axum: typed `ChapterMetadataDto` in `contracts`, `Md::chapter_metadata` in `core`, `GET /api/content/chapter/{id}` (legacy `/api/chapter/{id}` alias) in `server`, backed by the documented MangaDex chapter entity and manga relationship.
- Server environment: `READER_TICKET_SECRET` (new, ≥32 chars, server-only), plus existing `DATABASE_URL`, `RUST_CONTENT_API_ORIGIN`, `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET`. Never expose the ticket secret to the browser or commit it.

## Unverified external gates

No live Neon Postgres, Vercel deployment, OAuth provider, real MangaDex traffic, browser-to-production-Postgres flow, push or merge was exercised. The anti-farm delay and visible-page checks remain pragmatic abuse reduction, not proof of human reading. Full-workspace Rust formatting and the repository-wide browser suite beyond the listed files were not changed or re-baselined.
