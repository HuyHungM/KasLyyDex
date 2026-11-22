import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { chromium } from "playwright-core";
import { browserExecutable } from "./browser.mjs";
import { freePort, repoDir, startHttpServer, startNext, stop, webDir } from "./test-helpers.mjs";
import { coverJpg, pagePng } from "./image-fixtures.mjs";

const EDGE = browserExecutable();
const MANGA_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CHAPTER_IDS = [
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc",
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbd",
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbe",
];
const TAG_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SHOT_DIR = join(webDir, ".test-screenshots");
const PAGES = CHAPTER_IDS.map((_, index) => `https://uploads.mangadex.org/data/hash/page-${index + 1}.png`);
const PAGE_BYTES = Array.from({ length: 4 }, (_, index) => pagePng(index));
const COVERS = [256, 512].map((size) => `https://uploads.mangadex.org/covers/${MANGA_ID}/cover.jpg.${size}.jpg`);

let fixture;
let axum;
let next;
let browser;
let axumUrl;
let baseUrl;
let cacheDir;
let pageRequests = [];
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
  mkdirSync(SHOT_DIR, { recursive: true });
  cacheDir = join(webDir, ".test-cache", `playwright-${process.pid}`);
  mkdirSync(cacheDir, { recursive: true });
  PAGES.forEach((url, index) => seed(url, PAGE_BYTES[index]));
  COVERS.forEach((url, index) => {
    const key = createHash("sha256").update(url).digest("hex");
    writeFileSync(join(cacheDir, `${key}.jpg`), coverJpg(index === 0 ? 256 : 512));
  });

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
  assert.ok(existsSync(EDGE), `browser executable missing: ${EDGE}`);
  browser = await chromium.launch({ executablePath: EDGE, headless: true });
});

after(async () => {
  await browser?.close();
  await stop(next?.child);
  if (axum && axum.exitCode === null) axum.kill("SIGKILL");
  await fixture?.close();
});

async function assertNoHorizontalOverflow(page, label) {
  const sizes = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  assert.ok(
    sizes.scrollWidth <= sizes.viewport + 1 && sizes.bodyWidth <= sizes.viewport + 1,
    `${label} overflowed horizontally: ${JSON.stringify(sizes)}`,
  );
}

async function assertDecoded(locator, label) {
  const result = await locator.evaluate(async (img) => {
    if (!img.complete) {
      await new Promise((resolve) => {
        img.addEventListener("load", resolve, { once: true });
        img.addEventListener("error", resolve, { once: true });
      });
    }
    try {
      await img.decode();
    } catch (error) {
      return { ok: false, reason: String(error) };
    }
    return { ok: true, width: img.naturalWidth, height: img.naturalHeight };
  });
  assert.ok(result.ok && result.width > 0 && result.height > 0, `${label} did not decode: ${JSON.stringify(result)}`);
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

async function readerText(page) {
  return page.locator(".reader:visible .reader-page-count").textContent();
}

async function chooseReader(page, label, option) {
  const reader = page.locator(".reader:visible");
  await reader.getByRole("combobox", { name: label }).click();
  await reader.getByRole("option", { name: option, exact: true }).click();
}

async function chooseChapter(page, number) {
  const reader = page.locator(".reader:visible");
  await reader.getByRole("combobox", { name: "Chọn chương" }).click();
  await reader.getByRole("option", { name: `Chương ${number}`, exact: true }).click();
}

async function openPage(viewport) {
  const context = await browser.newContext({ viewport, colorScheme: "dark" });
  const page = await context.newPage();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("request", (request) => {
    const { hostname } = new URL(request.url());
    if (/(^|\.)mangadex\.(org|network)$/.test(hostname)) pageRequests.push(request.url());
  });
  return { context, page };
}

test("desktop and 375px shells render decodable covers, no horizontal overflow, and no direct MangaDex requests", async () => {
  for (const [name, viewport] of [["desktop", { width: 1280, height: 800 }], ["mobile", { width: 375, height: 812 }]]) {
    const { context, page } = await openPage(viewport);
    await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
    await page.locator(".feature h1").waitFor();
    assert.equal(await page.locator(".feature h1").textContent(), "Fixture Manga");
    const badge = page.locator(".feature-art .source-badge");
    assert.equal(await badge.textContent(), "MangaDex");
    assert.equal(await badge.getAttribute("aria-label"), "Nguồn: MangaDex");
    assert.ok(await badge.isVisible());
    assert.ok(await page.locator(".popular-rail .card").count() >= 1);
    const cover = page.locator(".feature-poster");
    assert.ok(cover && await cover.getAttribute("src").then((src) => src.startsWith("/api/content/img?u=")));
    await assertDecoded(cover, `${name} feature poster`);
    await assertDecoded(page.locator(".popular-rail .card-cover img").first(), `${name} card cover`);
    const rail = page.locator(".site-rail");
    if (name === "desktop") assert.equal(await rail.isVisible(), true);
    else {
      assert.equal(await page.locator(".bottom-tabs").isVisible(), true);
      await assertNoHorizontalOverflow(page, `${name} home`);
    }
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

  await page.goto(`${baseUrl}/search`, { waitUntil: "networkidle" });
  await page.locator(".search-filters summary").click();
  assert.ok(await page.locator(".search-filters .genre-group .chapter-pill").count() >= 1);
  const genres = await page.goto(`${baseUrl}/the-loai`, { waitUntil: "domcontentloaded" });
  assert.equal(genres.status(), 404, "the-loai route must be gone");
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
  await assertDecoded(page.locator('.reader-page[data-index="0"]'), "vertical reader page 1");

  const firstImage = page.locator('.reader-page[data-index="0"]');
  const imageResponse = await firstImage.evaluate(async (img) => {
    const response = await fetch(img.getAttribute("src"));
    const bytes = new Uint8Array(await response.arrayBuffer());
    return { type: response.headers.get("content-type"), hex: Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("") };
  });
  assert.equal(imageResponse.type, "image/png");
  assert.equal(imageResponse.hex, PAGE_BYTES[0].toString("hex"));

  // Vertical mode tracks the page under the reading line via IntersectionObserver.
  await scrollToPage(page, 1);
  await page.waitForFunction(() => document.querySelector(".reader-page-count")?.textContent?.includes("Trang 2/4"));
  assert.match(await page.locator(".reader-page-count").textContent(), /Trang 2\/4 · 50%/);

  await page.locator(".reader-settings summary").click();
  await chooseReader(page, "Chế độ đọc", "Lật ngang");
  assert.equal(await page.locator(".reader-paged").count(), 1);
  assert.equal(await page.locator(".reader-paged img").count(), 1);
  await assertDecoded(page.locator(".reader-paged img"), "horizontal reader page");
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

  await chooseReader(page, "Nền đọc", "Tối");
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
  await assertDecoded(page.locator(".reader-page").first(), "375px reader page");
  await assertNoHorizontalOverflow(page, "375px reader");
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

  // A working retry re-instantiates Rust state and renders decodable pages.
  await page.unroute("**/wasm/*.wasm");
  await page.getByRole("button", { name: "Thử lại" }).click();
  await page.locator(".reader-page").first().waitFor();
  await assertDecoded(page.locator(".reader-page").first(), "reader page after WASM retry");
  assert.match(await page.locator(".reader-page-count").textContent(), /Trang 1\/4 · 25%/);
  assert.equal(await page.locator('.panel[role="alert"]').count(), 0);
  await page.screenshot({ path: join(SHOT_DIR, "reader-after-retry.png") });
  await context.close();
});

test("page 1 progress is saved, equal-page chapters are isolated, and reload restores only the same chapter", async () => {
  const { context, page } = await openPage({ width: 1280, height: 800 });
  await page.goto(`${baseUrl}/read/${CHAPTER_IDS[0]}?manga=${MANGA_ID}&lang=vi`, { waitUntil: "networkidle" });
  await page.locator(".reader-page").first().waitFor();
  await assertDecoded(page.locator('.reader-page[data-index="0"]'), "chapter 1 page 1");

  // No page turn yet: the initial Rust position must still be persisted.
  await page.waitForFunction(() => {
    const history = JSON.parse(localStorage.getItem("truyenviet:history") ?? "[]");
    return history[0]?.chapterId?.startsWith("bbbb") && history[0]?.page === 1 && history[0]?.total === 4;
  });
  const first = await page.evaluate(() => JSON.parse(localStorage.getItem("truyenviet:history"))[0]);
  assert.equal(first.chapterId, CHAPTER_IDS[0]);
  assert.equal(first.page, 1);
  assert.equal(first.total, 4);

  // Equal page count chapter navigation via the toolbar dropdown: no state leaks.
  // Next may keep a hidden prefetched reader in the DOM, so scope to the visible one.
  await chooseChapter(page, 2);
  await page.waitForURL(new RegExp(CHAPTER_IDS[1]));
  await page.locator(".reader:visible .reader-page").first().waitFor();
  assert.match(await readerText(page), /Trang 1\/4 · 25%/);
  const second = await page.evaluate(() => JSON.parse(localStorage.getItem("truyenviet:history"))[0]);
  assert.equal(second.chapterId, CHAPTER_IDS[1]);
  assert.equal(second.page, 1, "chapter 2 must not inherit chapter 1 position");

  // Move within chapter 2, reload: only that chapter's position is restored.
  await scrollToPage(page, 2);
  await page.waitForFunction(() => [...document.querySelectorAll(".reader-page-count")]
    .some((element) => element.getBoundingClientRect().height > 0 && element.textContent?.includes("Trang 3/4")));
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".reader:visible .reader-page").first().waitFor();
  assert.match(await readerText(page), /Trang 3\/4 · 75%/);
  assert.equal((await page.evaluate(() => JSON.parse(localStorage.getItem("truyenviet:history"))[0])).page, 3);

  // Rapid successive chapter changes still settle on the last chapter at page 1.
  await chooseChapter(page, 3);
  await page.waitForURL(new RegExp(CHAPTER_IDS[2]));
  await page.locator(".reader:visible .chapter-select").waitFor({ state: "visible" });
  await chooseChapter(page, 4);
  await page.waitForURL(new RegExp(CHAPTER_IDS[3]));
  await page.locator(".reader:visible .reader-page").first().waitFor();
  assert.match(await readerText(page), /Trang 1\/4 · 25%/);
  assert.equal((await page.evaluate(() => JSON.parse(localStorage.getItem("truyenviet:history"))[0])).chapterId, CHAPTER_IDS[3]);
  await page.screenshot({ path: join(SHOT_DIR, "reader-chapter-isolation.png") });
  await context.close();
});

test("observer never snaps scrolling and auto-scroll pauses on user input", async () => {
  const { context, page } = await openPage({ width: 1280, height: 800 });
  await page.goto(`${baseUrl}/read/${CHAPTER_IDS[0]}?manga=${MANGA_ID}&lang=vi`, { waitUntil: "networkidle" });
  await page.locator(".reader-page").first().waitFor();

  await scrollToPage(page, 2);
  await page.waitForFunction(() => document.querySelector(".reader-page-count")?.textContent?.includes("Trang 3/4"));
  const stable = await page.evaluate(() => window.scrollY);
  await page.waitForTimeout(1200);
  assert.match(await page.locator(".reader-page-count").textContent(), /Trang 3\/4 · 75%/);
  assert.ok(Math.abs((await page.evaluate(() => window.scrollY)) - stable) <= 2, "observer must not snap scroll position");

  await page.locator(".reader-settings summary").click();
  await page.getByRole("button", { name: "Bật tự cuộn" }).click();
  await page.waitForTimeout(500);
  assert.ok((await page.evaluate(() => window.scrollY)) > stable, "auto-scroll should advance");
  await page.mouse.wheel(0, 50);
  await page.getByRole("button", { name: "Bật tự cuộn" }).waitFor();
  const paused = await page.evaluate(() => window.scrollY);
  await page.waitForTimeout(600);
  assert.ok(Math.abs((await page.evaluate(() => window.scrollY)) - paused) <= 2, "no stale RAF after pause");
  await context.close();
});

test("fullscreen is capability-gated and rejected promises produce no page errors", async () => {
  const before = pageErrors.length;

  const unsupported = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await unsupported.addInitScript(() => {
    Object.defineProperty(Document.prototype, "fullscreenEnabled", { configurable: true, get: () => false });
  });
  const first = await unsupported.newPage();
  first.on("pageerror", (error) => pageErrors.push(error.message));
  await first.goto(`${baseUrl}/read/${CHAPTER_IDS[0]}?manga=${MANGA_ID}&lang=vi`, { waitUntil: "networkidle" });
  await first.locator(".reader-page").first().waitFor();
  assert.equal(await first.getByRole("button", { name: "Đổi chế độ toàn màn hình" }).count(), 0);
  await unsupported.close();

  const denied = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await denied.addInitScript(() => {
    Object.defineProperty(Document.prototype, "fullscreenEnabled", { configurable: true, get: () => true });
    Object.defineProperty(Element.prototype, "requestFullscreen", {
      configurable: true,
      value: () => Promise.reject(new Error("fullscreen denied")),
    });
  });
  const second = await denied.newPage();
  second.on("pageerror", (error) => pageErrors.push(error.message));
  await second.goto(`${baseUrl}/read/${CHAPTER_IDS[1]}?manga=${MANGA_ID}&lang=vi`, { waitUntil: "networkidle" });
  await second.locator(".reader-page").first().waitFor();
  await second.getByRole("button", { name: "Đổi chế độ toàn màn hình" }).click();
  await second.waitForTimeout(200);
  assert.equal(await second.locator(".reader-page").count() > 0, true);
  await denied.close();

  assert.deepEqual(pageErrors.slice(before), [], `unexpected page errors: ${pageErrors.slice(before).join("; ")}`);
});
