import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { freePort, repoDir, startHttpServer, webDir } from "./test-helpers.mjs";

// Real Axum process + loopback MangaDex/Comick fixtures; no auth, database,
// remote catalog, deployment or cloud configuration.
const UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TAG = "391b0423-d847-456f-aff0-8b0cfc03066b";

let mangadexFixture;
let comickFixture;
let axum;
let axumUrl;
let mdRequests = [];
let comickRequests = [];

function json(res, body, status = 200) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function mdSearchItem(id, title) {
  return {
    id,
    attributes: {
      title: { en: title },
      status: "ongoing",
      year: 2024,
      description: { en: `${title} description` },
      tags: [],
    },
    relationships: [],
  };
}

function comickHit(hid, title) {
  return {
    hid,
    title,
    desc: "modern Comick description",
    status: 1,
    year: 2024,
    genres: [30, 244],
    md_covers: [{ b2key: `${hid}-cover.jpg` }],
    bayesian_rating: "8.25",
    user_follow_count: 4242,
    last_chapter: 12,
  };
}

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

async function get(path) {
  const response = await fetch(`${axumUrl}${path}`);
  return { response, body: await response.json() };
}

async function search(params) {
  return get(`/api/content/search?${new URLSearchParams(params)}`);
}

before(async () => {
  mangadexFixture = await startHttpServer((req, res) => {
    const url = new URL(req.url ?? "", "http://fixture.local");
    mdRequests.push(url.pathname + url.search);
    if (url.pathname === "/manga") {
      const title = url.searchParams.get("title") ?? "";
      if (["md-only", "shared", "boom", "cache", "lang-vi"].includes(title)) {
        return json(res, { total: 1, data: [mdSearchItem(UUID, title)] });
      }
      return json(res, { total: 0, data: [] });
    }
    if (url.pathname.startsWith("/statistics/manga")) return json(res, { statistics: {} });
    if (url.pathname.startsWith("/chapter?")) return json(res, { total: 0, data: [] });
    if (url.pathname.startsWith("/manga/") && url.pathname.endsWith("/feed")) {
      return json(res, { total: 0, data: [] });
    }
    if (url.pathname.startsWith("/manga/")) {
      const id = url.pathname.split("/")[2];
      return json(res, { data: {
        id,
        attributes: { title: { en: "Bare UUID Manga" }, status: "ongoing", description: { en: "" } },
        relationships: [],
      } });
    }
    return json(res, { total: 0, data: [] });
  });

  comickFixture = await startHttpServer((req, res) => {
    const url = new URL(req.url ?? "", "http://fixture.local");
    comickRequests.push(url.pathname + url.search);
    const path = decodeURIComponent(url.pathname);
    if (url.pathname === "/v1.0/search/") {
      const title = url.searchParams.get("q") ?? "";
      if (title === "boom") return json(res, "upstream failure", 500);
      if (title === "md-only") return json(res, []);
      return json(res, [comickHit("comic-1", title || "Comick Browse")]);
    }
    if (path === "/v1.0/comic/comic-1/") {
      return json(res, {
        comic: {
          hid: "comic-1",
          title: "Comick Detail",
          desc: "detail description",
          status: 1,
          year: 2024,
          md_covers: [{ b2key: "detail-cover.jpg" }],
          md_comic_md_genres: [{ md_genres: { name: "Action", slug: "action" } }],
          bayesian_rating: "8.5",
          user_follow_count: 99,
          last_chapter: 3,
        },
      });
    }
    if (path === "/v1.0/comic/comic-1/chapters") {
      const lang = url.searchParams.get("lang") ?? "vi";
      return json(res, {
        chapters: [{
          hid: `chap-1-${lang}`,
          chapter: "1",
          lang,
          title: "Comick Chapter",
          published_at: "2026-11-22T00:00:00Z",
          group: "Comick Group",
        }],
        total: 1,
        limit: 12,
      });
    }
    return json(res, [], 404);
  });

  const port = await freePort();
  axumUrl = `http://127.0.0.1:${port}`;
  const binary = join(repoDir, "target", "debug", process.platform === "win32" ? "server.exe" : "server");
  assert.ok(existsSync(binary), `build Axum first: cargo build -p server (missing ${binary})`);
  const cacheDir = join(webDir, ".test-cache", `search-source-${process.pid}`);
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
});

after(async () => {
  if (axum && axum.exitCode === null) axum.kill("SIGKILL");
  await mangadexFixture?.close();
  await comickFixture?.close();
});

function mdSearchCount() {
  return mdRequests.filter((url) => url.startsWith("/manga?")).length;
}

function comickSearchCount() {
  return comickRequests.filter((url) => url.startsWith("/v1.0/search/")).length;
}

test("source=mangadex only hits MangaDex and is not partial", async () => {
  const mdBefore = mdSearchCount();
  const comickBefore = comickSearchCount();
  const { response, body } = await search({ q: "md-only", source: "mangadex" });
  assert.equal(response.status, 200);
  assert.equal(body.partial, false);
  assert.deepEqual(body.results.map((item) => item.source_label), ["MangaDex"]);
  assert.equal(mdSearchCount(), mdBefore + 1);
  assert.equal(comickSearchCount(), comickBefore);
});

test("source=comick only hits Comick and keeps modern hit fields", async () => {
  const mdBefore = mdSearchCount();
  const { response, body } = await search({ q: "comick-only", source: "comick" });
  assert.equal(response.status, 200);
  assert.equal(body.partial, false);
  assert.deepEqual(body.results.map((item) => item.source_label), ["Comick"]);
  assert.equal(body.results[0].id, "comick:comic-1");
  assert.equal(body.results[0].description, "modern Comick description");
  assert.equal(body.results[0].status, "ongoing");
  assert.deepEqual(body.results[0].tags, ["30", "244"]);
  assert.equal(body.results[0].cover_file, "https://meo.comick.pictures/comic-1-cover.jpg");
  assert.equal(mdSearchCount(), mdBefore);
});

test("source=all returns both sources with exact labels", async () => {
  const { response, body } = await search({ q: "shared", source: "all" });
  assert.equal(response.status, 200);
  assert.equal(body.partial, false);
  assert.deepEqual(body.results.map((item) => item.source_label).sort(), ["Comick", "MangaDex"]);
  assert.equal(body.total, 2);
});

test("lang=vi filters MangaDex upstream while Comick stays partial", async () => {
  const mdBefore = mdSearchCount();
  const comickBefore = comickSearchCount();
  const { response, body } = await search({ q: "lang-vi", source: "all", lang: "vi" });
  assert.equal(response.status, 200);
  assert.equal(body.partial, true);
  assert.deepEqual(body.results.map((item) => item.source_label).sort(), ["Comick", "MangaDex"]);

  const mdQuery = mdRequests.filter((url) => url.startsWith("/manga?"));
  assert.equal(mdQuery.length, mdBefore + 1);
  assert.ok(
    mdQuery.at(-1).includes("availableTranslatedLanguage[]=vi"),
    `MangaDex fixture did not receive the language filter: ${mdQuery.at(-1)}`,
  );

  const comickQuery = comickRequests.filter((url) => url.startsWith("/v1.0/search/"));
  assert.equal(comickQuery.length, comickBefore + 1);
  assert.ok(
    !comickQuery.at(-1).includes("lang="),
    `Comick must not receive an invented lang param: ${comickQuery.at(-1)}`,
  );
});

test("Comick fixture 500 keeps MangaDex results and marks partial", async () => {
  const { response, body } = await search({ q: "boom", source: "all" });
  assert.equal(response.status, 200);
  assert.equal(body.partial, true);
  assert.deepEqual(body.results.map((item) => item.source_label), ["MangaDex"]);
});

test("invalid source/lang/year/page returns structured 400", async () => {
  for (const params of [
    { source: "bad" },
    { lang: "fr" },
    { year: "1899" },
    { page: "0" },
  ]) {
    const { response, body } = await search(params);
    assert.equal(response.status, 400, JSON.stringify(params));
    assert.equal(body.error.code, "VALIDATION_ERROR");
  }
});

test("cache key includes source, lang and year", async () => {
  const before = comickSearchCount();
  await search({ q: "cache", source: "comick" });
  const first = comickSearchCount();
  assert.equal(first, before + 1);
  await search({ q: "cache", source: "comick" });
  assert.equal(comickSearchCount(), first, "identical full query must be cached");
  await search({ q: "cache", source: "comick", lang: "vi" });
  assert.equal(comickSearchCount(), first + 1, "lang must change the cache key");
  await search({ q: "cache", source: "comick", year: "2024" });
  assert.equal(comickSearchCount(), first + 2, "year must change the cache key");
  await search({ q: "cache", source: "all" });
  assert.equal(comickSearchCount(), first + 3, "source must change the cache key");
});

test("Comick lang, page and tag limits are reported as partial", async () => {
  const lang = await search({ q: "limits", source: "comick", lang: "vi" });
  assert.equal(lang.body.partial, true);

  const before = comickSearchCount();
  const page = await search({ q: "limits", source: "comick", page: "51" });
  assert.equal(page.body.partial, true);
  assert.equal(page.body.results.length, 0);
  assert.equal(comickSearchCount(), before, "page 51 is outside the official Comick cap");

  const tags = await search({ q: "limits", source: "comick", tags: TAG });
  assert.equal(tags.body.partial, true);
  assert.ok(
    !comickRequests.slice(before).some((url) => url.includes("genres=")),
    "MangaDex tag UUIDs must not be guessed as Comick genre slugs",
  );
});

test("prefixed comic IDs dispatch to Comick detail and chapter routes", async () => {
  const comicId = encodeURIComponent("comick:comic-1");
  const detail = await get(`/api/content/manga/${comicId}`);
  assert.equal(detail.response.status, 200, JSON.stringify(comickRequests));
  assert.equal(detail.body.id, "comick:comic-1");
  assert.equal(detail.body.title, "Comick Detail");
  assert.equal(detail.body.source_label, "Comick");
  assert.ok(
    comickRequests.some((url) => decodeURIComponent(url.split("?")[0]) === "/v1.0/comic/comic-1/"),
    JSON.stringify(comickRequests),
  );

  const chapters = await get(`/api/content/manga/${comicId}/chapters`);
  assert.equal(chapters.response.status, 200);
  assert.deepEqual(chapters.body.vi.map((chapter) => chapter.id), ["comick:chap-1-vi"]);
  assert.deepEqual(chapters.body.en.map((chapter) => chapter.id), ["comick:chap-1-en"]);
  assert.ok(chapters.body.vi.every((chapter) => chapter.source_label === "Comick"));
});

test("bare UUID detail and chapter routes stay on MangaDex", async () => {
  const mdBefore = mdRequests.length;
  const detail = await get(`/api/content/manga/${UUID}`);
  assert.equal(detail.response.status, 200);
  assert.equal(detail.body.id, UUID);
  assert.equal(detail.body.title, "Bare UUID Manga");
  assert.equal(detail.body.source_label, "MangaDex");

  const chapters = await get(`/api/content/manga/${UUID}/chapters`);
  assert.equal(chapters.response.status, 200);
  assert.deepEqual(chapters.body, { vi: [], en: [], notice: null });
  assert.ok(mdRequests.length > mdBefore);
});

test("malformed prefixed manga ID is a structured 400 before any upstream call", async () => {
  const before = comickRequests.length;
  const { response, body } = await get(`/api/content/manga/${encodeURIComponent("comick:")}`);
  assert.equal(response.status, 400);
  assert.equal(body.error.code, "VALIDATION_ERROR");
  assert.equal(comickRequests.length, before);
});
