import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { after, before, test } from "node:test";
import { chromium } from "playwright-core";
import { startHttpServer, startNext, stop } from "./test-helpers.mjs";

// Browser fixture: the SDK session is real (loopback Neon-auth fixture), while
// community API responses are intercepted at the browser boundary. That proves
// rendering, spoiler state, dialogs and authorized calls without a local
// PostgreSQL wire server; SQL ownership is covered in community.test.mjs.
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const MANGA_ID = "manga-fixture";
const COMMENT_ID = "comment-xss";
const SPOILER_ID = "comment-spoiler";

let contentFixture;
let authFixture;
let next;
let browser;
let baseUrl;
let cookies;
let pageErrors = [];

function json(res, body, status = 200) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

const manga = {
  id: MANGA_ID, title: "Fixture Manga", cover_file: null, status: "ongoing", year: 2026,
  description: "Browser fixture", tags: [], tag_ids: [], author: "", artist: "",
  rating: null, follows: null, latest_chapter: null,
};

const comments = {
  items: [
    {
      id: COMMENT_ID, targetType: "manga", targetId: MANGA_ID, parentId: null,
      userId: "google|other", authorName: "Other reader", status: "visible", spoiler: false,
      body: '<img src=x onerror="window.__xss=1">hello', createdAt: Date.now(), updatedAt: Date.now(), replies: [],
    },
    {
      id: SPOILER_ID, targetType: "manga", targetId: MANGA_ID, parentId: null,
      userId: "google|other", authorName: "Other reader", status: "visible", spoiler: true,
      body: "Spoiler nội dung", createdAt: Date.now() - 1000, updatedAt: Date.now() - 1000,
      replies: [{
        id: "reply-1", targetType: "manga", targetId: MANGA_ID, parentId: SPOILER_ID,
        userId: "google|other", authorName: "Reply reader", status: "visible", spoiler: false,
        body: "Một phản hồi", createdAt: Date.now(), updatedAt: Date.now(), replies: [],
      }],
    },
    {
      id: "comment-hidden", targetType: "manga", targetId: MANGA_ID, parentId: null,
      userId: "google|sdk-identity", authorName: "Fixture Reader", status: "hidden",
      spoiler: false, body: null, createdAt: Date.now() - 2000, updatedAt: Date.now() - 2000, replies: [],
    },
  ],
  nextCursor: null,
};

const notification = {
  id: "notif-1", type: "comment_reply", title: "Có phản hồi bình luận", body: "Một phản hồi mới",
  href: `/manga/${MANGA_ID}`, readAt: null, createdAt: Date.now(),
};

const notifications = {
  items: [notification, {
    id: "notif-2", type: "new_chapter", title: "Chương mới", body: "Fixture Manga — 2",
    href: null, readAt: null, createdAt: Date.now() - 1000,
  }],
  unreadCount: 2,
  nextCursor: null,
};

async function signedInPage(routes = []) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "dark" });
  await context.addCookies(cookies);
  for (const [pattern, handler] of routes) await context.route(pattern, handler);
  const page = await context.newPage();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  return { context, page };
}

before(async () => {
  assert.ok(existsSync(EDGE), `Edge is required: ${EDGE}`);
  contentFixture = await startHttpServer((req, res) => {
    const url = req.url ?? "";
    if (url.startsWith("/api/content/manga/") && url.endsWith("/chapters")) {
      return json(res, { vi: [], en: [] });
    }
    if (url.startsWith("/api/content/manga/")) return json(res, manga);
    return json(res, {});
  });
  authFixture = await startHttpServer((req, res) => {
    if (req.url?.includes("get-session")) {
      const signedIn = (req.headers.cookie ?? "").includes("session_token=fixture");
      return json(res, signedIn ? {
        session: { id: "session-opaque", userId: "google|sdk-identity", expiresAt: new Date(Date.now() + 86_400_000).toISOString() },
        user: {
          id: "google|sdk-identity", name: "Fixture Reader", email: "reader@example.com",
          emailVerified: true, image: null,
        },
      } : { session: null, user: null });
    }
    res.writeHead(200, {
      "content-type": "application/json",
      "set-cookie": "__Secure-neon-auth.session_token=fixture; Path=/; HttpOnly; SameSite=Lax",
    });
    res.end(JSON.stringify({ ok: true }));
  });
  next = await startNext({
    RUST_CONTENT_API_ORIGIN: contentFixture.baseUrl,
    NEON_AUTH_BASE_URL: `${authFixture.baseUrl}/neondb/auth`,
    NEON_AUTH_COOKIE_SECRET: "fixture-secret-with-at-least-32-characters",
  });
  baseUrl = next.baseUrl;
  browser = await chromium.launch({ executablePath: EDGE, headless: true });

  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${baseUrl}/tai-khoan`, { waitUntil: "networkidle" });
  await page.locator('input[type="email"]').fill("reader@example.com");
  await page.locator('input[type="password"]').fill("fixture-password");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await page.getByText("Đã đăng nhập").waitFor({ timeout: 15_000 });
  cookies = await context.cookies();
  await context.close();
});

after(async () => {
  await browser?.close();
  await stop(next?.child);
  await authFixture?.close();
  await contentFixture?.close();
});

test("comments render as plain text and spoilers stay concealed until revealed", async () => {
  const { context, page } = await signedInPage([
    ["**/api/v1/comments?*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(comments) })],
    ["**/api/v1/notifications?*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(notifications) })],
    ["**/api/v1/notifications/refresh", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ checked: 1, created: 0, skipped: false }) })],
    ["**/api/v1/moderation/access", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ moderator: false }) })],
  ]);
  try {
    await page.goto(`${baseUrl}/manga/${MANGA_ID}`, { waitUntil: "networkidle" });
    const section = page.locator(".comment-section");
    await section.waitFor();
    assert.equal(await page.evaluate(() => window.__xss ?? null), null, "comment script must not execute");
    assert.equal(await section.locator("img").count(), 0, "comment markup must never become an element");
    assert.ok((await section.textContent()).includes('<img src=x onerror="window.__xss=1">hello'), "raw text remains visible");
    assert.equal(await section.getByText("Spoiler nội dung").count(), 0, "spoiler body is not in the DOM before reveal");
    await section.getByRole("button", { name: "Nội dung có spoiler — bấm để xem" }).first().click();
    await section.getByText("Spoiler nội dung").waitFor();
    assert.ok((await section.textContent()).includes("Bình luận đã bị ẩn để kiểm duyệt"), "moderated bodies show status text only");
  } finally {
    await context.close();
  }
});

test("report dialog sends a bounded reason and displays API errors", async () => {
  const posts = [];
  const { context, page } = await signedInPage([
    ["**/api/v1/comments?*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(comments) })],
    ["**/api/v1/notifications?*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(notifications) })],
    ["**/api/v1/notifications/refresh", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ checked: 1, created: 0, skipped: false }) })],
    ["**/api/v1/moderation/access", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ moderator: false }) })],
    ["**/api/v1/reports", (route) => {
      posts.push({ method: route.request().method(), body: route.request().postDataJSON() });
      if (posts.length === 1) return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ report: { id: "r" } }) });
      return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: { code: "DUPLICATE_REPORT", message: "Báo cáo đã tồn tại.", details: {} } }) });
    }],
  ]);
  try {
    await page.goto(`${baseUrl}/manga/${MANGA_ID}`, { waitUntil: "networkidle" });
    const section = page.locator(".comment-section");
    await section.getByRole("button", { name: "Báo cáo" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Báo cáo bình luận" });
    await dialog.locator("textarea").fill("Nội dung spam");
    await dialog.getByRole("button", { name: "Gửi báo cáo" }).click();
    await section.getByText("Đã gửi báo cáo tới đội kiểm duyệt.").waitFor();
    assert.equal(posts[0].method, "POST");
    assert.equal(posts[0].body.commentId, COMMENT_ID);
    assert.equal(posts[0].body.reason, "Nội dung spam");

    await section.getByRole("button", { name: "Báo cáo" }).nth(1).click();
    await dialog.locator("textarea").fill("Báo cáo trùng");
    await dialog.getByRole("button", { name: "Gửi báo cáo" }).click();
    await section.getByRole("alert").filter({ hasText: "Báo cáo đã tồn tại." }).waitFor();
  } finally {
    await context.close();
  }
});

test("moderator queue calls authorized APIs and reports errors", async () => {
  const calls = [];
  const reportList = {
    items: [{
      id: "report-1", commentId: COMMENT_ID, reason: "spam", status: "open", createdAt: Date.now(),
      comment: {
        id: COMMENT_ID, targetType: "manga", targetId: MANGA_ID, parentId: null,
        userId: "google|other", authorName: "Other reader", status: "visible", spoiler: false,
        body: "bad comment", createdAt: Date.now(), updatedAt: Date.now(), replies: [],
      },
    }],
    nextCursor: null,
  };
  const { context, page } = await signedInPage([
    ["**/api/v1/moderation/reports?*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(reportList) })],
    ["**/api/v1/moderation/comments/*", (route) => {
      calls.push({ url: route.request().url(), body: route.request().postDataJSON(), method: route.request().method() });
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ comment: reportList.items[0].comment }) });
    }],
    ["**/api/v1/moderation/threads", (route) => {
      calls.push({ url: route.request().url(), body: route.request().postDataJSON(), method: route.request().method() });
      return route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: { code: "FORBIDDEN", message: "Không có quyền kiểm duyệt.", details: {} } }) });
    }],
    ["**/api/v1/notifications?*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(notifications) })],
    ["**/api/v1/notifications/refresh", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ checked: 1, created: 0, skipped: false }) })],
  ]);
  try {
    await page.goto(`${baseUrl}/kiem-duyet`, { waitUntil: "networkidle" });
    const queue = page.locator(".moderation-card");
    await queue.getByText("bad comment").waitFor();
    await queue.getByRole("button", { name: "Ẩn" }).click();
    await queue.getByText("Đã cập nhật.").waitFor();
    assert.ok(calls.some((call) => call.url.includes(`/api/v1/moderation/comments/${COMMENT_ID}`) && call.body.action === "hide" && call.method === "PATCH"));

    await queue.locator('input[maxlength="200"]').fill(MANGA_ID);
    await queue.getByRole("button", { name: "Áp dụng" }).click();
    await queue.getByRole("alert").filter({ hasText: "Không có quyền kiểm duyệt." }).waitFor();
    assert.ok(calls.some((call) => call.url.endsWith("/api/v1/moderation/threads") && call.body.locked === true && call.body.targetId === MANGA_ID));
  } finally {
    await context.close();
  }
});

test("notification center shows an unread badge and marks only owned ids read", async () => {
  const reads = [];
  let unreadCount = 2;
  const { context, page } = await signedInPage([
    ["**/api/v1/notifications/refresh", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ checked: 1, created: 0, skipped: false }) })],
    ["**/api/v1/notifications?*", (route) => route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ ...notifications, unreadCount }),
    })],
    ["**/api/v1/notifications/read", (route) => {
      reads.push(route.request().postDataJSON());
      unreadCount = 1;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ updated: 1 }) });
    }],
    ["**/api/v1/moderation/access", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ moderator: true }) })],
  ]);
  try {
    await page.goto(`${baseUrl}/thong-bao`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Thông báo" }).waitFor();
    await page.getByText("Có phản hồi bình luận").waitFor();
    const badge = page.locator(".notification-badge");
    assert.equal((await badge.textContent())?.trim(), "2");
    await page.getByRole("button", { name: "Đã đọc" }).first().click();
    await page.getByText("1 thông báo chưa đọc.").waitFor();
    assert.equal(reads.length, 1);
    assert.deepEqual(reads[0].ids, ["notif-1"]);
    assert.equal(pageErrors.length, 0, `unexpected page errors: ${pageErrors.join(" | ")}`);
  } finally {
    await context.close();
  }
});
