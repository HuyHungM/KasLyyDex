# Vercel deployment — Task 3 local baseline

## What exists locally

- Next.js app directory: `web/`. Framework: Next.js 16.4.6. Build: `npm run build`.
- Default Next.js output (no `output: "export"` or standalone override); Vercel uses its
  native Next.js adapter.
- `GET /api/v1/health` returns `{ ok: true, version }` with `version` read from
  `web/package.json`. It is prerendered as a static route: no runtime env, database,
  auth, metrics, or secret access.
- Existing reader/catalog routes are unchanged: `/`, `/search`, `/manga/[id]`,
  `/read/[chapterId]`, `/api/img`, `/api/pages/[chapterId]`.

## Local verification

Run from `web/`:

```bash
npm ci
npm run test:smoke                  # build + node --test scripts/smoke.test.mjs
npx tsc --noEmit
npx eslint app/api/v1/health/route.ts scripts/smoke.test.mjs
npm run lint                        # see known baseline errors below
```

`npm run test:smoke` starts the built app with Neon/auth-related environment keys
removed and asserts that `/` returns 200 with KasLyyDex branding and that
`/api/v1/health` returns exactly `ok` and `version`.

Full `npm run lint` still reports four pre-existing `react-hooks/set-state-in-effect`
errors in `components/chapter-list.tsx`, `components/continue-reading.tsx`,
`components/manga-actions.tsx`, and `components/reader.tsx`. They are unrelated to
Task 3 and were not suppressed or refactored here.

## Owner-owned Preview steps (not executed in this task)

1. `vercel login` with the account that owns the existing project.
2. Link the repo to that project with `vercel link` from the repository root and keep
   Project Settings → Root Directory as `web` (or link from `web/` if that project
   already targets `web` as its root).
3. Confirm Framework Preset is Next.js and Build Command is `npm run build`.
4. Keep this Preview credential-free: do **not** set `DATABASE_URL`,
   `BETTER_AUTH_SECRET`, `NEON_*`, `GOOGLE_CLIENT_*`, or other auth/Neon values.
5. Create a Preview with `vercel deploy` (no `--prod`). Do not promote to Production.
6. Verify `<preview-url>/` returns 200 and shows KasLyyDex, and
   `<preview-url>/api/v1/health` returns `{ "ok": true, "version": "..." }`.
7. Record the Preview URL only in the ignored SDD report
   (`docs/superpowers/sdd/kaslyydex-phase-1-2/task-3-report.md`), never in source.

Task 4 depends on that verified Preview before connecting Neon Managed Auth. This
document is extended there with Axum `/api/content/*` and `RUST_CONTENT_API_ORIGIN`
notes.
