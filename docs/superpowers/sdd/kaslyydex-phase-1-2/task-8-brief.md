### Task 8: Progression, cultivation titles and anti-abuse

## Execution constraints and pinned progression contract

- Vercel/Neon deployment is paused; implement/test local code with existing SDK/DB interfaces. Do not provision services or push/merge.
- 100 XP/chapter once; level min(1000,1+floor(total_xp/200)), never negative. Full 13 Vietnamese realm titles/ranges come from the approved platform spec. `user/moderator/admin` permissions never depend on cultivation.
- Separate ordinary progress from XP checkpoints: users can reread/go backward, but the completion maximum/visited-page coverage is monotone. Guest imports do not award XP. A forged `percent` or `page_count` cannot control XP.
- Signed reader ticket uses server secret kept server-only, binds user + chapter + manga + language + authoritative page_count + issued_at + expiry (30 minutes), and a persisted session row. Missing secret/content metadata fails closed (structured 503), never generates a known default key.
- Fetch chapter ownership/language/external_url/page count from Axum to issue ticket; never trust client content metadata or grant XP for external/unavailable/zero-image chapters.
- Checkpoint records valid visited pages in session (monotone union), requires at least ceil(page_count*0.8) distinct pages before completion; no single jump to the last page. Enforce server elapsed minimum max(10 seconds,2 seconds per required page), idempotent retries and at most 20 checkpoint requests/minute/account. Disclose that this limits abuse, not proof of human reading.
- completion INSERT unique (user_id,chapter_id), xp_events unique (user_id,event_type,chapter_id), ledger + profile total + level and notification insert in ONE transaction. Increment profile only when XP event insertion succeeds; concurrent sessions/retries cannot double count. Include rules version progression_v1.
- Notifications/achievements are cosmetic. Seed realms deterministically; use tested TypeScript/Rust fixture boundaries to avoid title drift.
- Task 7 provides `emitNotification(db, {userId, type, eventKey, title, body, href})` in `web/lib/moderation.ts` with a unique `(user_id,event_key)` index. Reuse it inside the XP transaction for level-up events; read its actual types after Task 7 review. Its database argument must be the current transaction, so rollback cannot leave a level-up notification without the XP award.
- Cover modified/expired ticket, wrong user/chapter, external chapter, spoofed percent/count, insufficient distinct pages/time, out-of-range/duplicate checkpoint, concurrent completions, retry consistency and rollback on DB errors using the existing PostgreSQL harness.
- Reader UI should send checkpoints while actually intersecting visible pages in an active document, pause background tab work, show completion/level-up from server response only. No user-derived level/role writes.
- No subagents. Report `docs/superpowers/sdd/kaslyydex-phase-1-2/task-8-report.md` with tests and external gates.

**Files:**
- Create: `web/lib/progression.ts`, tests
- Create: `web/app/api/v1/reader-sessions/route.ts`, `progress/complete/route.ts`
- Modify: progress schema/migrations and reader components
- Create: `web/components/profile/CultivationBadge.tsx`

**Interfaces:**
- `createReaderSession(chapterId) -> signed ticket`
- `checkpointReaderSession(ticket, lastPageSeen) -> progress`
- `completeChapter(ticket) -> { awarded: boolean, xp: number, level: number, title: string }`

- [ ] **Step 1: Write failing pure tests** for all 13 realm boundaries, level 1/1000 clamps, progression_v1 formula, and duplicate completion.
- [ ] **Step 2: Run tests; expected RED.
- [ ] **Step 3: Implement signed reader tickets, monotonic checkpoints, page range validation, rate limits and transactional completion/XP event.
- [ ] **Step 4: Add cultivation badge/profile UI and in-app level-up notification.
- [ ] **Step 5: Verify a forged percent value cannot award EXP and completion is idempotent under concurrent requests.
- [ ] **Step 6: Run full tests plus Playwright reader completion/level-up flow.
- [ ] **Step 7: Commit** `feat: add cultivation progression and xp integrity`.

---

