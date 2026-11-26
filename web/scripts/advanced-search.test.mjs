import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { after, before, test } from "node:test";
import { chromium } from "playwright-core";
import { browserExecutable } from "./browser.mjs";
import { startHttpServer, startNext, stop } from "./test-helpers.mjs";

const EDGE = browserExecutable();
const TAGS = [
  { id: "11111111-1111-4111-8111-111111111111", name: "Action", group: "genre" },
  { id: "22222222-2222-4222-8222-222222222222", name: "Adventure", group: "theme" },
  { id: "33333333-3333-4333-8333-333333333333", name: "One-shot", group: "format" },
  { id: "44444444-4444-4444-8444-444444444444", name: "Violence", group: "content" },
];
const GROUP_TITLES = ["Thể loại chính", "Chủ đề", "Định dạng", "Nội dung"];
const MANGA = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  title: "Fixture Manga",
  cover_file: null,
  status: "ongoing",
  year: 2026,
  description: "Truyện dùng để kiểm tra tìm kiếm nâng cao.",
  tags: ["Action"],
  tag_ids: [TAGS[0].id],
  author: "Fixture Author",
  artist: "Fixture Author",
  rating: 8.5,
  follows: 12,
  latest_chapter: "1",
  source: "mangadex",
  source_label: "MangaDex",
};

let fixture;
let app;
let browser;
let tagsDelay = 0;

function json(res, body) {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

before(async () => {
  assert.ok(existsSync(EDGE), `browser executable missing: ${EDGE}`);
  fixture = await startHttpServer(async (req, res) => {
    const { pathname, searchParams } = new URL(req.url ?? "/", "http://content.local");
    if (pathname === "/api/content/tags") {
      if (tagsDelay) await new Promise((resolve) => setTimeout(resolve, tagsDelay));
      return json(res, TAGS);
    }
    if (pathname === "/api/content/search") {
      return json(res, { results: [MANGA], total: 1, partial: searchParams.get("q") === "partial" });
    }
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

async function openPage(width = 1280, height = 800) {
  const context = await browser.newContext({ viewport: { width, height } });
  return { context, page: await context.newPage() };
}

async function searchParams(page, path) {
  await page.goto(`${app.baseUrl}${path}`, { waitUntil: "networkidle" });
  await page.locator(".search-filters summary").click();
  return page.locator(".search-filters");
}

test("advanced form exposes source, language and year dropdowns and submits them with q and tags", async () => {
  const { context, page } = await openPage();
  const filters = await searchParams(page, `/search?q=Fixture&tags=${TAGS[0].id}`);
  const source = filters.getByRole("combobox", { name: "Nguồn" });
  const lang = filters.getByRole("combobox", { name: "Ngôn ngữ" });
  const year = filters.getByRole("combobox", { name: "Năm" });
  assert.equal(await source.count(), 1, "missing source dropdown");
  assert.equal(await lang.count(), 1, "missing language dropdown");
  assert.equal(await year.count(), 1, "missing year dropdown");

  await source.click();
  await page.getByRole("option", { name: "MangaDex", exact: true }).click();
  await lang.click();
  await page.getByRole("option", { name: "Tiếng Anh", exact: true }).click();
  await year.click();
  await page.getByRole("option", { name: "2025", exact: true }).click();
  await filters.getByRole("button", { name: "Áp dụng" }).click();

  await page.waitForURL((url) => url.searchParams.get("source") === "mangadex");
  const submitted = new URL(page.url()).searchParams;
  assert.equal(submitted.get("q"), "Fixture", "q must stay bookmarkable");
  assert.equal(submitted.get("tags"), TAGS[0].id, "tags must stay bookmarkable");
  assert.equal(submitted.get("lang"), "en");
  assert.equal(submitted.get("year"), "2025");
  assert.equal(submitted.has("page"), false);
  await context.close();
});

test("advanced panel holds four genre groups and a pill writes into tags", async () => {
  const { context, page } = await openPage();
  const filters = await searchParams(page, "/search");
  const groups = filters.locator(".genre-group");
  assert.equal(await groups.count(), 4, "expected four merged genre groups");
  assert.deepEqual(await groups.locator("h2").allTextContents(), GROUP_TITLES);

  await groups.nth(1).getByText("Adventure", { exact: true }).click();
  await filters.getByRole("button", { name: "Áp dụng" }).click();
  await page.waitForURL((url) => url.searchParams.has("tags"));
  assert.equal(new URL(page.url()).searchParams.get("tags"), TAGS[1].id);
  await context.close();
});

test("partial results render a short warning and full results do not", async () => {
  const { context, page } = await openPage();
  await page.goto(`${app.baseUrl}/search?q=partial`, { waitUntil: "networkidle" });
  const warning = page.locator(".partial-warning");
  await warning.waitFor();
  const text = (await warning.textContent())?.trim() ?? "";
  assert.match(text, /chưa đầy đủ|một phần|giới hạn/i);
  assert.ok(text.length > 0 && text.length < 160, `warning must stay short: ${text}`);

  await page.goto(`${app.baseUrl}/search?q=Fixture`, { waitUntil: "networkidle" });
  assert.equal(await page.locator(".partial-warning").count(), 0);
  await context.close();
});

test("/the-loai link is gone and the route returns 404 without redirect", async () => {
  const { context, page } = await openPage();
  await page.goto(`${app.baseUrl}/search`, { waitUntil: "networkidle" });
  assert.equal(await page.locator('a[href="/the-loai"]').count(), 0, "genre nav link must be gone");
  const response = await page.goto(`${app.baseUrl}/the-loai`, { waitUntil: "domcontentloaded" });
  assert.equal(response.status(), 404, "the-loai must not be redirected or served");
  assert.match(page.url(), /\/the-loai$/);
  await context.close();
});

test("advanced search has no horizontal overflow at 375px", async () => {
  const { context, page } = await openPage(375, 812);
  const filters = await searchParams(page, "/search");
  await filters.locator(".genre-group").first().waitFor();
  const sizes = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  assert.ok(
    sizes.scrollWidth <= sizes.viewport + 1 && sizes.bodyWidth <= sizes.viewport + 1,
    `375px advanced search overflowed horizontally: ${JSON.stringify(sizes)}`,
  );
  await context.close();
});

test("genre fallback reserves a group with at least eight pills on first render", async () => {
  tagsDelay = 2_000;
  const { context, page } = await openPage();
  try {
    await page.goto(`${app.baseUrl}/search`, { waitUntil: "commit" });
    const groups = page.locator(".search-filters .genre-group.skel");
    await groups.first().waitFor({ state: "attached" });
    assert.equal(await groups.count(), 1, "genre fallback needs one shared group");
    const pillCounts = await groups.evaluateAll((sections) => sections.map(
      (section) => section.querySelectorAll(".skel-pill").length,
    ));
    assert.ok(
      pillCounts.every((count) => count >= 8),
      `each genre fallback group needs >=8 pills: ${JSON.stringify(pillCounts)}`,
    );
    assert.ok(
      await page.locator('.search-filters [role="status"][aria-label="Đang tải thể loại"]').count() >= 1,
      "genre fallback needs an accessible status",
    );
  } finally {
    tagsDelay = 0;
    await context.close();
  }
});
