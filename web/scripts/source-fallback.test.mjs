import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { freePort, repoDir, startHttpServer, startNext, stop, webDir } from "./test-helpers.mjs";

// Real Axum process + loopback MangaDex/Comick fixtures. No remote calls, auth,
// database, or deployment configuration is involved.
const MANGA = {
  external: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  readable: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  error: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  noMatch: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
};
const TITLES = {
  [MANGA.external]: "Fallback Manga",
  [MANGA.readable]: "Readable Manga",
  [MANGA.error]: "Error Manga",
  [MANGA.noMatch]: "No Match Manga",
};
const EXTERNAL_URL = "https://example.com/external-chapter";

let mangadexFixture;
let comickFixture;
let axum;
let axumUrl;
let app;
let comickRequests = [];
let lastSearchTitle = "";
let comickBlocked = false;

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

function mdChapter(id, chapter, pages, externalUrl) {
  return {
    id,
    attributes: {
      chapter,
      pages,
      externalUrl,
      translatedLanguage: "vi",
      readableAt: "2026-11-21T00:00:00Z",
    },
    relationships: [{ type: "manga", id }],
  };
}

function comickChapter(hid, chapter, lang = "vi") {
  return {
    hid,
    chapter,
    lang,
    title: `Fallback ${chapter}`,
    published_at: "2026-11-21T00:00:00Z",
    groups: [{ title: "Fallback Group" }],
  };
}

async function get(path) {
  const response = await fetch(`${axumUrl}${path}`);
  return { response, body: await response.json() };
}

before(async () => {
  mangadexFixture = await startHttpServer((req, res) => {
    const url = new URL(req.url ?? "", "http://fixture.local");
    if (url.pathname.startsWith("/statistics/manga")) return json(res, { statistics: {} });
    if (url.pathname.startsWith("/manga/") && url.pathname.endsWith("/feed")) {
      const id = url.pathname.split("/")[2];
      if (url.searchParams.get("translatedLanguage[]") !== "vi") return json(res, { total: 0, data: [] });
      if (id === MANGA.external) {
        return json(res, { total: 1, data: [mdChapter(
          "11111111-1111-4111-8111-111111111111", "10.1", 0, EXTERNAL_URL,
        )] });
      }
      if (id === MANGA.readable) {
        return json(res, { total: 1, data: [mdChapter(
          "22222222-2222-4222-8222-222222222222", "10.1", 12, null,
        )] });
      }
      if (id === MANGA.error) {
        return json(res, { total: 1, data: [mdChapter(
          "33333333-3333-4333-8333-333333333333", "10.1", 0, EXTERNAL_URL,
        )] });
      }
      if (id === MANGA.noMatch) {
        return json(res, { total: 1, data: [mdChapter(
          "44444444-4444-4444-8444-444444444444", "10.1", 0, EXTERNAL_URL,
        )] });
      }
      return json(res, { total: 0, data: [] });
    }
    if (url.pathname.startsWith("/manga/")) {
      const id = url.pathname.split("/")[2];
      const title = TITLES[id] ?? "Fixture Manga";
      return json(res, { data: {
        id,
        attributes: { title: { vi: title }, status: "ongoing", description: { vi: title } },
        relationships: [],
      } });
    }
    if (url.pathname === "/at-home/server/22222222-2222-4222-8222-222222222222") {
      return json(res, { baseUrl: "https://uploads.mangadex.org", chapter: { hash: "abc", data: ["1.png"], dataSaver: [] } });
    }
    return json(res, { total: 0, data: [] });
  });

  comickFixture = await startHttpServer((req, res) => {
    const url = new URL(req.url ?? "", "http://fixture.local");
    comickRequests.push(url.pathname + url.search);
    if (url.pathname === "/v1.0/search/") {
      const title = url.searchParams.get("q") ?? "";
      lastSearchTitle = title;
      if (title.includes("Error")) return json(res, "upstream failure", 500);
      if (comickBlocked) {
        return json(res, [{ hid: "blocked-1", slug: "blocked-title", title: "Blocked Comic", md_titles: [] }]);
      }
      return json(res, [{ hid: "comic-1", title, md_titles: [] }]);
    }
    if (url.pathname.endsWith("/chapters")) {
      if (comickBlocked) return json(res, "cloudflare challenge", 403);
      if (lastSearchTitle.includes("Error")) return json(res, "upstream failure", 500);
      const number = lastSearchTitle.includes("No Match") ? "99" : "10.1";
      return json(res, { chapters: [comickChapter("chap-101", number)], total: 1, limit: 12 });
    }
    if (url.pathname.startsWith("/chapter/") && url.pathname.endsWith("/get_images")) {
      return json(res, [{ b2key: "page-1.jpg" }, { b2key: "page-2.jpg" }]);
    }
    return json(res, [], 404);
  });

  const port = await freePort();
  axumUrl = `http://127.0.0.1:${port}`;
  const binary = join(repoDir, "target", "debug", process.platform === "win32" ? "server.exe" : "server");
  assert.ok(existsSync(binary), `build Axum first: cargo build -p server (missing ${binary})`);
  const cacheDir = join(webDir, ".test-cache", `source-fallback-${process.pid}`);
  mkdirSync(cacheDir, { recursive: true });
  axum = spawn(binary, [], {
    cwd: repoDir,
    env: {
      ...process.env,
      PORT: String(port),
      MANGADEX_API_ORIGIN: mangadexFixture.baseUrl,
      COMICK_API_ORIGIN: comickFixture.baseUrl,
      CACHE_DIR: cacheDir,
      DIST_DIR: join(webDir, "public"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForTcp(port);
  app = await startNext({ RUST_CONTENT_API_ORIGIN: axumUrl });
});

after(async () => {
  await stop(app?.child);
  if (axum && axum.exitCode === null) axum.kill("SIGKILL");
  await mangadexFixture?.close();
  await comickFixture?.close();
});

test("external MangaDex chapter falls back to a readable Comick chapter", async () => {
  const { response, body } = await get(`/api/content/manga/${MANGA.external}/chapters`);
  assert.equal(response.status, 200);
  const chapter = body.vi[0];
  assert.equal(chapter.id, "comick:chap-101");
  assert.equal(chapter.source, "comick");
  assert.equal(chapter.source_label, "Comick");
  assert.equal(chapter.readable, true);
  assert.equal(chapter.external_url, null);
  assert.equal(chapter.pages, 2);
  const decoded = comickRequests.map((value) => decodeURIComponent(value));
  assert.ok(
    decoded.includes("/v1.0/comic/comic-1/chapters?lang=vi&page=1&limit=12"),
    `Comick chapter request did not strip the comick: prefix: ${JSON.stringify(decoded)}`,
  );
});

test("readable MangaDex chapter is never handed to Comick", async () => {
  const before = comickRequests.length;
  const { response, body } = await get(`/api/content/manga/${MANGA.readable}/chapters`);
  assert.equal(response.status, 200);
  assert.equal(body.vi[0].id, "22222222-2222-4222-8222-222222222222");
  assert.equal(body.vi[0].source, "mangadex");
  assert.equal(body.vi[0].readable, true);
  assert.equal(comickRequests.length, before);
});

test("Comick upstream failure keeps the MangaDex external link", async () => {
  const { response, body } = await get(`/api/content/manga/${MANGA.error}/chapters`);
  assert.equal(response.status, 200);
  const chapter = body.vi[0];
  assert.equal(chapter.id, "33333333-3333-4333-8333-333333333333");
  assert.equal(chapter.source, "mangadex");
  assert.equal(chapter.external_url, EXTERNAL_URL);
  assert.equal(chapter.pages, 0);
});

test("no confident chapter match keeps the original external chapter", async () => {
  const { response, body } = await get(`/api/content/manga/${MANGA.noMatch}/chapters`);
  assert.equal(response.status, 200);
  const chapter = body.vi[0];
  assert.equal(chapter.id, "44444444-4444-4444-8444-444444444444");
  assert.equal(chapter.source, "mangadex");
  assert.equal(chapter.external_url, EXTERNAL_URL);
});

test("Comick pages are same-origin proxies built from returned page URLs", async () => {
  const before = comickRequests.length;
  const { response, body } = await get(`/api/content/chapter/${encodeURIComponent("comick:chap-101")}/pages`);
  assert.equal(response.status, 200);
  assert.equal(body.pages.length, 2);
  assert.ok(body.pages.every((page) => page.startsWith("/api/content/img?u=")), JSON.stringify(body.pages));
  assert.equal(new URL(body.pages[0], axumUrl).searchParams.get("u"), "https://meo.comick.pictures/page-1.jpg");
  assert.equal(new URL(body.pages[1], axumUrl).searchParams.get("u"), "https://meo.comick.pictures/page-2.jpg");
  const decoded = comickRequests.slice(before).map((value) => decodeURIComponent(value));
  assert.ok(
    decoded.includes("/chapter/chap-101/get_images"),
    `Comick image request did not strip the comick: prefix: ${JSON.stringify(decoded)}`,
  );
});

test("legacy chapter pages alias dispatches source-aware IDs too", async () => {
  const { response, body } = await get(`/api/chapter/${encodeURIComponent("comick:chap-101")}/pages`);
  assert.equal(response.status, 200);
  assert.equal(body.pages.length, 2);
});

test("malformed comick chapter ID is a structured 400 before any upstream call", async () => {
  const before = comickRequests.length;
  const { response, body } = await get(`/api/content/chapter/${encodeURIComponent("comick:")}/pages`);
  assert.equal(response.status, 400);
  assert.equal(body.error.code, "VALIDATION_ERROR");
  assert.equal(comickRequests.length, before);
});

test("blocked Comick detail uses cached search hit and chapters degrade with a notice", async () => {
  comickBlocked = true;
  try {
    const searched = await get("/api/content/search?q=Blocked&source=comick&page=1");
    assert.equal(searched.response.status, 200);
    assert.ok(searched.body.results.some((manga) => manga.id === "comick:blocked-1"));

    const detail = await get("/api/content/manga/comick%3Ablocked-1");
    assert.equal(detail.response.status, 200);
    assert.equal(detail.body.title, "Blocked Comic");
    assert.equal(detail.body.source_url, "https://comick.dev/comic/blocked-title");

    const chapters = await get("/api/content/manga/comick%3Ablocked-1/chapters");
    assert.equal(chapters.response.status, 200);
    assert.equal(chapters.body.vi.length, 0);
    assert.match(chapters.body.notice, /Comick/i);
  } finally {
    comickBlocked = false;
  }
});

test("Next manga route renders an encoded Comick ID without double encoding", async () => {
  comickBlocked = true;
  try {
    await get("/api/content/search?q=Blocked&source=comick&page=1");
    const response = await fetch(`${app.baseUrl}/manga/${encodeURIComponent("comick:blocked-1")}`);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.ok(html.includes("Blocked Comic"), "encoded provider ID must reach the cached detail");
    assert.ok(html.includes('class="manga-title"'), "encoded provider ID must render the manga page");
    assert.ok(html.includes("source-notice"), "blocked chapters need the explanatory notice");
  } finally {
    comickBlocked = false;
  }
});
