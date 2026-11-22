### Task 6: Ranking skeleton and top-3 frames

**Files:**
- Create: `web/components/rank-skeleton.tsx`
- Create: `web/app/bxh/loading.tsx`
- Modify: `web/app/bxh/page.tsx`
- Modify: `web/app/globals.css`
- Test: `web/scripts/ranking-skeleton.test.mjs`

**Interfaces:**
- Produces: `RankListSkeleton` renders 12 shape-matched rows; rows 1–3 carry `rank-top rank-1|rank-2|rank-3` classes.
- Produces: `Loading` route component matching the `/bxh` shell.

- [ ] **Step 1: Write failing skeleton/frame test**

Create `web/scripts/ranking-skeleton.test.mjs` asserting:
- Route loading shell contains intro, tabs, and 12 skeleton rows.
- Changing `kind` shows skeleton again before data.
- Top 3 real rows and top 3 skeleton rows have distinct frame classes.
- Skeleton/loaded rows have matching bounding boxes within 2px.
- 375px no overflow; reduced-motion disables shimmer.

- [ ] **Step 2: Run test to verify RED**

Run from `web/` after build: `node --test scripts/ranking-skeleton.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement skeleton and frames**

Replace empty outer fallback and generic inner fallback. Add `.rank-row.rank-top.rank-1/2/3` styles using existing theme variables. Keep row height stable on mobile.

- [ ] **Step 4: Run test and regressions**

Run from `web/`:
- `node --test scripts/ranking-skeleton.test.mjs`
- `node --test scripts/skeleton-motion.test.mjs`
- `npx tsc --noEmit`
- `npm run lint`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/components/rank-skeleton.tsx web/app/bxh web/app/globals.css web/scripts/ranking-skeleton.test.mjs
git commit -m "feat: add ranking skeleton and top rank frames"
```
