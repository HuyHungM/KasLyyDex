import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { startNext, stop } from "./test-helpers.mjs";

// RED/GREEN harness for Task 6. The app DB is real SQL in embedded PGlite;
// authentication is exercised through the real Neon SDK against a local HTTP
// fixture. Nothing here injects a production header or in-memory user store.
const validators = await import("../lib/validators.ts");
const merge = await import("../lib/merge.ts");
const { identityFromSession } = await import("../lib/auth/identity.ts");
const service = await import("../lib/me/service.ts");
const { createMeApi } = await import("../lib/me/handlers.ts");
const schema = await import("../lib/db/schema.ts");

const DAY = 86_400_000;
let now = Date.parse("2026-06-01T12:00:00.000Z");

async function migratedDb() {
  const pg = new PGlite();
  const db = drizzle(pg, { schema });
  for (const file of ["0000_application.sql", "0001_account_data.sql"]) {
    const url = new URL(`../drizzle/${file}`, import.meta.url);
    await pg.exec(await readFile(fileURLToPath(url), "utf8"));
  }
  return { pg, db };
}

function identity(id = "opaque|reader-1", overrides = {}) {
  return {
    id,
    email: "reader@example.com",
    emailVerified: true,
    name: "Reader",
    image: null,
    sessionId: "session-opaque",
    ...overrides,
  };
}

function request(path, init = {}, origin = "http://localhost") {
  const headers = { origin, ...(init.headers ?? {}) };
  return new Request(`http://localhost${path}`, { ...init, headers });
}

function api(db, user = identity(), overrides = {}) {
  return createMeApi({
    db,
    identity: async () => user,
    now: () => now,
    allowlist: overrides.allowlist ?? [],
  });
}

let configuredNext;
let fixtureSession;

before(async () => {
  // Loopback managed-auth fixture: the SAME SDK proxy used in production sends
  // the requests and rewrites the session cookies; no fake session is minted by
  // application code.
  const { startHttpServer } = await import("./test-helpers.mjs");
  const fixture = await startHttpServer((req, res, body) => {
    if (req.url?.includes("get-session")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        session: { id: "session-opaque", userId: "google|opaque-42", expiresAt: new Date(now + DAY).toISOString() },
        user: {
          id: "google|opaque-42",
          name: "Fixture Reader",
          email: "reader@example.com",
          emailVerified: true,
          image: null,
        },
      }));
      return;
    }
    if (req.url?.includes("sign-in/email")) {
      res.writeHead(200, {
        "content-type": "application/json",
        "set-cookie": "__Secure-neon-auth.session_token=fixture; Path=/; HttpOnly; SameSite=Lax",
      });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, body }));
  });
  try {
    configuredNext = await startNext({
      NEON_AUTH_BASE_URL: `${fixture.baseUrl}/neondb/auth`,
      NEON_AUTH_COOKIE_SECRET: "fixture-secret-with-at-least-32-characters",
    });
    const signIn = await fetch(`${configuredNext.baseUrl}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "reader@example.com", password: "fixture-password" }),
    });
    assert.equal(signIn.status, 200);
    const sessionRes = await fetch(`${configuredNext.baseUrl}/api/auth/get-session`, {
      headers: { cookie: "__Secure-neon-auth.session_token=fixture" },
    });
    assert.equal(sessionRes.status, 200);
    fixtureSession = await sessionRes.json();
    assert.equal(fixtureSession.user.id, "google|opaque-42");
  } finally {
    await fixture.close();
  }
});

after(async () => {
  await stop(configuredNext?.child);
});

test("validators reject cross-origin mutations, oversize bodies and implausible timestamps", () => {
  assert.throws(
    () => validators.requireOrigin(request("/api/v1/me", { method: "PATCH" }, "http://evil.example")),
    (error) => error.status === 403,
  );
  assert.doesNotThrow(() => validators.requireOrigin(request("/api/v1/me", { method: "PATCH" })));
  assert.equal(validators.boundedClientTime(Number.NaN, now), null);
  assert.equal(validators.boundedClientTime(now + DAY, now), null);
  assert.equal(validators.boundedClientTime(now - 3 * 365 * DAY, now), null);
  assert.equal(validators.boundedClientTime(now - 1000, now), now - 1000);
  assert.equal(validators.normalizeUsername("  Reader.One "), "reader.one");
  assert.equal(validators.normalizeUsername("a!"), null);
});

test("readJson enforces content type and a small body limit", async () => {
  await assert.rejects(
    validators.readJson(request("/api/v1/me", {
      method: "PATCH",
      headers: { "content-type": "text/plain" },
      body: "{}",
    })),
    (error) => error.status === 415,
  );
  const big = { displayName: "x".repeat(30_000) };
  await assert.rejects(
    validators.readJson(request("/api/v1/me", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(big),
    })),
    (error) => error.status === 413,
  );
});

test("merge precedence keeps newer server state and stays idempotent", () => {
  const existingProgress = {
    mangaId: "m1", chapterId: "c1", lang: "vi", page: 8, maxPage: 8, total: 12,
    chapter: "8", title: "Server title", lastReadAt: now,
  };
  const stale = merge.mergeProgress(existingProgress, {
    mangaId: "m1", chapterId: "c1", lang: "vi", page: 3, total: 12,
    chapter: "3", title: "Old title", ts: now - 5000,
  });
  assert.equal(stale.changed, false);
  assert.equal(stale.value.page, 8);
  const newer = merge.mergeProgress(existingProgress, {
    mangaId: "m1", chapterId: "c1", lang: "vi", page: 5, total: 12,
    chapter: "5", title: "Local title", ts: now + 5000,
  });
  assert.equal(newer.changed, true);
  assert.equal(newer.value.page, 5);
  assert.equal(newer.value.maxPage, 8, "max observed page never regresses");
  const library = merge.mergeLibrary(
    { mangaId: "m1", title: "Server", coverFile: null, lang: "vi", status: "completed", followedAt: now, lastChapterId: "c9", lastReadPublish: 9 },
    { mangaId: "m1", title: "Local", coverFile: "x.jpg", lang: "en", status: "reading", followedAt: now - 1000, lastChapterId: "c1", lastReadPublish: 1 },
  );
  assert.equal(library.changed, false);
  assert.equal(library.value.status, "completed");
});

test("real SDK session identity is opaque and never derived from client fields", () => {
  const resolved = identityFromSession(fixtureSession);
  assert.equal(resolved.id, "google|opaque-42");
  assert.equal(resolved.emailVerified, true);
  assert.equal(validators.roleFromVerifiedAllowlist({
    ...resolved, emailVerified: false,
  }, ["reader@example.com"]), null);
  assert.equal(validators.roleFromVerifiedAllowlist(resolved, ["reader@example.com"]), "admin");
  assert.equal(validators.roleFromVerifiedAllowlist(resolved, []), null);
  assert.equal(validators.roleFromVerifiedAllowlist(resolved, ["other@example.com"]), null);
});

test("library rows are unique per user and ownership never crosses accounts", async () => {
  const { pg, db } = await migratedDb();
  try {
    const alice = api(db, identity("opaque|alice"));
    const bob = api(db, identity("opaque|bob"));
    const put = () => api(db, identity("opaque|alice")).libraryPut(
      request("/api/v1/me/library/m1", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "One", lang: "vi", status: "reading", coverFile: null }),
      }),
      { mangaId: "m1" },
    );
    assert.equal((await put()).status, 200);
    assert.equal((await put()).status, 200);
    const rows = await db.select().from(schema.libraryEntries);
    assert.equal(rows.length, 1);

    const aliceList = await alice.libraryGet(request("/api/v1/me/library"));
    const aliceBody = await aliceList.json();
    assert.equal(aliceBody.items.length, 1);
    const bobList = await bob.libraryGet(request("/api/v1/me/library"));
    assert.equal((await bobList.json()).items.length, 0);

    const bobDelete = await bob.libraryDelete(request("/api/v1/me/library/m1", { method: "DELETE" }), { mangaId: "m1" });
    assert.equal(bobDelete.status, 404);
    assert.equal((await db.select().from(schema.libraryEntries)).length, 1);
    assert.equal((await alice.libraryDelete(request("/api/v1/me/library/m1", { method: "DELETE" }), { mangaId: "m1" })).status, 200);
    assert.equal((await db.select().from(schema.libraryEntries)).length, 0);
  } finally {
    await pg.close();
  }
});

test("profile validation rejects mass assignment, overlong names and duplicate usernames", async () => {
  const { pg, db } = await migratedDb();
  try {
    const alice = api(db, identity("opaque|alice"));
    const bob = api(db, identity("opaque|bob"));
    assert.equal((await alice.meGet(request("/api/v1/me"))).status, 200);
    const patch = async (handle, body) => handle.mePatch(request("/api/v1/me", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }));

    assert.equal((await patch(alice, { role: "admin", totalXp: 9999, userId: "opaque|bob" })).status, 400);
    assert.equal((await patch(alice, { displayName: "x".repeat(100) })).status, 400);
    assert.equal((await patch(alice, { avatarUrl: "http://evil.example/a.png" })).status, 400);
    assert.equal((await patch(alice, { username: "Reader.One", displayName: "Reader One", avatarUrl: "https://cdn.example/a.png" })).status, 200);

    const duplicate = await patch(bob, { username: "reader.one" });
    assert.equal(duplicate.status, 409);
    assert.equal((await duplicate.json()).error.code, "USERNAME_TAKEN");

    const profile = await db.select().from(schema.profiles).where(eq(schema.profiles.userId, "opaque|alice"));
    assert.equal(profile[0].username, "reader.one");
    assert.equal(profile[0].totalXp, 0);
    assert.equal((await db.select().from(schema.userRoles)).length, 0);
  } finally {
    await pg.close();
  }
});

test("role bootstrap requires verified email and explicit operator allowlist", async () => {
  const { pg, db } = await migratedDb();
  try {
    const unverified = api(db, identity("opaque|unverified", { emailVerified: false }), { allowlist: ["reader@example.com"] });
    await unverified.meGet(request("/api/v1/me"));
    assert.equal((await db.select().from(schema.userRoles)).length, 0);
    const verified = api(db, identity("opaque|verified"), { allowlist: ["reader@example.com"] });
    await verified.meGet(request("/api/v1/me"));
    const roles = await db.select().from(schema.userRoles);
    assert.deepEqual(roles.map((row) => [row.userId, row.role]), [["opaque|verified", "admin"]]);
  } finally {
    await pg.close();
  }
});

test("guest import preserves newer server state, is idempotent and grants no XP", async () => {
  const { pg, db } = await migratedDb();
  try {
    const handle = api(db);
    await service.ensureProfile(db, identity(), { now, allowlist: [] });
    await service.putProgress(db, identity().id, "c1", {
      mangaId: "m1", chapterId: "c1", lang: "vi", page: 8, total: 12, chapter: "8", title: "Server",
    }, now);
    await service.putProgress(db, identity().id, "c4", {
      mangaId: "m1", chapterId: "c4", lang: "vi", page: 1, total: 10, chapter: "1", title: "Old server",
    }, now - DAY);
    const payload = {
      library: [{ mangaId: "m1", title: "Local", lang: "vi", coverFile: null, followedAt: now - DAY }],
      history: [
        { mangaId: "m1", chapterId: "c1", lang: "vi", page: 3, total: 12, chapter: "3", title: "Old", ts: now - 1000 },
        { mangaId: "m1", chapterId: "c2", lang: "vi", page: 4, total: 10, chapter: "4", title: "New", ts: now + 1000 },
        { mangaId: "m1", chapterId: "c4", lang: "vi", page: 6, total: 10, chapter: "6", title: "Local newer", ts: now + 1000 },
      ],
      settings: { mode: "horizontal", fit: false, bg: "dark", speed: 5 },
    };
    const send = () => handle.importPost(request("/api/v1/me/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }));
    const first = await send();
    assert.equal(first.status, 200);
    const summary = await first.json();
    assert.equal(summary.progressUpdated, 1);
    assert.equal(summary.progressInserted, 1);
    assert.equal(summary.libraryInserted, 1);
    assert.equal(summary.settingsApplied, true);

    const progress = await db.select().from(schema.chapterProgress).orderBy(schema.chapterProgress.chapterId);
    assert.equal(progress[0].page, 8, "newer server progress must win");
    assert.equal(progress[1].page, 4);
    assert.equal(progress[2].page, 6, "newer local progress wins");
    assert.equal(progress[2].maxPage, 6);
    const second = await send();
    assert.equal(second.status, 200);
    const repeat = await second.json();
    assert.equal(repeat.libraryInserted, 0);
    assert.equal(repeat.progressInserted, 0);
    assert.equal(repeat.progressUpdated, 0);
    assert.equal((await db.select().from(schema.chapterProgress)).length, 3);

    const profile = await db.select().from(schema.profiles);
    assert.equal(profile[0].totalXp, 0, "import never awards XP");
    assert.equal((await db.select().from(schema.userRoles)).length, 0, "import never grants roles");
  } finally {
    await pg.close();
  }
});

test("corrupt local payload is skipped safely and privileged fields are rejected", async () => {
  const { pg, db } = await migratedDb();
  try {
    const handle = api(db);
    const post = (body) => handle.importPost(request("/api/v1/me/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }));
    const corrupt = await post({ library: [null, "garbage", { mangaId: "m2", title: "Two", lang: "vi", coverFile: null, followedAt: now }], history: [], settings: {} });
    assert.equal(corrupt.status, 200);
    assert.equal((await corrupt.json()).skipped, 2);
    assert.equal((await db.select().from(schema.libraryEntries)).length, 1);

    const privileged = await post({ library: [], history: [], settings: {}, totalXp: 5000, completedChapters: ["c1"] });
    assert.equal(privileged.status, 400);
    assert.equal((await db.select().from(schema.profiles))[0].totalXp, 0);
    assert.equal((await post({ history: "not-an-array" })).status, 400);
  } finally {
    await pg.close();
  }
});

test("stale writes never regress observed progress; rereads can move backward", async () => {
  const { pg, db } = await migratedDb();
  try {
    const handle = api(db);
    const put = (page) => handle.progressPut(request("/api/v1/me/progress/c1", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mangaId: "m1", lang: "vi", page, total: 12, chapter: "8", title: "Eight" }),
    }), { chapterId: "c1" });
    assert.equal((await put(8)).status, 200);
    const stale = await service.putProgress(db, identity().id, "c1", {
      mangaId: "m1", chapterId: "c1", lang: "vi", page: 2, total: 12, chapter: "2", title: "Two",
    }, now - DAY);
    assert.equal(stale.page, 2, "current page may move backward for a reread");
    assert.equal(stale.maxPage, 8, "maximum observed page is monotone");
    assert.ok(stale.lastReadAt >= now, "server-owned timestamp cannot regress");
  } finally {
    await pg.close();
  }
});

test("requests require authentication and account reads are private no-store", async () => {
  const { pg, db } = await migratedDb();
  try {
    const handler = createMeApi({
      db,
      identity: async () => null,
      now: () => now,
      allowlist: [],
    });
    const res = await handler.meGet(request("/api/v1/me"));
    assert.equal(res.status, 401);
    assert.equal((await res.json()).error.code, "UNAUTHENTICATED");

    const authed = await api(db).meGet(request("/api/v1/me"));
    assert.equal(authed.headers.get("cache-control"), "private, no-store");
    assert.match(authed.headers.get("vary") ?? "", /cookie/i);
  } finally {
    await pg.close();
  }
});

test("cross-origin mutations are rejected before any database write", async () => {
  const { pg, db } = await migratedDb();
  try {
    const handle = api(db);
    const res = await handle.settingsPut(request("/api/v1/me/settings", {
      method: "PUT",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: JSON.stringify({ mode: "horizontal", fit: true, bg: "dark", speed: 5 }),
    }));
    assert.equal(res.status, 403);
    assert.equal((await db.select().from(schema.readerPreferences)).length, 0);
  } finally {
    await pg.close();
  }
});

test("level is an explicit zero-XP placeholder and settings persist", async () => {
  const { pg, db } = await migratedDb();
  try {
    const handle = api(db);
    const levelRes = await handle.levelGet(request("/api/v1/me/level"));
    const level = await levelRes.json();
    assert.equal(level.level, 1);
    assert.equal(level.totalXp, 0);
    assert.equal(level.source, "placeholder");

    const put = await handle.settingsPut(request("/api/v1/me/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "horizontal", fit: false, bg: "sepia", speed: 4 }),
    }));
    assert.equal(put.status, 200);
    const get = await handle.settingsGet(request("/api/v1/me/settings"));
    assert.deepEqual(await get.json(), { mode: "horizontal", fit: false, bg: "sepia", speed: 4 });
  } finally {
    await pg.close();
  }
});

test("database failures do not leave partial account writes", async () => {
  const { pg, db } = await migratedDb();
  try {
    const handle = api({
      ...db,
      transaction: async (fn) => {
        try {
          return await db.transaction(async (tx) => {
            await fn(tx);
            throw new Error("forced database failure");
          });
        } finally {
          // The inner transaction rolls back; rethrow is expected below.
        }
      },
    });
    const res = await handle.importPost(request("/api/v1/me/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        library: [{ mangaId: "m3", title: "Three", lang: "vi", coverFile: null, followedAt: now }],
        history: [],
        settings: {},
      }),
    }));
    assert.equal(res.status, 500);
    assert.equal((await db.select().from(schema.libraryEntries)).length, 0);
  } finally {
    await pg.close();
  }
});
