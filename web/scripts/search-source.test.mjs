import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { freePort, repoDir, startHttpServer, webDir } from "./test-helpers.mjs";

// Real Axum process + loopback MangaDex fixture; no auth, database, remote
// catalog, deployment or cloud configuration.
const UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

let mangadexFixture;
let axum;
let axumUrl;
let mdRequests = [];

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
      if (["md-only", "cache", "lang-vi"].includes(title)) {
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
});

function mdSearchCount() {
  return mdRequests.filter((url) => url.startsWith("/manga?")).length;
}

test("source=mangadex returns MangaDex results and is not partial", async () => {
  const mdBefore = mdSearchCount();
  const { response, body } = await search({ q: "md-only", source: "mangadex" });
  assert.equal(response.status, 200);
  assert.equal(body.partial, false);
  assert.deepEqual(body.results.map((item) => item.source_label), ["MangaDex"]);
  assert.equal(mdSearchCount(), mdBefore + 1);
});

test("lang=vi filters MangaDex upstream", async () => {
  const mdBefore = mdSearchCount();
  const { response, body } = await search({ q: "lang-vi", source: "mangadex", lang: "vi" });
  assert.equal(response.status, 200);
  assert.deepEqual(body.results.map((item) => item.source_label), ["MangaDex"]);

  const mdQuery = mdRequests.filter((url) => url.startsWith("/manga?"));
  assert.equal(mdQuery.length, mdBefore + 1);
  assert.ok(
    mdQuery.at(-1).includes("availableTranslatedLanguage[]=vi"),
    `MangaDex fixture did not receive the language filter: ${mdQuery.at(-1)}`,
  );
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

test("cache key includes query and lang", async () => {
  const before = mdSearchCount();
  await search({ q: "cache", source: "mangadex" });
  const first = mdSearchCount();
  assert.equal(first, before + 1);
  await search({ q: "cache", source: "mangadex" });
  assert.equal(mdSearchCount(), first, "identical full query must be cached");
  await search({ q: "cache", source: "mangadex", lang: "vi" });
  assert.equal(mdSearchCount(), first + 1, "lang must change the cache key");
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

test("opaque non-UUID manga ID is a structured 400", async () => {
  const { response, body } = await get(`/api/content/manga/${encodeURIComponent("opaque-id")}`);
  assert.equal(response.status, 400);
  assert.equal(body.error.code, "VALIDATION_ERROR");
});
