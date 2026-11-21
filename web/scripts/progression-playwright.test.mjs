import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { chromium } from "playwright-core";
import { freePort, repoDir, startHttpServer, startNext, stop, webDir } from "./test-helpers.mjs";
import { pagePng } from "./image-fixtures.mjs";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const MANGA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CHAPTER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SHOT_DIR = join(webDir, ".test-screenshots");

let contentFixture;
let authFixture;
let axum;
let next;
let browser;
let baseUrl;
let cacheDir;
let pageErrors = [];

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

function seed(url, bytes) {
  const key = createHash("sha256").update(url).digest("hex");
  writeFileSync(join(cacheDir, `${key}.png`), bytes);
}

before(async () => {
  assert.ok(existsSync(EDGE), `Edge is required: ${EDGE}`);
  mkdirSync(SHOT_DIR, { recursive: true });
  cacheDir = join(webDir, ".test-cache", `progression-${process.pid}`);
  mkdirSync(cacheDir, { recursive: true });
  const pages = [1, 2, 3, 4].map((index) => `https://uploads.mangadex.org/data/${CHAPTER}/page-${index}.png`);
  pages.forEach((url, index) => seed(url, pagePng(index)));

  const chapter = {
    id: CHAPTER,
    attributes: {
      chapter: "1", volume: null, title: "Chương 1", pages: 4, externalUrl: null,
      translatedLanguage: "vi", readableAt: "2026-11-21T00:00:00Z",
    },
    relationships: [{ type: "manga", id: MANGA }],
  };
  contentFixture = await startHttpServer((req, res) => {
    const url = req.url ?? "";
    if (url.startsWith("/at-home/server/")) {
      return json(res, {
        baseUrl: "https://uploads.mangadex.org",
        chapter: { hash: CHAPTER, data: ["page-1.png", "page-2.png", "page-3.png", "page-4.png"], dataSaver: [] },
      });
    }
    if (url.startsWith("/chapter/")) {
      return json(res, { result: "ok", response: "entity", data: chapter });
    }
    if (url.includes("/feed?")) {
      return json(res, { total: 1, data: [chapter] });
    }
    if (url.startsWith("/statistics/manga?")) {
      return json(res, { statistics: { [MANGA]: { rating: { bayesian: 8.5 }, follows: 10 } } });
    }
    if (url.startsWith("/manga/")) {
      return json(res, { data: { id: MANGA, attributes: {
        title: { vi: "Fixture Manga" }, status: "ongoing", year: 2026, description: { vi: "Progression fixture" }, tags: [],
      }, relationships: [] } });
    }
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

  authFixture = await startHttpServer((req, res) => {
    if (req.url?.includes("get-session")) {
      const signedIn = (req.headers.cookie ?? "").includes("session_token=fixture");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(signedIn ? {
        session: { id: "session-opaque", userId: "google|opaque-42", expiresAt: new Date(Date.now() + 86_400_000).toISOString() },
        user: { id: "google|opaque-42", name: "Fixture Reader", email: "reader@example.com", emailVerified: true, image: null },
      } : { session: null, user: null }));
      return;
    }
    res.writeHead(200, {
      "content-type": "application/json",
      "set-cookie": "__Secure-neon-auth.session_token=fixture; Path=/; HttpOnly; SameSite=Lax",
    });
    res.end(JSON.stringify({ ok: true }));
  });

  next = await startNext({
    RUST_CONTENT_API_ORIGIN: axumUrl,
    NEON_AUTH_BASE_URL: `${authFixture.baseUrl}/neondb/auth`,
    NEON_AUTH_COOKIE_SECRET: "fixture-secret-with-at-least-32-characters",
    READER_TICKET_SECRET: "fixture-reader-secret-with-at-least-32-chars",
  });
  baseUrl = next.baseUrl;
  browser = await chromium.launch({ executablePath: EDGE, headless: true });
});

after(async () => {
  await browser?.close();
  await stop(next?.child);
  if (axum && axum.exitCode === null) axum.kill("SIGKILL");
  await authFixture?.close();
  await contentFixture?.close();
});

async function signedInContext() {
  const signIn = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const signPage = await signIn.newPage();
  await signPage.goto(`${baseUrl}/tai-khoan`, { waitUntil: "networkidle" });
  await signPage.locator('input[type="email"]').fill("reader@example.com");
  await signPage.locator('input[type="password"]').fill("fixture-password");
  await signPage.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await signPage.getByText("Đã đăng nhập").waitFor({ timeout: 15_000 });
  const cookies = await signIn.cookies();
  await signIn.close();
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addCookies(cookies);
  return context;
}

async function fixtureProgress(context, calls) {
  await context.route("**/api/v1/me/settings", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ mode: "vertical", fit: true, bg: "light", speed: 3 }),
  }));
  await context.route("**/api/v1/me/progress", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }),
  }));
  await context.route("**/api/v1/reader-sessions", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({
      ticket: "fixture-ticket", chapterId: CHAPTER, mangaId: MANGA, lang: "vi",
      pageCount: 4, requiredPages: 4, minimumElapsedMs: 10_000, expiresAt: Date.now() + 1_800_000,
    }),
  }));
  await context.route("**/api/v1/progress/checkpoint", (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}");
    calls.checkpoints.push(body.pages ?? []);
    const seen = [...new Set(calls.checkpoints.flat())];
    return route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ seenPages: seen, complete: seen.length >= 4 }),
    });
  });
  await context.route("**/api/v1/progress/complete", (route) => {
    calls.completions += 1;
    return route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({
        awarded: true, xp: 100, level: 2, totalXp: 200, title: "Luyện Khí", chapterId: CHAPTER,
      }),
    });
  });
}

async function scrollToPage(page, index) {
  await page.evaluate((target) => {
    const image = [...document.querySelectorAll(`.reader-page[data-index="${target}"]`)]
      .find((candidate) => candidate.getBoundingClientRect().height > 0);
    if (!image) throw new Error(`no visible reader page ${target}`);
    const top = image.getBoundingClientRect().top + window.scrollY;
    window.scrollTo(0, top - window.innerHeight * 0.26);
  }, index);
}

test("real WASM reader reports only visible decoded pages and shows server-awarded completion", async () => {
  const context = await signedInContext();
  const calls = { checkpoints: [], completions: 0 };
  await fixtureProgress(context, calls);
  const page = await context.newPage();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(`${baseUrl}/read/${CHAPTER}?manga=${MANGA}&lang=vi`, { waitUntil: "networkidle" });
  await page.locator(".reader-page[data-index='3']").waitFor();
  for (let index = 0; index < 4; index += 1) {
    await scrollToPage(page, index);
    await page.waitForTimeout(450);
  }
  const deadline = Date.now() + 10_000;
  while (new Set(calls.checkpoints.flat()).size < 4 && Date.now() < deadline) {
    await page.waitForTimeout(200);
  }
  assert.ok(new Set(calls.checkpoints.flat()).size >= 4, JSON.stringify(calls.checkpoints));

  // A hidden document must not produce further evidence before completion.
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const before = calls.checkpoints.flat().length;
  await scrollToPage(page, 0);
  await page.waitForTimeout(3_500);
  assert.equal(calls.checkpoints.flat().length, before, "background tab never sends checkpoints");
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    document.dispatchEvent(new Event("visibilitychange"));
  });

  await page.waitForFunction(() => document.querySelector(".reader-award") !== null, null, { timeout: 25_000 });
  const banner = await page.locator(".reader-award").textContent();
  assert.match(banner ?? "", /\+100 XP · Cấp 2 · Luyện Khí/, "award text comes only from the server fixture");
  assert.ok(calls.completions >= 1);
  const reported = calls.checkpoints.flat();
  assert.ok(reported.length >= 4, `expected four observed pages, got ${JSON.stringify(calls.checkpoints)}`);
  assert.ok(reported.every((value) => Number.isInteger(value) && value >= 1 && value <= 4),
    `out-of-range page reported: ${JSON.stringify(calls.checkpoints)}`);
  await page.screenshot({ path: join(SHOT_DIR, "progression-award.png") });
  await context.close();
});

test("guest reading makes no progression API calls even with local history", async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const calls = { checkpoints: [], completions: 0 };
  await fixtureProgress(context, calls);
  const page = await context.newPage();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(`${baseUrl}/read/${CHAPTER}?manga=${MANGA}&lang=vi`, { waitUntil: "networkidle" });
  await page.locator(".reader-page[data-index='3']").waitFor();
  for (let index = 0; index < 4; index += 1) {
    await scrollToPage(page, index);
    await page.waitForTimeout(350);
  }
  assert.deepEqual(calls.checkpoints, []);
  assert.equal(calls.completions, 0);
  assert.equal(await page.locator(".reader-award").count(), 0);
  await context.close();
  assert.deepEqual(pageErrors, [], `browser errors: ${pageErrors.join("; ")}`);
});
