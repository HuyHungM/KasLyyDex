import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { chromium } from "playwright-core";
import { freePort, repoDir, startHttpServer, startNext, stop, webDir } from "./test-helpers.mjs";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const MANGA_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CHAPTER_IDS = [
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc",
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbd",
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbe",
];
const TAG_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SHOT_DIR = join(webDir, ".test-screenshots");
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452" + "00112233445566778899", "hex");
const JPG = Buffer.from("ffd8ffe000104a46494600010100000100010000ffd9", "hex");
const PAGES = CHAPTER_IDS.map((_, index) => `https://uploads.mangadex.org/data/hash/page-${index + 1}.png`);
const COVERS = [256, 512].map((size) => `https://uploads.mangadex.org/covers/${MANGA_ID}/cover.jpg.${size}.jpg`);

let fixture;
let axum;
let next;
let browser;
let axumUrl;
let baseUrl;
let cacheDir;
let pageRequests = [];

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
  mkdirSync(SHOT_DIR, { recursive: true });
  cacheDir = join(webDir, ".test-cache", `playwright-${process.pid}`);
  mkdirSync(cacheDir, { recursive: true });
  for (const url of PAGES) seed(url, PNG);
  for (const url of COVERS) {
    const key = createHash("sha256").update(url).digest("hex");
    writeFileSync(join(cacheDir, `${key}.jpg`), JPG);
  }

  const manga = {
    id: MANGA_ID,
    attributes: {
      title: { vi: "Fixture Manga" },
      status: "ongoing",
      year: 2026,
      description: { vi: "Một truyện dùng để kiểm tra giao diện và trình đọc." },
      tags: [{ id: TAG_ID, attributes: { name: { en: "Action" }, group: "genre" } }],
    },
    relationships: [
      { type: "cover_art", attributes: { fileName: "cover.jpg" } },
      { type: "author", attributes: { name: "Fixture Author" } },
    ],
  };
  const chapter = (id, number) => ({
    id,
    attributes: {
      chapter: String(number),
      volume: null,
      title: `Chương ${number}`,
      pages: 4,
      externalUrl: null,
      translatedLanguage: "vi",
      readableAt: `2026-11-2${number}T00:00:00Z`,
    },
    relationships: [{ type: "manga", id: MANGA_ID }],
  });
  const chapters = CHAPTER_IDS.map((id, index) => chapter(id, index + 1));

  fixture = await startHttpServer((req, res) => {
    const url = req.url ?? "";
    if (url.startsWith("/at-home/server/")) {
      return json(res, { baseUrl: "https://uploads.mangadex.org", chapter: { hash: "hash", data: ["page-1.png", "page-2.png", "page-3.png", "page-4.png"], dataSaver: [] } });
    }
    if (url.startsWith("/manga/tag")) {
      return json(res, { total: 1, data: [{ id: TAG_ID, attributes: { name: { en: "Action" }, group: "genre" } }] });
    }
    if (url.startsWith("/chapter?")) {
      return json(res, { total: chapters.length, data: chapters });
    }
    if (url.startsWith("/statistics/manga?")) {
      return json(res, { statistics: { [MANGA_ID]: { rating: { bayesian: 8.5 }, follows: 123 } } });
    }
    if (url.includes("/feed?")) {
      const vietnamese = decodeURIComponent(url).includes("translatedLanguage[]=vi");
      return json(res, { total: vietnamese ? chapters.length : 0, data: vietnamese ? chapters : [] });
    }
    if (url.startsWith("/manga?")) {
      return json(res, { total: 1, data: [manga] });
    }
    if (url.startsWith("/manga/")) {
      return json(res, { data: manga });
    }
    return json(res, { total: 0, data: [] });
  });

  const port = await freePort();
  axumUrl = `http://127.0.0.1:${port}`;
  const binary = join(repoDir, "target", "debug", process.platform === "win32" ? "server.exe" : "server");
  assert.ok(existsSync(binary), `build Axum first: cargo build -p server`);
  axum = spawn(binary, [], {
    cwd: repoDir,
    env: { ...process.env, PORT: String(port), MANGADEX_API_ORIGIN: fixture.baseUrl, CACHE_DIR: cacheDir, DIST_DIR: join(webDir, "public") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForTcp(port);

  next = await startNext({ RUST_CONTENT_API_ORIGIN: axumUrl });
  baseUrl = next.baseUrl;
  assert.ok(existsSync(EDGE), `Edge is required: ${EDGE}`);
  browser = await chromium.launch({ executablePath: EDGE, headless: true });
});

after(async () => {
  await browser?.close();
  await stop(next?.child);
  if (axum && axum.exitCode === null) axum.kill("SIGKILL");
  await fixture?.close();
});

async function openPage(viewport) {
  const context = await browser.newContext({ viewport, colorScheme: "dark" });
  const page = await context.newPage();
  page.on("request", (request) => {
    const { hostname } = new URL(request.url());
    if (/(^|\.)mangadex\.(org|network)$/.test(hostname)) pageRequests.push(request.url());
  });
  return { context, page };
}

test("desktop and 375px shells render real covers from Axum with no direct MangaDex requests", async () => {
  for (const [name, viewport] of [["desktop", { width: 1280, height: 800 }], ["mobile", { width: 375, height: 812 }]]) {
    const { context, page } = await openPage(viewport);
    await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
    await page.locator(".feature h1").waitFor();
    assert.equal(await page.locator(".feature h1").textContent(), "Fixture Manga");
    assert.ok(await page.locator(".popular-rail .card").count() >= 1);
    const cover = page.locator(".feature-poster");
    assert.ok(cover && await cover.getAttribute("src").then((src) => src.startsWith("/api/content/img?u=")));
    const rail = page.locator(".site-rail");
    if (name === "desktop") assert.equal(await rail.isVisible(), true);
    else assert.equal(await page.locator(".bottom-tabs").isVisible(), true);
    await page.screenshot({ path: join(SHOT_DIR, `home-${name}.png`), fullPage: false });
    await context.close();
  }
  assert.deepEqual(pageRequests, [], `browser called MangaDex directly: ${pageRequests.join(", ")}`);
});

test("search filters, clickable tags, genres, rank and library work from Axum data", async () => {
  const { context, page } = await openPage({ width: 1280, height: 800 });
  await page.goto(`${baseUrl}/search?q=Fixture`, { waitUntil: "networkidle" });
  assert.ok((await page.locator(".manga-grid .card-title").allTextContents()).some((text) => text.includes("Fixture")));
  assert.ok(await page.locator(".search-filters input[type=checkbox][name=tags]").count() >= 1);
  await page.screenshot({ path: join(SHOT_DIR, "search-desktop.png") });

  await page.goto(`${baseUrl}/manga/${MANGA_ID}`, { waitUntil: "networkidle" });
  const tagLink = page.locator(`.tags a[href*="tags=${TAG_ID}"]`).first();
  assert.equal(await tagLink.count(), 1);
  await tagLink.click();
  await page.waitForURL(/\/search\?tags=/);
  await page.locator(".manga-grid .card").first().waitFor();

  await page.goto(`${baseUrl}/the-loai`, { waitUntil: "networkidle" });
  assert.ok(await page.locator(".genre-group .chapter-pill").count() >= 1);
  await page.goto(`${baseUrl}/bxh?kind=rating`, { waitUntil: "networkidle" });
  assert.ok(await page.locator(".rank-list li").count() >= 1);
  await page.goto(`${baseUrl}/tu-truyen`, { waitUntil: "networkidle" });
  assert.ok(await page.locator(".empty").isVisible());
  await page.screenshot({ path: join(SHOT_DIR, "library-empty.png") });
  await context.close();
});

test("theme choice survives a reload in localStorage", async () => {
  const { context, page } = await openPage({ width: 375, height: 812 });
  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
  await page.locator(".theme-btn").click();
  assert.equal(await page.evaluate(() => localStorage.getItem("truyenviet:theme")), "light");
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "light");
  await context.close();
});

test("real WASM drives pages, progress, mode, background and chapter-local restoration", async () => {
  const { context, page } = await openPage({ width: 1280, height: 800 });
  await page.goto(`${baseUrl}/read/${CHAPTER_IDS[0]}?manga=${MANGA_ID}&lang=vi`, { waitUntil: "networkidle" });
  await page.locator(".reader-page").first().waitFor();
  assert.match(await page.locator(".reader-page-count").textContent(), /Trang 1\/4 · 25%/);

  const firstImage = page.locator('.reader-page[data-index="0"]');
  const imageResponse = await firstImage.evaluate(async (img) => {
    const response = await fetch(img.getAttribute("src"));
    const bytes = new Uint8Array(await response.arrayBuffer());
    return { type: response.headers.get("content-type"), hex: Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("") };
  });
  assert.equal(imageResponse.type, "image/png");
  assert.equal(imageResponse.hex, PNG.toString("hex"));

  // Vertical mode tracks the page under the reading line via IntersectionObserver.
  await page.evaluate(() => {
    const image = document.querySelector('.reader-page[data-index="1"]');
    const top = image.getBoundingClientRect().top + window.scrollY;
    window.scrollTo(0, top - window.innerHeight * 0.26);
  });
  await page.waitForFunction(() => document.querySelector(".reader-page-count")?.textContent?.includes("Trang 2/4"));
  assert.match(await page.locator(".reader-page-count").textContent(), /Trang 2\/4 · 50%/);

  await page.locator(".reader-settings summary").click();
  await page.locator(".reader-settings select").first().selectOption("horizontal");
  assert.equal(await page.locator(".reader-paged").count(), 1);
  assert.equal(await page.locator(".reader-paged img").count(), 1);
  await page.getByRole("button", { name: "Trang sau →" }).click();
  assert.match(await page.locator(".reader-page-count").textContent(), /Trang 3\/4 · 75%/);
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await page.keyboard.press("ArrowRight");
  assert.match(await page.locator(".reader-page-count").textContent(), /Trang 4\/4 · 100%/);
  await page.waitForFunction(() => {
    const history = JSON.parse(localStorage.getItem("truyenviet:history") ?? "[]");
    return history[0]?.page === 4 && history[0]?.total === 4;
  });
  await page.screenshot({ path: join(SHOT_DIR, "reader-desktop.png") });

  await page.locator(".reader-settings select").nth(1).selectOption("dark");
  assert.equal(await page.locator(".reader").getAttribute("data-bg"), "dark");
  await page.screenshot({ path: join(SHOT_DIR, "reader-horizontal-dark.png") });

  // Reload the same chapter: restored page comes from normalized local history only
  // when chapterId matches, and the Rust state clamps it to the current page count.
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".reader-page").first().waitFor();
  assert.match(await page.locator(".reader-page-count").textContent(), /Trang 4\/4 · 100%/);
  // Persisted settings are re-applied to Rust state, not left as a JS-only pref.
  assert.equal(await page.locator(".reader-paged").count(), 1);
  assert.equal(await page.locator(".reader").getAttribute("data-bg"), "dark");

  await page.goto(`${baseUrl}/read/${CHAPTER_IDS[1]}?manga=${MANGA_ID}&lang=vi`, { waitUntil: "networkidle" });
  await page.locator(".reader-page").first().waitFor();
  assert.match(await page.locator(".reader-page-count").textContent(), /Trang 1\/4 · 25%/);
  await context.close();
});

test("375px reader keeps toolbar, pages and bottom navigation usable", async () => {
  const { context, page } = await openPage({ width: 375, height: 812 });
  await page.goto(`${baseUrl}/read/${CHAPTER_IDS[2]}?manga=${MANGA_ID}&lang=vi`, { waitUntil: "networkidle" });
  await page.locator(".reader-page").first().waitFor();
  assert.equal(await page.locator(".reader-bar").isVisible(), true);
  assert.equal(await page.locator(".reader-bottom").isVisible(), true);
  assert.ok((await page.locator(".reader-page").count()) >= 2);
  await page.screenshot({ path: join(SHOT_DIR, "reader-mobile.png") });
  await context.close();
});

test("corrupt WASM shows a visible retry instead of a fake success state", async () => {
  const { context, page } = await openPage({ width: 1280, height: 800 });
  await page.route("**/wasm/*.wasm", (route) => route.fulfill({
    status: 200,
    contentType: "application/wasm",
    body: Buffer.from("not-a-wasm-module"),
  }));
  await page.goto(`${baseUrl}/read/${CHAPTER_IDS[3]}?manga=${MANGA_ID}&lang=vi`, { waitUntil: "networkidle" });
  const alert = page.locator('.panel[role="alert"]');
  await alert.waitFor();
  assert.match(await alert.textContent(), /WASM|WebAssembly|wasm|compile|instantiate/i);
  assert.equal(await page.getByRole("button", { name: "Thử lại" }).isVisible(), true);
  assert.equal(await page.locator(".reader-page").count(), 0);
  await page.screenshot({ path: join(SHOT_DIR, "reader-wasm-retry.png") });
  await context.close();
});
