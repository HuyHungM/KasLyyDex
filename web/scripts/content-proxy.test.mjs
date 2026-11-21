import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { freePort, repoDir, startHttpServer, startNext, stop, webDir } from "./test-helpers.mjs";

// Local topology only. The MangaDex fixture stands in for the remote service;
// no remote MangaDex request is needed and no credentials are involved.
const { contentPath, createContentClient } = await import("../lib/contracts.ts");

const IMAGE_URL = "https://uploads.mangadex.org/data/abc/1.png";
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452" + "00112233445566778899", "hex");
const TAGS = [{ id: "tag-1", name: "Action", group: "genre" }];

let mangadexFixture;
let axum;
let axumUrl;
let proxied;
let unconfigured;
let cacheDir;

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

function json(res, body, extraHeaders = {}) {
  res.writeHead(200, { "content-type": "application/json", ...extraHeaders });
  res.end(JSON.stringify(body));
}

before(async () => {
  cacheDir = join(webDir, ".test-cache", `axum-${process.pid}`);
  mkdirSync(cacheDir, { recursive: true });
  // Pre-seed Axum's disk cache so the image bytes are served by the real Axum
  // handler without any production fake host override or network dependency.
  const key = createHash("sha256").update(IMAGE_URL).digest("hex");
  writeFileSync(join(cacheDir, `${key}.png`), PNG);

  mangadexFixture = await startHttpServer((req, res) => {
    const url = req.url ?? "";
    if (url.startsWith("/at-home/server/")) {
      const empty = url.endsWith("/22222222-2222-4222-8222-222222222222");
      return json(res, {
        baseUrl: "https://uploads.mangadex.org",
        chapter: {
          hash: "abc",
          data: empty ? [] : ["1.png"],
          dataSaver: [],
        },
      });
    }
    if (url.startsWith("/chapter")) {
      return json(res, {
        total: 1,
        data: [{
          id: "11111111-1111-4111-8111-111111111111",
          attributes: {
            chapter: "1",
            pages: 2,
            externalUrl: null,
            translatedLanguage: "vi",
            readableAt: "2026-11-20T00:00:00Z",
          },
          relationships: [{ type: "manga", id: "33333333-3333-4333-8333-333333333333" }],
        }],
      });
    }
    if (url.startsWith("/manga/tag")) {
      return json(res, { total: TAGS.length, data: TAGS.map((t) => ({ id: t.id, attributes: { name: { en: t.name }, group: t.group } })) }, { "set-cookie": "fixture=1; Path=/" });
    }
    if (url.startsWith("/manga?")) {
      return json(res, {
        total: 1,
        data: [{
          id: "33333333-3333-4333-8333-333333333333",
          attributes: {
            title: { vi: "Fixture Manga" },
            status: "ongoing",
            description: { vi: "Local fixture" },
          },
          relationships: [],
        }],
      });
    }
    if (url.includes("/feed?")) {
      return json(res, { total: 1, data: [{
        id: "11111111-1111-4111-8111-111111111111",
        attributes: { chapter: "1", pages: 2, translatedLanguage: "vi", readableAt: "2026-11-20T00:00:00Z" },
        relationships: [],
      }] });
    }
    if (url.startsWith("/manga/")) {
      return json(res, { data: {
        id: "33333333-3333-4333-8333-333333333333",
        attributes: { title: { vi: "Fixture Manga" }, status: "ongoing", description: { vi: "Local fixture" } },
        relationships: [],
      } });
    }
    return json(res, { total: 0, data: [] });
  });

  const port = await freePort();
  axumUrl = `http://127.0.0.1:${port}`;
  const binary = join(repoDir, "target", "debug", process.platform === "win32" ? "server.exe" : "server");
  assert.ok(existsSync(binary), `build the Axum server first: cargo build -p server (missing ${binary})`);
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

  proxied = await startNext({ RUST_CONTENT_API_ORIGIN: axumUrl });
  unconfigured = await startNext();
});

after(async () => {
  await stop(proxied?.child);
  await stop(unconfigured?.child);
  if (axum && axum.exitCode === null) axum.kill("SIGKILL");
  await mangadexFixture?.close();
});

test("Axum keeps legacy endpoints and exposes the /api/content namespace", async () => {
  for (const path of ["/api/latest", "/api/content/latest"]) {
    const res = await fetch(`${axumUrl}${path}`);
    assert.equal(res.status, 200, path);
    const body = await res.json();
    assert.ok(Array.isArray(body), path);
    assert.equal(body[0]?.title, "Fixture Manga", path);
  }
});

test("Next proxies /api/content/latest through the real local Axum server", async () => {
  assert.equal(contentPath("latest"), "/api/content/latest");
  assert.equal(contentPath("manga", "abc"), "/api/content/manga/abc");

  const client = createContentClient(proxied.baseUrl);
  const latest = await client.latest();
  assert.ok(Array.isArray(latest));
  assert.equal(latest[0].title, "Fixture Manga");

  const direct = await fetch(`${proxied.baseUrl}/api/content/latest`);
  assert.equal(direct.status, 200);
  assert.match(direct.headers.get("content-type") ?? "", /application\/json/);
  assert.match(direct.headers.get("cache-control") ?? "", /max-age=60/);
});

test("Next proxy passes Axum's structured rejection for malformed content IDs", async () => {
  const res = await fetch(`${proxied.baseUrl}/api/content/manga/not-a-uuid`);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error.code, "VALIDATION_ERROR");
  assert.equal(typeof body.error.message, "string");
});

test("missing content origin returns a structured 503 without breaking public routes", async () => {
  const res = await fetch(`${unconfigured.baseUrl}/api/content/latest`);
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.error.code, "CONTENT_NOT_CONFIGURED");
  assert.equal(body.error.details.service, "content");
  assert.equal(body.error.details.missing, "RUST_CONTENT_API_ORIGIN");

  const health = await fetch(`${unconfigured.baseUrl}/api/v1/health`);
  assert.equal(health.status, 200);
});

test("Axum page URLs use /api/content/img and Next forwards the real image bytes", async () => {
  const client = createContentClient(proxied.baseUrl);
  const { pages } = await client.pages("11111111-1111-4111-8111-111111111111");
  assert.equal(pages.length, 1);
  assert.ok(pages[0].startsWith("/api/content/img?u="), pages[0]);
  assert.equal(new URL(pages[0], proxied.baseUrl).searchParams.get("u"), IMAGE_URL);

  const res = await fetch(`${proxied.baseUrl}${pages[0]}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/png");
  assert.match(res.headers.get("cache-control") ?? "", /immutable/);
  assert.equal(res.headers.get("set-cookie"), null);
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), PNG);
});

test("legacy /api/img alias still forwards the same Axum bytes", async () => {
  const alias = `${proxied.baseUrl}/api/img?u=${encodeURIComponent(IMAGE_URL)}`;
  const res = await fetch(alias);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/png");
  assert.match(res.headers.get("cache-control") ?? "", /immutable/);
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), PNG);
});

test("empty chapter pages stay an empty array instead of a fake image", async () => {
  const client = createContentClient(proxied.baseUrl);
  assert.deepEqual((await client.pages("22222222-2222-4222-8222-222222222222")).pages, []);
});

test("dot segments are rejected before URL construction (encoded and double encoded)", async () => {
  for (const segment of ["%2e%2e", "%252e%252e", "%252e"]) {
    const res = await fetch(`${proxied.baseUrl}/api/content/${segment}/latest`);
    assert.ok(res.status >= 400, `${segment} => ${res.status}`);
    if (res.status === 400) {
      assert.equal((await res.json()).error.code, "VALIDATION_ERROR");
    }
  }
});

test("dot-segment guard rejects literal and encoded forms before URL construction", async () => {
  const { unsafeSegment, hasTraversal } = await import("../lib/content-proxy.ts");
  for (const value of [".", "..", "%2e", "%2e%2e", "%252e%252e", "a/b", "a\\b"]) {
    assert.ok(unsafeSegment(value), value);
  }
  assert.equal(unsafeSegment("latest"), false);
  assert.equal(unsafeSegment("11111111-1111-4111-8111-111111111111"), false);
  assert.ok(hasTraversal("https://uploads.mangadex.org/../a.png"));
  assert.ok(hasTraversal("https://uploads.mangadex.org/%252e%252e/a.png"));
  assert.equal(hasTraversal(IMAGE_URL), false);
});

test("image alias rejects traversal and disallowed source URLs", async () => {
  for (const raw of ["", "../secret", IMAGE_URL.replace("/data/", "/../data/")]) {
    const res = await fetch(`${proxied.baseUrl}/api/img?u=${encodeURIComponent(raw)}`);
    assert.equal(res.status, 400, raw);
    assert.equal((await res.json()).error.code, "VALIDATION_ERROR");
  }
});

test("browser cookies and upstream Set-Cookie never cross the content proxy", async () => {
  const res = await fetch(`${proxied.baseUrl}/api/content/tags`, {
    headers: { cookie: "session=leak", authorization: "Bearer leak" },
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("set-cookie"), null);
  assert.ok(Array.isArray(await res.json()));
  const upstream = mangadexFixture.requests.find((request) => request.url.startsWith("/manga/tag"));
  assert.ok(upstream);
  assert.equal(upstream.headers.cookie, undefined);
  assert.equal(upstream.headers.authorization, undefined);
});
