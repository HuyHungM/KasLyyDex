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

let unconfigured;
let configured;
let browser;
let pageErrors = [];

before(async () => {
  assert.ok(existsSync(EDGE), `browser executable missing: ${EDGE}`);
  browser = await chromium.launch({ executablePath: EDGE, headless: true });
  unconfigured = await startNext();
  configured = await startNext();
});

after(async () => {
  await browser?.close();
  await stop(configured?.child);
  await stop(unconfigured?.child);
});

async function open(baseUrl, viewport = { width: 1280, height: 800 }) {
  const context = await browser.newContext({ viewport, colorScheme: "dark" });
  const page = await context.newPage();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  return { context, page, baseUrl };
}

async function choose(page, label, option) {
  await page.getByRole("combobox", { name: label }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

function chosen(page, label) {
  return page.getByRole("combobox", { name: label }).locator(".select-value").textContent();
}

test("auth-not-configured is explicit and guest account pages stay usable", async () => {
  const { context, page, baseUrl } = await open(unconfigured.baseUrl);
  await page.goto(`${baseUrl}/tai-khoan`, { waitUntil: "networkidle" });
  await page.getByText("Chưa bật đăng nhập").waitFor();
  assert.equal(await page.locator('input[type="email"]').count(), 0, "no inert sign-in form when unconfigured");
  assert.match(await page.locator(".account-card").first().innerText(), /SESSION_SECRET/);
  await page.screenshot({ path: join(SHOT_DIR, "account-unconfigured.png") });

  await page.goto(`${baseUrl}/tai-khoan/cai-dat`, { waitUntil: "networkidle" });
  await choose(page, "Chế độ đọc", "Chuyển trang");
  await choose(page, "Nền", "Tối");
  await page.getByRole("button", { name: "Lưu cài đặt" }).click();
  await page.getByText("Đã lưu trên thiết bị này.").waitFor();
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await chosen(page, "Chế độ đọc"), "Chuyển trang");
  assert.equal(await chosen(page, "Nền"), "Tối");

  await page.evaluate(() => {
    localStorage.setItem("truyenviet:history", JSON.stringify([{
      mangaId: "m-local", mangaTitle: "Truyện địa phương", chapterId: "c-local", chapter: "3",
      title: "Chương 3", coverFile: null, lang: "vi", ts: Date.now(), page: 3, total: 12,
    }]));
    localStorage.setItem("truyenviet:library", JSON.stringify([{
      mangaId: "m-local", title: "Truyện địa phương", coverFile: null, lang: "vi", followedAt: Date.now(),
    }]));
  });
  await page.goto(`${baseUrl}/tai-khoan/lich-su`, { waitUntil: "networkidle" });
  await page.getByText("Truyện địa phương").waitFor();
  await page.goto(`${baseUrl}/tu-truyen`, { waitUntil: "networkidle" });
  assert.ok(await page.getByText("Truyện địa phương").count() >= 1);
  assert.ok(await page.getByRole("link", { name: /Tài khoản/ }).count() >= 1);
  await context.close();
});

test("session sign-in through a loopback fixture reaches the account UI", async () => {
  const { context, page, baseUrl } = await open(configured.baseUrl);
  await installIdentityFixture(context);
  await page.goto(`${baseUrl}/tai-khoan`, { waitUntil: "networkidle" });
  const email = page.locator('input[type="email"]');
  await email.waitFor();
  await email.fill("reader@example.com");
  await page.locator('input[type="password"]').fill("fixture-password");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await page.getByText("Đã đăng nhập").waitFor({ timeout: 15_000 });
  assert.ok((await page.locator(".account-card").first().innerText()).includes("reader@example.com"));
  await page.screenshot({ path: join(SHOT_DIR, "account-authenticated.png") });

  await page.getByRole("button", { name: "Đăng xuất" }).click();
  await page.locator('input[type="email"]').waitFor({ timeout: 15_000 });
  assert.equal(await page.getByText("Đã đăng nhập").count(), 0);
  await context.close();
});

test("no browser page errors were produced by account flows", () => {
  assert.deepEqual(pageErrors, []);
});
