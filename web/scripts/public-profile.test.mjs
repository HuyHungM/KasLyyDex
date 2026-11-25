import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { localD1 } from "./sqlite-harness.mjs";
import { drizzle } from "drizzle-orm/d1";

const publicProfile = await import("../lib/public-profile/service.ts");
const schema = await import("../lib/db/schema.ts");
const { ServiceError } = await import("../lib/me/service.ts");
const { createCommunityApi } = await import("../lib/community/handlers.ts");

const DAY = 86_400_000;
const OWNER = "opaque|owner";
const now = Date.parse("2026-08-01T12:00:00.000Z");
const MIGRATIONS = ["0000_cloudflare_d1.sql", "0001_profile_bio.sql"];

let pg;
let db;

before(async () => {
  pg = localD1();
  db = drizzle(pg, { schema });
  for (const file of MIGRATIONS) {
    await pg.exec(await readFile(fileURLToPath(new URL(`../migrations/${file}`, import.meta.url)), "utf8"));
  }
  await db.insert(schema.profiles).values({
    userId: OWNER,
    displayName: "Chủ nhân",
    bio: "Thích isekai",
    createdAt: new Date(now - 30 * DAY),
    updatedAt: new Date(now),
  });
  await db.insert(schema.libraryEntries).values({
    userId: OWNER,
    mangaId: "m1",
    title: "Truyện một",
    lang: "vi",
    status: "reading",
    followedAt: now - DAY,
    lastReadPublish: 0,
    revision: 1,
    updatedAt: new Date(now - DAY),
  });
  await db.insert(schema.readingCompletions).values({
    userId: OWNER,
    mangaId: "m1",
    chapterId: "c1",
    language: "vi",
    pageCount: 10,
    lastPageSeen: 10,
    readerSessionId: "s1",
    completedAt: now - DAY,
  });
  await db.insert(schema.comments).values([
    comment("root-old", "m1", now - 5 * DAY, "root old"),
    comment("root-new", "m1", now - 4 * DAY, "root new"),
    comment("reply", "m1", now - 3 * DAY, "reply", "visible", "root-new"),
    comment("hidden", "m2", now - 2 * DAY, "HIDDEN_BODY", "hidden"),
    comment("removed-reply", "m1", now - DAY, "REMOVED_BODY", "removed", "reply"),
    comment("root-m2", "m2", now - 600, "root m2"),
  ]);
});

after(async () => {
  await pg?.close();
});

function comment(id, targetId, at, body, status = "visible", parentId = null, targetType = "manga") {
  return {
    id,
    userId: OWNER,
    targetType,
    targetId,
    parentId,
    body,
    spoiler: false,
    status,
    createdAt: new Date(at),
    updatedAt: new Date(at),
  };
}

const brokenContent = {
  manga: async () => { throw new Error("content unavailable"); },
  chapterMetadata: async () => { throw new Error("content unavailable"); },
};

test("public profile groups root/reply comments and hides non-visible bodies", async () => {
  const payload = await publicProfile.getPublicProfile(db, null, OWNER, brokenContent);

  assert.equal(payload.posted[0].targetId, "m2");
  assert.equal(payload.posted[0].body, "root m2");
  assert.equal(payload.posted[1].body, "root new");
  assert.equal(payload.participating[0].body, "reply");
  assert.equal(payload.recent[0].body, "root m2");
  assert.equal(payload.stats.comments, 4);
  assert.equal(payload.stats.posted, 2);
  assert.equal(payload.stats.participating, 1);
  assert.equal(payload.stats.chaptersRead, 1);
  assert.doesNotMatch(JSON.stringify(payload), /HIDDEN_BODY|REMOVED_BODY/);
});

test("saved library is owner-only and unknown users return 404", async () => {
  const guest = await publicProfile.getPublicProfile(db, null, OWNER, brokenContent);
  assert.equal(guest.saved, null);
  assert.equal(guest.savedTotal, 1);

  const owner = await publicProfile.getPublicProfile(db, OWNER, OWNER, brokenContent);
  assert.equal(owner.saved[0].mangaId, "m1");

  await assert.rejects(
    () => publicProfile.getPublicProfile(db, null, "opaque|missing", brokenContent),
    (error) => error instanceof ServiceError && error.status === 404 && error.code === "USER_NOT_FOUND",
  );
});

const richContent = {
  manga: async (id) => ({
    id,
    title: `Manga ${id}`,
    cover_file: "cover.jpg",
    tags: id === "m1" ? ["Action", "Isekai"] : ["Action"],
  }),
  chapterMetadata: async (id) => ({
    id,
    manga_id: "m1",
    lang: "vi",
    pages: 10,
    external_url: null,
    unavailable: false,
    chapter: "7",
    title: "Chapter 7",
  }),
};

function api(user) {
  return createCommunityApi({
    db: () => db,
    identity: async () => user,
    now: () => now,
    allowlist: [],
    content: async () => richContent,
  });
}

function request(path) {
  return new Request(`http://localhost${path}`);
}

test("profile enriches titles, tags and falls back when content fails", async () => {
  await db.insert(schema.comments).values(comment("chapter-root", "c1", now - 300, "chapter root", "visible", null, "chapter"));

  const payload = await publicProfile.getPublicProfile(db, null, OWNER, richContent);
  const chapterEntry = payload.posted.find((entry) => entry.targetType === "chapter");
  assert.equal(chapterEntry.mangaId, "m1");
  assert.equal(chapterEntry.chapterLabel, "Chương 7");
  assert.equal(chapterEntry.title, "Manga m1");
  assert.equal(payload.posted.find((entry) => entry.targetId === "m1").coverFile, "cover.jpg");
  assert.equal(payload.topTags[0], "Action");

  const fallback = await publicProfile.getPublicProfile(db, null, OWNER, brokenContent);
  assert.equal(fallback.posted.find((entry) => entry.targetId === "m1").title, "Truyện");
  assert.equal(fallback.posted.find((entry) => entry.targetId === "c1").targetId, "c1");
});

test("usersGet returns owner saved entries and guest null", async () => {
  const ownerRes = await api({ id: OWNER }).usersGet(request(`/api/v1/users/${OWNER}`), { userId: OWNER });
  assert.equal(ownerRes.status, 200);
  const ownerPayload = await ownerRes.json();
  assert.equal(ownerPayload.saved[0].mangaId, "m1");

  const guestRes = await api(null).usersGet(request(`/api/v1/users/${OWNER}`), { userId: OWNER });
  assert.equal(guestRes.status, 200);
  const guestPayload = await guestRes.json();
  assert.equal(guestPayload.saved, null);
});
