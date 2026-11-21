import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";
import { after, before, test } from "node:test";
import { chromium } from "playwright-core";
import { browserExecutable } from "./browser.mjs";
import { startNext, stop, webDir } from "./test-helpers.mjs";

const EDGE = browserExecutable();
const css = readFileSync(join(webDir, "app/globals.css"), "utf8").replace(/^@import[^;]+;\s*/, "");

/// Bundle the real component into a throwaway harness so keyboard, ARIA and
/// form-submission behavior is exercised against Select itself, not a mock.
const harness = `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import Select from "./components/ui/Select.tsx";

function Harness() {
  const [plain, setPlain] = useState("one");
  return React.createElement("div", null,
    React.createElement("button", { id: "outside", type: "button" }, "Outside"),
    React.createElement(Select, {
      id: "plain", value: plain, onChange: setPlain, ariaLabel: "Plain",
      options: [
        { value: "one", label: "One" },
        { value: "two", label: "Two" },
        { value: "three", label: "Three", disabled: true },
        { value: "four", label: "Four" },
      ],
    }),
    React.createElement(Select, {
      id: "named", name: "status", defaultValue: "", ariaLabel: "Status",
      options: [
        { value: "", label: "All" },
        { value: "ongoing", label: "Ongoing" },
        { value: "completed", label: "Completed" },
      ],
    }),
    React.createElement("label", null, "Labelled",
      React.createElement(Select, {
        id: "labelled", defaultValue: "a", ariaLabel: "Labelled",
        options: [{ value: "a", label: "A" }, { value: "b", label: "B" }],
      }),
    ),
    React.createElement(Select, {
      id: "edged", defaultValue: "a", ariaLabel: "Edged",
      options: [
        { value: "x", label: "First disabled", disabled: true },
        { value: "a", label: "Alpha" },
        { value: "z", label: "Last disabled", disabled: true },
      ],
    }),
    React.createElement(Select, {
      id: "disabled", disabled: true, defaultValue: "one", ariaLabel: "Disabled",
      options: [{ value: "one", label: "One" }, { value: "two", label: "Two" }],
    }),
    React.createElement("p", { id: "selected" }, plain),
  );
}
createRoot(document.getElementById("root")).render(React.createElement(Harness));
`;

let bundle;
let browser;

before(async () => {
  assert.ok(existsSync(EDGE), `browser executable missing: ${EDGE}`);
  const result = await build({
    stdin: { contents: harness, resolveDir: webDir, sourcefile: "select-harness.tsx", loader: "tsx" },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    target: "chrome120", logLevel: "silent",
  });
  bundle = result.outputFiles[0].text;
  browser = await chromium.launch({ executablePath: EDGE, headless: true });
});

after(async () => {
  await browser?.close();
});

async function openHarness(options = {}, withCss = false) {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  await page.setContent('<!doctype html><html><body><div id="root"></div></body></html>');
  if (withCss) await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: bundle });
  await page.getByRole("combobox", { name: "Plain" }).waitFor();
  return { context, page };
}

async function activeName(page, trigger) {
  const id = await trigger.getAttribute("aria-activedescendant");
  assert.ok(id, "expected an active option while the listbox is open");
  return (await page.locator(`[id="${id}"]`).textContent()).trim();
}

test("click opens the listbox and Escape closes it", async () => {
  const { context, page } = await openHarness();
  const trigger = page.getByRole("combobox", { name: "Plain" });
  assert.equal(await trigger.getAttribute("aria-expanded"), "false");
  await trigger.click();
  const list = page.getByRole("listbox");
  await list.waitFor({ state: "visible" });
  assert.equal(await trigger.getAttribute("aria-expanded"), "true");
  assert.ok(await trigger.getAttribute("aria-controls"));
  assert.equal(await page.getByRole("option").count(), 4);
  await page.keyboard.press("Escape");
  await list.waitFor({ state: "hidden" });
  assert.equal(await trigger.getAttribute("aria-expanded"), "false");
  await context.close();
});

test("arrow keys skip disabled options and Enter selects the active one", async () => {
  const { context, page } = await openHarness();
  const trigger = page.getByRole("combobox", { name: "Plain" });
  await trigger.click();
  await page.getByRole("listbox").waitFor();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  assert.equal(await page.locator("#selected").textContent(), "two");
  assert.match(await trigger.textContent(), /Two/);
  await page.getByRole("listbox").waitFor({ state: "hidden" });
  await context.close();
});

test("Space opens the listbox and selects the active option", async () => {
  const { context, page } = await openHarness();
  const trigger = page.getByRole("combobox", { name: "Plain" });
  await trigger.focus();
  await page.keyboard.press("Space");
  const list = page.getByRole("listbox");
  await list.waitFor({ state: "visible" });
  assert.equal(await trigger.getAttribute("aria-expanded"), "true");
  assert.equal(await activeName(page, trigger), "One");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Space");
  assert.equal(await page.locator("#selected").textContent(), "two");
  await list.waitFor({ state: "hidden" });
  await context.close();
});

test("Home and End move the active option and Enter commits it", async () => {
  const { context, page } = await openHarness();
  const trigger = page.getByRole("combobox", { name: "Plain" });
  await trigger.click();
  const list = page.getByRole("listbox");
  await list.waitFor({ state: "visible" });
  await page.keyboard.press("End");
  assert.equal(await activeName(page, trigger), "Four");
  await page.keyboard.press("Enter");
  assert.equal(await page.locator("#selected").textContent(), "four");
  await trigger.click();
  await page.keyboard.press("Home");
  assert.equal(await activeName(page, trigger), "One");
  await page.keyboard.press("Enter");
  assert.equal(await page.locator("#selected").textContent(), "one");
  await list.waitFor({ state: "hidden" });
  await context.close();
});

test("Home and End never activate disabled endpoint options", async () => {
  const { context, page } = await openHarness();
  const trigger = page.getByRole("combobox", { name: "Edged" });
  await trigger.click();
  await page.keyboard.press("Home");
  assert.equal(await activeName(page, trigger), "Alpha");
  await page.keyboard.press("End");
  assert.equal(await activeName(page, trigger), "Alpha");
  await page.keyboard.press("Enter");
  assert.match(await trigger.textContent(), /Alpha/);
  await context.close();
});

test("chevron transition is disabled under reduced motion", async () => {
  const reduced = await openHarness({ reducedMotion: "reduce" }, true);
  const chevron = reduced.page.getByRole("combobox", { name: "Plain" }).locator(".select-chevron");
  assert.equal(await chevron.evaluate((element) => getComputedStyle(element).transitionDuration), "0s");
  await reduced.context.close();

  const normal = await openHarness({ reducedMotion: "no-preference" }, true);
  const normalChevron = normal.page.getByRole("combobox", { name: "Plain" }).locator(".select-chevron");
  assert.equal(await normalChevron.evaluate((element) => getComputedStyle(element).transitionDuration), "0.12s");
  await normal.context.close();
});

test("clicking outside closes the listbox", async () => {
  const { context, page } = await openHarness();
  const trigger = page.getByRole("combobox", { name: "Plain" });
  await trigger.click();
  const list = page.getByRole("listbox");
  await list.waitFor({ state: "visible" });
  await page.locator("#outside").click();
  await list.waitFor({ state: "hidden" });
  assert.equal(await trigger.getAttribute("aria-expanded"), "false");
  await context.close();
});

test("selection updates the hidden input when name is present", async () => {
  const { context, page } = await openHarness();
  const trigger = page.getByRole("combobox", { name: "Status" });
  const hidden = page.locator('input[type="hidden"][name="status"]');
  assert.equal(await hidden.inputValue(), "");
  await trigger.click();
  assert.equal(await page.getByRole("option", { name: "Completed" }).getAttribute("aria-selected"), "false");
  await page.getByRole("option", { name: "Completed" }).click();
  assert.equal(await hidden.inputValue(), "completed");
  assert.equal(await page.getByRole("option", { name: "Completed" }).count(), 0);
  assert.match(await trigger.textContent(), /Completed/);
  await context.close();
});

test("choosing from a select wrapped in a label leaves it closed", async () => {
  const { context, page } = await openHarness();
  const trigger = page.getByRole("combobox", { name: "Labelled" });
  await trigger.click();
  await page.getByRole("option", { name: "B", exact: true }).click();
  assert.equal(await trigger.getAttribute("aria-expanded"), "false");
  assert.equal(await page.getByRole("listbox").count(), 0);
  assert.match(await trigger.textContent(), /B/);
  await context.close();
});

test("a disabled select cannot open", async () => {
  const { context, page } = await openHarness();
  const trigger = page.getByRole("combobox", { name: "Disabled" });
  assert.equal(await trigger.isDisabled(), true);
  await trigger.click({ force: true });
  assert.equal(await page.getByRole("listbox").count(), 0);
  await page.keyboard.press("ArrowDown");
  assert.equal(await page.getByRole("listbox").count(), 0);
  await context.close();
});

test("the search GET form submits the selected status and sort values", async (t) => {
  const app = await startNext();
  t.after(() => stop(app.child));
  const context = await browser.newContext();
  t.after(() => context.close());
  const page = await context.newPage();
  await page.goto(`${app.baseUrl}/search?q=Fixture`, { waitUntil: "networkidle" });
  await page.locator(".search-filters summary").click();

  const status = page.getByRole("combobox", { name: "Trạng thái" });
  await status.click();
  await page.getByRole("option", { name: "Hoàn thành" }).click();
  const sort = page.getByRole("combobox", { name: "Sắp xếp" });
  await sort.click();
  await page.getByRole("option", { name: "Điểm đánh giá" }).click();
  assert.equal(await page.locator('input[name="status"]').inputValue(), "completed");
  assert.equal(await page.locator('input[name="sort"]').inputValue(), "rating");

  await page.getByRole("button", { name: "Áp dụng" }).click();
  await page.waitForURL(/status=completed/);
  const url = new URL(page.url());
  assert.equal(url.searchParams.get("q"), "Fixture");
  assert.equal(url.searchParams.get("status"), "completed");
  assert.equal(url.searchParams.get("sort"), "rating");
});
