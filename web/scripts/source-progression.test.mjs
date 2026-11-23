import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";

// Task 6 RED/GREEN harness. Real SQL migrations run in embedded PostgreSQL and
// identity comes from the Netlify user mapper. No production bypass: the clock,
// content fixture and failure hook exist only on this test factory.
const apiModule = await import("../lib/progression-api.ts");
const { identityFromNetlifyUser } = await import("../lib/auth/identity.ts");
const { setIdentityProvider } = await import("../lib/auth/server.ts");
const { ContentClientError } = await import("../lib/contracts.ts");
const schema = await import("../lib/db/schema.ts");
const meService = await import("../lib/me/service.ts");
const validators = await import("../lib/validators.ts");

const MANGA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CHAPTER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc";
const COMICK_CHAPTER = "comick:chapter-opaque-abc123";
const SECRET = "fixture-reader-secret-with-at-least-32-chars";
const T0 = Date.parse("2026-11-21T10:00:00.000Z");
let now = T0;

const migrationFiles = [
  "0000_application.sql", "0001_account_data.sql", "0002_comments_moderation.sql",
  "0003_community_cursor_scrub.sql", "0004_notification_feed_cursor.sql",
  "0005_notification_pending.sql", "0006_progression.sql",
  "0007_reader_session_source.sql",
];

async function migratedDb() {
  const pg = new PGlite();
  const db = drizzle(pg, { schema });
  for (const file of migrationFiles) {
    const url = new URL(`../../netlify/database/migrations/${file}`, import.meta.url);
    // RED runs before the additive source migration exists; skip it so the
    // failures reflect missing source behaviour, not a missing file.
    if (!existsSync(fileURLToPath(url))) continue;
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

async function openSession(handler, user, bodyOverrides = {}) {
  assert.ok(typeof user?.id === "string");
  const res = await json(await handler.sessionPost(request("/api/v1/reader-sessions", {
    chapterId: CHAPTER, mangaId: MANGA, lang: "vi",
    ...bodyOverrides,
  })));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.headers.get("cache-control"), "private, no-store");
  return res.body;
}

async function checkpoints(handler, ticket, pages) {
  return json(await handler.checkpointPost(request("/api/v1/progress/checkpoint", { ticket, pages })));
}

async function validCoverage(handler, ticket, count = 10) {
  return checkpoints(handler, ticket, Array.from({ length: count }, (_, index) => index + 1));
}

const fixtureUser = {
  id: "identity-user-1",
  email: "reader@example.com",
  email_verified: true,
  user_metadata: { full_name: "Fixture Reader" },
};
const realIdentity = identityFromNetlifyUser(fixtureUser);
assert.equal(realIdentity?.id, fixtureUser.id);

afterEach(() => setIdentityProvider());

// Step 1 assertions: content ID validation and source-aware tickets.
test("additive migration adds reader_sessions.source defaulting to mangadex", async () => {
  const { pg } = await migratedDb();
  try {
    const column = await pg.query(
      "select data_type, is_nullable, column_default from information_schema.columns "
      + "where table_schema = 'public' and table_name = 'reader_sessions' and column_name = 'source'",
    );
    assert.equal(column.rows.length, 1);
    assert.equal(column.rows[0].data_type, "text");
    assert.equal(column.rows[0].is_nullable, "NO");
    assert.equal(column.rows[0].column_default, "'mangadex'::text");
    const auth = await pg.query(
      "select count(*)::int as n from information_schema.schemata where schema_name = 'neon_auth'",
    );
    assert.equal(auth.rows[0].n, 0, "the migration must never manage Neon Auth tables");
  } finally {
    await pg.close();
  }
});

test("content id validator accepts MangaDex UUID and comick:<opaque>, rejects the rest", () => {
  const parse = (value) => validators.parseContentId(value, "chapterId");
  assert.deepEqual(parse(CHAPTER), { id: CHAPTER, source: "mangadex" });
  assert.deepEqual(parse(COMICK_CHAPTER), { id: COMICK_CHAPTER, source: "comick" });
  for (const bad of ["not-a-uuid", "comick:", "comick:has space", "comick:has/slash", "", 42]) {
    assert.throws(() => parse(bad), (error) => error.code === "INVALID_INPUT", `accepted ${String(bad)}`);
  }
  assert.equal(validators.parseContentSource("comick"), "comick");
  assert.equal(validators.parseContentSource("mangadex"), "mangadex");
  assert.throws(() => validators.parseContentSource("webtoon"), (error) => error.code === "INVALID_INPUT");
});

test("MangaDex UUID ticket works and signs source=mangadex with a paired label", async () => {
  const { pg, db } = await migratedDb();
  try {
    const session = await openSession(api(db, realIdentity), realIdentity);
    assert.ok(typeof session.ticket === "string" && session.ticket.split(".").length === 3);
    assert.equal(session.source, "mangadex");
    assert.equal(session.source_label, "MangaDex");
    const claims = await apiModule.verifyTicket(session.ticket, SECRET, now);
    assert.equal(claims.cid, CHAPTER);
    assert.equal(claims.source, "mangadex");
    const rows = await db.select().from(schema.readerSessions).where(eq(schema.readerSessions.id, session.sessionId)).limit(1);
    assert.equal(rows[0].source, "mangadex");
  } finally {
    await pg.close();
  }
});

test("Comick chapter with authoritative pages can create a ticket", async () => {
  const { pg, db } = await migratedDb();
  try {
    const handler = api(db, realIdentity);
    const session = await openSession(handler, realIdentity, { chapterId: COMICK_CHAPTER });
    assert.equal(session.chapterId, COMICK_CHAPTER);
    assert.equal(session.source, "comick");
    assert.equal(session.source_label, "Comick");
    const claims = await apiModule.verifyTicket(session.ticket, SECRET, now);
    assert.equal(claims.cid, COMICK_CHAPTER);
    assert.equal(claims.source, "comick");
  } finally {
    await pg.close();
  }
});

test("Comick chapter completes once, persists source, and never double-awards", async () => {
  const { pg, db } = await migratedDb();
  try {
    const handler = api(db, realIdentity);
    const session = await openSession(handler, realIdentity, { chapterId: COMICK_CHAPTER });
    await validCoverage(handler, session.ticket);
    now = T0 + 16_000;
    const first = await json(await handler.completePost(request("/api/v1/progress/complete", { ticket: session.ticket })));
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.awarded, true);
    assert.equal(first.body.xp, 100);
    const retry = await json(await handler.completePost(request("/api/v1/progress/complete", { ticket: session.ticket })));
    assert.equal(retry.body.awarded, false);
    assert.equal(retry.body.totalXp, 100);
    const rows = await db.select().from(schema.readerSessions).where(eq(schema.readerSessions.chapterId, COMICK_CHAPTER)).limit(1);
    assert.equal(rows[0].source, "comick");
    const completions = await pg.query("select count(*)::int as n from reading_completions where chapter_id = $1", [COMICK_CHAPTER]);
    assert.equal(completions.rows[0].n, 1);
    now = T0;
  } finally {
    await pg.close();
  }
});

test("a re-signed ticket with a different source claim is rejected", async () => {
  const { pg, db } = await migratedDb();
  try {
    const session = await openSession(api(db, realIdentity), realIdentity);
    const claims = await apiModule.verifyTicket(session.ticket, SECRET, now);
    assert.equal(claims.source, "mangadex");
    // Re-sign with the real secret but a different source: the persisted row
    // is bound to mangadex, so loadSession must refuse the comick claim.
    const swapped = await apiModule.signTicket(SECRET, { ...claims, source: "comick" });
    const res = await json(await api(db, realIdentity).checkpointPost(
      request("/api/v1/progress/checkpoint", { ticket: swapped, pages: [1] })));
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, "INVALID_TICKET");
  } finally {
    await pg.close();
  }
});

test("a tampered ticket signature is rejected", async () => {
  const { pg, db } = await migratedDb();
  try {
    const session = await openSession(api(db, realIdentity), realIdentity);
    const forged = await json(await api(db, realIdentity).checkpointPost(
      request("/api/v1/progress/checkpoint", { ticket: session.ticket.slice(0, -2) + "xy", pages: [1] })));
    assert.equal(forged.status, 401);
    assert.equal(forged.body.error.code, "INVALID_TICKET");
  } finally {
    await pg.close();
  }
});

test("Comick id with MangaDex-only metadata is rejected", async () => {
  const { pg, db } = await migratedDb();
  try {
    const handler = api(db, realIdentity, {
      content: () => content({ metadata: { id: OTHER, manga_id: MANGA, pages: 10 } }),
    });
    const res = await json(await handler.sessionPost(request("/api/v1/reader-sessions", {
      chapterId: COMICK_CHAPTER, mangaId: MANGA, lang: "vi",
    })));
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, "CONTENT_MISMATCH");
  } finally {
    await pg.close();
  }
});

test("a client source that disagrees with the id is rejected", async () => {
  const { pg, db } = await migratedDb();
  try {
    const handler = api(db, realIdentity);
    const res = await json(await handler.sessionPost(request("/api/v1/reader-sessions", {
      chapterId: CHAPTER, mangaId: MANGA, lang: "vi", source: "comick", source_label: "Comick",
    })));
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, "CONTENT_MISMATCH");
  } finally {
    await pg.close();
  }
});

test("source without its label, or with a non-canonical label, is rejected", async () => {
  const { pg, db } = await migratedDb();
  try {
    const handler = api(db, realIdentity);
    const missing = await json(await handler.sessionPost(request("/api/v1/reader-sessions", {
      chapterId: CHAPTER, mangaId: MANGA, lang: "vi", source: "mangadex",
    })));
    assert.equal(missing.status, 400);
    assert.equal(missing.body.error.code, "INVALID_INPUT");
    const badLabel = await json(await handler.sessionPost(request("/api/v1/reader-sessions", {
      chapterId: CHAPTER, mangaId: MANGA, lang: "vi", source: "mangadex", source_label: "MD",
    })));
    assert.equal(badLabel.status, 400);
    assert.equal(badLabel.body.error.code, "INVALID_INPUT");
  } finally {
    await pg.close();
  }
});

test("forged percent/pageCount/extra fields cannot award XP or a ticket", async () => {
  const { pg, db } = await migratedDb();
  try {
    const handler = api(db, realIdentity);
    const session = await openSession(handler, realIdentity);
    const forged = await json(await handler.checkpointPost(request("/api/v1/progress/checkpoint", {
      ticket: session.ticket, pages: [1], percent: 100, pageCount: 1, totalXp: 999, role: "admin",
    })));
    assert.equal(forged.status, 400);
    assert.equal(forged.body.error.code, "INVALID_INPUT");
    const extra = await json(await handler.sessionPost(request("/api/v1/reader-sessions", {
      chapterId: CHAPTER, mangaId: MANGA, lang: "vi", role: "admin", totalXp: 999,
    })));
    assert.equal(extra.status, 400);
  } finally {
    await pg.close();
  }
});

test("a cold-direct 502 content error fails closed without a session or ownership", async () => {
  const { pg, db } = await migratedDb();
  try {
    const handler = api(db, realIdentity, {
      content: () => ({
        async chapterMetadata() { throw new ContentClientError(502, { error: { code: "UPSTREAM_ERROR", message: "upstream" } }); },
        async pages() { throw new ContentClientError(502, { error: { code: "UPSTREAM_ERROR", message: "upstream" } }); },
      }),
    });
    const res = await json(await handler.sessionPost(request("/api/v1/reader-sessions", {
      chapterId: CHAPTER, mangaId: MANGA, lang: "vi",
    })));
    assert.equal(res.status, 503);
    assert.equal(res.body.error.code, "CONTENT_METADATA_UNAVAILABLE");
    const rows = await pg.query("select count(*)::int as n from reader_sessions");
    assert.equal(rows.rows[0].n, 0, "a metadata failure never mints a session");
  } finally {
    await pg.close();
  }
});

test("cross-origin mutations are rejected and every response is private no-store", async () => {
  const { pg, db } = await migratedDb();
  try {
    const cross = await json(await api(db, realIdentity).sessionPost(
      request("/api/v1/reader-sessions", { chapterId: CHAPTER, mangaId: MANGA, lang: "vi" }, "https://evil.example")));
    assert.equal(cross.status, 403);
    assert.equal(cross.body.error.code, "ORIGIN_REJECTED");
    const ok = await json(await api(db, realIdentity).sessionPost(
      request("/api/v1/reader-sessions", { chapterId: CHAPTER, mangaId: MANGA, lang: "vi" })));
    assert.equal(ok.headers.get("cache-control"), "private, no-store");
    assert.equal(ok.headers.get("vary"), "Cookie");
  } finally {
    await pg.close();
  }
});

test("an injected completion failure rolls back XP, progress and the event together", async () => {
  const { pg, db } = await migratedDb();
  try {
    let fail = false;
    const handler = api(db, realIdentity, { hooks: {
      beforeCommit: async () => { if (fail) throw new Error("injected database failure"); },
    } });
    const session = await openSession(handler, realIdentity, { chapterId: COMICK_CHAPTER });
    await validCoverage(handler, session.ticket);
    now = T0 + 16_000;
    fail = true;
    const failed = await json(await handler.completePost(request("/api/v1/progress/complete", { ticket: session.ticket })));
    assert.equal(failed.status, 500);
    for (const table of ["reading_completions", "xp_events", "chapter_progress"]) {
      const rows = await pg.query(`select count(*)::int as n from ${table}`);
      assert.equal(rows.rows[0].n, 0, `${table} must be empty after rollback`);
    }
    fail = false;
    const retry = await json(await handler.completePost(request("/api/v1/progress/complete", { ticket: session.ticket })));
    assert.equal(retry.body.awarded, true);
    now = T0;
  } finally {
    await pg.close();
  }
});

test("guest imports still create no XP or completions", async () => {
  const { pg, db } = await migratedDb();
  try {
    await meService.ensureProfile(db, realIdentity, { now, allowlist: [] });
    await meService.importGuest(db, realIdentity.id, {
      library: [],
      history: [{
        mangaId: MANGA, chapterId: CHAPTER, lang: "vi", page: 10, total: 10,
        chapter: "1", title: "local", coverFile: null, ts: now,
      }],
      settings: null, skipped: 0,
    }, now);
    for (const table of ["reading_completions", "xp_events", "reader_checkpoints"]) {
      const rows = await pg.query(`select count(*)::int as n from ${table}`);
      assert.equal(rows.rows[0].n, 0, `${table} must stay empty for guest imports`);
    }
  } finally {
    await pg.close();
  }
});

test("production route fails closed without READER_TICKET_SECRET", async () => {
  const previous = process.env.READER_TICKET_SECRET;
  delete process.env.READER_TICKET_SECRET;
  setIdentityProvider({
    config: () => ({ url: "https://example.test/.netlify/identity" }),
    getUser: async () => fixtureUser,
    login: async () => fixtureUser,
    signup: async () => fixtureUser,
    logout: async () => {},
  });
  try {
    const res = await apiModule.wrapProgressionRoute(
      (api, req) => api.sessionPost(req),
      request("/api/v1/reader-sessions", { chapterId: CHAPTER, mangaId: MANGA, lang: "vi" }),
    );
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error.code, "READER_TICKET_NOT_CONFIGURED");
    assert.equal(res.headers.get("cache-control"), "private, no-store");
  } finally {
    if (previous === undefined) delete process.env.READER_TICKET_SECRET;
    else process.env.READER_TICKET_SECRET = previous;
  }
});
