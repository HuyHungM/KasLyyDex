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
function render(relativePath, props, exportName = "default") {
  const specifier = pathToFileURL(join(webDir, relativePath)).href;
  const script = `
    import { createElement } from "react";
    import { renderToStaticMarkup } from "react-dom/server";
    const mod = await import(${JSON.stringify(specifier)});
    const exported = mod[${JSON.stringify(exportName)}] ?? mod.default ?? mod;
    const Component = exported?.default ?? exported;
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

const sourceManga = {
  id: "m1",
  title: "Slime",
  cover_file: null,
  status: "ongoing",
  year: 2026,
  description: "desc",
  tags: [],
  tag_ids: [],
  author: "A",
  artist: "A",
  rating: 8.5,
  follows: 12,
  latest_chapter: "1",
  source: "comick",
  source_label: "Comick",
};
const sourceFixture = {
  rank: [sourceManga],
  latest: [{
    ...sourceManga,
    chapters: [{ id: "c1", chapter: "1", lang: "vi", publish_at: "2026-11-20T00:00:00Z" }],
  }],
  manga: sourceManga,
  chapters: {
    vi: [chapter({ id: "comick:chap-1", source: "comick", source_label: "Comick" })],
    en: [],
  },
};

// Async Server Components need a stubbed content boundary: `serverContent()`
// calls Next's request-scoped `connection()` and imports `server-only`, neither
// of which exists in a standalone render. A data-URL loader redirects only that
// one module to a fixture client; every other import is the shipped code.
function renderPage(relativePath, props) {
  const target = pathToFileURL(join(webDir, relativePath)).href;
  const contentServer = pathToFileURL(join(webDir, "lib/content-server.tsx")).href;
  const stubSource = 'const d=JSON.parse(process.env.SOURCE_UI_FIXTURE||"{}");'
    + 'export async function serverContent(){return {'
    + 'rank:async()=>d.rank??[],latest:async()=>d.latest??[],'
    + 'manga:async()=>d.manga??{},chapters:async()=>d.chapters??{vi:[],en:[]}}};'
    + 'export function contentUnavailable(){return null}';
  const stub = `data:text/javascript,${encodeURIComponent(stubSource)}`;
  const loaderSource = `const m={${JSON.stringify(contentServer)}:${JSON.stringify(stub)}};`
    + "export async function resolve(s,c,n){if(m[s])return{url:m[s],shortCircuit:true};return n(s,c)}";
  const loader = `data:text/javascript,${encodeURIComponent(loaderSource)}`;
  const script = `
    import { register, createRequire } from "node:module";
    import { createElement } from "react";
    const require = createRequire(${JSON.stringify(pathToFileURL(join(webDir, "package.json")).href)});
    const { renderToPipeableStream } = require(${JSON.stringify(join(webDir, "node_modules", "react-dom", "cjs", "react-dom-server.node.development.js"))});
    register(${JSON.stringify(loader)}, import.meta.url);
    const mod = await import(${JSON.stringify(target)});
    const Component = mod.default?.default ?? mod.default ?? mod;
    const chunks = [];
    await new Promise((resolve, reject) => {
      const stream = renderToPipeableStream(createElement(Component, ${JSON.stringify(props)}), {
        onAllReady() {}, onError: reject,
      });
      stream.pipe({
        write(chunk) { chunks.push(Buffer.from(chunk)); return true; },
        end: resolve,
        on() {}, off() {}, once() {}, emit() {}, writableEnded: false,
      });
    });
    process.stdout.write(Buffer.concat(chunks).toString("utf8"));
  `;
  return execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
    cwd: webDir,
    encoding: "utf8",
    env: { ...process.env, SOURCE_UI_FIXTURE: JSON.stringify(sourceFixture) },
  });
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

test("manga card title shows the source label", () => {
  const html = render("components/manga-card.tsx", { manga: sourceManga, rank: 1 }, "MangaCard");
  assert.match(html, /<h3 class="card-title">Slime \(Comick\)<\/h3>/);
  assert.match(html, /href="\/manga\/m1"/);
});

test("home feature, feed and rank titles show the source label", () => {
  const html = renderPage("app/page.tsx", {});
  assert.match(html, /<h1 id="featured-title">Slime \(Comick\)<\/h1>/);
  assert.match(html, /<h3><a href="\/manga\/m1">Slime \(Comick\)<\/a><\/h3>/);
  assert.match(html, /<span class="rank-title">Slime \(Comick\)<small>12 theo dõi<\/small><\/span>/);
});

test("manga detail title shows the source label", () => {
  const html = renderPage("app/manga/[id]/page.tsx", { params: {} });
  assert.match(html, /<h1 class="manga-title">Slime \(Comick\)<\/h1>/);
});

test("ranking page titles show the source label", () => {
  const html = renderPage("app/bxh/page.tsx", { searchParams: {} });
  assert.match(html, /<span class="rank-title">Slime \(Comick\)<small>12 theo dõi<\/small><\/span>/);
});
