# Vercel deployment — Task 4 local integration status

## No deployment in this task

No Vercel deployment, project creation, linking, domain setup or environment-variable
write happened during Task 4. Cloud work remains paused by owner decision. A prior
`create_project` request returned `402 resource_creation_blocked` (team exceeded
fair-use limits); no Vercel project was created. Do not bypass that limit with a
temporary project, new team, or alternate account.

Current Vercel documentation also states that the **first deployment of a brand-new
project is always Production**, even when requested with `--target preview`. The
first-deploy target and domain decision must be resolved with the owner before any
future deployment. This document does not claim a Preview URL exists.

## Local code added

- `web/lib/auth/server.ts` uses the officially published `@neon/auth@0.8.2`
  server entry point `@neon/auth/next/server` (`createNeonAuth`). Configuration is
  lazy and server-only; missing or invalid `NEON_AUTH_BASE_URL` /
  `NEON_AUTH_COOKIE_SECRET` returns a structured 503 from `/api/auth/*` only.
- `web/lib/auth/client.ts` uses `@neon/auth/next` and exposes the Google social
  sign-in call. Google provider settings themselves are owned by the Neon branch;
  no OAuth credentials are read in the browser bundle.
- `web/lib/db/client.ts` creates a pooled `pg` client and Drizzle instance only on
  first use. No `DATABASE_URL` is needed for builds, public pages or health.
- `web/lib/contracts.ts` holds browser-safe typed content contracts/client and
  the shared error envelope.
- `web/app/api/content/[...path]/route.ts` is the same-origin content boundary.
  Without `RUST_CONTENT_API_ORIGIN` it returns a structured 503; it never invents
  a fake response.
- `web/app/api/v1/health` and `/` remain credential-free.

## Environment names (values are owner-supplied, never committed)

```
NEON_AUTH_BASE_URL
NEON_AUTH_COOKIE_SECRET
DATABASE_URL
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
RUST_CONTENT_API_ORIGIN
NEXT_PUBLIC_APP_URL
```

`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` document the owner-managed Google
provider inputs; the current SDK adapter does not consume them in Next. Never
prefix server secrets with `NEXT_PUBLIC_`.

## Local verification

From `web/`:

```bash
npm ci
npx tsc --noEmit
npm run test:task4
npm run test:smoke
npx eslint lib/auth lib/contracts.ts lib/db app/api/auth app/api/content drizzle.config.ts next.config.ts scripts
npm run lint   # four pre-existing set-state-in-effect errors remain
```

`npm run test:task4` builds Next, builds the Axum server, then runs the auth,
PGlite migration and local Next→Axum content tests with Node's built-in runner.
The auth and JWT/JWKS tests use local fixtures only; they do not prove a Neon
project, Google OAuth tenant, or live token exchange works.

Full `npm run lint` still reports the four pre-existing
`react-hooks/set-state-in-effect` errors in `components/chapter-list.tsx`,
`components/continue-reading.tsx`, `components/manga-actions.tsx` and
`components/reader.tsx`. None were suppressed or refactored here.

## Explicit unverified gates

- Neon Managed Auth enablement on any branch.
- Google OAuth provider configuration with owner credentials.
- Live Neon permission and schema/migration application.
- Real Google sign-in and live JWT/JWKS verification.
- Any Vercel Preview or Production deployment, domain or environment wiring.
