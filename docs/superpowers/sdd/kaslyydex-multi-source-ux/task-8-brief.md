### Task 8: Shape-matched skeletons and motion system

**Files:**
- Modify: `web/app/globals.css`
- Modify: `web/app/page.tsx`
- Modify: `web/components/manga-card.tsx`
- Modify: `web/app/search/page.tsx`
- Modify: `web/app/manga/[id]/page.tsx`
- Modify: `web/components/reader/ReaderPages.tsx`
- Test: `web/scripts/skeleton-motion.test.mjs`

**Interfaces:**
- Produces: CSS tokens `--dur-fast`, `--dur-base`, `--ease-out`.
- Produces: skeleton components/classes for hero, popular card, feed row, rank row, chapter row, reader page.
- Produces: image fade-in class applied after load/decode.

- [ ] **Step 1: Write failing skeleton/motion browser test**

Create `web/scripts/skeleton-motion.test.mjs` asserting:
- Home fallback skeletons have hero/card/feed/rank shapes, not a single generic block.
- Skeleton containers have accessible loading status.
- At 375px, skeleton and loaded pages have no horizontal overflow.
- With reduced motion emulated, shimmer/transition animations are disabled or reduced.
- Reader page images fade in only after decode/load.

- [ ] **Step 2: Run test to verify RED**

Run from `web/`: `node --test scripts/skeleton-motion.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Add motion tokens and skeleton markup/styles**

Add CSS variables and shape-matched skeletons. Replace generic Suspense fallbacks in home/search/manga pages. Add reader page skeleton/frame behavior without changing WASM state.

- [ ] **Step 4: Add restrained transitions**

Apply card hover, button press, image fade-in, reader horizontal transition, and progress bar transition using tokens. Guard all motion with `prefers-reduced-motion`.

- [ ] **Step 5: Run test and visual regression suites**

Run from `web/`:
- `node --test scripts/skeleton-motion.test.mjs`
- `node --test scripts/reader-playwright.test.mjs`
- `npm run lint`
- `npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/app/globals.css web/app/page.tsx web/components/manga-card.tsx web/app/search/page.tsx "web/app/manga/[id]/page.tsx" web/components/reader/ReaderPages.tsx web/scripts/skeleton-motion.test.mjs
git commit -m "feat: match skeletons to content and add restrained motion"
```
