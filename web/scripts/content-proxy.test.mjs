import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { freePort, repoDir, startHttpServer, startNext, stop, webDir } from "./test-helpers.mjs";

// Local topology only. The MangaDex fixture stands in for the remote service;
// no remote MangaDex request is needed and no credentials are involved.
const { contentPath, createContentClient } = await import("../lib/contracts.ts");

let mangadexFixture;
let axum;
let axumUrl;
let proxied;
let unconfigured;

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

before(async () => {
  mangadexFixture = await startHttpServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    if (req.url.startsWith("/chapter")) {
      res.end(JSON.stringify({
        total: 1,
        data: [{
          id: "fixture-chapter-1",
          attributes: {
            chapter: "1",
            pages: 2,
            externalUrl: null,
            translatedLanguage: "vi",
            readableAt: "2026-11-20T00:00:00Z",
          },
          relationships: [{ type: "manga", id: "fixture-manga-1" }],
        }],
      }));
      return;
    }
    if (req.url.startsWith("/manga?")) {
      res.end(JSON.stringify({
        total: 1,
        data: [{
          id: "fixture-manga-1",
          attributes: {
            title: { vi: "Fixture Manga" },
            status: "ongoing",
            description: { vi: "Local fixture" },
          },
          relationships: [],
        }],
      }));
      return;
    }
    res.end(JSON.stringify({ total: 0, data: [] }));
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
