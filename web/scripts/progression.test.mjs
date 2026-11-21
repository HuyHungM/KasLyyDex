import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { startNext, stop } from "./test-helpers.mjs";

// Task 8 RED/GREEN harness. Real SQL migrations run in embedded PostgreSQL and
// identity comes from the real Neon SDK session fixture. No production bypass:
// the clock, content fixture and failure hook exist only on this test factory.
const progression = await import("../lib/progression.ts");
const apiModule = await import("../lib/progression-api.ts");
const { identityFromSession } = await import("../lib/auth/identity.ts");
const schema = await import("../lib/db/schema.ts");
const meService = await import("../lib/me/service.ts");

const MANGA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CHAPTER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc";
const SECRET = "fixture-reader-secret-with-at-least-32-chars";
const T0 = Date.parse("2026-11-21T10:00:00.000Z");
let now = T0;

const migrationFiles = [
  "0000_application.sql", "0001_account_data.sql", "0002_comments_moderation.sql",
  "0003_community_cursor_scrub.sql", "0004_notification_feed_cursor.sql",
  "0005_notification_pending.sql", "0006_progression.sql",
];

async function migratedDb() {
  const pg = new PGlite();
  const db = drizzle(pg, { schema });
  for (const file of migrationFiles) {
    const url = new URL(`../drizzle/${file}`, import.meta.url);
    await pg.exec(await readFile(fileURLToPath(url), "utf8"));
  }
  return { pg, db };
}

function content(overrides = {}) {
  return {
    async chapterMetadata(id) {
      return {
        id, manga_id: MANGA, lang: "vi", pages: 10, external_url: null, unavailable: false,
        chapter: "1", title: "Chương 1",
        ...(overrides.metadata ?? {}),
      };
    },
    async pages() {
      return { pages: Array.from({ length: overrides.imageCount ?? 10 }, (_, index) => `/api/content/img?u=p${index}`) };
    },
  };
}

function request(path, body, origin = "http://localhost") {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body ?? {}),
  });
}

function api(db, user, overrides = {}) {
  return apiModule.createProgressionApi({
    db: () => db,
    identity: async () => user,
    now: () => now,
    content: () => (overrides.content ?? content)(),
    secret: () => (overrides.secret ?? (() => SECRET))(),
    hooks: overrides.hooks,
  });
}

async function json(res) {
  return { status: res.status, body: await res.json(), headers: res.headers };
}

async function openSession(handler, user) {
  assert.ok(typeof user?.id === "string");
  const res = await json(await handler.sessionPost(request("/api/v1/reader-sessions", {
    chapterId: CHAPTER, mangaId: MANGA, lang: "vi",
  })));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.headers.get("cache-control"), "private, no-store");
  return res.body;
}

async function checkpoints(handler, ticket, pages) {
  return json(await handler.checkpointPost(request("/api/v1/progress/checkpoint", { ticket, pages })));
}

let authFixture;
let configuredNext;
let realIdentity;

before(async () => {
  authFixture = await (await import("./test-helpers.mjs")).startHttpServer((req, res) => {
    if (req.url?.includes("get-session")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        session: { id: "session-opaque", userId: "google|opaque-42", expiresAt: new Date(now + 86_400_000).toISOString() },
        user: { id: "google|opaque-42", name: "Fixture Reader", email: "reader@example.com", emailVerified: true, image: null },
      }));
      return;
    }
    res.writeHead(200, {
      "content-type": "application/json",
      "set-cookie": "__Secure-neon-auth.session_token=fixture; Path=/; HttpOnly; SameSite=Lax",
    });
    res.end(JSON.stringify({ ok: true }));
  });
  configuredNext = await startNext({
    NEON_AUTH_BASE_URL: `${authFixture.baseUrl}/neondb/auth`,
    NEON_AUTH_COOKIE_SECRET: "fixture-secret-with-at-least-32-characters",
  });
  await fetch(`${configuredNext.baseUrl}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "reader@example.com", password: "fixture-password" }),
  });
  const sessionRes = await fetch(`${configuredNext.baseUrl}/api/auth/get-session`, {
    headers: { cookie: "__Secure-neon-auth.session_token=fixture" },
  });
  realIdentity = identityFromSession(await sessionRes.json());
  assert.equal(realIdentity.id, "google|opaque-42");
});

after(async () => {
  await stop(configuredNext?.child);
  await authFixture?.close();
});

// Step 1: pure contract.
test("all 13 Vietnamese realms and adjacent boundaries match the platform spec", () => {
  const boundaries = [
    [1, "Phàm Nhân"], [10, "Luyện Khí"], [50, "Trúc Cơ"], [100, "Kim Đan"],
    [200, "Nguyên Anh"], [300, "Hóa Thần"], [400, "Luyện Hư"], [500, "Hợp Thể"],
    [600, "Đại Thừa"], [700, "Độ Kiếp"], [800, "Chân Tiên"], [900, "Tiên Vương"],
    [1000, "Tiên Đế"],
  ];
  assert.equal(progression.REALMS.length, 13);
  for (const [level, title] of boundaries) {
    assert.equal(progression.realmForLevel(level).name, title, `level ${level}`);
    if (level > 1) assert.notEqual(progression.realmForLevel(level - 1).name, title, `level ${level - 1}`);
    if (level < 1000) assert.equal(progression.realmForLevel(level + 1).name, title, `level ${level + 1}`);
  }
  assert.equal(progression.realmForLevel(9).name, "Phàm Nhân");
  assert.equal(progression.realmForLevel(49).name, "Luyện Khí");
  assert.equal(progression.realmForLevel(999).name, "Tiên Vương");
});

test("level formula clamps to 1..1000 and uses progression_v1", () => {
  assert.equal(progression.PROGRESSION_RULE_VERSION, "progression_v1");
  assert.equal(progression.XP_PER_CHAPTER, 100);
  assert.equal(progression.levelFromXp(-500), 1);
  assert.equal(progression.levelFromXp(0), 1);
  assert.equal(progression.levelFromXp(199), 1);
  assert.equal(progression.levelFromXp(200), 2);
  assert.equal(progression.levelFromXp(199_800), 1000);
  assert.equal(progression.levelFromXp(500_000), 1000);
  const snapshot = progression.progressionForXp(400);
  assert.equal(snapshot.level, 3);
  assert.equal(snapshot.title, "Phàm Nhân");
  assert.equal(snapshot.ruleVersion, "progression_v1");
});

test("coverage is distinct, bounded and elapsed time uses required pages", () => {
  assert.equal(progression.requiredPages(10), 8);
  assert.equal(progression.requiredPages(11), 9);
  assert.equal(progression.minimumElapsedMs(10), 16_000);
  assert.equal(progression.minimumElapsedMs(4), 10_000);
  const merged = progression.mergePages([9, 2, 2], [10, 9, 11, 0, 1], 10);
  assert.deepEqual(merged, [1, 2, 9, 10], "out-of-range and duplicate pages never enter the union");
});

test("production route fails closed without READER_TICKET_SECRET", async () => {
  const res = await fetch(`${configuredNext.baseUrl}/api/v1/reader-sessions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: configuredNext.baseUrl,
      cookie: "__Secure-neon-auth.session_token=fixture",
    },
    body: JSON.stringify({ chapterId: CHAPTER, mangaId: MANGA, lang: "vi" }),
  });
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error.code, "READER_TICKET_NOT_CONFIGURED");
  assert.equal(res.headers.get("cache-control"), "private, no-store");
});

// Step 3: signed tickets and authoritative metadata.
test("missing secret fails closed; forged, expired and mismatched tickets are rejected", async () => {
  const { pg, db } = await migratedDb();
  const user = realIdentity;
  try {
    const denied = await json(await api(db, user, { secret: () => apiModule.readTicketSecret({}) })
      .sessionPost(request("/api/v1/reader-sessions", { chapterId: CHAPTER, mangaId: MANGA, lang: "vi" })));
    assert.equal(denied.status, 503);
    assert.equal(denied.body.error.code, "READER_TICKET_NOT_CONFIGURED");

    const session = await openSession(api(db, user), user);
    assert.ok(typeof session.ticket === "string" && session.ticket.split(".").length === 3);
    const forged = await json(await api(db, user).checkpointPost(
      request("/api/v1/progress/checkpoint", { ticket: session.ticket.slice(0, -2) + "xy", pages: [1] })));
    assert.equal(forged.status, 401);
    assert.equal(forged.body.error.code, "INVALID_TICKET");

    const nowBefore = now;
    now = now + 31 * 60_000;
    const expired = await json(await api(db, user).checkpointPost(
      request("/api/v1/progress/checkpoint", { ticket: session.ticket, pages: [1] })));
    assert.equal(expired.status, 401);
    now = nowBefore;

    const other = await json(await api(db, { ...realIdentity, id: "google|opaque-99" })
      .checkpointPost(request("/api/v1/progress/checkpoint", { ticket: session.ticket, pages: [1] })));
    assert.equal(other.status, 403, "a ticket bound to another persisted user is refused");
  } finally {
    await pg.close();
  }
});

test("ticket claims bind user, chapter, manga, language, count and expiry", async () => {
  const { pg, db } = await migratedDb();
  try {
    const session = await openSession(api(db, realIdentity), realIdentity);
    const claims = await apiModule.verifyTicket(session.ticket, SECRET, now);
    assert.equal(claims.sub, realIdentity.id);
    assert.equal(claims.cid, CHAPTER);
    assert.equal(claims.mid, MANGA);
    assert.equal(claims.lang, "vi");
    assert.equal(claims.pages, 10);
    assert.equal(claims.exp - claims.iat, 30 * 60);
  } finally {
    await pg.close();
  }
});

test("upstream ownership, zero pages, external and unavailable chapters never yield a ticket", async () => {
  const { pg, db } = await migratedDb();
  try {
    const cases = [
      [{ metadata: { manga_id: "other-manga" } }, "CONTENT_MISMATCH"],
      [{ metadata: { lang: "en" } }, "CONTENT_MISMATCH"],
      [{ metadata: { id: OTHER } }, "CONTENT_MISMATCH"],
      [{ metadata: { pages: 0 }, imageCount: 0 }, "CONTENT_UNAVAILABLE"],
      [{ metadata: { external_url: "https://example.com" } }, "CONTENT_UNAVAILABLE"],
      [{ metadata: { unavailable: true } }, "CONTENT_UNAVAILABLE"],
      [{ imageCount: 9 }, "CONTENT_MISMATCH"],
    ];
    for (const [override, code] of cases) {
      const res = await json(await api(db, realIdentity, { content: () => content(override) })
        .sessionPost(request("/api/v1/reader-sessions", { chapterId: CHAPTER, mangaId: MANGA, lang: "vi" })));
      assert.equal(res.status, 409, JSON.stringify(res));
      assert.equal(res.body.error.code, code, JSON.stringify(res));
    }
    const badId = await json(await api(db, realIdentity).sessionPost(
      request("/api/v1/reader-sessions", { chapterId: "not-a-uuid", mangaId: MANGA, lang: "vi" })));
    assert.equal(badId.status, 400);
    const spoofed = await json(await api(db, realIdentity).checkpointPost(
      request("/api/v1/progress/checkpoint", { ticket: "x", pages: [1], percent: 100, pageCount: 1, totalXp: 999, role: "admin" })));
    assert.equal(spoofed.status, 400);
  } finally {
    await pg.close();
  }
});

// Step 4: monotone incremental coverage and rate limits.
test("checkpoints keep a distinct monotone union; legacy lastPageSeen means one page", async () => {
  const { pg, db } = await migratedDb();
  try {
    const handler = api(db, realIdentity);
    const session = await openSession(handler, realIdentity);
    const first = await checkpoints(handler, session.ticket, [3, 3, 10]);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.deepEqual(first.body.seenPages, [3, 10]);
    const outOfRange = await checkpoints(handler, session.ticket, [0, 11]);
    assert.equal(outOfRange.status, 400);
    const second = await checkpoints(handler, session.ticket, [4]);
    assert.deepEqual(second.body.seenPages, [3, 4, 10]);
    const legacy = await json(await handler.checkpointPost(request("/api/v1/progress/checkpoint", {
      ticket: session.ticket, lastPageSeen: 5,
    })));
    assert.deepEqual(legacy.body.seenPages, [3, 4, 5, 10], "one legacy page never implies 1..5");
  } finally {
    await pg.close();
  }
});

test("checkpoint rate limit is durable at 20 per account per minute", async () => {
  const { pg, db } = await migratedDb();
  try {
    const handler = api(db, realIdentity);
    const session = await openSession(handler, realIdentity);
    let last;
    for (let index = 0; index < 20; index += 1) {
      last = await checkpoints(handler, session.ticket, [(index % 10) + 1]);
      assert.equal(last.status, 200, `request ${index + 1}: ${JSON.stringify(last.body)}`);
    }
    const denied = await checkpoints(handler, session.ticket, [1]);
    assert.equal(denied.status, 429);
    assert.equal(denied.body.error.code, "RATE_LIMITED");
    const events = await pg.query("select count(*)::int as n from action_events where action = 'reader_checkpoint'");
    assert.equal(events.rows[0].n, 20, "rejected requests leave no durable event");
  } finally {
    await pg.close();
  }
});

// Step 5: completion, XP and atomicity.
async function validCoverage(handler, ticket, count = 10) {
  const pages = Array.from({ length: count }, (_, index) => index + 1);
  return checkpoints(handler, ticket, pages);
}

test("insufficient coverage and insufficient elapsed time award nothing", async () => {
  const { pg, db } = await migratedDb();
  try {
    const handler = api(db, realIdentity);
    const session = await openSession(handler, realIdentity);
    await checkpoints(handler, session.ticket, [1, 2, 3, 4, 5, 6, 7]);
    now = T0 + 16_000;
    let res = await json(await handler.completePost(request("/api/v1/progress/complete", { ticket: session.ticket })));
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, "COVERAGE_INSUFFICIENT");
    const more = await checkpoints(handler, session.ticket, [8]);
    assert.equal(more.status, 200);
    now = T0 + 10_000;
    res = await json(await handler.completePost(request("/api/v1/progress/complete", { ticket: session.ticket })));
    assert.equal(res.status, 429);
    assert.equal(res.body.error.code, "TOO_FAST");
    now = T0 + 16_000;
    res = await json(await handler.completePost(request("/api/v1/progress/complete", { ticket: session.ticket })));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.awarded, true);
    assert.equal(res.body.xp, 100);
    now = T0;
  } finally {
    await pg.close();
  }
});

test("duplicate completions across sessions and languages never double XP", async () => {
  const { pg, db } = await migratedDb();
  try {
    const handler = api(db, realIdentity);
    const first = await openSession(handler, realIdentity);
    await validCoverage(handler, first.ticket);
    now = T0 + 16_000;
    const awarded = await json(await handler.completePost(request("/api/v1/progress/complete", { ticket: first.ticket })));
    assert.equal(awarded.body.awarded, true);
    const retry = await json(await handler.completePost(request("/api/v1/progress/complete", { ticket: first.ticket })));
    assert.equal(retry.body.awarded, false);
    assert.equal(retry.body.totalXp, 100);
    assert.equal(retry.body.level, 1);
    now = T0;

    const secondHandler = api(db, realIdentity, {
      content: () => ({ ...content(), async chapterMetadata(id) {
        return { ...(await content().chapterMetadata(id)), lang: "en" };
      } }),
    });
    const secondRes = await json(await secondHandler.sessionPost(request("/api/v1/reader-sessions", {
      chapterId: CHAPTER, mangaId: MANGA, lang: "en",
    })));
    assert.equal(secondRes.status, 200, JSON.stringify(secondRes.body));
    const second = secondRes.body;
    await validCoverage(secondHandler, second.ticket);
    now = T0 + 16_000;
    const otherLang = await json(await secondHandler
      .completePost(request("/api/v1/progress/complete", { ticket: second.ticket })));
    assert.equal(otherLang.body.awarded, false);
    assert.equal(otherLang.body.totalXp, 100);
    now = T0;

    const completions = await pg.query("select count(*)::int as n from reading_completions");
    const events = await pg.query("select count(*)::int as n from xp_events");
    assert.equal(completions.rows[0].n, 1);
    assert.equal(events.rows[0].n, 1);
  } finally {
    await pg.close();
  }
});

test("concurrent completions of different chapters serialize profile totals and level-up events", async () => {
  const { pg, db } = await migratedDb();
  try {
    const user = realIdentity;
    const sessions = [];
    for (const id of [CHAPTER, OTHER]) {
      const handler = api(db, user, { content: () => ({
        ...content(),
        async chapterMetadata(chapterId) { return { ...(await content().chapterMetadata(chapterId)), id: chapterId }; },
      }) });
      const res = await json(await handler.sessionPost(request("/api/v1/reader-sessions", {
        chapterId: id, mangaId: MANGA, lang: "vi",
      })));
      assert.equal(res.status, 200);
      sessions.push(res.body.ticket);
    }
    const handler = api(db, user);
    for (const ticket of sessions) await validCoverage(handler, ticket);
    now = T0 + 16_000;
    const results = await Promise.all(sessions.map(async (ticket) =>
      json(await handler.completePost(request("/api/v1/progress/complete", { ticket })))));
    assert.deepEqual(results.map((res) => res.status), [200, 200]);
    assert.equal(results.filter((res) => res.body.awarded).length, 2);
    const profiles = await pg.query("select total_xp, level from profiles where user_id = $1", [user.id]);
    assert.equal(profiles.rows[0].total_xp, 200);
    assert.equal(profiles.rows[0].level, 2);
    const events = await pg.query("select count(*)::int as n from xp_events where user_id = $1", [user.id]);
    assert.equal(events.rows[0].n, 2);
    const notifications = await pg.query("select event_key from notifications where user_id = $1", [user.id]);
    assert.deepEqual(notifications.rows.map((row) => row.event_key), ["level:2"]);
    const roles = await pg.query("select role from user_roles where user_id = $1", [user.id]);
    assert.deepEqual(roles.rows, [], "XP never grants a role");
    now = T0;
  } finally {
    await pg.close();
  }
});

test("injected failure rolls back completion, event, progress, profile and notification together", async () => {
  const { pg, db } = await migratedDb();
  try {
    let fail = false;
    const handler = api(db, realIdentity, { hooks: {
      beforeCommit: async () => { if (fail) throw new Error("injected database failure"); },
    } });
    const session = await openSession(handler, realIdentity);
    await validCoverage(handler, session.ticket);
    now = T0 + 16_000;
    fail = true;
    const failed = await json(await handler.completePost(request("/api/v1/progress/complete", { ticket: session.ticket })));
    assert.equal(failed.status, 500);
    assert.equal(failed.body.error.code, "INTERNAL_ERROR");
    // Checkpoints were committed earlier as progressive evidence; only this
    // completion transaction's writes must disappear together.
    for (const table of ["reading_completions", "xp_events", "chapter_progress", "notifications"]) {
      const rows = await pg.query(`select count(*)::int as n from ${table}`);
      assert.equal(rows.rows[0].n, 0, `${table} must be empty after rollback`);
    }
    const checkpoints = await pg.query("select count(*)::int as n from reader_checkpoints");
    assert.equal(checkpoints.rows[0].n, 10);
    const profile = await pg.query("select total_xp, level from profiles");
    assert.equal(profile.rows[0].total_xp, 0);
    assert.equal(profile.rows[0].level, 1);
    fail = false;
    const retry = await json(await handler.completePost(request("/api/v1/progress/complete", { ticket: session.ticket })));
    assert.equal(retry.body.awarded, true);
    now = T0;
  } finally {
    await pg.close();
  }
});

test("session route has a durable abuse limit and missing metadata fails closed", async () => {
  const { pg, db } = await migratedDb();
  try {
    const handler = api(db, realIdentity);
    let last;
    for (let index = 0; index < 30; index += 1) {
      last = await json(await handler.sessionPost(request("/api/v1/reader-sessions", {
        chapterId: CHAPTER, mangaId: MANGA, lang: "vi",
      })));
      assert.equal(last.status, 200);
    }
    const denied = await json(await handler.sessionPost(request("/api/v1/reader-sessions", {
      chapterId: CHAPTER, mangaId: MANGA, lang: "vi",
    })));
    assert.equal(denied.status, 429);

    const missing = await json(await api(db, realIdentity, {
      content: () => ({ async chapterMetadata() { return undefined; }, async pages() { return { pages: [] }; } }),
    }).sessionPost(request("/api/v1/reader-sessions", { chapterId: CHAPTER, mangaId: MANGA, lang: "vi" })));
    assert.equal(missing.status, 429, "abuse limit applies before metadata parsing");

    const clean = await migratedDb();
    try {
      const noMetadata = await json(await api(clean.db, realIdentity, {
        content: () => ({ async chapterMetadata() { return undefined; }, async pages() { return { pages: [] }; } }),
      }).sessionPost(request("/api/v1/reader-sessions", { chapterId: CHAPTER, mangaId: MANGA, lang: "vi" })));
      assert.equal(noMetadata.status, 503);
      assert.equal(noMetadata.body.error.code, "CONTENT_METADATA_UNAVAILABLE");
    } finally {
      await clean.pg.close();
    }
  } finally {
    await pg.close();
  }
});

test("guest imports only merge local history and never create XP or completions", async () => {
  const { pg, db } = await migratedDb();
  try {
    await meService.ensureProfile(db, realIdentity, { now, allowlist: [] });
    const summary = await meService.importGuest(db, realIdentity.id, {
      library: [], history: [{
        mangaId: MANGA, chapterId: CHAPTER, lang: "vi", page: 10, total: 10,
        chapter: "1", title: "local", coverFile: null, ts: now,
      }], settings: null, skipped: 0,
    }, now);
    assert.equal(summary.progressInserted, 1);
    for (const table of ["reading_completions", "xp_events", "reader_checkpoints"]) {
      const rows = await pg.query(`select count(*)::int as n from ${table}`);
      assert.equal(rows.rows[0].n, 0, `${table} must stay empty for guest imports`);
    }
    const profile = await pg.query("select total_xp, level from profiles");
    assert.equal(profile.rows[0].total_xp, 0);
  } finally {
    await pg.close();
  }
});

test("real SDK session identity is opaque and role checks remain independent of XP", async () => {
  const { pg, db } = await migratedDb();
  try {
    assert.equal(realIdentity.id, "google|opaque-42");
    const profile = await meService.ensureProfile(db, realIdentity, { now, allowlist: [] });
    assert.equal(profile.level, 1);
    now = T0 + 199_800;
    await db.update(schema.profiles).set({ totalXp: 199_800 }).where(eq(schema.profiles.userId, realIdentity.id));
    const level = await meService.getLevel(db, realIdentity.id);
    assert.equal(level.level, 1000);
    assert.equal(level.title, "Tiên Đế");
    assert.equal(level.source, "progression_v1");
    const roles = await pg.query("select role from user_roles");
    assert.deepEqual(roles.rows, [], "XP alone never populates a role");
    now = T0;
  } finally {
    await pg.close();
  }
});
