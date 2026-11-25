import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { localD1 } from "./sqlite-harness.mjs";
import { drizzle } from "drizzle-orm/d1";
import { startNext, stop } from "./test-helpers.mjs";

// SQL runs in local SQLite via the checked-in D1 migration; identity comes
// from a verified user mapped by the production helper. No fake header, env
// bypass or role field.
const community = await import("../lib/moderation.ts");
const { createCommunityApi } = await import("../lib/community/handlers.ts");
const validators = await import("../lib/validators.ts");
const { identityFromVerifiedUser } = await import("../lib/auth/identity.ts");
const { AuthConfigurationError } = await import("../lib/auth/server.ts");
const schema = await import("../lib/db/schema.ts");

const DAY = 86_400_000;
let now = Date.parse("2026-07-01T12:00:00.000Z");
const MIGRATIONS = ["0000_cloudflare_d1.sql", "0001_profile_bio.sql"];
// Keep the pre-0003 comment schema while satisfying the current Drizzle shape.

async function migratedDb(files = MIGRATIONS) {
  const pg = localD1();
  const db = drizzle(pg, { schema });
  for (const file of files) {
    try {
      await pg.exec(await readFile(fileURLToPath(new URL(`../migrations/${file}`, import.meta.url)), "utf8"));
    } catch (error) {
      // During RED the fix migration does not exist yet; keep the older SQL so
      // behaviour regressions fail on assertions rather than a setup error.
      if (error.code !== "ENOENT") throw error;
    }
  }
  return { pg, db };
}

function identity(id = "google|opaque-reader", overrides = {}) {
  return {
    id,
    email: "reader@example.com",
    emailVerified: true,
    name: "Reader",
    image: null,
    sessionId: "session-reader",
    ...overrides,
  };
}

function request(path, init = {}, origin = "http://localhost") {
  return new Request(`http://localhost${path}`, {
    ...init,
    headers: { origin, ...(init.headers ?? {}) },
  });
}

function jsonRequest(path, method, body, origin = "http://localhost") {
  return request(path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }, origin);
}

function feedPage(items, params = {}) {
  return {
    items,
    total: items.length,
    offset: params.offset ?? 0,
    limit: params.limit ?? 100,
    next_offset: null,
    partial: false,
  };
}

function notificationContent(itemsOrGetter) {
  return async () => ({
    notificationFeed: async (_id, params) => {
      const items = typeof itemsOrGetter === "function" ? itemsOrGetter() : itemsOrGetter;
      return feedPage(params.lang === "vi" ? items : [], params);
    },
  });
}

function api(db, user = null, overrides = {}) {
  return createCommunityApi({
    db: () => db,
    identity: async () => user,
    now: () => now,
    allowlist: overrides.allowlist ?? [],
    content: overrides.content ?? notificationContent([]),
  });
}

async function seed(db, ids) {
  for (const id of ids) {
    await db.insert(schema.profiles).values({ userId: id, displayName: `Name ${id}` }).onConflictDoNothing();
  }
}

async function postComment(handle, body, id = "c1") {
  const response = await handle.commentPost(jsonRequest("/api/v1/comments", "POST", body), { id });
  return { response, payload: await response.json() };
}

function chapter(id, chapterNumber, publishAt) {
  return {
    id, chapter: chapterNumber, volume: null, title: `Chapter ${chapterNumber}`, lang: "vi",
    pages: 1, external_url: null, publish_at: new Date(publishAt).toISOString(), group: "fixture",
  };
}

let unconfiguredNext;
let fixtureSession;

before(async () => {
  unconfiguredNext = await startNext();
  // Raw verified user, including fields a client must never be able to
  // turn into privileges. The production mapping reads none of them.
  fixtureSession = {
    id: "google|sdk-identity",
    email: "reader@example.com",
    email_verified: true,
    confirmed_at: "2026-07-01T00:00:00.000Z",
    name: "SDK Reader",
    user_metadata: { full_name: "SDK Reader" },
    app_metadata: { roles: ["moderator"] },
    role: "admin",
    level: 999,
    totalXp: 999_999,
  };
});

after(async () => {
  await stop(unconfiguredNext?.child);
});

test("migration owns comment, report, notification and rate tables without auth schemas", async () => {
  const { pg } = await migratedDb();
  try {
    const tables = await pg.query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name");
    const names = tables.rows.map((row) => row.name);
    for (const table of [
      "comments", "comment_threads", "comment_reports", "notifications",
      "notification_cursors", "action_events",
    ]) {
      assert.ok(names.includes(table), `${table} must be created by the application migration`);
    }
    assert.equal((await pg.query("SELECT 1 FROM sqlite_master WHERE name LIKE '%neon_auth%'")).rows.length, 0);

    await pg.exec("INSERT INTO profiles (user_id) VALUES ('opaque-1'), ('opaque-2');");
    await pg.exec(`INSERT INTO comment_threads (target_type, target_id) VALUES ('manga','m1');`);
    await pg.exec(`INSERT INTO comments (id, user_id, target_type, target_id, body, spoiler, status) VALUES
      ('c1','opaque-1','manga','m1','hello',true,'visible');`);
    await pg.exec(`INSERT INTO comment_reports (id, user_id, comment_id, reason) VALUES ('r1','opaque-2','c1','spam');`);
    await assert.rejects(
      pg.exec(`INSERT INTO comment_reports (id, user_id, comment_id, reason) VALUES ('r2','opaque-2','c1','again');`),
      /duplicate key|unique/i,
      "only one open report per user and comment",
    );
    await pg.exec(`UPDATE comment_reports SET status = 'resolved' WHERE id = 'r1';`);
    await pg.exec(`INSERT INTO comment_reports (id, user_id, comment_id, reason) VALUES ('r3','opaque-2','c1','new report');`);

    await pg.exec(`INSERT INTO notifications (id, user_id, type, event_key, title, body) VALUES
      ('n1','opaque-1','comment_reply','reply:c1','New','body');`);
    await assert.rejects(
      pg.exec(`INSERT INTO notifications (id, user_id, type, event_key, title, body) VALUES
        ('n2','opaque-1','level_up','reply:c1','Other','body');`),
      /duplicate key|unique/i,
      "notification event keys deduplicate across every producer",
    );
    await assert.rejects(
      pg.exec(`INSERT INTO comments (id,user_id,target_type,target_id,body,status) VALUES
        ('bad','opaque-1','manga','m1','x','locked');`),
      /check constraint|violates check/i,
    );
    await pg.exec("DELETE FROM profiles WHERE user_id = 'opaque-1';");
    for (const table of ["comments", "comment_reports", "notifications"]) {
      const rows = await pg.query(`SELECT 1 FROM ${table} WHERE user_id = 'opaque-1'`);
      assert.equal(rows.rows.length, 0, `${table} must cascade with the profile`);
    }
  } finally {
    await pg.close();
  }
});

test("Verified session identity owns comments; client role fields grant nothing", async () => {
  const { pg, db } = await migratedDb();
  try {
    const resolved = identityFromVerifiedUser(fixtureSession);
    assert.equal(resolved.id, "google|sdk-identity");
    assert.deepEqual(Object.keys(resolved).sort(), ["email", "emailVerified", "id", "image", "name", "sessionId"]);
    const handle = api(db, resolved);
    const created = await postComment(handle, {
      targetType: "manga", targetId: "m1", body: "  from sdk  ", spoiler: true,
    });
    assert.equal(created.response.status, 201);
    assert.equal(created.payload.comment.userId, "google|sdk-identity");
    assert.equal(created.payload.comment.spoiler, true);
    assert.equal(created.payload.comment.status, "visible");

    const moderator = await handle.moderationReportsGet(request("/api/v1/moderation/reports?limit=5"));
    assert.equal(moderator.status, 403, "SDK reader is not a moderator");
  } finally {
    await pg.close();
  }
});

test("forged role and totalXp in a body grant nothing without a session identity", async () => {
  const { pg, db } = await migratedDb();
  try {
    const guest = api(db, null);
    const forged = {
      targetType: "manga", targetId: "m1", body: "forged", spoiler: false,
      role: "moderator", level: 999, totalXp: 999_999, percent: 100,
    };
    const comment = await guest.commentPost(jsonRequest("/api/v1/comments", "POST", forged));
    assert.equal(comment.status, 401);
    assert.equal((await comment.json()).error.code, "UNAUTHENTICATED");

    const queue = await guest.moderationReportsGet(request("/api/v1/moderation/reports?limit=5"));
    assert.equal(queue.status, 403);
    assert.equal((await queue.json()).error.code, "FORBIDDEN");
    assert.equal((await db.select().from(schema.comments)).length, 0);
  } finally {
    await pg.close();
  }
});

test("comments persist spoiler, validate bodies and reject unknown fields", async () => {
  const { pg, db } = await migratedDb();
  try {
    const handle = api(db, identity());
    const created = await postComment(handle, {
      targetType: "chapter", targetId: "c9", body: "  spoiler text  ", spoiler: true,
    });
    assert.equal(created.response.status, 201);
    assert.equal(created.payload.comment.body, "spoiler text");
    assert.equal(created.payload.comment.spoiler, true);

    const invalid = await postComment(handle, {
      targetType: "manga", targetId: "m1", body: "x".repeat(2001), spoiler: false,
    }, "too-long");
    assert.equal(invalid.response.status, 400);
    assert.equal(invalid.payload.error.code, "INVALID_INPUT");
    const unknown = await postComment(handle, {
      targetType: "manga", targetId: "m1", body: "hello", spoiler: false, level: 999, role: "moderator",
    }, "unknown-field");
    assert.equal(unknown.response.status, 400);
    assert.equal(unknown.payload.error.code, "INVALID_INPUT");
    const html = await postComment(handle, {
      targetType: "manga", targetId: "m1", body: "<img src=x onerror=alert(1)>", spoiler: false,
    }, "html-text");
    assert.equal(html.response.status, 201);
    assert.equal(html.payload.comment.body, "<img src=x onerror=alert(1)>", "stored as plain text, not markup");
  } finally {
    await pg.close();
  }
});

test("aliases may edit or remove only their own comments", async () => {
  const { pg, db } = await migratedDb();
  try {
    const alice = api(db, identity("opaque|alice"));
    const bob = api(db, identity("opaque|bob"));
    const created = await postComment(alice, { targetType: "manga", targetId: "m1", body: "mine" });
    assert.equal(created.response.status, 201);
    const commentId = created.payload.comment.id;

    const ownerEdit = await alice.commentPatch(
      jsonRequest(`/api/v1/comments/${commentId}`, "PATCH", { body: "edited", spoiler: false }),
      { id: commentId },
    );
    assert.equal(ownerEdit.status, 200);
    const bobEdit = await bob.commentPatch(
      jsonRequest(`/api/v1/comments/${commentId}`, "PATCH", { body: "stolen by bob", spoiler: false }),
      { id: commentId },
    );
    assert.equal(bobEdit.status, 403);
    assert.equal((await bobEdit.json()).error.code, "FORBIDDEN");

    const bobDelete = await bob.commentDelete(request(`/api/v1/comments/${commentId}`, { method: "DELETE" }), { id: commentId });
    assert.equal(bobDelete.status, 403);
    const aliceDelete = await alice.commentDelete(request(`/api/v1/comments/${commentId}`, { method: "DELETE" }), { id: commentId });
    assert.equal(aliceDelete.status, 200);
    const list = await alice.commentsGet(request("/api/v1/comments?targetType=manga&targetId=m1"));
    const body = await list.json();
    assert.equal(body.items.length, 1);
    assert.equal(body.items[0].status, "removed");
    assert.equal(body.items[0].body, null, "removed body never leaves the public API");
  } finally {
    await pg.close();
  }
});

test("replies are one level, same-thread and reject removed or locked roots", async () => {
  const { pg, db } = await migratedDb();
  try {
    const alice = api(db, identity("opaque|alice"));
    const bob = api(db, identity("opaque|bob"));
    const root = await postComment(alice, { targetType: "manga", targetId: "m1", body: "root" });
    assert.equal(root.response.status, 201);
    const rootId = root.payload.comment.id;
    const otherRoot = await postComment(alice, { targetType: "manga", targetId: "m2", body: "other" });
    assert.equal(otherRoot.response.status, 201);

    const reply = await postComment(bob, {
      targetType: "manga", targetId: "m1", parentId: rootId, body: "reply", spoiler: true,
    });
    assert.equal(reply.response.status, 201);
    assert.equal(reply.payload.comment.parentId, rootId);

    const deep = await postComment(alice, {
      targetType: "manga", targetId: "m1", parentId: reply.payload.comment.id, body: "too deep",
    });
    assert.equal(deep.response.status, 400);
    assert.equal(deep.payload.error.code, "INVALID_REPLY");
    const crossThread = await postComment(alice, {
      targetType: "manga", targetId: "m2", parentId: rootId, body: "wrong thread",
    });
    assert.equal(crossThread.response.status, 400);
    const wrongType = await postComment(alice, {
      targetType: "chapter", targetId: "m1", parentId: rootId, body: "wrong target",
    });
    assert.equal(wrongType.response.status, 400);

    await db.insert(schema.userRoles).values({ userId: "opaque|alice", role: "moderator" }).onConflictDoNothing();
    await community.setThreadLock(db, "opaque|alice", "manga", "m1", true, now);
    const duringLock = await postComment(bob, { targetType: "manga", targetId: "m1", body: "locked" });
    assert.equal(duringLock.response.status, 409);
    assert.equal(duringLock.payload.error.code, "THREAD_LOCKED");
    await community.setThreadLock(db, "opaque|alice", "manga", "m1", false, now);

    await community.moderateComment(db, "opaque|alice", rootId, "hide", now);
    const toHidden = await postComment(bob, {
      targetType: "manga", targetId: "m1", parentId: rootId, body: "hidden parent",
    });
    assert.equal(toHidden.response.status, 409);
    assert.equal(toHidden.payload.error.code, "PARENT_UNAVAILABLE");
  } finally {
    await pg.close();
  }
});

test("thread lock and comment creation serialize instead of racing", async () => {
  const { pg, db } = await migratedDb();
  try {
    const alice = identity("opaque|alice");
    const bob = identity("opaque|bob");
    await seed(db, [alice.id]);
    await db.insert(schema.userRoles).values({ userId: alice.id, role: "moderator" });
    const handle = api(db, alice);
    const first = await postComment(handle, { targetType: "manga", targetId: "m1", body: "before lock" });
    assert.equal(first.response.status, 201);

    // One SQL engine serialises these transactions; whichever wins, the lock
    // state and accepted comments must agree and later writes stay closed.
    const [locked, attempts] = await Promise.all([
      community.setThreadLock(db, alice.id, "manga", "m1", true, now),
      Promise.allSettled([0, 1, 2].map((index) => postComment(api(db, bob), {
        targetType: "manga", targetId: "m1", body: `race ${index}`,
      }))),
    ]);
    assert.equal(locked.locked, true);
    const accepted = attempts.filter((entry) => entry.status === "fulfilled" && entry.value.response.status === 201).length;
    const stored = await db.select().from(schema.comments);
    assert.equal(stored.length, 1 + accepted, "accepted comments match the committed responses");
    assert.equal((await postComment(api(db, bob), { targetType: "manga", targetId: "m1", body: "after lock" })).response.status, 409);
  } finally {
    await pg.close();
  }
});

test("public reads never expose hidden or removed bodies through replies", async () => {
  const { pg, db } = await migratedDb();
  try {
    const alice = identity("opaque|alice");
    const bob = identity("opaque|bob");
    const handle = api(db, alice);
    const root = await postComment(handle, { targetType: "manga", targetId: "m1", body: "visible root" });
    const reply = await postComment(api(db, bob), {
      targetType: "manga", targetId: "m1", parentId: root.payload.comment.id, body: "secret reply",
    });
    await db.insert(schema.userRoles).values({ userId: alice.id, role: "moderator" }).onConflictDoNothing();
    await community.moderateComment(db, alice.id, reply.payload.comment.id, "hide", now);
    await community.moderateComment(db, alice.id, root.payload.comment.id, "remove", now);

    const anonymous = await api(db, null).commentsGet(request("/api/v1/comments?targetType=manga&targetId=m1"));
    const publicBody = await anonymous.json();
    assert.equal(publicBody.items.length, 0, "removed roots and their replies vanish for guests");

    const owner = await api(db, bob).commentsGet(request("/api/v1/comments?targetType=manga&targetId=m1"));
    const ownerBody = await owner.json();
    assert.equal(ownerBody.items.length, 1, "signed-in viewers keep the placeholder for a removed root");
    assert.equal(ownerBody.items[0].body, null, "removed root body stays redacted");
    assert.equal(ownerBody.items[0].replies.length, 0, "hidden replies stay hidden from their author");
    assert.ok(!JSON.stringify(ownerBody).includes("secret reply"));

    const mod = await api(db, alice, { allowlist: [alice.email] }).moderationReportsGet(
      request("/api/v1/moderation/reports?limit=20"),
    );
    assert.equal(mod.status, 200);
  } finally {
    await pg.close();
  }
});

test("durable SQL limits stop concurrent comments and hourly reports", async () => {
  const { pg, db } = await migratedDb();
  try {
    const alice = api(db, identity("opaque|alice"));
    const attempts = await Promise.allSettled(Array.from({ length: 8 }, (_, index) =>
      postComment(alice, { targetType: "manga", targetId: "m1", body: `burst ${index}` }, `burst-${index}`)));
    const successes = attempts.filter((entry) => entry.status === "fulfilled" && entry.value.response.status === 201);
    const limited = attempts.filter((entry) => entry.status === "fulfilled" && entry.value.response.status === 429);
    assert.equal(successes.length, 5, "at most five comments per minute survive");
    assert.equal(limited.length, 3);
    assert.equal(limited[0].value.payload.error.code, "RATE_LIMITED");
    const rows = await db.select().from(schema.comments);
    assert.equal(rows.length, 5);

    const bob = await postComment(api(db, identity("opaque|bob")), {
      targetType: "manga", targetId: "m1", body: "other user",
    }, "bob-1");
    assert.equal(bob.response.status, 201, "limits are per user");

    // Reports need distinct visible comments owned by someone else; seeded
    // directly so the report limiter is measured on its own.
    for (let index = 0; index < 12; index += 1) {
      const owner = `opaque|author-${index}`;
      await db.insert(schema.profiles).values({ userId: owner }).onConflictDoNothing();
      await db.insert(schema.comments).values({
        id: `report-c${index}`, userId: owner, targetType: "manga", targetId: "m1",
        body: "reportable", spoiler: false, status: "visible",
      });
    }
    const reporter = api(db, identity("opaque|reporter"));
    const reportAttempts = await Promise.allSettled(Array.from({ length: 12 }, (_, index) =>
      reporter.reportPost(
        jsonRequest("/api/v1/reports", "POST", { commentId: `report-c${index}`, reason: `reason ${index}` }),
        { id: "reporter" },
      )));
    const reportSuccess = reportAttempts.filter((entry) => entry.status === "fulfilled" && entry.value.status === 201);
    assert.equal(reportSuccess.length, 10, "at most ten reports per hour per user");
  } finally {
    await pg.close();
  }
});

test("reports reject self-reports and duplicates but allow reopening after resolution", async () => {
  const { pg, db } = await migratedDb();
  try {
    const author = identity("opaque|author");
    const reporter = identity("opaque|reporter");
    const mod = identity("opaque|mod", { email: "mod@example.com" });
    const handle = api(db, author);
    const target = await postComment(handle, { targetType: "manga", targetId: "m1", body: "report me" });
    const targetId = target.payload.comment.id;

    const self = await api(db, author).reportPost(
      jsonRequest("/api/v1/reports", "POST", { commentId: targetId, reason: "mine" }), { id: "author" });
    assert.equal(self.status, 403);
    assert.equal((await self.json()).error.code, "SELF_REPORT");

    const first = await api(db, reporter).reportPost(
      jsonRequest("/api/v1/reports", "POST", { commentId: targetId, reason: "spam" }), { id: "reporter" });
    assert.equal(first.status, 201);
    const reportId = (await first.json()).report.id;
    const duplicate = await api(db, reporter).reportPost(
      jsonRequest("/api/v1/reports", "POST", { commentId: targetId, reason: "again" }), { id: "reporter" });
    assert.equal(duplicate.status, 409);
    assert.equal((await duplicate.json()).error.code, "DUPLICATE_REPORT");

    await seed(db, [mod.id]);
    await db.insert(schema.userRoles).values({ userId: mod.id, role: "moderator" });
    const resolved = await api(db, mod).reportPatch(
      jsonRequest(`/api/v1/moderation/reports/${reportId}`, "PATCH", { action: "resolve" }), { id: reportId });
    assert.equal(resolved.status, 200);
    const reopened = await api(db, reporter).reportPost(
      jsonRequest("/api/v1/reports", "POST", { commentId: targetId, reason: "new issue" }), { id: "reporter" });
    assert.equal(reopened.status, 201);
  } finally {
    await pg.close();
  }
});

test("moderator actions require a stored role in both handler and service", async () => {
  const { pg, db } = await migratedDb();
  try {
    const mod = identity("opaque|mod", { email: "mod@example.com" });
    const author = identity("opaque|author");
    const created = await postComment(api(db, author), { targetType: "chapter", targetId: "ch1", body: "moderate me" });
    const commentId = created.payload.comment.id;

    const unsigned = await api(db, null).commentModeratePatch(
      jsonRequest(`/api/v1/moderation/comments/${commentId}`, "PATCH", { action: "hide" }), { id: commentId });
    assert.equal(unsigned.status, 403, "moderator routes reject anonymous callers as forbidden");
    const reader = await api(db, author).commentModeratePatch(
      jsonRequest(`/api/v1/moderation/comments/${commentId}`, "PATCH", { action: "hide" }), { id: commentId });
    assert.equal(reader.status, 403);
    await assert.rejects(
      community.moderateComment(db, author.id, commentId, "hide", now, []),
      (error) => error.code === "FORBIDDEN",
    );

    await seed(db, [mod.id]);
    await db.insert(schema.userRoles).values({ userId: mod.id, role: "moderator" });
    const allowed = await api(db, mod).commentModeratePatch(
      jsonRequest(`/api/v1/moderation/comments/${commentId}`, "PATCH", { action: "hide" }), { id: commentId });
    assert.equal(allowed.status, 200);
    const queue = await api(db, mod).moderationReportsGet(request("/api/v1/moderation/reports?limit=20"));
    assert.equal(queue.status, 200);
    const readBody = await community.listComments(db, "chapter", "ch1", null, 20, mod.id);
    assert.equal(readBody.items.length, 0, "hidden comments stay out of the privacy-safe public DTO");

    const lock = await api(db, mod).threadPut(
      jsonRequest("/api/v1/moderation/threads", "PUT", { targetType: "chapter", targetId: "ch1", locked: true }), {});
    assert.equal(lock.status, 200);
    const state = await api(db, mod).threadGet(request("/api/v1/moderation/threads?targetType=chapter&targetId=ch1"));
    assert.equal((await state.json()).thread.locked, true);
  } finally {
    await pg.close();
  }
});

test("reply and moderation events notify owners, dedupe and respect mark-read ownership", async () => {
  const { pg, db } = await migratedDb();
  try {
    const alice = identity("opaque|alice");
    const bob = identity("opaque|bob");
    const mod = identity("opaque|mod", { email: "mod@example.com" });
    const aliceApi = api(db, alice);
    const root = await postComment(aliceApi, { targetType: "manga", targetId: "m1", body: "notify me" });
    const reply = await postComment(api(db, bob), {
      targetType: "manga", targetId: "m1", parentId: root.payload.comment.id, body: "spoiler here", spoiler: true,
    });

    const inbox = await aliceApi.notificationsGet(request("/api/v1/notifications?limit=20"));
    const inboxBody = await inbox.json();
    assert.equal(inboxBody.unreadCount, 1);
    assert.equal(inboxBody.items[0].type, "comment_reply");
    assert.ok(!JSON.stringify(inboxBody).includes("spoiler here"), "spoiler text is concealed in notifications");

    const deduped = await community.emitNotification(db, {
      userId: alice.id, type: "comment_reply", eventKey: `reply:${reply.payload.comment.id}`, title: "again", body: "again",
    });
    assert.equal(deduped, false, "duplicate event keys are ignored for every producer");
    const levelUp = await community.emitNotification(db, {
      userId: alice.id, type: "level_up", eventKey: "level:2", title: "Cấp 2", body: "Task 8 event",
    });
    assert.equal(levelUp, true, "the same interface serves future level-up events");

    const bobMark = await api(db, bob).notificationsReadPost(
      jsonRequest("/api/v1/notifications/read", "POST", { ids: [inboxBody.items[0].id] }), { id: "bob" });
    assert.equal(bobMark.status, 200);
    assert.equal((await bobMark.json()).updated, 0, "another user's notification cannot be marked read");
    const aliceMark = await aliceApi.notificationsReadPost(
      jsonRequest("/api/v1/notifications/read", "POST", { ids: [inboxBody.items[0].id] }), { id: "alice" });
    assert.equal((await aliceMark.json()).updated, 1);
    const after = await (await aliceApi.notificationsGet(request("/api/v1/notifications?limit=20"))).json();
    assert.equal(after.unreadCount, 1, "only the unread level-up event remains");

    await seed(db, [mod.id]);
    await db.insert(schema.userRoles).values({ userId: mod.id, role: "moderator" });
    await community.moderateComment(db, mod.id, root.payload.comment.id, "hide", now);
    const moderated = await (await aliceApi.notificationsGet(request("/api/v1/notifications?limit=20"))).json();
    assert.equal(moderated.unreadCount, 2);
    assert.ok(moderated.items.some((item) => item.type === "moderation"));
  } finally {
    await pg.close();
  }
});

test("new-chapter refresh baselines first follow, dedupes and bounds content calls", async () => {
  const { pg, db } = await migratedDb();
  try {
    const reader = identity("opaque|reader");
    const handle = api(db, reader);
    await seed(db, [reader.id]);
    await db.insert(schema.libraryEntries).values({
      userId: reader.id, mangaId: "m1", title: "One", lang: "vi", status: "reading",
      followedAt: now - DAY, lastReadPublish: 0, revision: 1,
    });
    const old = chapter("ch-old", "1", now - 10 * DAY);
    const fresh = chapter("ch-new", "2", now - 60_000);
    let calls = 0;
    const content = {
      notificationFeed: async (_id, params) => {
        calls += 1;
        return feedPage(params.lang === "vi" ? [old, fresh] : [], params);
      },
    };
    const first = await api(db, reader, { content: async () => content }).notificationsRefreshPost(
      jsonRequest("/api/v1/notifications/refresh", "POST", {}), {});
    const firstBody = await first.json();
    assert.equal(first.status, 200, JSON.stringify(firstBody));
    assert.equal(firstBody.created, 0, "first refresh only stores a baseline");
    const cursors = await db.select().from(schema.notificationCursors);
    assert.equal(cursors.length, 1);
    assert.equal(cursors[0].lastPublish, now - 60_000, "baseline uses the newest observed chapter, not the old archive");

    const later = now + 60_000;
    const secondHandle = createCommunityApi({
      db: () => db, identity: async () => reader, now: () => later, allowlist: [],
      content: async () => ({ notificationFeed: async (_id, params) => feedPage(params.lang === "vi" ? [old, fresh] : [], params) }),
    });
    // Move the composite continuation back to simulate a follow before that chapter existed.
    await db.update(schema.notificationCursors).set({
      lastPublish: now - 2 * DAY, scanPublish: now - 2 * DAY, scanOffset: 0,
    });
    const second = await secondHandle.notificationsRefreshPost(
      jsonRequest("/api/v1/notifications/refresh", "POST", {}), {});
    assert.equal(second.status, 200);
    assert.equal((await second.json()).created, 1);
    const third = await handle.notificationsRefreshPost(
      jsonRequest("/api/v1/notifications/refresh", "POST", {}), {});
    assert.equal((await third.json()).created, 0, "repeated refresh never duplicates a chapter");
    assert.ok(calls >= 1);

    const many = Array.from({ length: 40 }, (_, index) => ({
      userId: reader.id, mangaId: `m${index}`, title: "Many", lang: "vi", status: "reading",
      followedAt: now - index, lastReadPublish: 0, revision: 1,
    }));
    for (const item of many) {
      await db.insert(schema.libraryEntries).values(item).onConflictDoNothing();
    }
    let boundedCalls = 0;
    const bounded = api(db, reader, { content: async () => ({
      notificationFeed: async (_id, params) => {
        boundedCalls += 1;
        return feedPage([], params);
      },
    }) });
    const boundedBody = await (await bounded.notificationsRefreshPost(
      jsonRequest("/api/v1/notifications/refresh", "POST", {}), {})).json();
    assert.equal(boundedBody.checked, 20, "library scan stays bounded at 20 manga");
    assert.ok(boundedCalls <= 40, `refresh must stay bounded at 20 manga x 2 languages, saw ${boundedCalls}`);
  } finally {
    await pg.close();
  }
});

test("chapter cursor advances through same-timestamp backlog without loss", async () => {
  const { pg, db } = await migratedDb();
  try {
    const reader = identity("opaque|reader");
    await seed(db, [reader.id]);
    await db.insert(schema.libraryEntries).values({
      userId: reader.id, mangaId: "m1", title: "One", lang: "vi", status: "reading",
      followedAt: now - DAY, lastReadPublish: 0, revision: 1,
    });
    const baselinePublish = now - 10 * DAY;
    let feed = [chapter("ch-base", "1", baselinePublish)];
    const content = notificationContent(() => feed);
    const refresh = () => api(db, reader, { content }).notificationsRefreshPost(
      jsonRequest("/api/v1/notifications/refresh", "POST", {}), {});

    const first = await refresh();
    assert.equal((await first.json()).created, 0, "first observation is a baseline only");
    let cursorRows = await db.select().from(schema.notificationCursors);
    assert.equal(cursorRows[0].lastChapterId, "ch-base");

    feed = Array.from({ length: 7 }, (_, index) => chapter(`ch-${index + 1}`, String(index + 2), now - 60_000));
    const counts = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await refresh();
      counts.push((await response.json()).created);
    }
    assert.deepEqual(counts, [3, 3, 1, 0], "bounded batches must resume, not skip, the backlog");
    const emitted = await db.select().from(schema.notifications);
    assert.equal(emitted.length, 7);
    assert.equal(new Set(emitted.map((item) => item.eventKey)).size, 7, "each chapter is notified exactly once");
    cursorRows = await db.select().from(schema.notificationCursors);
    assert.equal(cursorRows[0].lastChapterId, "ch-7");

    feed = [...feed, chapter("ch-8", "9", now - 60_000)];
    assert.equal((await (await refresh()).json()).created, 1, "a later id at the same timestamp is still new");
  } finally {
    await pg.close();
  }
});

test("equal publish timestamps replay through the pending queue exactly once", async () => {
  const { pg, db } = await migratedDb();
  try {
    const reader = identity("opaque|reader");
    await seed(db, [reader.id]);
    const published = now - 60_000;
    await db.insert(schema.libraryEntries).values({
      userId: reader.id, mangaId: "m1", title: "One", lang: "vi", status: "reading",
      followedAt: now - DAY, lastReadPublish: 0, revision: 1,
    });
    await db.insert(schema.notificationCursors).values({
      userId: reader.id, mangaId: "m1", language: "vi", lastPublish: published, lastChapterId: "ch-2",
    });
    const feed = [1, 2, 3, 4, 5].map((number) => chapter(`ch-${number}`, String(number + 1), published));
    const content = notificationContent(feed);
    const handle = api(db, reader, { content });
    const response = await handle.notificationsRefreshPost(
      jsonRequest("/api/v1/notifications/refresh", "POST", {}), {});
    const body = await response.json();
    assert.deepEqual(body, { checked: 1, created: 3, skipped: false, partial: false });
    const second = await handle.notificationsRefreshPost(
      jsonRequest("/api/v1/notifications/refresh", "POST", {}), {});
    assert.equal((await second.json()).created, 2);
    const rows = await db.select().from(schema.notifications);
    assert.deepEqual(rows.map((item) => item.eventKey).sort(), [
      `chapter:${reader.id}:m1:ch-1:vi`,
      `chapter:${reader.id}:m1:ch-2:vi`,
      `chapter:${reader.id}:m1:ch-3:vi`,
      `chapter:${reader.id}:m1:ch-4:vi`,
      `chapter:${reader.id}:m1:ch-5:vi`,
    ]);
    const cursor = (await db.select().from(schema.notificationCursors))[0];
    assert.equal(cursor.lastChapterId, "ch-5");
  } finally {
    await pg.close();
  }
});

test("overlapping refreshes dedupe and failed or empty feeds do not advance cursors", async () => {
  const { pg, db } = await migratedDb();
  try {
    const reader = identity("opaque|reader");
    await seed(db, [reader.id]);
    await db.insert(schema.libraryEntries).values({
      userId: reader.id, mangaId: "m1", title: "One", lang: "vi", status: "reading",
      followedAt: now - DAY, lastPublish: 0, revision: 1,
    });
    const baseline = now - 5 * DAY;
    await db.insert(schema.notificationCursors).values({
      userId: reader.id, mangaId: "m1", language: "vi", lastPublish: baseline, lastChapterId: "ch-0",
    });
    const withoutFeed = api(db, reader, { content: notificationContent([]) });
    const before = (await db.select().from(schema.notificationCursors))[0];
    await withoutFeed.notificationsRefreshPost(jsonRequest("/api/v1/notifications/refresh", "POST", {}), {});
    const afterEmpty = (await db.select().from(schema.notificationCursors))[0];
    assert.deepEqual(
      { publish: afterEmpty.lastPublish, chapter: afterEmpty.lastChapterId },
      { publish: before.lastPublish, chapter: before.lastChapterId },
    );

    const failing = api(db, reader, { content: async () => ({ notificationFeed: async () => { throw new Error("upstream down"); } }) });
    await failing.notificationsRefreshPost(jsonRequest("/api/v1/notifications/refresh", "POST", {}), {});
    const afterFailure = (await db.select().from(schema.notificationCursors))[0];
    assert.equal(afterFailure.lastPublish, before.lastPublish);

    const feed = [1, 2, 3, 4].map((number) => chapter(`ch-${number}`, String(number), now - 60_000));
    const content = notificationContent(feed);
    const parallel = await Promise.all([0, 1].map(() => api(db, reader, { content }).notificationsRefreshPost(
      jsonRequest("/api/v1/notifications/refresh", "POST", {}), {})));
    assert.ok(parallel.every((response) => response.status === 200));
    const notifications = await db.select().from(schema.notifications);
    assert.equal(notifications.length, 4, "two overlapping refreshes never duplicate a chapter");
    assert.equal(new Set(notifications.map((item) => item.eventKey)).size, 4);
  } finally {
    await pg.close();
  }
});

test("reply notifications never retain a body, before or after moderation", async () => {
  const { pg, db } = await migratedDb();
  try {
    const alice = identity("opaque|alice");
    const bob = identity("opaque|bob");
    const mod = identity("opaque|mod");
    await seed(db, [mod.id]);
    await db.insert(schema.userRoles).values({ userId: mod.id, role: "moderator" });
    const root = await postComment(api(db, alice), { targetType: "manga", targetId: "m1", body: "root" });
    const reply = await postComment(api(db, bob), {
      targetType: "manga", targetId: "m1", parentId: root.payload.comment.id,
      body: "SENSITIVE_REPLY_SECRET", spoiler: false,
    });
    assert.equal(reply.response.status, 201);
    const readInbox = async () => (await (await api(db, alice).notificationsGet(
      request("/api/v1/notifications?limit=20"))).json()).items;
    const created = await readInbox();
    assert.equal(created.length, 1);
    assert.ok(!JSON.stringify(created).includes("SENSITIVE_REPLY_SECRET"), "reply snippets must be neutral at creation");
    await community.moderateComment(db, mod.id, reply.payload.comment.id, "hide", now);
    assert.ok(!JSON.stringify(await readInbox()).includes("SENSITIVE_REPLY_SECRET"));
    await community.moderateComment(db, mod.id, reply.payload.comment.id, "remove", now);
    assert.ok(!JSON.stringify(await readInbox()).includes("SENSITIVE_REPLY_SECRET"));
  } finally {
    await pg.close();
  }
});

test("legacy reply snippets are scrubbed from migrated notification rows", async () => {
  const { pg, db } = await migratedDb();
  try {
    await seed(db, ["opaque|alice"]);
    await db.insert(schema.notifications).values({
      id: "legacy-reply", userId: "opaque|alice", type: "comment_reply",
      eventKey: "reply:legacy", title: "Có phản hồi bình luận", body: "LEGACY_SECRET_SNIPPET",
    });
    await pg.exec(`UPDATE "notifications" SET "body" = 'Có phản hồi mới trong bình luận. Mở bình luận để xem nội dung.'
      WHERE "type" = 'comment_reply' AND "event_key" LIKE 'reply:%'`);
    const rows = await db.select().from(schema.notifications);
    assert.equal(rows.length, 1);
    assert.ok(!rows[0].body.includes("LEGACY_SECRET_SNIPPET"));
  } finally {
    await pg.close();
  }
});

test("moderator queue exposes hidden bodies while public and owner reads redact them", async () => {
  const { pg, db } = await migratedDb();
  try {
    const author = identity("opaque|author");
    const reporter = identity("opaque|reporter");
    const mod = identity("opaque|mod");
    await seed(db, [mod.id]);
    await db.insert(schema.userRoles).values({ userId: mod.id, role: "moderator" });
    const created = await postComment(api(db, author), {
      targetType: "manga", targetId: "m1", body: "HIDDEN_QUEUE_SECRET",
    });
    const commentId = created.payload.comment.id;
    assert.equal((await api(db, reporter).reportPost(
      jsonRequest("/api/v1/reports", "POST", { commentId, reason: "spam" }), {})).status, 201);
    await community.moderateComment(db, mod.id, commentId, "hide", now);

    const queue = await (await api(db, mod).moderationReportsGet(
      request("/api/v1/moderation/reports?limit=20"))).json();
    assert.equal(queue.items.length, 1);
    assert.equal(queue.items[0].comment.body, "HIDDEN_QUEUE_SECRET");
    assert.equal((await api(db, reporter).moderationReportsGet(
      request("/api/v1/moderation/reports?limit=20"))).status, 403);
    assert.equal((await api(db, null).moderationReportsGet(
      request("/api/v1/moderation/reports?limit=20"))).status, 403);

    const publicBody = await (await api(db, null).commentsGet(
      request("/api/v1/comments?targetType=manga&targetId=m1"))).json();
    assert.equal(publicBody.items.length, 0);
    const ownerBody = await (await api(db, author).commentsGet(
      request("/api/v1/comments?targetType=manga&targetId=m1"))).json();
    assert.equal(ownerBody.items[0].body, null);
    assert.ok(!JSON.stringify(ownerBody).includes("HIDDEN_QUEUE_SECRET"));
  } finally {
    await pg.close();
  }
});

test("only hidden comments can be restored; removed comments stay gone", async () => {
  const { pg, db } = await migratedDb();
  try {
    const author = identity("opaque|author");
    const mod = identity("opaque|mod");
    await seed(db, [mod.id]);
    await db.insert(schema.userRoles).values({ userId: mod.id, role: "moderator" });
    const handle = api(db, author);
    const make = async (body) => (await postComment(handle, {
      targetType: "manga", targetId: "m1", body,
    })).payload.comment.id;

    const ownerRemoved = await make("owner removed");
    assert.equal((await handle.commentDelete(
      request(`/api/v1/comments/${ownerRemoved}`, { method: "DELETE" }), { id: ownerRemoved })).status, 200);
    const badRestore = await api(db, mod).commentModeratePatch(
      jsonRequest(`/api/v1/moderation/comments/${ownerRemoved}`, "PATCH", { action: "restore" }), { id: ownerRemoved });
    assert.equal(badRestore.status, 409);
    assert.equal((await badRestore.json()).error.code, "RESTORE_NOT_ALLOWED");

    const modRemoved = await make("moderator removed");
    await community.moderateComment(db, mod.id, modRemoved, "remove", now);
    await assert.rejects(
      community.moderateComment(db, mod.id, modRemoved, "restore", now),
      (error) => error.code === "RESTORE_NOT_ALLOWED",
    );

    const hidden = await make("hidden then restored");
    await community.moderateComment(db, mod.id, hidden, "hide", now);
    const restored = await community.moderateComment(db, mod.id, hidden, "restore", now);
    assert.equal(restored.status, "visible");
    assert.equal(restored.body, "hidden then restored");
    const invalid = await pg.query("SELECT 1 FROM comments WHERE status = 'visible' AND body IS NULL");
    assert.equal(invalid.rows.length, 0, "no visible comment can have a null body");
  } finally {
    await pg.close();
  }
});

test("public comment reads tolerate missing auth configuration but still need the database", async () => {
  const { pg, db } = await migratedDb();
  try {
    const injected = createCommunityApi({
      db: () => db,
      identity: async () => { throw new AuthConfigurationError("AUTH_NOT_CONFIGURED", "not configured", ["Identity"]); },
      now: () => now,
      allowlist: [],
      content: notificationContent([]),
    });
    const response = await injected.commentsGet(request("/api/v1/comments?targetType=manga&targetId=m1"));
    assert.equal(response.status, 200, "guest reads are not blocked by an unconfigured auth service");
    assert.equal((await response.json()).items.length, 0);

    const route = await fetch(`${unconfiguredNext.baseUrl}/api/v1/comments?targetType=manga&targetId=m1`);
    assert.equal(route.status, 503, await route.clone().text());
    const body = await route.json();
    assert.equal(body.error.code, "DATABASE_NOT_CONFIGURED", "the route reaches the DB boundary, not an auth failure");
    assert.equal(route.headers.get("cache-control"), "private, no-store");
  } finally {
    await pg.close();
  }
});

test("request validators bound pagination, bodies and cursors", () => {
  assert.equal(validators.parseLimit("7", 20, 50), 7);
  assert.throws(() => validators.parseLimit("999", 20, 50), (error) => error.status === 400);
  assert.throws(() => validators.parseLimit("nope", 20, 50), (error) => error.status === 400);
  assert.deepEqual(validators.parseCursor("1234.abc"), { time: 1234, id: "abc" });
  assert.throws(() => validators.parseCursor("bad"), (error) => error.status === 400);
  assert.throws(() => validators.parseIds(["x".repeat(201)]), (error) => error.status === 400);
  assert.throws(() => validators.parseCommentBody("   "), (error) => error.status === 400);
  assert.equal(validators.parseCommentBody("  ok  "), "ok");
});
