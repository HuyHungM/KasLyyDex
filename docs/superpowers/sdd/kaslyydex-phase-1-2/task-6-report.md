# Task 6 report — user profile, library, progress and guest merge

## Status

**DONE_WITH_CONCERNS** — local implementation and all local suites pass. Live Neon,
Google OAuth mail/provider delivery and Vercel deployment remain external,
unverified gates; see *External gates*.

## Scope and base

- Worktree: `D:\Code\nodejs\kaslyydex\.worktrees\kaslyydex-phase-1-2`
- Branch: `feature/kaslyydex-phase-1-2`, base `281cc2646ea59bdb72669efda4eeeafc920fef4d`
- No subagents, deployment, Vercel/Neon provisioning, live database mutation, push or merge.
- `web/AGENTS.md` was followed: the installed Next 16.4.6 docs in
  `web/node_modules/next/dist/docs/` were read for route handlers, `cookies()` and
  segment config. With `cacheComponents: true`, Next 16 rejects both `runtime` and
  `dynamic` route segment exports, so the account route files use neither.
- SDK/schema ownership follows Task 4: `getAuth()` / managed session cookies and
  lazy pooled `getDatabase()` from `pg`+Drizzle; no second auth system and no
  hand-written session/account tables.

## What was implemented

### Data and merge (slice 1)

- `web/lib/db/schema.ts` + `web/drizzle/0001_account_data.sql` add:
  - `profiles` fields: normalized `username` (unique index), `display_name`,
    `avatar_url`, `total_xp` (zero placeholder only), timestamps.
  - `user_roles(user_id, role)` with cascade from `profiles`.
  - `library_entries` with `UNIQUE(user_id, manga_id)`, status
    (`reading/planned/completed/paused/dropped`), server revision/timestamp.
  - `chapter_progress` with `UNIQUE(user_id, manga_id, chapter_id, language)`,
    separate `page` (current, may move backward for rereads) and `max_page`
    (observed maximum, monotone), plus a recent-read index.
  - `reader_preferences` for persisted per-account reader settings.
  - Every account table cascades on profile deletion, including role rows.
- `web/lib/validators.ts`: same-origin `Origin` check, 24 KiB JSON body cap,
  media-type check, bounded client timestamps (± plausible window), normalized
  username, https-only avatar, library/status/reader settings validators,
  strict unknown-key rejection (mass-assignment guard), and verified-email
  allowlist role bootstrap.
- `web/lib/merge.ts`: pure merge rules. Server-newer state wins; a strictly newer
  local timestamp updates advisory fields; `max_page` never drops; repeated
  import is a no-op.
- `web/lib/me/service.ts`: DB-injectable services; transactional guest import with
  `ON CONFLICT` updates whose `CASE` expressions keep the merge monotone even if
  imports race. All mutation times/revisions are server-owned. No XP,
  completion or role write exists in the import path.

### HTTP surface (slice 2)

| Route | Methods | Behaviour |
|---|---|---|
| `/api/v1/me` | GET, PATCH | Profile + settings; PATCH limited to username/display name/avatar |
| `/api/v1/me/level` | GET | `{ level: 1, totalXp: 0, source: "placeholder" }` until Task 8 |
| `/api/v1/me/library` | GET | Up to 200 entries owned by the session user |
| `/api/v1/me/library/[mangaId]` | PUT, DELETE | Upsert/remove one owned row |
| `/api/v1/me/progress` | GET | Up to 100 recent owned chapter rows |
| `/api/v1/me/progress/[chapterId]` | PUT, DELETE | Reread-safe upsert/delete |
| `/api/v1/me/import` | POST | Explicit idempotent guest merge, bounded timestamps |
| `/api/v1/me/settings` | GET, PUT | Persisted reader preferences |

- Every `/api/v1/me/*` response (including errors) sends
  `Cache-Control: private, no-store`, `Vary: Cookie` and `X-Content-Type-Options: nosniff`.
- All mutations require a same-origin `Origin`; cross-origin requests are rejected
  before authentication or database work.
- User id comes only from `getAuth().getSession()` via `identityFromSession()`;
  request bodies cannot supply `userId`, `role`, `totalXp`, `level` or completion state.
- Missing auth env returns structured `503 AUTH_NOT_CONFIGURED`; configured auth
  with missing database env returns `503 DATABASE_NOT_CONFIGURED`; neither creates
  a fake session or in-memory user.
- `OPERATOR_EMAIL_ALLOWLIST` is the only role bootstrap input and is server-only;
  unverified emails never receive `admin`.

### UI (slice 3)

- Real SDK email/password sign-in and sign-up, Google social button, sign out,
  provider error display, session-error retry, and explicit
  *auth-not-configured* state (`/tai-khoan`).
- Account pages: `/tai-khoan` (profile + explicit guest import),
  `/tai-khoan/cai-dat` (settings), `/tai-khoan/lich-su` (history).
- Tủ truyện, "Đọc tiếp", manga follow button and reader use the synced API when
  authenticated and the existing guest/local path when anonymous. Guest import
  never deletes the source local data and reports inserted/updated/skipped counts.
- Reader still uses the Rust WASM state machine. Authenticated settings/position
  are applied by calling the same Rust methods; no JS progress state machine was
  recreated. Chapter-local local restoration remains the guest path.

## RED → GREEN evidence

RED (before implementation, exact command):

```bash
cd web
node --import tsx --conditions=react-server --test scripts/account.test.mjs
```

Result: `1 test / 0 pass / 1 fail`; launch failed with
`ERR_MODULE_NOT_FOUND ... lib/validators.ts`, i.e. none of the account modules
existed. The database migration test was then extended to require the new
constraints before implementation.

GREEN (post-fix, exact commands and counts):

```bash
cd web
npm run test:task6              # 46 tests / 46 pass / 0 fail
node --test scripts/account-playwright.test.mjs  # 3 / 3 pass
npm run test:e2e                # 9 / 9 pass
node --test scripts/smoke.test.mjs               # 2 / 2 pass
npx tsc --noEmit                                  # pass
npm run lint                                      # 0 errors, 7 warnings
npm run build                                     # pass, new /api/v1/me/* and /tai-khoan/* routes present
```

From repo root: `cargo test --workspace` passed (all workspace suites). `npm run lint` has seven `no-img-element`
warnings: five pre-existing from Task 5 and two new ones on proxied account
covers; Next's image optimizer must not fetch MangaDex hosts locally.

`npm run test:task6` includes Task 4's auth/database/content proxy suites,
Task 5's guest storage and real-WASM suites, and the new 15-test account suite.
Detailed new account results:

- 15/15 pass: same-origin guard, payload/type limits, bounded timestamps,
  username normalization, pure merge precedence, opaque SDK session identity,
  role allowlist with verified email, library uniqueness/ownership, profile
  validation and 409 on duplicate username, cascade-safe role bootstrap,
  idempotent guest merge with server-newer precedence, corrupt local input,
  privilege-field rejection, stale-write monotonicity, unauthenticated 401,
  private no-store reads, cross-origin 403, zero-XP level, settings persistence,
  rollback on forced DB failure, and server fail-closed states.
- `scripts/database.test.mjs` now applies **both** real generated migrations to
  PGlite and asserts table set, columns, PK/unique constraints, cascade deletion
  and no `neon_auth` objects.
- `scripts/account.test.mjs` starts a loopback HTTP auth fixture and the **real
  SDK proxy in a built Next server**, signs in through
  `/api/auth/sign-in/email`, reads `/api/auth/get-session`, and uses the returned
  opaque id `google|opaque-42` for the injected identity in handler tests. No
  production header/env bypass exists. PGlite is used strictly as a local SQL
  engine; application runtime code still uses pooled `pg`/Drizzle.

## Browser proof

`node --test scripts/account-playwright.test.mjs` (Edge headless, 3/3):

1. With auth env absent, `/tai-khoan` shows *Chưa bật đăng nhập*, names the
   missing env variables, and renders **no** inert email form. Guest settings
   saved in `/tai-khoan/cai-dat` survived reload; seeded guest history and
   library appeared on `/tai-khoan/lich-su` and `/tu-truyen`; the account nav
   link is present. Screenshot: `web/.test-screenshots/account-unconfigured.png`.
2. With the loopback managed-auth fixture, the real SDK client signed in with
   email/password, the UI reached *Đã đăng nhập* with the fixture email, then
   sign-out returned to the sign-in form. Screenshot:
   `web/.test-screenshots/account-authenticated.png`.
3. No browser `pageerror` was produced by either flow.

`npm run test:e2e` (9/9) re-verified the untouched Rust WASM reader: decoded
fixture pages, scroll/paged reading, chapter isolation, retry panel, auto-scroll
pause and mobile shell. No direct `*.mangadex.org` browser requests.

## Commits

- `c99b42c` — `feat: add synced account schema and services`
- `af66bd9` — `feat: add account API routes with session ownership and CSRF guards`
- `d9692b7` — `feat: add synced user reading data UI`

SDD briefs, review diffs, controller ledger and `progress.md` were deliberately
left uncommitted. No push or merge was performed.

## External gates and concerns

- **Neon Managed Auth**: no live branch instance, real session, JWKS or email was
  used. The auth flows were proven only against a loopback HTTP fixture through
  the real SDK.
- **Google OAuth**: no owner credentials/tenant; only the SDK social proxy path
  was exercised, not a live Google redirect or consent flow.
- **Live PostgreSQL**: migrations and transactions ran on embedded PGlite. No
  Neon database, schema change or permission was verified. Runtime uses
  `pg`/Drizzle only; no in-memory fallback.
- **Vercel**: no project, deployment, domain or env wiring was created or checked.
- Browser authenticated data sync against a live SQL-backed Next instance was
  not performed because no local PostgreSQL wire server is available; the
  equivalent handler/ownership/import flows are covered in-process with PGlite.
- XP/level remain an explicit zero placeholder until Task 8. Guest imports never
  grant XP, completions or roles.
- Password reset/verification and account deletion UI were not added; neither
  was faked. Auth revocation/deletion must use the documented managed SDK later.
- `cacheComponents` forbids `runtime`/`dynamic` segment exports in Next 16; route
  handlers remain dynamic because they read managed-auth cookies.

---

## Fix round 1 — reader restore races, resource staleness, session gating, scoped delete

All six regraded findings were fixed in Task 6 files only.

### RED evidence

```bash
cd web
node --import tsx --conditions=react-server --test scripts/account-resource.test.mjs
node --test scripts/reader-sync.test.mjs
node --import tsx --conditions=react-server --test --test-name-pattern "progress delete is scoped" scripts/account.test.mjs
node --test scripts/reader-sync-playwright.test.mjs
```

- `account-resource.test.mjs`: 1 file failed with `ERR_MODULE_NOT_FOUND ... lib/account/resource.ts` (no generation guard existed).
- `reader-sync.test.mjs`: 1 file failed with `ERR_MODULE_NOT_FOUND ... lib/reader-sync.ts` (no restore gate existed).
- `account.test.mjs`: the scoped-delete test failed — deleting one `(manga, lang)` row deleted **both** language rows (`actual []`, expected `['en']`).
- `reader-sync-playwright.test.mjs`: 4/5 failed before the fix — no visible restore-retry button, and the early follow click was enabled while the session was resolving.

### Fixes

1. **Critical — no page-1 overwrite.** `ReaderRestoreCoordinator` gates progress PUTs until the async settings/progress GETs resolve and the server page has been applied to Rust. The restore key is `chapterId|lang|userId`, so a different account cannot reuse another user's gate.
2. **Stale restore responses.** The coordinator uses generations plus an `alive` flag; a response from chapter A/B or a previous user after navigation is discarded before touching WASM, and no stale write is sent.
3. **`useRemoteResource` staleness.** Added a generation/AbortController-backed `RemoteResourceController`. Every post-`await` `setState` is generation-guarded, `data` is cleared on key/path change and on failure, and all consumers pass `session.user.id` in the resource key. Effect cleanup aborts and disposes.
4. **Restore failure retry.** A failed restore clears the key and shows a visible *Thử lại đồng bộ* button in the reader; retry re-runs the GETs and applies the server page before any PUT.
5. **Early-click gating.** The manga follow button is disabled while the session is `loading`/`error`; guest localStorage is only written for explicit `guest`/`unconfigured` sessions, and the synced API is used for authenticated users.
6. **Scoped progress delete.** `DELETE /api/v1/me/progress/[chapterId]` now requires `mangaId` and `lang` query selectors; the service deletes only the addressed `(user, manga, chapter, language)` row. Ambiguous requests return 400.

### GREEN evidence

```bash
cd web
node --import tsx --conditions=react-server --test scripts/account-resource.test.mjs scripts/reader-sync.test.mjs  # 7/7 pass
node --import tsx --conditions=react-server --test --test-name-pattern "progress delete is scoped" scripts/account.test.mjs  # 1/1 pass
npm run test:task6                                             # 54 tests / 54 pass / 0 fail
npm run test:e2e                                               # 9/9 pass
node --test scripts/account-playwright.test.mjs scripts/reader-sync-playwright.test.mjs  # 6/6 pass
npm run lint                                                   # 0 errors, 7 expected img warnings
npx tsc --noEmit                                               # pass
npm run build                                                  # pass
git diff --check                                               # pass
```

The pure `reader-sync` tests cover a delayed GET whose first PUT is gated, a slow chapter A response arriving after navigation to B, failed-restore retry, and post-disposal suppression. The browser retry test proves the visible retry path with a real SDK session over the loopback auth fixture; the early-click test proves no guest write while session resolution is pending. Cargo was untouched in this round.

Skipped: live Neon/Google/Vercel verification and a browser test backed by a
real PostgreSQL wire server. Risk: local PGlite/loopback auth fixtures do not
certify provider configuration, mail delivery or deployed permissions.
