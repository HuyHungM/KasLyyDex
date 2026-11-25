import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { chromium } from "playwright-core";
import { browserExecutable } from "./browser.mjs";
import { installIdentityFixture, sessionBody } from "./identity-fixture.mjs";
import { freePort, repoDir, startHttpServer, startNext, stop, webDir } from "./test-helpers.mjs";
import { pagePng } from "./image-fixtures.mjs";

const EDGE = browserExecutable();
const MANGA_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CHAPTER_A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CHAPTER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc";
const PAGES = [CHAPTER_A, CHAPTER_B].flatMap((id) =>
  [1, 2, 3, 4].map((page) => `https://uploads.mangadex.org/data/${id}/page-${page}.png`));

let contentFixture;
let axum;
let next;
let browser;
let baseUrl;
let cacheDir;
let pageErrors = [];

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

function json(res, body) {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

before(async () => {
  assert.ok(existsSync(EDGE), `browser executable missing: ${EDGE}`);
  cacheDir = join(webDir, ".test-cache", `reader-sync-${process.pid}`);
  mkdirSync(cacheDir, { recursive: true });
  PAGES.forEach((url, index) => {
    const key = createHash("sha256").update(url).digest("hex");
    writeFileSync(join(cacheDir, `${key}.png`), pagePng(index % 4));
  });

  const manga = {
    id: MANGA_ID,
    attributes: { title: { vi: "Fixture Manga" }, status: "ongoing", year: 2026, description: { vi: "Sync fixture" }, tags: [] },
    relationships: [],
  };
  const chapter = (id, number) => ({
    id,
    attributes: {
      chapter: String(number), volume: null, title: `Chương ${number}`, pages: 4,
      externalUrl: null, translatedLanguage: "vi", readableAt: "2026-11-20T00:00:00Z",
    },
    relationships: [{ type: "manga", id: MANGA_ID }],
  });
  const chapters = [chapter(CHAPTER_A, 1), chapter(CHAPTER_B, 2)];
  contentFixture = await startHttpServer((req, res) => {
    const url = req.url ?? "";
    if (url.startsWith("/at-home/server/")) {
      return json(res, { baseUrl: "https://uploads.mangadex.org", chapter: { hash: "hash", data: ["page-1.png", "page-2.png", "page-3.png", "page-4.png"], dataSaver: [] } });
    }
    if (url.includes("/feed?")) {
      const vietnamese = decodeURIComponent(url).includes("translatedLanguage[]=vi");
      return json(res, { total: vietnamese ? chapters.length : 0, data: vietnamese ? chapters : [] });
    }
    if (url.startsWith("/statistics/manga?")) {
      return json(res, { statistics: { [MANGA_ID]: { rating: { bayesian: 8.5 }, follows: 10 } } });
    }
    if (url.startsWith("/manga/")) return json(res, { data: manga });
    return json(res, { total: 0, data: [] });
  });

  const axumPort = await freePort();
  const axumUrl = `http://127.0.0.1:${axumPort}`;
  const binary = join(repoDir, "target", "debug", process.platform === "win32" ? "server.exe" : "server");
  assert.ok(existsSync(binary), "build Axum first: cargo build -p server");
  axum = spawn(binary, [], {
    cwd: repoDir,
    env: { ...process.env, PORT: String(axumPort), MANGADEX_API_ORIGIN: contentFixture.baseUrl, CACHE_DIR: cacheDir, DIST_DIR: join(webDir, "public") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForTcp(axumPort);

  next = await startNext({ RUST_CONTENT_API_ORIGIN: axumUrl });
  baseUrl = next.baseUrl;
  browser = await chromium.launch({ executablePath: EDGE, headless: true });
});

after(async () => {
  await browser?.close();
  await stop(next?.child);
  if (axum && axum.exitCode === null) axum.kill("SIGKILL");
  await contentFixture?.close();
});

async function signedInContext() {
  // Fresh context per test, with the session fixture installed before any page
  // loads so no client module state leaks between tests.
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: "dark" });
  await installIdentityFixture(context, { signedIn: true });
  const page = await context.newPage();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await context.route("**/api/v1/me/settings", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ mode: "vertical", fit: true, bg: "light", speed: 3 }),
    });
  });
  return { context, page };
}

async function waitFor(predicate, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(50);
  }
  throw new Error("timed out waiting for condition");
}

function progressItem(chapterId, page) {
  return {
    mangaId: MANGA_ID, chapterId, lang: "vi", chapter: "1", title: "Chương 1", coverFile: null,
    page, total: 4, maxPage: page, lastReadAt: Date.now(), revision: 1,
  };
}

test("restore failure exposes a retry that applies the server page", async () => {
  const { context, page } = await signedInContext();
  const puts = [];
  let attempts = 0;
  let failOnce = true;
  await context.route("**/api/v1/me/progress", async (route) => {
    attempts += 1;
    if (failOnce && attempts === 1) {
      failOnce = false;
      await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":{"code":"INTERNAL_ERROR","message":"fixture failure","details":{}}}' });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [progressItem(CHAPTER_A, 3)] }) });
  });
  await context.route("**/api/v1/me/progress/**", async (route) => {
    if (route.request().method() === "PUT") puts.push(JSON.parse(route.request().postData() ?? "{}"));
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.goto(`${baseUrl}/read/${CHAPTER_A}?manga=${MANGA_ID}&lang=vi`);
  const retry = page.getByRole("button", { name: "Thử lại đồng bộ" });
  await retry.waitFor({ timeout: 10_000 });
  assert.equal(puts.length, 0, "no write after a failed restore");
  await retry.click();
  await waitFor(() => puts.length > 0);
  assert.equal(puts[0].page, 3);
  assert.match(await page.locator(".reader-page-count").textContent(), /Trang 3\/4/);
  await context.close();
});

test("a follow click during session loading is not written to guest storage", async () => {
  const { context, page } = await signedInContext();
  const libraryPuts = [];
  await context.route("**/api/v1/me/library/**", async (route) => {
    if (route.request().method() === "PUT") libraryPuts.push(route.request().postData());
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await context.route("**/api/auth/get-session", async (route) => {
    await delay(1500);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(sessionBody(true)),
    });
  });
  await page.goto(`${baseUrl}/manga/${MANGA_ID}`);
  const follow = page.locator("button.btn[aria-pressed]");
  await follow.waitFor();
  assert.equal(await follow.isDisabled(), true, "follow must be gated until the session resolves");
  await follow.evaluate((button) => button.click());
  assert.equal(await page.evaluate(() => localStorage.getItem("truyenviet:library")), null, "early click must not write guest data");
  assert.equal(libraryPuts.length, 0);
  await page.waitForFunction(() => !document.querySelector("button.btn[aria-pressed]")?.disabled, null, { timeout: 10_000 });
  await follow.click();
  await delay(300);
  assert.ok(libraryPuts.length >= 1, "after resolution the synced API must be used");
  await context.close();
});

test("reader sync fixes produced no page errors", () => {
  assert.deepEqual(pageErrors, []);
});
