import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { freePort, repoDir, startHttpServer, startNext, stop, webDir } from "./test-helpers.mjs";

// End-to-end for Task 7 chapter notifications: real Axum content handler, real
// Next typed client through the proxy, real SQL migrations/cursor in PGlite.
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

async function migratedDb() {
  const pg = new PGlite();
  const db = drizzle(pg, { schema });
  for (const file of [
    "0000_application.sql", "0001_account_data.sql",
    "0002_comments_moderation.sql", "0003_community_cursor_scrub.sql",
    "0004_notification_feed_cursor.sql",
  ]) {
    try {
      await pg.exec(await readFile(fileURLToPath(new URL(`../drizzle/${file}`, import.meta.url)), "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return { pg, db };
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
      items = [...items].sort((a, b) => {
        const published = Date.parse(a.attributes.publishAt) - Date.parse(b.attributes.publishAt);
        return order === "desc" ? -published : published;
      });
      return json(res, { total: items.length, data: items.slice(offset, offset + limit) });
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
