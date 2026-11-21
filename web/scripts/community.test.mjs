import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { startNext, stop } from "./test-helpers.mjs";

// Task 7 RED/GREEN harness. SQL runs in embedded PGlite via the checked-in
// migrations; identity comes from the real Neon SDK against a loopback auth
// fixture. No application code accepts a fake header, env bypass or role field.
const community = await import("../lib/moderation.ts");
const { createCommunityApi } = await import("../lib/community/handlers.ts");
const validators = await import("../lib/validators.ts");
const { identityFromSession } = await import("../lib/auth/identity.ts");
const schema = await import("../lib/db/schema.ts");

const DAY = 86_400_000;
let now = Date.parse("2026-07-01T12:00:00.000Z");
const MIGRATIONS = [
  "0000_application.sql",
  "0001_account_data.sql",
  "0002_comments_moderation.sql",
];

async function migratedDb() {
  const pg = new PGlite();
  const db = drizzle(pg, { schema });
  for (const file of MIGRATIONS) {
    await pg.exec(await readFile(fileURLToPath(new URL(`../drizzle/${file}`, import.meta.url)), "utf8"));
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

function api(db, user = null, overrides = {}) {
  return createCommunityApi({
    db: () => db,
    identity: async () => user,
    now: () => now,
    allowlist: overrides.allowlist ?? [],
    content: overrides.content ?? (async () => ({ chapters: async () => ({ vi: [], en: [] }) })),
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

let authFixture;
let configuredNext;
let fixtureSession;

before(async () => {
  const { startHttpServer: http } = await import("./test-helpers.mjs");
  authFixture = await http((req, res) => {
    if (req.url?.includes("get-session")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        session: { id: "session-opaque", userId: "google|sdk-identity", expiresAt: new Date(now + DAY).toISOString() },
        user: {
          id: "google|sdk-identity", name: "SDK Reader", email: "reader@example.com",
          emailVerified: true, image: null, role: "admin", level: 999, totalXp: 999_999,
        },
      }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
  configuredNext = await startNext({
    NEON_AUTH_BASE_URL: `${authFixture.baseUrl}/neondb/auth`,
    NEON_AUTH_COOKIE_SECRET: "fixture-secret-with-at-least-32-characters",
  });
  const signIn = await fetch(`${configuredNext.baseUrl}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "reader@example.com", password: "fixture-password" }),
  });
  assert.equal(signIn.status, 200);
  const response = await fetch(`${configuredNext.baseUrl}/api/auth/get-session`, {
    headers: { cookie: "__Secure-neon-auth.session_token=fixture" },
  });
  fixtureSession = await response.json();
  assert.equal(fixtureSession.user.id, "google|sdk-identity");
});

after(async () => {
  await stop(configuredNext?.child);
  await authFixture?.close();
});

test("migration owns comment, report, notification and rate tables without auth schemas", async () => {
  const { pg } = await migratedDb();
  try {
    const tables = await pg.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' ORDER BY table_name
    `);
    const names = tables.rows.map((row) => row.table_name);
    for (const table of [
      "comments", "comment_threads", "comment_reports", "notifications",
      "notification_cursors", "action_events",
    ]) {
      assert.ok(names.includes(table), `${table} must be created by the application migration`);
    }
    assert.equal((await pg.query("SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'neon_auth'")).rows.length, 0);

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

test("real SDK session identity owns comments; client role fields grant nothing", async () => {
  const { pg, db } = await migratedDb();
  try {
    const resolved = identityFromSession(fixtureSession);
    assert.equal(resolved.id, "google|sdk-identity");
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
    assert.equal(ownerBody.items.length, 0, "hidden replies do not expose a removed root");
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
    assert.equal(unsigned.status, 401);
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
      chapters: async () => {
        calls += 1;
        return { vi: [old, fresh], en: [] };
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
      content: async () => ({ chapters: async () => ({ vi: [old, fresh], en: [] }) }),
    });
    // The new chapter is older than the baseline clock, so move the cursor back
    // to simulate a follow before that chapter existed.
    await db.update(schema.notificationCursors).set({ lastPublish: now - 2 * DAY });
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
      chapters: async () => { boundedCalls += 1; return { vi: [], en: [] }; },
    }) });
    await bounded.notificationsRefreshPost(jsonRequest("/api/v1/notifications/refresh", "POST", {}), {});
    assert.ok(boundedCalls <= 20, `refresh must stay bounded, saw ${boundedCalls} content calls`);
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
