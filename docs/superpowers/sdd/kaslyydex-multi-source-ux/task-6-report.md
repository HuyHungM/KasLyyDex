# Task 6 report — Source-aware reader tickets, progress, and XP

- Branch: `feature/kaslyydex-multi-source-ux`
- Base: `b2a96f7589ee41f351551f8a3c991f2678857ce2`
- Status: **complete**, commit `feat: bind reader tickets and XP to content source`
- No deploy / push / merge performed. No Neon Auth table writes.

## What changed

- `web/lib/validators.ts`: added `CONTENT_SOURCES` (`mangadex`/`comick` exact ids), `ContentSource`, `parseContentId()` (MangaDex UUID or `comick:<opaque>`; opaque has no whitespace/control/`?`/`#`), and `parseContentSource()` (exact allowlist).
- `web/lib/progression-api.ts`: `TicketClaims.source` is signed into the JWT; `verifyTicket` validates it is one of the two exact ids; `loadSession` compares claim source to `reader_sessions.source` before checkpoint/complete; `sessionPost` derives source from the full chapter id, optionally accepts a paired `source` + `source_label` and rejects disagreement/non-canonical labels, fetches metadata with the full source-aware id, persists `source`, signs it, and returns a paired `source`/`source_label` DTO. Existing elapsed/coverage/rate-limit rules untouched; the 502 `UPSTREAM_ERROR` envelope still fails closed as `503 CONTENT_METADATA_UNAVAILABLE` with no session row.
- `web/lib/db/schema.ts` + `web/drizzle/0007_reader_session_source.sql` + `web/drizzle/meta/0007_snapshot.json` + `web/drizzle/meta/_journal.json`: additive `reader_sessions.source TEXT NOT NULL DEFAULT 'mangadex'`, generated with Drizzle Kit (`drizzle-kit check`: "Everything's fine"). No auth schema touched.
- `web/components/reader/ReaderClient.tsx`: sends the full `chapter.id` plus canonical `source`/`source_label` pair to `/api/v1/reader-sessions`; checkpoint/complete continue to carry the signed ticket (source bound in the claim). WASM page state untouched; native selects untouched (Task 7 owns them).
- `web/scripts/progression.test.mjs`, `web/scripts/database.test.mjs`: added migration `0007` to their harness lists — required because Drizzle now selects the new column. No assertions changed.

## RED (before implementation)

From `web/`:

```
node --import tsx --conditions=react-server --test scripts/source-progression.test.mjs
```

- First run (migration file absent): 8 tests, 8 fail — all `ENOENT` on `0007_reader_session_source.sql`.
- Meaningful RED after making the harness skip a missing migration so failures reflect behaviour: **8 tests, 4 pass, 4 fail**:
  - MangaDex ticket had no `source` claim (`undefined !== 'mangadex'`).
  - Comick chapter ticket creation rejected with `400 Content ids must be MangaDex UUIDs`.
  - Comick completion rejected with the same `400`.
  - Comick id with MangaDex metadata returned `400` instead of `409 CONTENT_MISMATCH`.

## GREEN (after implementation)

From `web/`:

```
node --import tsx --conditions=react-server --test scripts/source-progression.test.mjs \
  scripts/progression.test.mjs scripts/database.test.mjs
npx tsc --noEmit
npx eslint lib/validators.ts lib/progression-api.ts lib/db/schema.ts \
  components/reader/ReaderClient.tsx scripts/source-progression.test.mjs \
  scripts/progression.test.mjs scripts/database.test.mjs
npx drizzle-kit check
git diff --check
node scripts/secret-scan.mjs ..
```

- Focused only: **16/16 pass**.
- Focused + progression + database: **38/38 pass**.
- `tsc --noEmit`: exit 0. Scoped eslint: exit 0. `drizzle-kit check`: clean. `git diff --check`: clean. Secret scan: 0 candidates.

`source-progression.test.mjs` coverage: additive column/default/no-auth-schema; validator accepts UUID and `comick:<opaque>` and rejects malformed ids; MangaDex ticket source claim + paired label + persisted row; Comick ticket creation and one-time XP/idempotent re-completion; re-signed ticket with changed source refused; tampered signature refused; Comick id with MangaDex-only metadata refused; client source/id disagreement refused; source without label and non-canonical label refused; forged `percent`/`pageCount`/extra fields refused; structured 502 fails closed with no session; cross-origin mutation refused and private no-store headers; completion rollback atomicity; guest import creates no XP; production route fails closed without the signing secret.

## Concerns / deferred

1. `source`/`source_label` are optional on the wire for legacy MangaDex clients; when present they must be a canonical pair. A legacy client sending both fields for an id with an inconsistent source gets `409 CONTENT_MISMATCH` rather than silently reattributing XP. This is intentional fail-closed behavior.
2. `xp_events`/`reading_completions` are not given a separate `source` column: the chapter id itself is namespaced (`comick:<opaque>` vs UUID), so the existing `(user, chapter)` unique keys already bind source + chapter id. No backfill or extra migration needed.
3. The test harnesses `progression.test.mjs` and `database.test.mjs` were modified beyond the brief's explicit `git add` list; without the migration entry their PGlite databases cannot satisfy Drizzle's new `source` select. They are committed as required task files.
4. Whitespace scan of the whole repo reports 526 pre-existing findings in `docs/superpowers/sdd/kaslyydex-phase-1-2/*.diff`; none are in this task's files (`git diff --check` clean). Left untouched.
5. Task 3 cold-direct metadata can return a structured 502; ticket issuance maps it to `503 CONTENT_METADATA_UNAVAILABLE` and never fabricates ownership. Live Axum/Comick behavior was not exercised here (fixture-level only).
