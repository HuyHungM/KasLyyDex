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

const profile = {
  id: USER_ID,
  username: "reader.one",
  displayName: "Reader One",
  avatarUrl: null,
  bio: "",
  level: 1,
  totalXp: 0,
  title: "Phàm Nhân",
};

const progressItem = {
  mangaId: "m1", chapterId: "c1", lang: "vi", chapter: "1", title: "Chapter 1",
  coverFile: null, page: 1, total: 10, maxPage: 1, lastReadAt: Date.now(), revision: 1,
};

const report = {
  id: "r1", commentId: "c1", reason: "spam", status: "open", createdAt: Date.now(),
  comment: {
    id: "c1", targetType: "manga", targetId: "m1", parentId: null, userId: "u2",
    authorName: "Spammer", authorLevel: 1, body: "bad", spoiler: false, status: "visible",
    createdAt: Date.now(), updatedAt: Date.now(), replies: [],
  },
};

const progressItems = Array.from({ length: 4 }, (_, index) => ({
  ...progressItem,
  chapterId: `c${index}`,
  mangaId: `m${index}`,
}));

const reports = Array.from({ length: 4 }, (_, index) => ({
  ...report,
  id: `r${index}`,
  commentId: `c${index}`,
}));

const notifications = Array.from({ length: 3 }, (_, index) => ({
  id: `n${index}`,
  type: "chapter",
  title: `Chương mới ${index}`,
  body: "Có chương mới",
  href: "/manga/m1",
  readAt: null,
  createdAt: Date.now(),
}));

const bodies = {
  "**/api/v1/me": { profile, settings: { mode: "vertical", fit: true, bg: "auto", speed: 3 } },
  "**/api/v1/me/level": { level: 1, totalXp: 0, title: "Phàm Nhân", realm: "Phàm Nhân", source: "xp", ruleVersion: "1" },
  "**/api/v1/me/progress": { items: progressItems },
  "**/api/v1/moderation/reports**": { items: reports, nextCursor: null },
  "**/api/v1/moderation/access": { moderator: true },
  "**/api/v1/notifications**": { items: notifications, unreadCount: notifications.length, nextCursor: null },
};

async function open() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await installIdentityFixture(context, { signedIn: true, userId: USER_ID });
  for (const [pattern, body] of Object.entries(bodies)) {
    await context.route(pattern, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });
  }
  const page = await context.newPage();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  return { context, page };
}

async function box(page, selector) {
  return page.locator(selector).first().evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { width: Math.round(rect.width), height: Math.round(rect.height) };
  });
}

async function compare(page, label, skeletonWrapper, skeletonRow, loadedWrapper, loadedRow) {
  const skeleton = { wrapper: await box(page, skeletonWrapper), row: await box(page, skeletonRow) };
  assert.ok(skeleton.wrapper.width > 0 && skeleton.row.width > 0, `${label} skeleton missing`);
  await page.locator(loadedRow).first().waitFor({ timeout: 15000 });
  const loaded = { wrapper: await box(page, loadedWrapper), row: await box(page, loadedRow) };
  for (const key of ["wrapper", "row"]) {
    assert.ok(Math.abs(skeleton[key].width - loaded[key].width) <= 2, `${label} ${key} width shifted`);
    assert.ok(Math.abs(skeleton[key].height - loaded[key].height) <= 2, `${label} ${key} height shifted`);
  }
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

test("history skeleton matches the synced history list", async () => {
  const { context, page } = await open();
  await page.goto(`${app.baseUrl}/tai-khoan/lich-su`, { waitUntil: "commit" });
  await page.locator(".history-list[role=status]").waitFor();
  await compare(page, "history", ".history-list[role=status]", ".history-row.skel", ".history-list:not([role=status])", ".history-list:not([role=status]) .history-row");
  await page.screenshot({ path: join(SHOT_DIR, "skeleton-history.png"), fullPage: true });
  await context.close();
});

test("moderation skeleton matches the moderation queue", async () => {
  const { context, page } = await open();
  await page.goto(`${app.baseUrl}/kiem-duyet`, { waitUntil: "commit" });
  await page.locator(".moderation-card[role=status]").waitFor();
  await compare(page, "moderation", ".moderation-card[role=status]", ".moderation-row.skel", ".moderation-card:not([role=status])", ".moderation-card:not([role=status]) .moderation-row");
  await page.screenshot({ path: join(SHOT_DIR, "skeleton-moderation.png"), fullPage: true });
  await context.close();
});

test("compact notification skeleton matches the bell panel rows", async () => {
  const { context, page } = await open();
  await page.goto(`${app.baseUrl}/`, { waitUntil: "networkidle" });
  await page.locator(".notification-bell").click();
  await page.locator(".notification-panel .notification-list[role=status]").waitFor();
  await compare(page, "notification", ".notification-panel .notification-list[role=status]", ".notification-item.skel", ".notification-panel .notification-list:not([role=status])", ".notification-panel .notification-list:not([role=status]) .notification-item");
  await context.close();
});

test("no browser errors were produced by skeleton audits", () => {
  assert.deepEqual([...new Set(pageErrors)].slice(0, 5), []);
});
