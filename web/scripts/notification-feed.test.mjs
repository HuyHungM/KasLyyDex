import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { localD1 } from "./sqlite-harness.mjs";
import { drizzle } from "drizzle-orm/d1";
import { freePort, repoDir, startHttpServer, startNext, stop, webDir } from "./test-helpers.mjs";

// End-to-end for Task 7 chapter notifications: real Axum content handler, real
// Next typed client through the proxy, real SQL migrations/cursor in SQLite.
// The MangaDex origin is a deterministic loopback fixture with >2000 chapters.
const MANGA_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BASE = Date.parse("2026-07-01T00:00:00.000Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const PAGE = 100;

const { createContentClient } = await import("../lib/contracts.ts");
const { createCommunityApi } = await import("../lib/community/handlers.ts");
const schema = await import("../lib/db/schema.ts");

let upstream;
let axum;
let next;
let client;
let requests = [];
let chapters = [];
let offsetWall = false;

function waitForTcp(port, deadlineMs = 20_000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + deadlineMs;
    const attempt = () => {
      const socket = connect({ host: "127.0.0.1", port });
      socket.once("connect", () => { socket.destroy(); resolve(); });
      socket.once("error", (error) => {
        socket.destroy();
        if (Date.now() > deadline) reject(error);
        else setTimeout(attempt, 100);
      });
    };
    attempt();
  });
}

function json(res, body, status = 200) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function makeChapter(index, published) {
  const when = new Date(published).toISOString();
  return {
    id: `chapter-${String(index).padStart(5, "0")}`,
    attributes: {
      chapter: String(index),
      title: `Chapter ${index}`,
      pages: 1,
      // Deliberately different from publishAt: notifications must order by publishAt.
      readableAt: new Date(published + HOUR).toISOString(),
      publishAt: when,
      translatedLanguage: "vi",
      externalUrl: null,
    },
    relationships: [{ type: "manga", id: MANGA_ID }],
  };
}

const MIGRATIONS = ["0000_cloudflare_d1.sql", "0001_profile_bio.sql"];

async function migratedDb(files = MIGRATIONS) {
  const pg = localD1();
  const db = drizzle(pg, { schema });
  for (const file of files) {
    try {
      await pg.exec(await readFile(fileURLToPath(new URL(`../migrations/${file}`, import.meta.url)), "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return { pg, db };
}

async function seedReader(db, cursor = null) {
  await db.insert(schema.profiles).values({ userId: "opaque|reader" }).onConflictDoNothing();
  await db.insert(schema.libraryEntries).values({
    userId: "opaque|reader", mangaId: MANGA_ID, title: "Fixture", lang: "vi", status: "reading",
    followedAt: BASE, lastReadPublish: 0, revision: 1,
  }).onConflictDoNothing();
  if (cursor) await db.insert(schema.notificationCursors).values(cursor);
}

function cursorAt(publish, id = "", offset = 0) {
  return {
    userId: "opaque|reader", mangaId: MANGA_ID, language: "vi",
    lastPublish: publish, lastChapterId: id, scanPublish: publish, scanOffset: offset,
  };
}

function tied(id, publish, index) {
  const chapter = makeChapter(index, publish);
  return { ...chapter, id };
}

async function drain(db, limit = 60) {
  for (let attempt = 0; attempt < limit; attempt += 1) {
    const response = await handle(db).notificationsRefreshPost(jsonRequest("/api/v1/notifications/refresh", "POST", {}));
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    const notes = await db.select().from(schema.notifications);
    if (body.created === 0 && notes.length > 0) break;
  }
  return db.select().from(schema.notifications);
}

function request(path, init = {}) {
  return new Request(`http://localhost${path}`, {
    ...init,
    headers: { origin: "http://localhost", ...(init.headers ?? {}) },
  });
}

function jsonRequest(path, method, body) {
  return request(path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function handle(db, now = BASE + 200 * DAY) {
  return createCommunityApi({
    db: () => db,
    identity: async () => ({ id: "opaque|reader", email: "reader@example.com", emailVerified: true, name: "Reader", image: null, sessionId: "s" }),
    now: () => now,
    allowlist: [],
    content: async () => client,
  });
}

before(async () => {
  chapters = Array.from({ length: 2500 }, (_, index) => makeChapter(index + 1, BASE + index * HOUR));
  upstream = await startHttpServer((req, res) => {
    const url = new URL(req.url ?? "", "http://fixture.local");
    requests.push(url.pathname + url.search);
    if (url.pathname === `/manga/${MANGA_ID}/feed`) {
      const limit = Number(url.searchParams.get("limit") ?? 500);
      const offset = Number(url.searchParams.get("offset") ?? 0);
      return json(res, { total: chapters.length, data: chapters.slice(offset, offset + Math.min(limit, 500)) });
    }
    if (url.pathname === "/chapter") {
      const lang = url.searchParams.get("translatedLanguage[]");
      const manga = url.searchParams.get("manga");
      const limit = Number(url.searchParams.get("limit") ?? PAGE);
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const since = url.searchParams.get("publishAtSince");
      const order = url.searchParams.get("order[publishAt]");
      if (manga !== MANGA_ID || lang !== "vi" || !["asc", "desc"].includes(order ?? "")) {
        return json(res, { total: 0, data: [] }, 400);
      }
      let items = chapters;
      if (since) items = items.filter((item) => Date.parse(item.attributes.publishAt) > Date.parse(since));
      // Stable sort: equal publish timestamps preserve fixture insertion order.
      items = [...items].sort((a, b) => {
        const published = Date.parse(a.attributes.publishAt) - Date.parse(b.attributes.publishAt);
        return order === "desc" ? -published : published;
      });
      const total = offsetWall ? 12_000 : items.length;
      return json(res, { total, data: items.slice(offset, offset + limit) });
    }
    return json(res, { total: 0, data: [] });
  });

  const axumPort = await freePort();
  const binary = join(repoDir, "target", "debug", process.platform === "win32" ? "server.exe" : "server");
  assert.ok(existsSync(binary), `build Axum first: cargo build -p server (missing ${binary})`);
  axum = spawn(binary, [], {
    cwd: repoDir,
    env: {
      ...process.env,
      PORT: String(axumPort),
      MANGADEX_API_ORIGIN: upstream.baseUrl,
      CACHE_DIR: join(webDir, ".test-cache", `notification-feed-${process.pid}`),
      DIST_DIR: join(webDir, "public"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForTcp(axumPort);
  next = await startNext({ RUST_CONTENT_API_ORIGIN: `http://127.0.0.1:${axumPort}` });
  client = createContentClient(next.baseUrl);
});

after(async () => {
  await stop(next?.child);
  if (axum && axum.exitCode === null) axum.kill("SIGKILL");
  await upstream?.close();
});

test("ordinary chapter listing still uses the capped catalog feed contract", async () => {
  const response = await client.chapters(MANGA_ID);
  assert.equal(response.vi.length, 2000, "legacy list stays capped at 2000");
  const feedCalls = requests.filter((value) => {
    const url = new URL(value, "http://fixture.local");
    return url.pathname.endsWith("/feed")
      && url.searchParams.get("order[chapter]") === "asc"
      && url.searchParams.get("translatedLanguage[]") === "vi";
  });
  assert.deepEqual(
    feedCalls.map((value) => new URL(value, "http://fixture.local").searchParams.get("offset")),
    ["0", "500", "1000", "1500"],
  );
});

test("baseline observes the newest chapter beyond 2000 without an archive flood", async () => {
  const { pg, db } = await migratedDb();
  try {
    await db.insert(schema.profiles).values({ userId: "opaque|reader" });
    await db.insert(schema.libraryEntries).values({
      userId: "opaque|reader", mangaId: MANGA_ID, title: "Fixture", lang: "vi", status: "reading",
      followedAt: BASE, lastReadPublish: 0, revision: 1,
    });
    const response = await handle(db).notificationsRefreshPost(
      jsonRequest("/api/v1/notifications/refresh", "POST", {}));
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.created, 0);
    assert.equal(body.checked, 1, `refresh did not scan the library: ${JSON.stringify(body)}`);
    const cursors = await db.select().from(schema.notificationCursors);
    assert.ok(cursors.length > 0, `no cursor; requests=${JSON.stringify(requests.slice(-10))}`);
    assert.equal(cursors[0].lastPublish, BASE + 2499 * HOUR, "baseline uses latest available publication, not the first 2000");
    const feedCalls = requests.filter((value) => value.includes("/chapter?") && value.includes("order[publishAt]=desc"));
    assert.ok(feedCalls.length > 0, "baseline must query the notification feed in descending publish order");
    assert.match(feedCalls[0], /manga=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/);
    assert.match(feedCalls[0], /translatedLanguage\[\]=vi/);
  } finally {
    await pg.close();
  }
});

test("a chapter published after the cursor is delivered once despite catalog size", async () => {
  const { pg, db } = await migratedDb();
  try {
    await db.insert(schema.profiles).values({ userId: "opaque|reader" });
    await db.insert(schema.libraryEntries).values({
      userId: "opaque|reader", mangaId: MANGA_ID, title: "Fixture", lang: "vi", status: "reading",
      followedAt: BASE, lastReadPublish: 0, revision: 1,
    });
    await handle(db).notificationsRefreshPost(jsonRequest("/api/v1/notifications/refresh", "POST", {}));
    chapters.push(makeChapter(2501, BASE + 2500 * HOUR));
    const first = await handle(db).notificationsRefreshPost(jsonRequest("/api/v1/notifications/refresh", "POST", {}));
    assert.equal((await first.json()).created, 1);
    const notes = await db.select().from(schema.notifications);
    assert.equal(notes.length, 1);
    assert.match(notes[0].eventKey, /chapter-02501/);
    const again = await handle(db).notificationsRefreshPost(jsonRequest("/api/v1/notifications/refresh", "POST", {}));
    assert.equal((await again.json()).created, 0, "repeat refresh dedupes");
    const asc = requests.filter((value) => value.includes("/chapter?") && value.includes("order[publishAt]=asc"));
    assert.ok(asc.some((value) => new URL(value, "http://fixture.local").searchParams.get("publishAtSince")));
    chapters.pop();
  } finally {
    await pg.close();
  }
});

test("same-timestamp backlog crossing a page edge drains exactly once", async () => {
  const { pg, db } = await migratedDb();
  try {
    await db.insert(schema.profiles).values({ userId: "opaque|reader" });
    await db.insert(schema.libraryEntries).values({
      userId: "opaque|reader", mangaId: MANGA_ID, title: "Fixture", lang: "vi", status: "reading",
      followedAt: BASE, lastReadPublish: 0, revision: 1,
    });
    const tie = BASE + 150 * DAY;
    const tied = Array.from({ length: PAGE + 5 }, (_, index) => makeChapter(3000 + index, tie));
    chapters.push(...tied);
    await db.insert(schema.notificationCursors).values({
      userId: "opaque|reader", mangaId: MANGA_ID, language: "vi",
      lastPublish: BASE + 149 * DAY, lastChapterId: "", scanPublish: BASE + 149 * DAY, scanOffset: 0,
    });

    let created = 0;
    let calls = 0;
    while (calls < 60) {
      const response = await handle(db).notificationsRefreshPost(jsonRequest("/api/v1/notifications/refresh", "POST", {}));
      const body = await response.json();
      created += body.created;
      calls += 1;
      if (body.created === 0 && (await db.select().from(schema.notifications)).length === tied.length) break;
    }
    const notes = await db.select().from(schema.notifications);
    assert.equal(notes.length, tied.length, "all same-time chapters arrive across repeat refreshes");
    assert.equal(created, tied.length, "each chapter is created exactly once");
    assert.equal(new Set(notes.map((item) => item.eventKey)).size, tied.length);
    chapters.splice(chapters.length - tied.length, tied.length);
  } finally {
    await pg.close();
  }
});

test("reviewer counterexample: reverse equal-time ids are all emitted exactly once", async () => {
  const original = chapters;
  const tie = BASE + 145 * DAY;
  try {
    chapters = ["z", "y", "x", "w", "v"].map((suffix, index) => tied(`tie-${suffix}`, tie, 6000 + index));
    const { pg, db } = await migratedDb();
    try {
      await seedReader(db, cursorAt(tie - 1000));
      const notes = await drain(db, 12);
      assert.equal(notes.length, 5, "no tied id may be lost behind a local-rank offset");
      assert.equal(new Set(notes.map((item) => item.eventKey)).size, 5);
      assert.match(notes[0].body, /Chương|Chapter/, "notification body stays readable, not an opaque id");
    } finally {
      await pg.close();
    }
  } finally {
    chapters = original;
  }
});

test("shuffled equal-time backlog crossing the page edge drains exactly once", async () => {
  const original = chapters;
  const tie = BASE + 146 * DAY;
  try {
    const ids = Array.from({ length: 105 }, (_, index) => `tie-${String(index).padStart(3, "0")}`).reverse();
    chapters = ids.map((id, index) => tied(id, tie, 7000 + index));
    const { pg, db } = await migratedDb();
    try {
      await seedReader(db, cursorAt(tie - 1000));
      const notes = await drain(db, 80);
      assert.equal(notes.length, 105);
      assert.equal(new Set(notes.map((item) => item.eventKey)).size, 105, "no duplicate notifications across replayed pages");
    } finally {
      await pg.close();
    }
  } finally {
    chapters = original;
  }
});

test("a tied row inserted between upstream pages is reconciled, not skipped", async () => {
  const original = chapters;
  const tie = BASE + 147 * DAY;
  try {
    chapters = Array.from({ length: 102 }, (_, index) => tied(`tie-${String(index).padStart(3, "0")}`, tie, 8000 + index)).reverse();
    const { pg, db } = await migratedDb();
    try {
      await seedReader(db, cursorAt(tie - 1000));
      const first = await handle(db).notificationsRefreshPost(jsonRequest("/api/v1/notifications/refresh", "POST", {}));
      assert.equal((await first.json()).created, 3);
      chapters.splice(50, 0, tied("tie-new", tie, 9999));
      const notes = await drain(db, 80);
      assert.equal(notes.length, 103, "a row inserted between pages must still be observed");
      assert.ok(notes.some((item) => item.eventKey.includes("tie-new")));
      assert.equal(new Set(notes.map((item) => item.eventKey)).size, 103);
    } finally {
      await pg.close();
    }
  } finally {
    chapters = original;
  }
});

test("future publish candidates stay revisitable until they are eligible", async () => {
  const original = chapters;
  const future = BASE + 220 * DAY;
  try {
    chapters = [tied("future-1", future, 9001)];
    const { pg, db } = await migratedDb();
    try {
      await seedReader(db, cursorAt(future - DAY));
      const early = await handle(db, BASE + 200 * DAY).notificationsRefreshPost(
        jsonRequest("/api/v1/notifications/refresh", "POST", {}));
      assert.equal((await early.json()).created, 0);
      const cursor = (await db.select().from(schema.notificationCursors))[0];
      assert.equal(cursor.lastPublish, future - DAY, "future rows cannot consume the cursor");
      const later = await handle(db, future + HOUR).notificationsRefreshPost(
        jsonRequest("/api/v1/notifications/refresh", "POST", {}));
      assert.equal((await later.json()).created, 1);
      const repeat = await handle(db, future + HOUR).notificationsRefreshPost(
        jsonRequest("/api/v1/notifications/refresh", "POST", {}));
      assert.equal((await repeat.json()).created, 0);
    } finally {
      await pg.close();
    }
  } finally {
    chapters = original;
  }
});

test("upstream 10,000 offset wall reports partial instead of silent success", async () => {
  offsetWall = true;
  try {
    const { pg, db } = await migratedDb();
    try {
      await seedReader(db, cursorAt(BASE + 100 * HOUR, "", 9900));
      const response = await handle(db).notificationsRefreshPost(jsonRequest("/api/v1/notifications/refresh", "POST", {}));
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(body.partial, true, "the UI must be told the scan is incomplete");
    } finally {
      await pg.close();
    }
  } finally {
    offsetWall = false;
  }
});

test("0005 backfill replays same-publish legacy rows without duplicate notifications", async () => {
  const original = chapters;
  const legacy = BASE + 148 * DAY;
  try {
    chapters = ["v", "w", "z"].map((suffix, index) => tied(`tie-${suffix}`, legacy, 9500 + index));
    const { pg, db } = await migratedDb();
    try {
      await seedReader(db);
      // Legacy backfill shape: the migration rewound scan_publish by one second.
      await pg.exec(`INSERT INTO notification_cursors
        (user_id, manga_id, language, last_publish, last_chapter_id, scan_publish, scan_offset)
        VALUES ('opaque|reader', '${MANGA_ID}', 'vi', ${legacy}, 'tie-v', ${legacy - 1000}, 0)`);
      await db.insert(schema.notifications).values({
        id: "legacy-v", userId: "opaque|reader", type: "new_chapter",
        eventKey: `chapter:opaque|reader:${MANGA_ID}:tie-v:vi`,
        title: "Chương mới", body: "legacy",
      });
      const notes = await drain(db, 10);
      const keys = notes.map((item) => item.eventKey);
      assert.equal(notes.length, 3);
      assert.ok(keys.some((key) => key.endsWith(":tie-w:vi")));
      assert.ok(keys.some((key) => key.endsWith(":tie-z:vi")));
      assert.equal(keys.filter((key) => key.endsWith(":tie-v:vi")).length, 1, "old row is not duplicated");
    } finally {
      await pg.close();
    }
  } finally {
    chapters = original;
  }
});

test("upstream failure leaves the continuation cursor unchanged", async () => {
  const { pg, db } = await migratedDb();
  try {
    await db.insert(schema.profiles).values({ userId: "opaque|reader" });
    await db.insert(schema.libraryEntries).values({
      userId: "opaque|reader", mangaId: MANGA_ID, title: "Fixture", lang: "vi", status: "reading",
      followedAt: BASE, lastReadPublish: 0, revision: 1,
    });
    await handle(db).notificationsRefreshPost(jsonRequest("/api/v1/notifications/refresh", "POST", {}));
    const before = (await db.select().from(schema.notificationCursors))[0];
    const failing = createCommunityApi({
      db: () => db,
      identity: async () => ({ id: "opaque|reader", email: "reader@example.com", emailVerified: true, name: "Reader", image: null, sessionId: "s" }),
      now: () => BASE + 200 * DAY,
      allowlist: [],
      content: async () => ({ notificationFeed: async () => { throw new Error("upstream down"); } }),
    });
    await failing.notificationsRefreshPost(jsonRequest("/api/v1/notifications/refresh", "POST", {}));
    const after = (await db.select().from(schema.notificationCursors))[0];
    assert.equal(after.lastPublish, before.lastPublish);
    assert.equal(after.scanOffset, before.scanOffset);
    assert.equal((await db.select().from(schema.notifications)).length, 0);
  } finally {
    await pg.close();
  }
});
