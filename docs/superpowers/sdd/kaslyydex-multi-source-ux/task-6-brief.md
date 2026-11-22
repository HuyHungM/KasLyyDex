### Task 6: Source-aware reader tickets, progress, and XP

**Files:**
- Modify: `web/lib/validators.ts`
- Modify: `web/lib/progression-api.ts`
- Modify: `web/lib/db/schema.ts`
- Create: `web/drizzle/0007_reader_session_source.sql`
- Modify: `web/drizzle/meta/_journal.json` and snapshot files via Drizzle Kit
- Modify: `web/components/reader/ReaderClient.tsx`
- Test: `web/scripts/source-progression.test.mjs`

**Interfaces:**
- Consumes: Task 3 `chapter_metadata` with source, Task 5 source-aware UI.
- Produces: content ID validator accepting MangaDex UUID or `comick:<opaque-id>`.
- Produces: reader ticket claim `source` and `reader_sessions.source` column default `mangadex`.
- Produces: XP completion binds `source + chapter_id`; mismatched source rejects ticket.

- [ ] **Step 1: Write failing source-aware progression tests**

Create `web/scripts/source-progression.test.mjs` using existing PGlite + fixture harness. Assertions:
- MangaDex UUID ticket still works.
- Comick chapter with authoritative pages can create ticket and complete once.
- Ticket with changed `source` is rejected.
- Ticket with Comick ID but MangaDex metadata is rejected.
- Forged `percent`/`pageCount` still cannot award XP.
- Guest import still creates no XP.

- [ ] **Step 2: Run test to verify RED**

Run from `web/`: `node --import tsx --conditions=react-server --test scripts/source-progression.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Add migration and schema source column**

Add `reader_sessions.source TEXT NOT NULL DEFAULT 'mangadex'`. Generate Drizzle migration/snapshot/journal consistently. Do not touch Neon Auth tables.

- [ ] **Step 4: Update validators and ticket flow**

Allow source-aware content IDs. Fetch chapter metadata from Axum using the full source-aware ID. Bind `source` into signed ticket and persisted session. Verify claim/source/session match before checkpoint/completion. Keep existing elapsed/coverage/rate-limit rules.

- [ ] **Step 5: Update reader client requests**

Pass full chapter ID and source metadata through reader-session/checkpoint/complete calls. Do not change WASM page state logic.

- [ ] **Step 6: Run tests and migration harness**

Run from `web/`:
- `node --import tsx --conditions=react-server --test scripts/source-progression.test.mjs scripts/progression.test.mjs scripts/database.test.mjs`
- `npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web/lib/validators.ts web/lib/progression-api.ts web/lib/db/schema.ts web/drizzle web/components/reader/ReaderClient.tsx web/scripts/source-progression.test.mjs
git commit -m "feat: bind reader tickets and XP to content source"
```
