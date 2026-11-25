### Task 5: Web source labels and fallback chapter UI

**Files:**
- Modify: `web/lib/format.ts`
- Modify: `web/components/manga-card.tsx`
- Modify: `web/app/page.tsx`
- Modify: `web/app/manga/[id]/page.tsx`
- Modify: `web/components/chapter-list.tsx`
- Modify: `web/components/reader/ReaderToolbar.tsx`
- Test: `web/scripts/source-ui.test.mjs`

**Interfaces:**
- Consumes: Task 1 `sourceLabel`, Task 3 source-aware chapter DTOs.
- Produces: `titleWithSource(title: string, source?: string): string` in `web/lib/format.ts`.
- Produces: chapter rows and reader toolbar show source label for non-primary chapters.

- [ ] **Step 1: Write failing UI helper/browser test**

Create `web/scripts/source-ui.test.mjs` asserting:
- `titleWithSource("Slime", "mangadex") === "Slime (MangaDex)"`.
- `titleWithSource("Slime", "comick") === "Slime (Comick)"`.
- `titleWithSource("Slime") === "Slime (MangaDex)"`.
- In a fixture page with a Comick chapter, chapter row text contains `(Comick)`.
- Readable MangaDex chapter rows do not falsely show Comick.

- [ ] **Step 2: Run test to verify RED**

Run from `web/`: `node --import tsx --conditions=react-server --test scripts/source-ui.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement source label rendering**

Add `titleWithSource`. Use it in manga cards/detail/feature where title is shown. In `ChapterList`, append source label for chapters whose `source` is not `mangadex`. In reader toolbar/back title, show source when current chapter is fallback. Keep external links unchanged.

- [ ] **Step 4: Run test, typecheck, lint**

Run from `web/`:
- `node --import tsx --conditions=react-server --test scripts/source-ui.test.mjs`
- `npx tsc --noEmit`
- `npx eslint lib/format.ts components/manga-card.tsx components/chapter-list.tsx components/reader/ReaderToolbar.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/lib/format.ts web/components/manga-card.tsx web/app/page.tsx "web/app/manga/[id]/page.tsx" web/components/chapter-list.tsx web/components/reader/ReaderToolbar.tsx web/scripts/source-ui.test.mjs
git commit -m "feat: show reading source labels in web UI"
```
