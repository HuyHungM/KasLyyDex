# Public Profile Design

Date: 2026-11-26
Status: Approved design, pending spec review

## Goal

Add a public member profile at `/thanh-vien/{userId}`, modeled on Docln's member page, while keeping KasLyyDex's existing design language, privacy rules, and skeleton system.

Success criteria:

- A guest can open any existing user's profile and see public activity without signing in.
- The profile shows the latest comment from that user for each manga/chapter in two sections: root comments and replies.
- The owner sees their saved library on the same page; everyone else sees only the saved count.
- Every loading state uses a skeleton with the same wrapper and approximate geometry as the real content.
- No email, role, hidden comment, or private saved list is exposed.

## Scope

In scope:

- Public route `web/app/thanh-vien/[userId]/page.tsx`.
- Public API `GET /api/v1/users/[userId]`.
- New `PublicProfileDto` and `PublicProfileEntryDto` contracts.
- Additive migration: `profiles.bio` and a comment lookup index.
- Profile header, stats, root/reply comment sections, recent activity, top genres, saved library, and bio editing.
- Shape-matched skeletons for every async section.
- Tests for authorization, grouping, migration, and browser layout.

Out of scope:

- Uploading or publishing manga.
- Following/followers graph beyond the existing saved library.
- Public DMs, contact fields, or moderation changes.
- Paginated activity beyond the bounded profile payload.
- Changing `/tai-khoan` into the public page; it remains the editing surface.

## Data Model

### Migration

Add `web/migrations/0001_profile_bio.sql`:

- `ALTER TABLE profiles ADD COLUMN bio text;` (nullable).
- `CREATE INDEX comments_user_visible_idx ON comments(user_id, status, created_at DESC);`

The migration is additive and safe for existing rows. `bio` is plain text, trimmed, maximum 160 characters.

### Public DTO

Add to `web/lib/contracts.ts`:

```ts
export type PublicProfileEntryDto = {
  targetType: "manga" | "chapter";
  targetId: string;
  mangaId: string | null;
  title: string;
  coverFile: string | null;
  chapterLabel: string | null;
  body: string;
  createdAt: number;
};

export type PublicProfileDto = {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  title: string;
  level: number;
  totalXp: number;
  joinedAt: number;
  stats: {
    chaptersRead: number;
    following: number;
    comments: number;
    posted: number;
    participating: number;
    saved: number;
  };
  topTags: string[];
  posted: PublicProfileEntryDto[];
  participating: PublicProfileEntryDto[];
  recent: PublicProfileEntryDto[];
  saved: LibraryEntryDto[] | null;
  savedTotal: number;
  truncated: { posted: boolean; participating: boolean; recent: boolean; saved: boolean };
};
```

`saved` is `null` for non-owners. It is an array only when the authenticated viewer is the profile owner. `savedTotal` is always the owner's library count, so guests can see the number without the list.

### Queries

All reads stay in D1 through Drizzle:

- Profile: `profiles` row by `userId`; missing row returns 404.
- `chaptersRead`: count `reading_completions` for the user.
- `following`: count `library_entries` for the user.
- `comments`: count `comments` with `status = "visible"` for the user.
- `posted`: visible root comments (`parent_id IS NULL`), grouped by `(target_type, target_id)`, newest comment per target, limit 20.
- `participating`: visible replies (`parent_id IS NOT NULL`), grouped by `(target_type, target_id)`, newest comment per target, limit 20.
- `recent`: newest 5 visible comments across both groups.
- `saved`: owner-only, `library_entries` newest by `followed_at`, limit 24; `savedTotal` is the full count.

Comment bodies are only returned when `status = "visible"`. Hidden and removed comments never appear in the public profile.

### Enrichment

The server enriches each target with title/cover:

- `targetType = "manga"`: call `content.manga(targetId)`.
- `targetType = "chapter"`: call `content.chapterMetadata(targetId)`, then `content.manga(manga_id)`.
- Reuse `library_entries` rows to resolve known manga titles/covers without a content call.
- Enrich the union of targets in `posted`, `participating`, and `recent`, not each list independently.
- Cap metadata work at 8 targets per section and 12 content calls per request. If a lookup fails, keep the item with a fallback title (`Truyện` or `Chương`) and a working link.
- `topTags`: count tags from enriched manga entries across both sections; return up to 3 unique tags.

### Bio editing

- `AccountProfileDto` and the `PATCH /api/v1/me` profile patch accept `bio`.
- Validation: trim; `null` or empty becomes `null`; reject values longer than 160 characters with `BIO_TOO_LONG`.
- `ProfileForm` adds a textarea with a 160-character counter.
- Public profile renders bio as plain text, preserving line breaks with CSS `white-space: pre-line`.

## API

`GET /api/v1/users/[userId]`

- Public route; session is optional.
- Uses the existing community API factory (`createCommunityApi`) with a new `usersGet` action so identity, database, content, and error handling stay in one place.
- `userId` is validated with the existing resource-id parser.
- Response: `PublicProfileDto`.
- Errors: `404 USER_NOT_FOUND` for unknown users; existing 503 envelopes when auth/content/database are not configured.
- No cache headers beyond the existing private JSON behavior.

## UI

Route: `web/app/thanh-vien/[userId]/page.tsx` renders `main.wrap.catalog-page` and a client `PublicProfile` component.

Layout, one column, maximum width aligned with existing catalog pages:

1. **Profile header**
   - 88px avatar, or initials fallback.
   - Display name (fallback username, then `Thành viên`).
   - Realm pill + `CultivationBadge` progress.
   - Bio, if present.
   - `Tham gia {date}`.
2. **Stat strip**
   - Four primary stats: chapters read, following, public comments, top genres.
   - Section headings show `posted` and `participating` counts.
3. **Truyện đã đăng**
   - Root comments grouped by target; newest comment per target.
   - Item: cover, title, chapter label when applicable, comment excerpt, relative time, link to `/manga/{id}` or `/read/{chapterId}?manga={mangaId}&lang={lang}`.
4. **Truyện đang tham gia**
   - Same item shape for reply comments.
5. **Hoạt động gần đây**
   - Newest 5 comments as a compact timeline; same links and relative time.
6. **Thể loại hay tương tác**
   - Up to 3 tag pills.
7. **Truyện đã lưu**
   - Owner: `shelf-grid` with `surface shelf-card` items and a `Xem tất cả` link to `/tu-truyen`.
   - Guest: empty surface with “Chỉ chủ nhân xem được” and the saved count.

### Skeletons

Every async region on the profile uses a shape-matched skeleton. The initial route fallback is one composed `PublicProfileSkeleton`, not a generic spinner or text. Add to `web/components/loaders.tsx`:

- `PublicProfileSkeleton`: the full page frame — header block, stat strip, two section blocks, recent block, tag block, saved block — with the same max-width, gaps and section wrappers as the loaded page.
- `ProfileHeaderSkeleton`: 88px avatar circle, name/handle bars, realm pill, bio lines, joined-date bar.
- `ProfileStatsSkeleton`: 4 equal stat cells in the same strip.
- `ProfileEntrySkeleton`: cover block, title/meta bars, comment bubble, time bar; used 3 times per comment section.
- `ProfileRecentSkeleton`: 3 compact timeline rows with the same bubble geometry.
- `ProfileTagsSkeleton`: 3 pill placeholders.
- Reuse `ShelfSkeleton` (4 cards) for saved items.

Rules:

- Skeleton wrappers must be the same elements/classes as the loaded content (`profile-header`, `profile-stats`, `profile-section`, `profile-entry`, `shelf-grid`, etc.), so bounding boxes match and there is no layout shift.
- Keep `role="status"` and an `aria-label` on each skeleton container; inner placeholders are `aria-hidden`.
- No visible “Đang tải…”, “Đang mở…” or similar text.
- The owner/guest saved state uses the same skeleton; only the loaded result differs.
- Reduced-motion users get the static skeleton, matching the existing skeleton behavior.

### Account link

`/tai-khoan` keeps its current editing layout and gains a link to the signed-in user's public profile.

## Security and Privacy

- Public payload excludes `email`, `role`, moderation status, and reader preferences.
- Only `visible` comments contribute bodies, counts, sections, recent activity, and top tags.
- Saved entries are returned only when `viewer.id === userId`; otherwise `saved: null`.
- Bio is plain text and rendered without HTML.
- Public profile never exposes hidden comment bodies or moderation notes.

## Testing

### Backend

- Unknown user returns 404.
- Guest payload contains only visible comments; hidden/removed bodies are absent.
- Root/reply grouping keeps the newest comment per target.
- Owner receives saved entries; non-owner receives `saved: null` and `savedTotal`.
- Bio trims, rejects over 160 characters, and round-trips through `PATCH /api/v1/me`.
- Enrichment fallback keeps a usable link when content metadata fails.
- Response contains no email or role fields.

### Migration

- `0001_profile_bio.sql` applies after the base migration on SQLite.
- Existing rows keep `bio = null`.
- The comments index exists and does not change existing data.

### Browser

- Guest and owner views render the correct saved state.
- The initial `PublicProfileSkeleton` and every section skeleton match the loaded header/stat/comment/recent/tag/shelf geometry; no visible loading text.
- Comment links resolve to the right manga/chapter route.
- No horizontal overflow at 375px and 1280px.
- No console/page errors on load or navigation.

### Gates

- `npm run build`
- `npm run build:vinext`
- `npm run test:aggregate`
- Relevant Playwright profile tests

## Rollout

1. Apply the additive D1 migration.
2. Run gates.
3. Commit and push.
4. Deploy with `cf deploy --prebuilt --secrets-file .cloudflare/secrets.json`.
5. Live QA: guest profile, owner profile, skeleton capture, mobile overflow.

No rollback is planned; the migration is additive and forward-only.

## Risks

- Content enrichment can add latency; the cap and library-first resolution bound it.
- More than 20 targets per section are counted but not all rendered; the payload sets `truncated` and the UI states the shown limit.
- A user with no comments/reading history gets empty surfaces, not broken sections.
- Profile visibility depends on the existing `profiles` row; unknown ids return 404 rather than a placeholder profile.