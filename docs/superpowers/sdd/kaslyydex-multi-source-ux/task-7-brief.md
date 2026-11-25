### Task 7: Shared accessible custom dropdown

**Files:**
- Create: `web/components/ui/Select.tsx`
- Modify: `web/app/globals.css`
- Modify: `web/components/reader/ReaderToolbar.tsx`
- Modify: `web/components/account/SettingsForm.tsx`
- Modify: `web/components/moderation/ModerationQueue.tsx`
- Modify: `web/app/search/page.tsx`
- Test: `web/scripts/select.test.mjs`
- Modify: `web/scripts/account-playwright.test.mjs`
- Modify: `web/scripts/reader-playwright.test.mjs`

**Interfaces:**
- Produces: `Select` props:

```ts
type SelectOption = { value: string; label: string; disabled?: boolean };
type SelectProps = {
  id?: string;
  name?: string;
  value?: string;
  defaultValue?: string;
  options: SelectOption[];
  onChange?: (value: string) => void;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
};
```

- Produces: when `name` is provided, renders a hidden input with the current value so GET/POST forms submit unchanged.
- Produces: trigger button with `aria-expanded`, `aria-controls`; popup `role="listbox"`; options `role="option"` and `aria-selected`.

- [ ] **Step 1: Write failing dropdown behavior test**

Create `web/scripts/select.test.mjs` with Playwright assertions:
- Click opens listbox; Escape closes.
- Arrow Down/Up moves active option; Enter selects.
- Click outside closes.
- Selected value updates hidden input when `name` is present.
- Disabled select cannot open.
- Search filter form still submits selected `status`/`sort` values.

- [ ] **Step 2: Run test to verify RED**

Run from `web/`: `node --test scripts/select.test.mjs`
Expected: FAIL because component does not exist.

- [ ] **Step 3: Implement `Select` and styles**

Implement controlled/uncontrolled behavior, keyboard navigation, outside-click close, focus management, long-list scrolling, and theme-variable styling. Add subtle open/close transition under reduced-motion guard.

- [ ] **Step 4: Replace native selects**

Replace reader chapter/settings selects, account settings selects, moderation target select, and search filter selects. For search GET form, use `name` hidden-input behavior. Keep underlying values identical.

- [ ] **Step 5: Update existing Playwright select interactions**

Replace `selectOption` calls in account/reader tests with dropdown click/keyboard interactions. Keep test intent unchanged.

- [ ] **Step 6: Run dropdown and affected browser tests**

Run from `web/`:
- `node --test scripts/select.test.mjs`
- `node --test scripts/account-playwright.test.mjs scripts/reader-playwright.test.mjs`
- `npx tsc --noEmit`
- `npm run lint`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web/components/ui/Select.tsx web/app/globals.css web/components/reader/ReaderToolbar.tsx web/components/account/SettingsForm.tsx web/components/moderation/ModerationQueue.tsx web/app/search/page.tsx web/scripts/select.test.mjs web/scripts/account-playwright.test.mjs web/scripts/reader-playwright.test.mjs
git commit -m "feat: replace native selects with accessible dropdown"
```
