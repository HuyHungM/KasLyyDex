# Task 3 report: Vercel-ready Next.js shell and health route (local scope)

## Status

Local implementation complete. External deployment steps were intentionally not
performed: no Vercel login, link, deployment, Production promotion, Neon project,
auth provider, or remote resource was created. The controller owns those steps.

## Changes

- Added `web/app/api/v1/health/route.ts`: `GET /api/v1/health` returns
  `{ ok: true, version }`, with `version` imported from `web/package.json`.
- Added `web/scripts/smoke.test.mjs` and `web/package.json` script `test:smoke`.
  The test builds the app with `npm run build`, starts `next start` with every
  `DATABASE|POSTGRES|NEON|AUTH|GOOGLE_CLIENT|RUST_CONTENT_API_ORIGIN`-matching
  environment key removed, and asserts:
  - `/` returns 200 and contains `KasLyyDex`;
  - `/api/v1/health` returns 200, JSON content type, exactly the keys `ok` and
    `version`, `ok === true`, and a non-empty string version.
- Added `infra/vercel.md` with the local checks and the owner-owned Preview runbook.

`web/app/layout.tsx`, `web/app/page.tsx`, and `web/next.config.ts` were intentionally
left unchanged: the existing root/layout already provide the branded, buildable
Vercel-ready shell (title contains KasLyyDex and the root route returns 200 without
Neon/auth credentials). Rewriting them would risk the reader/catalog behavior Task 5
must preserve. No auth, database, metrics, or runtime dependency was added. The
health route is prerendered as `○ /api/v1/health`, so a function-runtime dependency
is unnecessary.

## RED evidence

Command: `npm run test:smoke` from `web/`, before adding the health route.

```text
✔ root serves the branded KasLyyDex shell without Neon/auth credentials (634.8602ms)
✖ GET /api/v1/health returns ok and version without secrets (24.5521ms)
AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  404 !== 200
ℹ tests 2
ℹ pass 1
ℹ fail 1
```

Exit code: 1. The build succeeded and the route table had no `/api/v1/health`.

## GREEN evidence

Command: `npm run test:smoke` from `web/`, after adding the health route.

```text
├ ○ /api/v1/health
✔ root serves the branded KasLyyDex shell without Neon/auth credentials (633.642ms)
✔ GET /api/v1/health returns ok and version without secrets (20.0967ms)
ℹ tests 2
ℹ pass 2
ℹ fail 0
```

Exit code: 0.

Other checks from `web/`:

- `npx tsc --noEmit` — exit 0.
- `npx eslint app/api/v1/health/route.ts scripts/smoke.test.mjs` — exit 0, no output.
- `npm run build` — exit 0; route table includes `○ /api/v1/health` and preserves
  `/`, `/search`, `/manga/[id]`, `/read/[chapterId]`, `/api/img`, and
  `/api/pages/[chapterId]`.
- `npm run lint` — exit 1 with exactly the four pre-existing errors already present
  at base `e4b81ee`: `components/chapter-list.tsx:28:12`,
  `components/continue-reading.tsx:14:5`, `components/manga-actions.tsx:20:12`,
  `components/reader.tsx:52:5`, all `react-hooks/set-state-in-effect`. No rule was
  disabled and no legacy consumer was refactored. The full-lint output is unchanged
  from the baseline; the focused lint of this task's files is clean.
- `git diff --check` — clean.

## Residual concerns / blocked work

- No Vercel Preview URL exists for this task. Task 4 is blocked until the owner logs
  in, links the existing project with Root Directory `web`, runs `vercel deploy`
  (Preview only), and verifies `/` and `/api/v1/health` as described in
  `infra/vercel.md`.
- The smoke test proves no Neon/auth credentials are required; it does not prove
  Preview deployment, DNS, or Vercel project settings.
- The home page still fetches MangaDex for catalog sections. That behavior and its
  network dependency were preserved; this task does not replace the Axum content
  boundary planned in Task 4/5.
- `version` is baked into the prerendered health response at build time from
  `web/package.json`; it does not change without a rebuild.
