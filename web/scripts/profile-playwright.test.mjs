import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { chromium } from "playwright-core";
import { browserExecutable } from "./browser.mjs";
import { installIdentityFixture } from "./identity-fixture.mjs";
import { startNext, stop, webDir } from "./test-helpers.mjs";

const EDGE = browserExecutable();
const SHOT_DIR = join(webDir, ".test-screenshots");
const USER_ID = "user-1";

let app;
let browser;
let pageErrors = [];

function entry(targetId, body) {
  return {
    targetType: "manga",
    targetId,
    mangaId: targetId,
    title: `Manga ${targetId}`,
    coverFile: null,
    chapterLabel: null,
    body,
    createdAt: Date.now() - 3600_000,
  };
}

function payload(saved) {
  return {
    id: USER_ID,
    username: "reader.one",
    displayName: "Reader One",
    avatarUrl: null,
    bio: "Thích isekai",
    title: "Luyện khí",
    level: 3,
    totalXp: 120,
    joinedAt: Date.now() - 30 * 86_400_000,
    stats: { chaptersRead: 4, following: 2, comments: 3, posted: 2, participating: 1, saved: saved ? 1 : 0 },
    topTags: ["Action", "Isekai"],
    posted: [entry("m1", "root mới nhất")],
    participating: [entry("m2", "reply gần nhất")],
    recent: [entry("m1", "root mới nhất")],
    saved,
    savedTotal: 1,
    truncated: { posted: false, participating: false, recent: false, saved: false },
  };
}

async function open({ signedIn = false, saved = null } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await installIdentityFixture(context, { signedIn, userId: USER_ID });
  await context.route("**/api/v1/notifications**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], unreadCount: 0, nextCursor: null }) });
  });
  await context.route("**/api/v1/users/**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload(saved)) });
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") pageErrors.push(message.text()); });
  page.on("response", (response) => { if (response.status() >= 400) pageErrors.push(`${response.status()} ${response.url()}`); });
  return { context, page };
}

async function geometry(page, phase) {
  return page.evaluate((name) => {
    const root = document.querySelector(`.profile-page${name === "skeleton" ? ".profile-skeleton" : ":not(.profile-skeleton)"}`);
    const pick = (selector) => {
      const element = root?.querySelector(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { width: Math.round(rect.width), height: Math.round(rect.height) };
    };
    return {
      header: pick(".profile-header"),
      stats: pick(".profile-stats"),
      entry: pick(".profile-entry"),
      shelf: pick(".shelf-grid"),
    };
  }, phase);
}

before(async () => {
  assert.ok(existsSync(EDGE), `browser executable missing: ${EDGE}`);
  browser = await chromium.launch({ executablePath: EDGE, headless: true });
  app = await startNext();
});

after(async () => {
  await browser?.close();
  await stop(app?.child);
});

test("guest profile shows shape-matched skeletons and public data only", async () => {
  const { context, page } = await open();
  await page.goto(`${app.baseUrl}/thanh-vien/${USER_ID}`, { waitUntil: "domcontentloaded" });
  await page.locator(".profile-page.profile-skeleton").waitFor();
  const skeletonText = await page.locator(".profile-page.profile-skeleton").innerText();
  assert.doesNotMatch(skeletonText, /Đang tải|Đang mở/);
  const beforeGeometry = await geometry(page, "skeleton");

  await page.locator(".profile-page:not(.profile-skeleton) .profile-entry").first().waitFor();
  const afterGeometry = await geometry(page, "loaded");
  for (const key of ["header", "stats", "entry", "shelf"]) {
    assert.ok(beforeGeometry[key] && afterGeometry[key], `${key} missing in one phase`);
    assert.ok(Math.abs(beforeGeometry[key].width - afterGeometry[key].width) <= 2, `${key} width shifted`);
    assert.ok(Math.abs(beforeGeometry[key].height - afterGeometry[key].height) <= 2, `${key} height shifted`);
  }
  assert.ok(await page.getByText("Chỉ chủ nhân xem được").count() >= 1);
  assert.match(await page.locator(".profile-entry").first().innerText(), /root mới nhất/);

  const sizes = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  assert.ok(sizes.scrollWidth <= sizes.viewport + 1, `overflow: ${JSON.stringify(sizes)}`);
  await page.screenshot({ path: join(SHOT_DIR, "profile-guest.png"), fullPage: true });
  await context.close();
});

test("owner profile shows the saved shelf", async () => {
  const { context, page } = await open({ signedIn: true, saved: [{ mangaId: "m1", title: "Manga m1", coverFile: null, lang: "vi", status: "reading", followedAt: Date.now(), lastChapterId: null, lastReadPublish: 0, revision: 1 }] });
  await page.goto(`${app.baseUrl}/thanh-vien/${USER_ID}`, { waitUntil: "domcontentloaded" });
  await page.locator(".profile-page:not(.profile-skeleton) .shelf-card").first().waitFor();
  assert.ok(await page.locator(".shelf-card").count() >= 1);
  await page.screenshot({ path: join(SHOT_DIR, "profile-owner.png"), fullPage: true });
  await context.close();
});

test("no browser errors were produced by profile flows", () => {
  assert.deepEqual([...new Set(pageErrors)].slice(0, 5), []);
});
