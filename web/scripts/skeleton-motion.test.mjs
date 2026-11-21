import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { chromium } from "playwright-core";
import { browserExecutable } from "./browser.mjs";
import { pagePng } from "./image-fixtures.mjs";
import { startHttpServer, startNext, stop, webDir } from "./test-helpers.mjs";

const EDGE = browserExecutable();
const CSS = readFileSync(join(webDir, "app/globals.css"), "utf8").replace(/^@import[^;]+;\s*/, "");
const TAG_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const MANGA_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CHAPTER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const IMAGE_URL = `https://uploads.mangadex.org/data/hash/page-1.png`;
const PAGE_IMAGE = pagePng(0);

const manga = {
  id: MANGA_ID,
  title: "Fixture Manga",
  cover_file: "cover.jpg",
  status: "ongoing",
  year: 2026,
  description: "Truyện dùng để kiểm tra skeleton.",
  tags: ["Action"],
  tag_ids: [TAG_ID],
  author: "Fixture Author",
  artist: "Fixture Author",
  rating: 8.5,
  follows: 12,
  latest_chapter: "1",
  source: "mangadex",
  source_label: "MangaDex",
};
const chapter = {
  id: CHAPTER_ID,
  chapter: "1",
  volume: null,
  title: "Chương 1",
  lang: "vi",
  pages: 2,
  external_url: null,
  publish_at: "2026-11-21T00:00:00Z",
  group: "Fixture",
  source: "mangadex",
  source_label: "MangaDex",
};
const chapters = { vi: [chapter], en: [] };

let fixture;
let app;
let browser;
let contentDelay = 1200;

function json(res, payload) {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

before(async () => {
  assert.ok(existsSync(EDGE), `browser executable missing: ${EDGE}`);
  fixture = await startHttpServer(async (req, res) => {
    const { pathname } = new URL(req.url ?? "/", "http://content.local");
    await new Promise((resolve) => setTimeout(resolve, contentDelay));
    if (pathname === "/api/content/rank") return json(res, [manga]);
    if (pathname === "/api/content/latest") return json(res, [{ ...manga, chapters: [{ ...chapter, publish_at: chapter.publish_at }] }]);
    if (pathname === "/api/content/tags") return json(res, [{ id: TAG_ID, name: "Action", group: "genre" }]);
    if (pathname === "/api/content/search") return json(res, { results: [manga], total: 1 });
    if (pathname === `/api/content/manga/${MANGA_ID}`) return json(res, manga);
    if (pathname === `/api/content/manga/${MANGA_ID}/chapters`) return json(res, chapters);
    if (pathname === `/api/content/chapter/${CHAPTER_ID}/pages`) {
      return json(res, { pages: [`/api/content/img?u=${encodeURIComponent(IMAGE_URL)}`] });
    }
    if (pathname === `/api/content/chapter/${CHAPTER_ID}`) return json(res, { ...chapter, manga_id: MANGA_ID });
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
    scrollWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  assert.ok(
    sizes.scrollWidth <= sizes.viewport + 1 && sizes.bodyWidth <= sizes.viewport + 1,
    `${label} overflowed horizontally: ${JSON.stringify(sizes)}`,
  );
}

async function assertStatus(container) {
  assert.ok(await container.count(), `missing skeleton container`);
  const status = await container.evaluate((element) => ({
    role: element.getAttribute("role"),
    label: element.getAttribute("aria-label"),
    text: element.textContent?.trim() ?? "",
  }));
  assert.equal(status.role, "status");
  assert.ok(status.label || status.text, "skeleton status needs an accessible name");
}

test("home, search and manga fallbacks use shape-matched skeletons with accessible status", async () => {
  const { context, page } = await openPage();
  await page.goto(app.baseUrl, { waitUntil: "commit" });
  await page.locator(".skel-hero:visible").waitFor();

  await assertStatus(page.locator(".skel-hero:visible"));
  await assertStatus(page.locator(".popular-rail:has(.skel-card):visible"));
  await assertStatus(page.locator(".chapter-feed:has(.skel-feed):visible"));
  await assertStatus(page.locator(".rank-list:has(.skel-rank):visible"));
  assert.ok(await page.locator(".skel-card:visible").count() >= 4, "popular rail needs card skeletons");
  assert.ok(await page.locator(".skel-feed:visible").count() >= 2, "feed needs row skeletons");
  assert.ok(await page.locator(".skel-rank:visible").count() >= 3, "rank needs row skeletons");

  const skeletonBoxes = {
    hero: await page.locator(".skel-hero:visible").boundingBox(),
    card: await page.locator(".skel-card:visible .card-cover").first().boundingBox(),
    feed: await page.locator(".skel-feed:visible .feed-cover").first().boundingBox(),
    rank: await page.locator(".skel-rank:visible .rank-row").first().boundingBox(),
  };
  assert.ok(skeletonBoxes.hero.height >= 300, "hero skeleton must reserve hero height");
  for (const [name, box] of Object.entries(skeletonBoxes)) assert.ok(box && box.width > 0, `${name} skeleton has no box`);

  await assertNoOverflow(page, "375px home skeleton");

  contentDelay = 0;
  await page.locator(".feature h1:visible").waitFor();
  await page.locator(".popular-rail .card:visible").first().waitFor();
  await page.locator(".feed-row:visible").first().waitFor();
  await page.locator(".rank-list .rank-row:visible").first().waitFor();
  await assertNoOverflow(page, "375px home loaded");

  const loadedBoxes = {
    card: await page.locator(".popular-rail .card-cover:visible").first().boundingBox(),
    feed: await page.locator(".feed-row:visible .feed-cover").first().boundingBox(),
    rank: await page.locator(".rank-list .rank-row:visible").first().boundingBox(),
  };
  for (const key of Object.keys(loadedBoxes)) {
    assert.ok(Math.abs(loadedBoxes[key].width - skeletonBoxes[key].width) <= 2, `${key} skeleton width shifted`);
  }
  assert.match(await page.locator(".card-title:visible").first().textContent(), /MangaDex/, "source label must stay visible");

  contentDelay = 1200;
  await page.goto(`${app.baseUrl}/search?q=Fixture`, { waitUntil: "commit" });
  await page.locator(".skel-card:visible").first().waitFor();
  await assertStatus(page.locator(".manga-grid:has(.skel-card):visible"));
  assert.ok(await page.locator(".skel-card:visible").count() >= 4, "search needs card skeletons");
  await assertNoOverflow(page, "375px search skeleton");
  contentDelay = 0;
  await page.locator(".manga-grid .card-title:visible").first().waitFor();
  await assertNoOverflow(page, "375px search loaded");

  contentDelay = 1200;
  await page.goto(`${app.baseUrl}/manga/${MANGA_ID}`, { waitUntil: "commit" });
  await page.locator(".skel-chapter:visible").first().waitFor();
  await assertStatus(page.locator(".manga-head:has(.skel-cover):visible"));
  await assertStatus(page.locator(".chapters-panel:has(.skel-chapter):visible"));
  assert.ok(await page.locator(".skel-chapter:visible").count() >= 3, "chapter list needs row skeletons");
  await assertNoOverflow(page, "375px manga skeleton");
  contentDelay = 0;
  await page.locator(".chapter-row:visible").first().waitFor();
  await assertNoOverflow(page, "375px manga loaded");
  assert.match(await page.locator(".manga-title:visible").textContent(), /MangaDex/, "source label must stay visible");
  await context.close();
});

test("motion tokens exist and every transition is guarded by reduced motion", async () => {
  const cssTokens = await (async () => {
    const { context, page } = await openPage();
    await page.setContent("<!doctype html><html><body></body></html>");
    await page.addStyleTag({ content: CSS });
    const tokens = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      return {
        fast: style.getPropertyValue("--dur-fast").trim(),
        base: style.getPropertyValue("--dur-base").trim(),
        ease: style.getPropertyValue("--ease-out").trim(),
      };
    });
    await context.close();
    return tokens;
  })();
  assert.ok(cssTokens.fast && cssTokens.base && cssTokens.ease, `missing motion tokens: ${JSON.stringify(cssTokens)}`);
  assert.match(CSS, /progress::(-moz-progress-bar|-webkit-progress-value)[^{]+\{[^}]*var\(--dur-base\)/, "progress bar needs a tokenized transition");

  const markup = `
    <div class="skel" id="skel"><div class="skel-line"></div></div>
    <div class="card" id="card"><div class="card-cover"><img id="cover" /></div></div>
    <div class="reader-page" id="page" data-loaded="false"></div>
    <div class="reader-paged"><img class="reader-page img-fade" id="paged" data-loaded="true" /></div>
    <progress id="progress" max="100" value="50"></progress>
    <span class="select-chevron" id="chevron"></span>`;

  async function motionContext(reducedMotion) {
    const { context, page } = await openPage({ reducedMotion });
    await page.setContent(`<!doctype html><html><body>${markup}</body></html>`);
    await page.addStyleTag({ content: CSS });
    return { context, page };
  }

  const normal = await motionContext("no-preference");
  const normalStyles = await normal.page.evaluate(() => ({
    skeleton: getComputedStyle(document.querySelector("#skel")).animationName,
    chevron: getComputedStyle(document.querySelector("#chevron")).transitionDuration,
    progress: getComputedStyle(document.querySelector("#progress")).transitionDuration,
    reader: getComputedStyle(document.querySelector("#page")).transitionDuration,
    paged: getComputedStyle(document.querySelector("#paged")).transitionDuration,
  }));
  assert.match(normalStyles.skeleton, /breathe|shimmer/);
  assert.notEqual(normalStyles.chevron, "0s");
  assert.notEqual(normalStyles.progress, "0s");
  assert.notEqual(normalStyles.reader, "0s");
  assert.notEqual(normalStyles.paged, "0s");
  await normal.context.close();

  const reduced = await motionContext("reduce");
  const reducedStyles = await reduced.page.evaluate(() => ({
    skeleton: getComputedStyle(document.querySelector("#skel")).animationName,
    chevron: getComputedStyle(document.querySelector("#chevron")).transitionDuration,
    progress: getComputedStyle(document.querySelector("#progress")).transitionDuration,
    reader: getComputedStyle(document.querySelector("#page")).transitionDuration,
    paged: getComputedStyle(document.querySelector("#paged")).transitionDuration,
  }));
  assert.equal(reducedStyles.skeleton, "none");
  for (const [name, duration] of Object.entries(reducedStyles)) {
    if (name !== "skeleton") assert.equal(duration, "0s", `${name} must not animate under reduced motion`);
  }
  await reduced.context.close();
});

test("reader page images keep a page-shaped skeleton, then fade in after load/decode", async () => {
  contentDelay = 0;
  for (const reducedMotion of ["no-preference", "reduce"]) {
    let releaseImages;
    const imageGate = new Promise((resolve) => { releaseImages = resolve; });
    const { context, page } = await openPage({ reducedMotion });
    await page.route("**/api/content/img*", async (route) => {
      await imageGate;
      await route.fulfill({ status: 200, contentType: "image/png", body: PAGE_IMAGE });
    });
    await page.goto(`${app.baseUrl}/read/${CHAPTER_ID}?manga=${MANGA_ID}&lang=vi`, { waitUntil: "domcontentloaded" });
    const image = page.locator('.reader-page[data-index="0"]');
    await image.waitFor();

    const before = await image.evaluate((element) => ({
      loaded: element.getAttribute("data-loaded"),
      fade: element.classList.contains("img-fade"),
      opacity: getComputedStyle(element).opacity,
      background: getComputedStyle(element).backgroundColor,
      animation: getComputedStyle(element).animationName,
      width: element.getBoundingClientRect().width,
    }));
    assert.equal(before.loaded, "false", "page image must start unloaded");
    assert.equal(before.fade, true, "page image needs the fade-in class");
    assert.equal(before.opacity, "0", "page image must not appear before load");
    assert.notEqual(before.background, "rgba(0, 0, 0, 0)", "unloaded page needs a skeleton frame");
    assert.equal(before.animation, "none", "fade must wait for decode");
    assert.ok(before.width > 0);
    await assertNoOverflow(page, `375px reader skeleton (${reducedMotion})`);

    releaseImages();
    await page.waitForFunction(() => document.querySelector('.reader-page[data-index="0"]')?.getAttribute("data-loaded") === "true");
    await page.waitForTimeout(300);
    const after = await image.evaluate(async (element) => {
      await element.decode();
      return {
        opacity: getComputedStyle(element).opacity,
        animation: getComputedStyle(element).animationName,
        width: element.naturalWidth,
      };
    });
    assert.ok(after.width > 0, "decoded image has no pixels");
    assert.equal(after.opacity, "1", "loaded image must be visible");
    assert.equal(after.animation, reducedMotion === "reduce" ? "none" : "img-in");
    await assertNoOverflow(page, `375px reader loaded (${reducedMotion})`);
    await page.unroute("**/api/content/img*");
    await context.close();
  }
});

test("broken reader images are released from the skeleton gate on error, without faking decode", async () => {
  contentDelay = 0;
  for (const mode of ["vertical", "horizontal"]) {
    const { context, page } = await openPage();
    if (mode === "horizontal") {
      await context.addInitScript(() => {
        localStorage.setItem("truyenviet:reader", JSON.stringify({ mode: "horizontal", fit: false, bg: "light", speed: 2 }));
      });
    }
    await page.route("**/api/content/img*", (route) => route.abort("failed"));
    await page.goto(`${app.baseUrl}/read/${CHAPTER_ID}?manga=${MANGA_ID}&lang=vi`, { waitUntil: "domcontentloaded" });
    const selector = mode === "horizontal" ? '.reader-paged .reader-page[data-index="0"]' : '.reader-page[data-index="0"]';
    const image = page.locator(selector);
    await image.waitFor();
    await page.waitForFunction(
      (sel) => document.querySelector(sel)?.getAttribute("data-loaded") === "true",
      selector,
      { timeout: 5000 },
    );
    await page.waitForTimeout(400); // let the release animation settle
    const state = await image.evaluate((element) => ({
      loaded: element.getAttribute("data-loaded"),
      opacity: getComputedStyle(element).opacity,
      background: getComputedStyle(element).backgroundColor,
      naturalWidth: element.naturalWidth,
    }));
    assert.equal(state.loaded, "true", "onError must release the fade gate");
    assert.equal(state.naturalWidth, 0, "a broken image must not be reported as decoded");
    assert.equal(state.opacity, "1", "broken image must be visible, not stuck at opacity 0");
    assert.equal(state.background, "rgba(0, 0, 0, 0)", "error must not keep the permanent skeleton frame");
    await page.unroute("**/api/content/img*");
    await context.close();
  }
});
