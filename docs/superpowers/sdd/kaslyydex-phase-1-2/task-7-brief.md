### Task 7: Comments, reports, moderation and in-app notifications

## Execution constraints and correctness rules

- Cloud deployment/provisioning stays paused; no pushes/merges. Use earlier auth/DB/error contracts; do not build a second auth system. Follow `web/AGENTS.md` installed docs.
- Comment status is visible/hidden/removed. Locks belong to a `comment_threads` row keyed by target type/id, not an individual `locked` comment status. Replies may only target a root in the same thread; reject cross-thread/deep replies and replies to removed/locked content.
- Accept plain text comment bodies of 1–2000 trimmed characters; render as React text (no raw HTML), allow spoiler reveal, owners can edit/remove, moderators hide/remove/lock; modifications require CSRF/origin check and no-store account responses.
- Per-user rate limiting is durable across function instances (PostgreSQL), e.g. at most 5 new comments/minute and 10 reports/hour. Do not use a module-local Map for production abuse limits. Report unique user/comment while open; prevent self-report and duplicate reports.
- Moderator/admin permission must be checked in service AND routed handler where it forms the entry point. User-controlled ids/titles/level cannot grant permissions. Anonymous may read visible comments; hidden/removed body must not leak through counts/replies/public API.
- Paginate comment/report/notification endpoints with bounded limits. Notification center supports mark-read and unread badge, reply/moderation events and deduplication by event key. No email/push at this stage.
- New-chapter in-app notifications refresh on demand when an authenticated user opens library/notifications: fetch bounded batches of followed manga from content API, persist a comparison cursor and dedup unique (user,manga,chapter,language). Never mark all historic chapters as new on first follow/import; no fake persistent background worker claim.
- PostgreSQL integration tests: reply depth/thread scope, ownership, unauth moderator 403, XSS remains text, report uniqueness, durable limit concurrency, mark-read ownership, hidden body privacy, chapter event duplicate suppression, thread lock races where practical.
- No subagents. Full report `docs/superpowers/sdd/kaslyydex-phase-1-2/task-7-report.md`.

**Files:**
- Modify: `web/lib/db/schema.ts`, add migration
- Create: `web/app/api/v1/comments/route.ts`, `web/app/api/v1/comments/[id]/route.ts`, reports and moderation routes
- Create: `web/lib/moderation.ts`, `web/components/comments/*`, `web/components/notifications/*`

**Interfaces:**
- Comments target either manga or chapter; one-level `parentId` only.
- Comment status: `visible`, `hidden`, `removed`, `locked`.
- Moderator/admin route checks are required inside every mutation handler.

- [ ] **Step 1: Write failing tests** for comment ownership, one-level reply rejection, spoiler flag persistence, rate limit, report uniqueness and moderator-only actions.
- [ ] **Step 2: Run tests; expected RED.
- [ ] **Step 3: Implement typed schema, structured errors, rate limits and moderation transaction paths.
- [ ] **Step 4: Add UI for story/chapter comments, spoiler reveal, report dialog, moderation queue and unread notifications.
- [ ] **Step 5: Verify sanitized rendering and authorization with Playwright and route-level tests.
- [ ] **Step 6: Commit** `feat: add moderated comments and notifications`.

---

