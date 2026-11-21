import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, beforeEach, test } from "node:test";
import { chromium } from "playwright-core";
import { browserExecutable } from "./browser.mjs";

const guest = await import("../lib/guest.ts");
const validators = await import("../lib/validators.ts");

class MemoryStorage {
  constructor(seed = {}) {
    this.data = new Map(Object.entries(seed));
  }
  getItem(key) {
    return this.data.has(key) ? this.data.get(key) : null;
  }
  setItem(key, value) {
    this.data.set(key, String(value));
  }
}

function seedSettings(value) {
  globalThis.localStorage = new MemoryStorage(
    value === null ? {} : { [guest.KEYS.reader]: JSON.stringify(value) },
  );
}

beforeEach(() => {
  seedSettings(null);
});

// Real cascade check: feed the site theme and reader rules from globals.css
// into a headless page, no app server required.
const cssSource = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const themeCss = [...cssSource.matchAll(
  /(?::root(?:\[data-theme="light"\])?|\.reader(?:\[data-bg="[^"]+"\])?)\s*\{[^}]*\}/g,
)].map((match) => match[0]).join("\n");

let browser;
before(async () => {
  browser = await chromium.launch({ executablePath: browserExecutable(), headless: true });
});
after(async () => {
  await browser?.close();
});

async function mount(page, bg, theme) {
  await page.evaluate(({ source, bg, theme }) => {
    document.documentElement.dataset.theme = theme;
    document.querySelector("style[data-theme-css]")?.remove();
    const style = document.createElement("style");
    style.dataset.themeCss = "true";
    style.textContent = source;
    document.head.append(style);
    document.querySelector(".reader")?.remove();
    const reader = document.createElement("div");
    reader.className = "reader";
    reader.dataset.bg = bg;
    reader.textContent = "reader";
    document.body.append(reader);
  }, { source: themeCss, bg, theme });
}

async function openHarness(bg, theme) {
  const context = await browser.newContext();
  await context.route("http://theme.test/", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: "<!doctype html><html><head></head><body></body></html>",
  }));
  const page = await context.newPage();
  await page.goto("http://theme.test/");
  await mount(page, bg, theme);
  return { context, page };
}

async function palettes(page) {
  return page.evaluate(() => {
    const read = (element, withSiteBg) => {
      const style = getComputedStyle(element);
      const palette = {
        readerBg: style.getPropertyValue("--reader-bg").trim(),
        surface: style.getPropertyValue("--surface").trim(),
        text: style.getPropertyValue("--text").trim(),
        line: style.getPropertyValue("--line").trim(),
        accent: style.getPropertyValue("--accent").trim(),
        scheme: style.colorScheme,
      };
      if (withSiteBg) palette.bg = style.getPropertyValue("--bg").trim();
      return palette;
    };
    return {
      reader: read(document.querySelector(".reader"), false),
      site: read(document.documentElement, true),
    };
  });
}

test("unset or invalid reader settings normalize to auto background", () => {
  assert.equal(guest.DEFAULT_SETTINGS.bg, "auto");
  assert.equal(guest.getSettings().bg, "auto");
  assert.equal(guest.normalizeSettings(null).bg, "auto");
  assert.equal(guest.normalizeSettings({}).bg, "auto");
  assert.equal(guest.normalizeSettings({ bg: "neon" }).bg, "auto");
});

test("saved manual backgrounds stay unchanged through normalization", () => {
  for (const bg of ["light", "sepia", "dark", "auto"]) {
    seedSettings({ mode: "horizontal", fit: false, bg, speed: 4 });
    assert.deepEqual(guest.getSettings(), { mode: "horizontal", fit: false, bg, speed: 4 });
  }
  seedSettings({ mode: "horizontal", fit: false, bg: "sepia", speed: 99 });
  assert.deepEqual(guest.getSettings(), { mode: "horizontal", fit: false, bg: "sepia", speed: 3 });
});

test("account settings boundary accepts the auto background", () => {
  assert.equal(validators.DEFAULT_READER_SETTINGS.bg, "auto");
  assert.equal(validators.parseSettingsInput({ mode: "vertical", fit: true, bg: "auto", speed: 3 }).bg, "auto");
});

test("reader in auto follows the site light and dark dataset", async () => {
  for (const theme of ["dark", "light"]) {
    const { context, page } = await openHarness("auto", theme);
    const { reader, site } = await palettes(page);
    assert.equal(reader.readerBg, site.bg, "auto reader background must be the site --bg");
    for (const key of ["surface", "text", "line", "accent"]) {
      assert.equal(reader[key], site[key], `auto reader ${key} must be the site --${key}`);
    }
    assert.equal(reader.scheme, site.scheme, "auto reader color-scheme must follow the site");
    await context.close();
  }
});

test("switching the site theme repaints the auto reader without reload", async () => {
  const { context, page } = await openHarness("auto", "dark");
  const darkSite = (await palettes(page)).site;
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "light";
  });
  const after = await palettes(page);
  assert.equal(after.reader.readerBg, after.site.bg);
  assert.equal(after.reader.surface, after.site.surface);
  assert.notEqual(after.site.bg, darkSite.bg);
  assert.equal(after.reader.scheme, "light");
  await context.close();
});

test("manual dark reader ignores site theme changes and persists after reload", async () => {
  const { context, page } = await openHarness("dark", "light");
  const before = await palettes(page);
  assert.notEqual(before.reader.surface, before.site.surface);
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  const afterSwitch = await palettes(page);
  assert.deepEqual(afterSwitch.reader, before.reader, "manual override must not follow the site theme");

  await page.evaluate((key) => {
    localStorage.setItem(key, JSON.stringify({ mode: "vertical", fit: true, bg: "dark", speed: 3 }));
  }, guest.KEYS.reader);
  await page.reload();
  const stored = await page.evaluate((key) => localStorage.getItem(key), guest.KEYS.reader);
  const restored = guest.normalizeSettings(JSON.parse(stored));
  assert.equal(restored.bg, "dark");
  await mount(page, restored.bg, "light");
  assert.deepEqual((await palettes(page)).reader, before.reader, "manual override must persist after reload");
  await context.close();
});
