import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { localD1 } from "./sqlite-harness.mjs";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

// Task 6 RED/GREEN harness. Real SQL migrations run in local SQLite and
// identity comes from the verified-user mapper. No production bypass: the clock,
// content fixture and failure hook exist only on this test factory.
const apiModule = await import("../lib/progression-api.ts");
const { identityFromVerifiedUser } = await import("../lib/auth/identity.ts");
const { setIdentityProvider } = await import("../lib/auth/server.ts");
const { ContentClientError } = await import("../lib/contracts.ts");
const schema = await import("../lib/db/schema.ts");
const meService = await import("../lib/me/service.ts");
const validators = await import("../lib/validators.ts");

const MANGA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CHAPTER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc";
const SECRET = "fixture-reader-secret-with-at-least-32-chars";
const T0 = Date.parse("2026-11-21T10:00:00.000Z");
let now = T0;

const migrationFiles = ["0000_cloudflare_d1.sql", "0001_profile_bio.sql"];

async function migratedDb() {
  const pg = localD1();
  const db = drizzle(pg, { schema });
  for (const file of migrationFiles) {
    const url = new URL(`../migrations/${file}`, import.meta.url);
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
const realIdentity = identityFromVerifiedUser(fixtureUser);
assert.equal(realIdentity?.id, fixtureUser.id);

afterEach(() => setIdentityProvider());

// Step 1 assertions: content ID validation and source-aware tickets.
test("additive migration adds reader_sessions.source defaulting to mangadex", async () => {
  const { pg } = await migratedDb();
  try {
    const column = await pg.query("PRAGMA table_info(reader_sessions)");
    const source = column.rows.find((row) => row.name === "source");
    assert.equal(source?.type.toLowerCase(), "text");
    assert.equal(source?.notnull, 1);
    assert.equal(source?.dflt_value, "'mangadex'");
    const auth = await pg.query("select count(*) as n from sqlite_master where name like '%neon_auth%'");
    assert.equal(auth.rows[0].n, 0, "the migration must never manage Neon Auth tables");
  } finally {
    await pg.close();
  }
});

test("content id validator accepts only MangaDex UUIDs", () => {
  const parse = (value) => validators.parseContentId(value, "chapterId");
  assert.deepEqual(parse(CHAPTER), { id: CHAPTER, source: "mangadex" });
  for (const bad of ["not-a-uuid", "opaque-id", "", 42]) {
    assert.throws(() => parse(bad), (error) => error.code === "INVALID_INPUT", `accepted ${String(bad)}`);
  }
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

test("a re-signed ticket with a different source claim is rejected", async () => {
  const { pg, db } = await migratedDb();
  try {
    const session = await openSession(api(db, realIdentity), realIdentity);
    const claims = await apiModule.verifyTicket(session.ticket, SECRET, now);
    assert.equal(claims.source, "mangadex");
    // Re-sign with the real secret but a different source: the persisted row
    // is bound to mangadex, so loadSession must refuse the foreign claim.
    const swapped = await apiModule.signTicket(SECRET, { ...claims, source: "webtoon" });
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

test("chapter id with mismatched MangaDex metadata is rejected", async () => {
  const { pg, db } = await migratedDb();
  try {
    const handler = api(db, realIdentity, {
      content: () => content({ metadata: { id: OTHER, manga_id: MANGA, pages: 10 } }),
    });
    const res = await json(await handler.sessionPost(request("/api/v1/reader-sessions", {
      chapterId: CHAPTER, mangaId: MANGA, lang: "vi",
    })));
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, "CONTENT_MISMATCH");
  } finally {
    await pg.close();
  }
});

test("a client source outside the MangaDex-only allowlist is rejected", async () => {
  const { pg, db } = await migratedDb();
  try {
    const handler = api(db, realIdentity);
    const res = await json(await handler.sessionPost(request("/api/v1/reader-sessions", {
      chapterId: CHAPTER, mangaId: MANGA, lang: "vi", source: "webtoon", source_label: "Webtoon",
    })));
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "INVALID_INPUT");
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
    const session = await openSession(handler, realIdentity);
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
    config: async () => ({ secret: "fixture-session-secret-with-at-least-32-chars", clientId: null }),
    getSession: async () => realIdentity,
    signIn: async () => realIdentity,
    signUp: async () => realIdentity,
    signOut: async () => {},
    google: async () => realIdentity,
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
