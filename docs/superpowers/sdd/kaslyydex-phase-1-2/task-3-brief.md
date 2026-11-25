### Task 3: Deploy the Next.js skeleton to Vercel before Neon setup

**Files:**
- Modify: `web/package.json`, `web/next.config.ts`, `web/app/layout.tsx`, `web/app/page.tsx`
- Create: `web/app/api/v1/health/route.ts`, `infra/vercel.md`

**Interfaces:**
- `GET /api/v1/health` returns `{ ok: true, version: string }` without secrets.

- [ ] **Step 1: Add a failing smoke test** asserting the Next root and `/api/v1/health` return 200, expose KasLyyDex branding, and do not require Neon/auth credentials.
- [ ] **Step 2: Run the smoke test** and record RED because the health route and deployment shell are absent.
- [ ] **Step 3: Add the minimal Vercel-ready shell and health route.** Keep existing legacy routes intact; do not add auth or database code in this task.
- [ ] **Step 4: Run `npm run lint`, `npx tsc --noEmit`, and `npm run build`; expected GREEN without Neon credentials.
- [ ] **Step 5: Link the existing Vercel account/project and deploy a Preview before provisioning or connecting Neon.** Do not deploy Production. If Vercel CLI authentication or project linkage is unavailable, stop and report the exact user action needed; Task 4 depends on verified Preview deployment.
- [ ] **Step 6: Verify Preview root and health route, then record Preview URL in the ignored SDD report, never source code.
- [ ] **Step 7: Commit** `feat: deploy KasLyyDex web foundation`.

## Constraints and rulings

- This is the sequencing prerequisite requested by the owner: Vercel Preview deploy occurs before Neon project/auth/database setup.
- Do not deploy Production, provision Neon, configure OAuth, or commit credentials in this task.
- Worktree: `D:\Code\nodejs\kaslyydex\.worktrees\kaslyydex-phase-1-2`.
- Do not dispatch subagents. Write report to `docs/superpowers/sdd/kaslyydex-phase-1-2/task-3-report.md`.
