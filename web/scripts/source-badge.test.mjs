import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { coverImageUrl } from "../lib/contracts.ts";
import { webDir } from "./test-helpers.mjs";

const COMICK_COVER = "https://meo.comick.pictures/comic-1-cover.jpg";
const COMICK_PROXY = `/api/content/img?u=${encodeURIComponent(COMICK_COVER)}`;
const BADGE = (label) => `<span class="source-badge" role="img" aria-label="Nguồn: ${label}">${label}</span>`;

// RSC mode cannot render hooks, so render shipped components in a child process
// the same way source-ui.test.mjs does, without a hand-written stand-in.
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

const manga = {
  id: "m1",
  title: "Slime",
  cover_file: COMICK_COVER,
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
const fixture = {
  rank: [manga],
  latest: [{ ...manga, chapters: [{ id: "c1", chapter: "1", lang: "vi", publish_at: "2026-11-20T00:00:00Z" }] }],
  manga,
  chapters: { vi: [], en: [] },
};

// Async Server Components need the same stubbed content boundary as source-ui.
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
    env: { ...process.env, SOURCE_UI_FIXTURE: JSON.stringify(fixture) },
  });
}

test("SourceBadge shows exact labels with an accessible name and hides unknown sources", () => {
  assert.equal(render("components/source-badge.tsx", { source: "mangadex" }, "SourceBadge"), BADGE("MangaDex"));
  assert.equal(render("components/source-badge.tsx", { source: "comick" }, "SourceBadge"), BADGE("Comick"));
  assert.equal(render("components/source-badge.tsx", { source: "" }, "SourceBadge"), "");
  assert.equal(render("components/source-badge.tsx", { source: "unknown" }, "SourceBadge"), "");
  assert.equal(render("components/source-badge.tsx", {}, "SourceBadge"), "");
});

test("card cover keeps the original link and shows a badge instead of a title suffix", () => {
  const html = render("components/manga-card.tsx", { manga, rank: 1 }, "MangaCard");
  assert.match(html, /<a class="card" href="\/manga\/m1">/);
  assert.match(html, new RegExp(`<div class="card-cover">[\\s\\S]*?${BADGE("Comick")}[\\s\\S]*?<\\/div>`));
  assert.match(html, /<h3 class="card-title">Slime<\/h3>/);
  assert.doesNotMatch(html, /\(Comick\)|\(MangaDex\)/);
});

test("home feature, feed and rank covers show badges without title suffixes", () => {
  const html = renderPage("app/page.tsx", {});
  assert.match(html, /<h1 id="featured-title">Slime<\/h1>/);
  assert.match(html, /<h3><a href="\/manga\/m1">Slime<\/a><\/h3>/);
  assert.match(html, /<span class="rank-title">Slime<small>/);
  assert.doesNotMatch(html, /\(Comick\)|\(MangaDex\)/);

  const featureStart = html.indexOf('class="feature-art"');
  const feature = html.slice(featureStart, html.indexOf("</section>", featureStart));
  assert.match(feature, new RegExp(BADGE("Comick")));
  const feedLink = html.match(/<a[^>]*class="feed-cover"[\s\S]*?<\/a>/)?.[0] ?? "";
  assert.match(feedLink, /href="\/manga\/m1"/);
  assert.match(feedLink, new RegExp(BADGE("Comick")));
  const rankCover = html.match(/<span class="rank-cover"><img[\s\S]*?<span class="rank-title">/)?.[0] ?? "";
  assert.match(rankCover, new RegExp(BADGE("Comick")));
  assert.ok(html.includes(COMICK_PROXY));
});

test("ranking and detail covers show badges", () => {
  const rankHtml = renderPage("app/bxh/page.tsx", { searchParams: {} });
  const rankCover = rankHtml.match(/<span class="rank-cover"><img[\s\S]*?<span class="rank-title">/)?.[0] ?? "";
  assert.match(rankCover, new RegExp(BADGE("Comick")));
  assert.match(rankHtml, /<span class="rank-title">(?:<span class="podium-tag"[^>]*>[\s\S]*?<\/span>)?Slime<small>/);
  assert.doesNotMatch(rankHtml, /\(Comick\)|\(MangaDex\)/);

  const detail = renderPage("app/manga/[id]/page.tsx", { params: {} });
  assert.match(detail, new RegExp(`<div class="manga-cover">[\\s\\S]*?${BADGE("Comick")}`));
  assert.match(detail, /<h1 class="manga-title">Slime<\/h1>/);
  assert.doesNotMatch(detail, /\(Comick\)|\(MangaDex\)/);
});

test("Comick covers proxy through Axum while MangaDex stays unchanged", () => {
  assert.equal(coverImageUrl(manga), COMICK_PROXY);
  assert.equal(
    coverImageUrl({ id: "m1", cover_file: "cover.jpg" }),
    `/api/content/img?u=${encodeURIComponent("https://uploads.mangadex.org/covers/m1/cover.jpg.256.jpg")}`,
  );
  assert.equal(coverImageUrl({ ...manga, cover_file: null }), null);
  assert.equal(coverImageUrl({ ...manga, cover_file: "http://meo.comick.pictures/cover.jpg" }), null);
  assert.equal(coverImageUrl({ ...manga, cover_file: "https://evil.test/cover.jpg" }), null);
});
