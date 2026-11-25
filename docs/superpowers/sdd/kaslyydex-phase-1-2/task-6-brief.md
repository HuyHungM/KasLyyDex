### Task 6: User profile, library, progress and guest merge

## Execution constraints and interfaces to pin before implementation

- No Vercel deploy, external Neon mutation, push or merge. Use Task 4's actual `auth/server` and DB exports; read the Task 4 report first.
- Runtime must use authenticated Neon session and real PostgreSQL. No in-memory user data/auth fallback in production. Isolate service functions for tests; inject deterministic test auth only in the test harness, never via public headers/env bypass.
- Public handlers never accept an authoritative user_id, system_role, total_xp or level from clients. Ownership is always derived from session. Mutations reject cross-origin requests; reads/writes of account data send `Cache-Control: private, no-store`.
- Define `GET /api/v1/me/library` plus `PUT/DELETE /api/v1/me/library/[mangaId]`; `GET /api/v1/me/progress` plus `PUT /api/v1/me/progress/[chapterId]`; `POST /api/v1/me/import` for guest merge, and `/api/v1/me/settings` for persisted reader preferences. `/me/level` returns zero-XP level 1 until Task 8 records XP events. `/me` profile changes are limited to username/display name/avatar input.
- Keep opaque auth user id TEXT. UNIQUE(user_id,manga_id) for library; progress UNIQUE(user_id,manga_id,chapter_id,language); username unique normalized. Role bootstrap must require a verified account matching an explicit operator allowlist; unverified email cannot grant moderator/admin.
- Distinguish current page (can move backward for rereads) from maximum observed progress for future completion rules. Guest import never creates XP/completions/roles. Repeated import is idempotent; local timestamp is bounded against implausible future dates and cannot change privileged state.
- Persist library status (reading/planned/completed/paused/dropped) if implementing status filters; don't invent unrelated social features.
- Test actual SQL migration/constraints/transactions using the PostgreSQL harness from Task 4; if PGlite is used, label it correctly and leave live Neon verification pending. Cover unauth, ownership, mass-assignment attempts, duplicate import, corrupted local input, disabled storage, stale progress, cross-origin mutation and database failure rollback.
- Add real auth UI flows (email/password + Google, sign out, provider errors; auth-not-configured state when credentials absent), profile/settings/library/history pages, merge UX and integration with reader. Don't ship success-looking inert buttons.
- Reader must still work for guests. Avoid dropping legacy local data when keys/field names migrate.
- Task4 exports (read actual implementation if changed): `getAuth()` and `verifyNeonJwt()` from auth/server; `getDatabase()` lazy pooled pg/Drizzle from db/client; `errorEnvelope()` and typed DTOs in lib/contracts. Protected route authentication must use the real SDK session/cookie, and bearer JWT support if exposed must verify issuer/audience/signature/expiry and account status, never decode-only. Test-only fixtures can emulate managed auth at a loopback HTTP server using real SDK requests, not a production bypass.
- Use a server-owned mutation timestamp/revision for authenticated updates; imported client time must be finite, plausible, and bounded. Return clear 409 on duplicate username; reject overlong display names and avatar URLs outside https (or use provider avatar only). Do not enable arbitrary file upload/cloud storage in this task.
- Keep `profiles` account data consistent with auth identity, don't expose emails in public profiles. Deleting an app profile must not leave user role rows with privileges; account deletion/auth revocation uses documented managed SDK, never handcrafted password/session table writes.
- Reset password/verification UI may call managed auth endpoints but must not pretend email was delivered in local fixture mode. Clearly report external mail/Google gates as unverified.
- No subagents. Full report `docs/superpowers/sdd/kaslyydex-phase-1-2/task-6-report.md`.

**Files:**
- Modify: `web/lib/db/schema.ts`, add migration
- Create: `web/lib/merge.ts`, `web/lib/validators.ts`
- Create: `web/app/api/v1/me/route.ts`, `library/route.ts`, `progress/route.ts`, `level/route.ts`
- Modify: `web/components/header.tsx`, `web/components/library/*`, `web/components/reader/*`

**Interfaces:**
- `GET/PATCH /api/v1/me`
- `GET/PUT/DELETE /api/v1/me/library/:mangaId`
- `PUT /api/v1/me/progress/:chapterId`
- `GET /api/v1/me/level`

- [ ] **Step 1: Write failing tests** for ownership, unique library rows, progress merge precedence (server newer wins unless local has a later timestamp), and unauthenticated responses.
- [ ] **Step 2: Run tests; expected RED.
- [ ] **Step 3: Add typed schema, validators, transaction-safe BFF handlers and guest merge endpoint.
- [ ] **Step 4: Add logged-in UI for profile, library, continue reading and cross-device progress.
- [ ] **Step 5: Verify duplicate requests are idempotent and a user cannot read/update another user’s rows.
- [ ] **Step 6: Run database migration tests, TypeScript tests and Playwright auth/library/progress flows.
- [ ] **Step 7: Commit** `feat: add synced user reading data`.

---

