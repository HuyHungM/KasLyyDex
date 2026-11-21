import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { titleWithSource } from "../lib/format.ts";
import { webDir } from "./test-helpers.mjs";

const chapter = (overrides = {}) => ({
  id: "ch-1",
  chapter: "1",
  volume: null,
  title: "Fallback 1",
  lang: "vi",
  pages: 2,
  external_url: null,
  publish_at: "2026-11-21T00:00:00Z",
  group: "Group",
  source: "mangadex",
  source_label: "MangaDex",
  readable: true,
  ...overrides,
});

// The suite runs with --conditions=react-server, which resolves React's RSC
// build (no hooks/createContext). Render the real components in a plain child
// process so the assertions exercise shipped JSX, not a hand-written stand-in.
function render(relativePath, props) {
  const specifier = pathToFileURL(join(webDir, relativePath)).href;
  const script = `
    import { createElement } from "react";
    import { renderToStaticMarkup } from "react-dom/server";
    const mod = await import(${JSON.stringify(specifier)});
    const Component = mod.default?.default ?? mod.default ?? mod;
    process.stdout.write(renderToStaticMarkup(createElement(Component, ${JSON.stringify(props)})));
  `;
  return execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
    cwd: webDir,
    encoding: "utf8",
  });
}

function rowTitles(html) {
  return [...html.matchAll(/<span class="ch-title"[^>]*>([\s\S]*?)<\/span>/g)]
    .map((match) => match[1].replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").trim());
}

test("titleWithSource appends the exact source label", () => {
  assert.equal(titleWithSource("Slime", "mangadex"), "Slime (MangaDex)");
  assert.equal(titleWithSource("Slime", "comick"), "Slime (Comick)");
  assert.equal(titleWithSource("Slime"), "Slime (MangaDex)");
});

test("chapter rows show (Comick) only for fallback chapters", () => {
  const fallback = render("components/chapter-list.tsx", {
    mangaId: "m1",
    chapters: { vi: [chapter({ id: "comick:chap-1", source: "comick", source_label: "Comick" })], en: [] },
  });
  assert.deepEqual(rowTitles(fallback), ["Fallback 1 (Comick)"]);

  const readable = render("components/chapter-list.tsx", {
    mangaId: "m1",
    chapters: {
      vi: [chapter({ id: "md-chapter", source: "mangadex", source_label: "MangaDex" })],
      en: [],
    },
  });
  assert.deepEqual(rowTitles(readable), ["Fallback 1"]);
  assert.doesNotMatch(readable, /Comick/);
});

test("reader toolbar back title marks a fallback chapter", () => {
  const props = {
    mangaId: "m1",
    mangaTitle: "Slime",
    chapterId: "comick:chap-1",
    chapters: [chapter({ id: "comick:chap-1", source: "comick", source_label: "Comick" })],
    settings: { mode: "vertical", bg: "light", fit: true, speed: 1 },
    running: false,
    fullscreenSupported: false,
  };
  const html = render("components/reader/ReaderToolbar.tsx", props);
  const backLink = html.match(/<a class="back-link"[^>]*>([\s\S]*?)<\/a>/)?.[1] ?? "";
  assert.equal(backLink, "← Slime (Comick)");
});
