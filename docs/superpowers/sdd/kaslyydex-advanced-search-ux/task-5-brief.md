### Task 5: Source badge on cover images

**Files:**
- Create: `web/components/source-badge.tsx`
- Modify: `web/components/manga-card.tsx`
- Modify: `web/app/page.tsx`
- Modify: `web/app/bxh/page.tsx`
- Modify: `web/app/manga/[id]/page.tsx`
- Modify: `web/app/globals.css`
- Test: `web/scripts/source-badge.test.mjs`

**Interfaces:**
- Produces: `SourceBadge({ source }: { source?: string })` returns `null` for unknown/empty source and a badge text of exactly `MangaDex` or `Comick`.
- Consumes: DTO `source`/`source_label` from Task 1/3.

- [ ] **Step 1: Write failing render/accessibility test**

Create `web/scripts/source-badge.test.mjs` asserting:
- Badge text is exact for both sources.
- Badge has accessible label `Nguồn: <label>`.
- Cover parent link still has the original href.
- Card/rank/feed/feature/detail covers contain a badge.
- Visible manga titles no longer contain `(MangaDex)` or `(Comick)`.

- [ ] **Step 2: Run test to verify RED**

Run from `web/`: `node --import tsx --conditions=react-server --test scripts/source-badge.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement badge and replace title suffix**

Add CSS for a compact top-left/top-right badge using theme variables. Remove `titleWithSource` usages from visible titles. Keep `sourceLabel` helper as the badge source of truth.

- [ ] **Step 4: Update existing source-ui tests**

Adjust `web/scripts/source-ui.test.mjs` expectations from title suffix to cover badge. Do not delete assertions.

- [ ] **Step 5: Run tests and scoped checks**

Run from `web/`:
- `node --import tsx --conditions=react-server --test scripts/source-badge.test.mjs scripts/source-ui.test.mjs`
- `node --test scripts/reader-playwright.test.mjs`
- `npx tsc --noEmit`
- `npm run lint`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/components/source-badge.tsx web/components/manga-card.tsx web/app/page.tsx web/app/bxh/page.tsx "web/app/manga/[id]/page.tsx" web/app/globals.css web/scripts/source-badge.test.mjs web/scripts/source-ui.test.mjs
git commit -m "feat: show source as a cover badge"
```
