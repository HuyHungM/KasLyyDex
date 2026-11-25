### Task 4: Advanced Search UI and merged genre groups

**Files:**
- Modify: `web/app/search/page.tsx`
- Create: `web/components/search/GenreGroups.tsx`
- Create: `web/components/search/GenreGroupsSkeleton.tsx`
- Modify: `web/components/site-shell.tsx`
- Delete: `web/app/the-loai/page.tsx`
- Test: `web/scripts/advanced-search.test.mjs`

**Interfaces:**
- Consumes: Task 1 `SearchParams`, Task 3 `SearchResponse.partial`.
- Produces: `parseQuery` fields `source: "all"|"mangadex"|"comick"`, `lang: "all"|"vi"|"en"`, `year?: number`.
- Produces: `GenreGroups` renders grouped tags and writes selected tag ids into the existing `tags` form values.
- Produces: `GenreGroupsSkeleton` renders four group placeholders.

- [ ] **Step 1: Write failing browser/SSR test**

Create `web/scripts/advanced-search.test.mjs` asserting:
- `/search` form contains shared dropdowns for source, language, year.
- Selecting source/lang/year submits correct query params while preserving `q` and tags.
- Advanced panel contains four genre groups and a genre pill updates `tags`.
- `partial=true` renders a short warning.
- `/the-loai` navigation link is absent and direct route is gone.
- 375px no horizontal overflow.

- [ ] **Step 2: Run test to verify RED**

Run from `web/` after build: `node --test scripts/advanced-search.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Extend query parsing and filters**

Update `Query` type and `parseQuery` with exact allowlists, year bounds and page clamp. Keep existing status/sort/tags behavior. Use shared `Select` for new controls.

- [ ] **Step 4: Merge genre groups into advanced panel**

Move tag group rendering into `GenreGroups`. Use `GenreGroupsSkeleton` as Suspense fallback. Remove standalone `/the-loai` page and nav item. Keep page name "Khám phá".

- [ ] **Step 5: Run test and affected regressions**

Run from `web/`:
- `node --test scripts/advanced-search.test.mjs`
- `node --test scripts/reader-playwright.test.mjs`
- `npx tsc --noEmit`
- `npm run lint`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/app/search/page.tsx web/components/search web/components/site-shell.tsx web/app/the-loai
git commit -m "feat: add advanced search and merge genre groups"
```
