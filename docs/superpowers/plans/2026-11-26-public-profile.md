# Public Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Docln-style public member profile at `/thanh-vien/{userId}` with root/reply comment sections, owner-only saved library, stats, bio, and shape-matched skeletons.

**Architecture:** A public `GET /api/v1/users/[userId]` endpoint reads D1 through a new `getPublicProfile` service, enriches comment targets from the content client with bounded calls, and returns one `PublicProfileDto`. A client `PublicProfile` component renders the page and uses the existing `useRemoteResource` pattern; the saved list is present only when the session viewer is the profile owner.

**Tech Stack:** Next.js 16 App Router, React 19, Drizzle + Cloudflare D1, vinext/Cloudflare Workers, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-26-public-profile-design.md`

## Global Constraints

- No visible “Đang tải…”, “Đang mở…” or similar loading text; use shape-matched skeletons with `role="status"` + `aria-label`.
- Public payload must never include `email`, `role`, hidden/removed comment bodies, moderation notes, or reader preferences.
- Saved library entries are returned only when `viewer.id === userId`; guests get `saved: null` and `savedTotal`.
- Migration is additive and forward-only: add `profiles.bio` and `comments_user_visible_idx`; never drop or rewrite existing tables.
- Reuse existing classes/tokens (`wrap catalog-page`, `surface`, `shelf-grid`, `shelf-card`, `skel-bar`, `skel-cover`) instead of adding a new design system.
- Do not add dependencies.
- Run `npm run build` before browser tests that use `startNext`.

## Review Focus

- Hidden or removed comment body leaking into a public profile → Task 3 test.
- Non-owner receiving the saved library array → Task 3/4 test.
- Unknown `userId` returning a placeholder profile instead of 404 → Task 3 test.
- Content metadata failure producing a dead/blank item → Task 4 test.
- Skeleton/loaded geometry mismatch or horizontal overflow on mobile → Task 5 browser test.

---

### Task 1: Additive bio migration and test harness

**Files:**
- Modify: `web/lib/db/schema.ts` (profiles + comments index)
- Create: `web/migrations/0001_profile_bio.sql` via `drizzle-kit generate`
- Modify: `web/migrations/meta/_journal.json`, `web/migrations/meta/*_snapshot.json` (generated)
- Modify: `web/scripts/database.test.mjs`
- Modify: `web/scripts/account.test.mjs`, `web/scripts/community.test.mjs`, `web/scripts/notification-feed.test.mjs`, `web/scripts/source-progression.test.mjs`, `web/scripts/progression.test.mjs` migration file lists

**Interfaces:**
- Consumes: existing `profiles` and `comments` tables.
- Produces: `profiles.bio` (`text`, nullable) and `comments_user_visible_idx`; all test databases apply `0000_cloudflare_d1.sql` then `0001_profile_bio.sql`.

- [ ] **Step 1: Write the failing migration assertions**

In `web/scripts/database.test.mjs`, change the baseline test to expect both files and both journal tags:

```js
assert.deepEqual(files, ["0000_cloudflare_d1.sql", "0001_profile_bio.sql"]);
assert.deepEqual(journal.entries.map((entry) => entry.tag), ["0000_cloudflare_d1", "0001_profile_bio"]);
```

Add a check that the new SQL contains `ADD COLUMN \`bio\`` and `CREATE INDEX \`comments_user_visible_idx\``.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --conditions=react-server --test scripts/database.test.mjs`
Expected: FAIL because `0001_profile_bio.sql` and the journal entry do not exist.

- [ ] **Step 3: Add the schema changes**

In `web/lib/db/schema.ts`:

- Import `desc` from `drizzle-orm`.
- Add `bio: text("bio")` to `profiles`.
- Add `index("comments_user_visible_idx").on(table.userId, table.status, desc(table.createdAt))` to the `comments` table callback.

- [ ] **Step 4: Generate the additive migration**

Run: `npx drizzle-kit generate --name=profile_bio`
Expected: `web/migrations/0001_profile_bio.sql` plus journal/snapshot updates; SQL contains `ALTER TABLE \`profiles\` ADD \`bio\` text;` and the comments index.

- [ ] **Step 5: Update every test migration list**

Add `"0001_profile_bio.sql"` after `"0000_cloudflare_d1.sql"` in:

- `web/scripts/account.test.mjs`
- `web/scripts/community.test.mjs`
- `web/scripts/notification-feed.test.mjs`
- `web/scripts/source-progression.test.mjs`
- `web/scripts/progression.test.mjs`

For `database.test.mjs`, apply both files in `freshDatabase()`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --import tsx --conditions=react-server --test scripts/database.test.mjs scripts/account.test.mjs scripts/community.test.mjs`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web/lib/db/schema.ts web/migrations web/scripts/database.test.mjs web/scripts/account.test.mjs web/scripts/community.test.mjs web/scripts/notification-feed.test.mjs web/scripts/source-progression.test.mjs web/scripts/progression.test.mjs
git commit -m "feat(db): add profile bio and comment lookup migration"
```

---

### Task 2: Bio in profile DTO, API and edit form

**Files:**
- Modify: `web/lib/contracts.ts` (`AccountProfileDto`)
- Modify: `web/lib/me/service.ts` (`ProfileDto`, `profileDto`, `updateProfile`)
- Modify: `web/lib/validators.ts` (`parseProfilePatch`)
- Modify: `web/components/account/ProfileForm.tsx`
- Test: `web/scripts/account.test.mjs`

**Interfaces:**
- Consumes: `profiles.bio` from Task 1.
- Produces: `AccountProfileDto.bio: string | null`; `parseProfilePatch` accepts `{ bio?: string | null }`; `updateProfile(..., patch, now)` persists `bio`.

- [ ] **Step 1: Write the failing bio tests**

Extend the existing profile validation test in `web/scripts/account.test.mjs`:

```js
assert.equal((await patch(alice, { bio: "x".repeat(161) })).status, 400);
assert.equal((await patch(alice, { bio: "  Thích isekai  " })).status, 200);
const [saved] = await db.select().from(schema.profiles).where(eq(schema.profiles.userId, "opaque|alice"));
assert.equal(saved.bio, "Thích isekai");
const read = await alice.meGet(request("/api/v1/me"));
assert.equal((await read.json()).profile.bio, "Thích isekai");
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --conditions=react-server --test scripts/account.test.mjs`
Expected: FAIL on the 400/200 assertions or missing `bio` in the response.

- [ ] **Step 3: Add bio to contracts and service**

- `AccountProfileDto` and `ProfileDto` get `bio: string | null`.
- `profileDto(row)` returns `bio: row.bio`.
- `updateProfile` patch type includes `bio?: string | null`; set `values.bio = patch.bio ?? null` when the key is present.

- [ ] **Step 4: Validate bio in the request boundary**

In `parseProfilePatch`:

- Allow `"bio"` in `assertAllowedKeys`.
- Parse with `plainText(body.bio, 160)`.
- Empty string becomes `null`; values over 160 throw `ValidationError(400, "INVALID_INPUT", ...)`.

- [ ] **Step 5: Add the textarea to the form**

In `ProfileForm`:

- Add `const [bio, setBio] = useState(profile.bio ?? "")`.
- Send `bio: bio.trim() || null` in the PATCH body.
- Add a `<label className="auth-field">` with a `<textarea className="auth-input" maxLength={160}>` and a visible `160` character counter.
- Keep the existing submit/reset behavior.

- [ ] **Step 6: Run the test to verify it passes**

Run: `node --import tsx --conditions=react-server --test scripts/account.test.mjs`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web/lib/contracts.ts web/lib/me/service.ts web/lib/validators.ts web/components/account/ProfileForm.tsx web/scripts/account.test.mjs
git commit -m "feat(profile): add editable bio"
```

---

### Task 3: Public profile service, grouping and privacy

**Files:**
- Modify: `web/lib/contracts.ts` (public DTOs)
- Create: `web/lib/public-profile/service.ts`
- Create: `web/scripts/public-profile.test.mjs`
- Modify: `web/package.json` (`test:aggregate`)

**Interfaces:**
- Consumes: `AppDatabase`, `ContentClient`, `profiles`, `comments`, `libraryEntries`, `readingCompletions`.
- Produces:

```ts
export async function getPublicProfile(
  db: AppDatabase,
  viewerId: string | null,
  userId: string,
  content: ContentClient,
): Promise<PublicProfileDto>;
```

- [ ] **Step 1: Write the failing service tests**

Create `web/scripts/public-profile.test.mjs` with a local D1 database applying both migrations. Cover:

```js
test("public profile groups root/reply comments and hides non-visible bodies", async () => { ... });
test("saved library is owner-only and unknown users return 404", async () => { ... });
```

Use direct inserts for `profiles`, `comments`, `libraryEntries`, and `readingCompletions`; use a content stub whose methods throw so the test also pins the fallback path.

Assertions:

- Guest payload `posted[0].body === "root"` and `participating[0].body === "reply"`.
- No `hidden`/`removed` body appears anywhere in `JSON.stringify(payload)`.
- `payload.saved === null` for guest; `payload.saved[0].mangaId` exists for owner.
- Unknown id rejects with `ServiceError` status 404 / code `USER_NOT_FOUND`.
- `payload.stats.comments` counts only visible comments.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --conditions=react-server --test scripts/public-profile.test.mjs`
Expected: FAIL because the service file does not exist.

- [ ] **Step 3: Implement the service**

In `web/lib/public-profile/service.ts`:

- Load the profile row; throw `new ServiceError(404, "USER_NOT_FOUND", ...)` when absent.
- Return `joinedAt: row.createdAt.getTime()`, `bio: row.bio`, level/title from `levelFromXp`/`realmForLevel`.
- Count `readingCompletions`, `libraryEntries`, and visible `comments`.
- Read all visible comments for the user ordered `createdAt DESC, id DESC`; group by `(targetType,targetId)` into root (`parentId === null`) and reply maps, keeping the first (newest) comment per target.
- `posted` / `participating` are the first 20 groups; `recent` is the first 5 comments; `saved` is owner-only (24 newest) or `null`; `savedTotal` is always the full count.
- Set `truncated` from group/list lengths.
- For this task, map entries with fallback `title: "Truyện"` / `"Chương"`, `coverFile: null`, `mangaId: targetType === "manga" ? targetId : null`, `chapterLabel: null`, `body: row.body ?? ""`.

- [ ] **Step 4: Register the test in the aggregate script**

Add `scripts/public-profile.test.mjs` to `test:aggregate` in `web/package.json`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --import tsx --conditions=react-server --test scripts/public-profile.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/lib/contracts.ts web/lib/public-profile/service.ts web/scripts/public-profile.test.mjs web/package.json
git commit -m "feat(profile): add public profile data service"
```

---

### Task 4: Enrichment, API route and owner saved list

**Files:**
- Modify: `web/lib/public-profile/service.ts`
- Modify: `web/lib/community/handlers.ts` (`usersGet`)
- Create: `web/app/api/v1/users/[userId]/route.ts`
- Modify: `web/scripts/public-profile.test.mjs`

**Interfaces:**
- Consumes: `getPublicProfile` from Task 3; `ContentClient.manga`, `ContentClient.chapterMetadata`.
- Produces: `CommunityApi.usersGet(request, params: { userId: string })`; `GET /api/v1/users/[userId]`.

- [ ] **Step 1: Write the failing enrichment/API tests**

Add to `web/scripts/public-profile.test.mjs`:

```js
test("profile enriches titles, tags and falls back when content fails", async () => { ... });
test("usersGet returns owner saved entries and guest null", async () => { ... });
```

Use a content stub:

```js
manga: async (id) => ({ id, title: `Manga ${id}`, cover_file: "cover.jpg", tags: ["Action", "Isekai"], ... }),
chapterMetadata: async (id) => ({ id, manga_id: "m1", chapter: "7", title: "Chapter 7", ... }),
```

Assertions:

- `posted[0].title === "Manga m1"`, `coverFile === "cover.jpg"`, `topTags` includes `"Action"`.
- A chapter entry gets `mangaId === "m1"` and `chapterLabel === "Chương 7"`.
- When `manga` throws, the entry still has a working `targetId` and fallback title.
- `api.usersGet(request("/api/v1/users/opaque|owner"), { userId: "opaque|owner" })` returns saved entries for the owner and `saved: null` for a guest.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --conditions=react-server --test scripts/public-profile.test.mjs`
Expected: FAIL on enrichment assertions and missing `usersGet`.

- [ ] **Step 3: Add bounded enrichment**

In `getPublicProfile`:

- Build the union of targets from `posted`, `participating`, and `recent`.
- Load the profile user's `libraryEntries` once into a `mangaId -> {title, coverFile}` map.
- For each target, resolve from the library map first; otherwise call `content.manga` for manga targets or `content.chapterMetadata` then `content.manga` for chapter targets.
- Cap content calls at 12 per request; on error keep the fallback entry.
- Count tags from enriched manga entries and return up to 3 unique tags in `topTags`.

- [ ] **Step 4: Add the API action and route**

In `createCommunityApi`, add:

```ts
usersGet: (request: Request, params: { userId: string }) => withUser(request, async (user) => {
  const userId = parseResourceId(params.userId, "userId");
  const profile = await getPublicProfile(db(), user?.id ?? null, userId, await deps.content());
  return privateJson(profile);
}, { optional: true }),
```

Create `web/app/api/v1/users/[userId]/route.ts`:

```ts
import { wrapCommunityRoute } from "@/lib/community/handlers";

export function GET(request: Request, context: { params: Promise<{ userId: string }> }) {
  return wrapCommunityRoute(async (api, req) => api.usersGet(req, await context.params), request);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --import tsx --conditions=react-server --test scripts/public-profile.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/lib/public-profile/service.ts web/lib/community/handlers.ts "web/app/api/v1/users/[userId]/route.ts" web/scripts/public-profile.test.mjs
git commit -m "feat(profile): expose public profile API"
```

---

### Task 5: Profile UI, skeletons and browser coverage

**Files:**
- Create: `web/app/thanh-vien/[userId]/page.tsx`
- Create: `web/components/profile/PublicProfile.tsx`
- Modify: `web/components/loaders.tsx`
- Modify: `web/app/globals.css`
- Modify: `web/components/account/AccountPage.tsx`
- Create: `web/scripts/profile-playwright.test.mjs`
- Modify: `web/package.json` (`test:browser`)

**Interfaces:**
- Consumes: `PublicProfileDto`, `useRemoteResource`, `CultivationBadge`, `ShelfSkeleton`.
- Produces: route `/thanh-vien/{userId}` and `PublicProfileSkeleton`, `ProfileHeaderSkeleton`, `ProfileStatsSkeleton`, `ProfileEntrySkeleton`, `ProfileRecentSkeleton`, `ProfileTagsSkeleton`.

- [ ] **Step 1: Write the failing browser test**

Create `web/scripts/profile-playwright.test.mjs` using `startNext`, `installIdentityFixture`, and a mocked `**/api/v1/users/**` response with a 1200ms delay.

Cover:

- Guest: initial `.profile-page [role="status"]` is visible, contains no `/Đang tải|Đang mở/`; after load, `.profile-entry` and `.shelf-grid` guest empty state appear.
- Owner (`installIdentityFixture(context, { signedIn: true, userId: "user-1" })`): mocked payload includes `saved`; `.shelf-card` appears.
- Skeleton vs loaded geometry: capture `getBoundingClientRect()` of `.profile-header`, `.profile-stats`, `.profile-entry`, `.shelf-grid` in both phases and assert width/height differ by at most 2px.
- 375px viewport: `documentElement.scrollWidth <= clientWidth + 1`.
- No page errors.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run build` then `node --test scripts/profile-playwright.test.mjs`
Expected: FAIL because the route/component/skeletons do not exist.

- [ ] **Step 3: Add the skeleton components**

In `web/components/loaders.tsx`, add:

- `PublicProfileSkeleton` composing the header, stats, two entry sections (3 rows each), recent (3 rows), tags (3 pills), and `ShelfSkeleton`.
- `ProfileHeaderSkeleton`, `ProfileStatsSkeleton`, `ProfileEntrySkeleton`, `ProfileRecentSkeleton`, `ProfileTagsSkeleton`.

Use the same class names as the loaded markup and `role="status"` + `aria-label` on each outer container.

- [ ] **Step 4: Build the page and client component**

`web/app/thanh-vien/[userId]/page.tsx`:

```tsx
import PublicProfile from "@/components/profile/PublicProfile";

export default async function Page({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  return <main className="wrap catalog-page"><PublicProfile userId={userId} /></main>;
}
```

`PublicProfile.tsx`:

- `useRemoteResource<PublicProfileDto>(`/api/v1/users/${encodeURIComponent(userId)}`, userId)`.
- While loading and no data: `<PublicProfileSkeleton />`.
- Header: avatar/initials, display name, `CultivationBadge`, bio, joined date.
- Stats: 4 cells; section headings show `posted`/`participating` counts.
- Entries: cover, title, chapter label, comment excerpt, `relDate(new Date(createdAt).toISOString())`, link to `/manga/{mangaId}` or `/read/{targetId}?manga={mangaId}&lang=vi`.
- Recent: 5 compact rows.
- Tags: pills.
- Saved: owner `shelf-grid`; guest empty surface with “Chỉ chủ nhân xem được”.
- Error: `surface empty` with retry button.

- [ ] **Step 5: Add CSS**

In `web/app/globals.css`, add `.profile-page`, `.profile-header`, `.profile-avatar`, `.profile-stats`, `.profile-stat`, `.profile-section`, `.profile-entry`, `.profile-entry-cover`, `.profile-entry-body`, `.profile-comment`, `.profile-recent`, `.profile-tag-list`, `.profile-saved`, plus skeleton geometry rules. Reuse `--surface`, `--line`, `--accent`, `--muted`; stack to one column below 720px.

- [ ] **Step 6: Link from `/tai-khoan`**

In `AccountPage`, when signed in, add a link to `/thanh-vien/${session.user.id}` labeled “Xem hồ sơ công khai”.

- [ ] **Step 7: Register and run the browser test**

Add `scripts/profile-playwright.test.mjs` to `test:browser` in `web/package.json`.

Run: `npm run build` then `node --test scripts/profile-playwright.test.mjs`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add "web/app/thanh-vien/[userId]/page.tsx" web/components/profile/PublicProfile.tsx web/components/loaders.tsx web/app/globals.css web/components/account/AccountPage.tsx web/scripts/profile-playwright.test.mjs web/package.json
git commit -m "feat(profile): render public profile with shape-matched skeletons"
```

---

### Task 6: Full gates and live verification

**Files:**
- No new files; verify the branch.

**Interfaces:**
- Consumes: all previous tasks.
- Produces: a deployable branch with green gates.

- [ ] **Step 1: Run build gates**

Run: `npm run build` then `npm run build:vinext`
Expected: both PASS.

- [ ] **Step 2: Run aggregate tests**

Run: `npm run test:aggregate`
Expected: PASS, including `public-profile.test.mjs`.

- [ ] **Step 3: Run browser tests**

Run: `npm run test:browser`
Expected: PASS, including `profile-playwright.test.mjs`.

- [ ] **Step 4: Commit any gate fixes**

```bash
git add -A
git commit -m "test(profile): cover public profile gates"
```

- [ ] **Step 5: Push and deploy**

```bash
git push origin HEAD:refs/heads/netlify-migration
cd web
cf deploy --prebuilt --secrets-file .cloudflare/secrets.json --message "Public member profile"
```

- [ ] **Step 6: Live QA**

Check on `https://dex.kaslyy.dpdns.org`:

- Guest `/thanh-vien/{userId}` shows public comments and no saved titles.
- Owner sees saved shelf and “Xem hồ sơ công khai” from `/tai-khoan`.
- Skeleton phase has no visible loading text and no horizontal overflow at 375px.
- No console/page errors.