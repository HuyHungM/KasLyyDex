import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { after, before, test } from "node:test";
import { chromium } from "playwright-core";
import { browserExecutable } from "./browser.mjs";
import { startHttpServer, startNext, stop } from "./test-helpers.mjs";

const EDGE = browserExecutable();
const TAG_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CHAPTER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const manga = (index) => ({
  id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, "0")}`,
  title: `Fixture ${index}`,
  cover_file: "cover.jpg",
  status: "ongoing",
  year: 2026,
  description: "Truyện dùng để kiểm tra skeleton bảng xếp hạng.",
  tags: ["Action"],
  tag_ids: [TAG_ID],
  author: "Fixture Author",
  artist: "Fixture Author",
  rating: 9 - index * 0.1,
  follows: 100 - index,
  latest_chapter: "1",
  source: "mangadex",
  source_label: "MangaDex",
});
const books = Array.from({ length: 12 }, (_, index) => manga(index + 1));
const chapter = {
  id: CHAPTER_ID, chapter: "1", volume: null, title: "Chương 1", lang: "vi", pages: 1,
  external_url: null, publish_at: "2026-11-21T00:00:00Z", group: "Fixture", source: "mangadex", source_label: "MangaDex",
};

let fixture;
let app;
let browser;
let contentDelay = 1500;

function json(res, payload) {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

before(async () => {
  assert.ok(existsSync(EDGE), `browser executable missing: ${EDGE}`);
  fixture = await startHttpServer(async (req, res) => {
    const { pathname } = new URL(req.url ?? "/", "http://content.local");
    await new Promise((resolve) => setTimeout(resolve, contentDelay));
    if (pathname === "/api/content/rank") return json(res, books);
    if (pathname === "/api/content/latest") return json(res, books);
    if (pathname === "/api/content/tags") return json(res, [{ id: TAG_ID, name: "Action", group: "genre" }]);
    if (pathname === "/api/content/search") return json(res, { results: books, total: books.length });
    if (pathname.startsWith("/api/content/manga/") && pathname.endsWith("/chapters")) return json(res, { vi: [chapter], en: [] });
    if (pathname.startsWith("/api/content/manga/")) return json(res, books[0]);
    if (pathname.startsWith("/api/content/chapter/")) return json(res, chapter);
    return json(res, { results: [], total: 0 });
  });
  app = await startNext({ RUST_CONTENT_API_ORIGIN: `${fixture.baseUrl}/api/content` });
  browser = await chromium.launch({ executablePath: EDGE, headless: true });
});

after(async () => {
  await browser?.close();
  await stop(app?.child);
  await fixture?.close();
});

async function openPage(options = {}) {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, ...options });
  return { context, page: await context.newPage() };
}

async function assertNoOverflow(page, label) {
  const sizes = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  assert.ok(sizes.scroll <= sizes.viewport + 1 && sizes.body <= sizes.viewport + 1,
    `${label} overflowed horizontally: ${JSON.stringify(sizes)}`);
}

const SKELETON = ".rank-list .rank-row.skel";
const REAL = ".rank-list .rank-row:not(.skel)";

test("route loading shell shows intro, tabs and 12 shape-matched skeleton rows", async () => {
  contentDelay = 1500;
  const { context, page } = await openPage();
  await page.goto(`${app.baseUrl}/bxh?kind=follows`, { waitUntil: "commit" });
  await page.locator(SKELETON).first().waitFor();

  assert.match(await page.locator(".page-intro h1").first().textContent(), /Bảng xếp hạng/);
  assert.equal(await page.locator(".rank-tabs a").count(), 3, "loading shell needs the three tabs");
  assert.equal(await page.locator(".rank-list > li").count(), 12, "loading shell needs 12 skeleton rows");

  const status = await page.locator(".rank-list").first().evaluate((el) => ({
    role: el.getAttribute("role"), label: el.getAttribute("aria-label"),
  }));
  assert.equal(status.role, "status");
  assert.ok(status.label, "skeleton needs an accessible name");

  const frames = await page.locator(SKELETON).evaluateAll((rows) => rows.slice(0, 4).map((row) => row.className));
  for (const rank of [1, 2, 3]) {
    assert.match(frames[rank - 1], new RegExp(`rank-top\\b.*\\brank-${rank}\\b|rank-${rank}\\b.*\\brank-top\\b`),
      `skeleton row ${rank} needs rank-top rank-${rank}`);
  }
  assert.doesNotMatch(frames[3], /rank-top/, "skeleton row 4 must not be framed");
  assert.equal(await page.locator(`${SKELETON}.podium-card`).count(), 3, "skeleton needs three podium cards");
  assert.equal(await page.locator(".rank-podium .skel .podium-tag").count(), 3, "podium skeletons need rank label slots");

  const skeletonBox = await page.locator(SKELETON).first().boundingBox();
  assert.ok(skeletonBox && skeletonBox.width > 0 && skeletonBox.height > 0);
  await assertNoOverflow(page, "375px /bxh skeleton");

  contentDelay = 0;
  await page.locator(`${REAL}`).first().waitFor();
  assert.equal(await page.locator(REAL).count(), 12, "ranking needs 12 real rows");

  const realFrames = await page.locator(REAL).evaluateAll((rows) => rows.slice(0, 4).map((row) => row.className));
  for (const rank of [1, 2, 3]) {
    assert.match(realFrames[rank - 1], new RegExp(`rank-top\\b.*\\brank-${rank}\\b|rank-${rank}\\b.*\\brank-top\\b`),
      `real row ${rank} needs rank-top rank-${rank}`);
  }
  assert.doesNotMatch(realFrames[3], /rank-top/, "real row 4 must not be framed");

  const shadows = await page.locator(REAL).evaluateAll((rows) =>
    rows.slice(0, 3).map((row) => getComputedStyle(row).boxShadow));
  assert.ok(shadows.every((shadow) => shadow && shadow !== "none"), "top 3 rows need visible frames");
  assert.equal(new Set(shadows).size, 3, "top 3 rows need distinct frame styles");

  const podium = page.locator(`${REAL}.podium-card`);
  assert.equal(await podium.count(), 3, "ranking needs three podium cards");
  assert.deepEqual(await page.locator(".rank-podium .podium-tag").allTextContents(), ["HẠNG 1", "HẠNG 2", "HẠNG 3"]);
  const [gold, silver, bronze] = await Promise.all([0, 1, 2].map((i) => podium.nth(i).boundingBox()));
  assert.ok(gold.width > silver.width + 40, `rank 1 must dominate: ${gold.width} vs ${silver.width}`);
  assert.ok(Math.abs(silver.y - bronze.y) <= 1, "ranks 2 and 3 must share a row at 375px");

  const realBox = await page.locator(REAL).first().boundingBox();
  assert.ok(Math.abs(realBox.width - skeletonBox.width) <= 2, `skeleton width shifted: ${skeletonBox.width} vs ${realBox.width}`);
  assert.ok(Math.abs(realBox.height - skeletonBox.height) <= 2, `skeleton height shifted: ${skeletonBox.height} vs ${realBox.height}`);
  await assertNoOverflow(page, "375px /bxh loaded");
  await context.close();
});

test("changing kind shows the skeleton again before the new data", async () => {
  contentDelay = 0;
  const { context, page } = await openPage();
  await page.goto(`${app.baseUrl}/bxh?kind=follows`, { waitUntil: "commit" });
  await page.locator(REAL).first().waitFor();

  contentDelay = 1500;
  await page.locator('.rank-tabs a[href="/bxh?kind=rating"]').click();
  await page.locator(SKELETON).first().waitFor({ timeout: 10_000 });
  assert.equal(await page.locator(".rank-list > li").count(), 12, "kind switch must re-show 12 skeleton rows");

  contentDelay = 0;
  await page.locator(REAL).first().waitFor();
  assert.equal(await page.locator(REAL).count(), 12);
  await context.close();
});

test("shimmer is guarded by reduced motion on the ranking skeleton", async () => {
  for (const reducedMotion of ["no-preference", "reduce"]) {
    contentDelay = 1500;
    const { context, page } = await openPage({ reducedMotion });
    await page.goto(`${app.baseUrl}/bxh`, { waitUntil: "commit" });
    const skeleton = page.locator(`${SKELETON}:visible`).first();
    await skeleton.waitFor();
    await page.waitForFunction((selector) => {
      const row = Array.from(document.querySelectorAll(selector)).find((el) => el.getClientRects().length > 0);
      return !!row && getComputedStyle(row).animationName !== "";
    }, SKELETON);
    const animation = await skeleton.evaluate((el) => getComputedStyle(el).animationName);
    if (reducedMotion === "reduce") assert.equal(animation, "none", "reduced motion must disable shimmer");
    else assert.match(animation, /shimmer/, "normal motion needs shimmer");
    await assertNoOverflow(page, `375px /bxh skeleton (${reducedMotion})`);
    await context.close();
  }
});
