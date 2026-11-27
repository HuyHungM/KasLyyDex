import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { coverImageUrl } from "../lib/contracts.ts";
import { webDir } from "./test-helpers.mjs";

const BADGE = '<span class="source-badge" role="img" aria-label="Nguồn: MangaDex">MangaDex</span>';

// RSC mode cannot render hooks, so render shipped components in a child process.
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
  cover_file: "cover.jpg",
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
  source: "mangadex",
  source_label: "MangaDex",
};
const fixture = {
  rank: [manga],
  latest: [{ ...manga, chapters: [{ id: "c1", chapter: "1", lang: "vi", publish_at: new Date(Date.now() - 3600_000).toISOString() }] }],
  manga,
  chapters: { vi: [], en: [] },
};

// Async Server Components need a stubbed content boundary.
function renderPage(relativePath, props, data = fixture) {
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
    env: { ...process.env, SOURCE_UI_FIXTURE: JSON.stringify(data) },
  });
}

const heroSearch = /<form class="search-form" role="search" action="\/search" method="get">[\s\S]*?aria-label="Tìm truyện"[\s\S]*?<\/form>/;

test("SourceBadge shows the exact MangaDex label and hides unknown sources", () => {
  assert.equal(render("components/source-badge.tsx", { source: "mangadex" }, "SourceBadge"), BADGE);
  assert.equal(render("components/source-badge.tsx", { source: "" }, "SourceBadge"), "");
  assert.equal(render("components/source-badge.tsx", { source: "unknown" }, "SourceBadge"), "");
  assert.equal(render("components/source-badge.tsx", {}, "SourceBadge"), "");
});

test("card cover keeps the original link and shows a badge instead of a title suffix", () => {
  const html = render("components/manga-card.tsx", { manga, rank: 1 }, "MangaCard");
  assert.match(html, /<a class="card" href="\/manga\/m1">/);
  assert.match(html, new RegExp(`<div class="card-cover">[\\s\\S]*?${BADGE}[\\s\\S]*?<\\/div>`));
  assert.match(html, /<h3 class="card-title">Slime<\/h3>/);
  assert.doesNotMatch(html, /\(MangaDex\)/);
});

test("home feature, feed and rank covers show badges without title suffixes", () => {
  const html = renderPage("app/page.tsx", {});
  assert.match(html, /<h1 id="featured-title">Slime<\/h1>/);
  assert.match(html, /<h3><a href="\/manga\/m1">Slime<\/a><\/h3>/);
  assert.match(html, /<span class="rank-title">Slime<small>/);
  assert.doesNotMatch(html, /\(MangaDex\)/);

  const featureStart = html.indexOf('class="feature-art feature-animate"');
  const feature = html.slice(featureStart, html.indexOf("</section>", featureStart));
  assert.ok(feature.includes(BADGE));
  const feedLink = html.match(/<a[^>]*class="feed-cover"[\s\S]*?<\/a>/)?.[0] ?? "";
  assert.match(feedLink, /href="\/manga\/m1"/);
  assert.ok(feedLink.includes(BADGE));
  const rankCover = html.match(/<span class="rank-cover"><img[\s\S]*?<span class="rank-title">/)?.[0] ?? "";
  assert.ok(rankCover.includes(BADGE));
  assert.ok(html.includes(`/api/content/img?u=${encodeURIComponent("https://uploads.mangadex.org/covers/m1/cover.jpg.256.jpg")}&amp;v=2`));
});

test("home hero rotates top picks and ranking has day/month tabs, without hero search", () => {
  const featured = renderPage("app/page.tsx", {});
  assert.doesNotMatch(featured, heroSearch);
  assert.match(featured, /class="feature feature-slider"/);
  assert.match(featured, /Top 10 ngày/);
  assert.match(featured, /aria-label="Top 10 ngày · 1\/1"/);
  assert.match(featured, /class="rank-switch"/);
  assert.match(featured, /Top ngày/);
  assert.match(featured, /Top tháng/);

  const fallback = renderPage("app/page.tsx", {}, { ...fixture, rank: [], latest: [] });
  assert.match(fallback, /<h1>Khám phá truyện<\/h1>/);
  assert.doesNotMatch(fallback, heroSearch);
});

test("ranking and detail covers show badges", () => {
  const rankHtml = renderPage("app/bxh/page.tsx", { searchParams: {} });
  const rankCover = rankHtml.match(/<span class="rank-cover"><img[\s\S]*?<span class="rank-title">/)?.[0] ?? "";
  assert.ok(rankCover.includes(BADGE));
  assert.match(rankHtml, /<span class="rank-title">(?:<span class="podium-tag"[^>]*>[\s\S]*?<\/span>)?Slime<small>/);
  assert.doesNotMatch(rankHtml, /\(MangaDex\)/);

  const detail = renderPage("app/manga/[id]/page.tsx", { params: {} });
  assert.match(detail, new RegExp(`<div class="manga-cover">[\\s\\S]*?${BADGE}`));
  assert.match(detail, /<h1 class="manga-title">Slime<\/h1>/);
  assert.doesNotMatch(detail, /\(MangaDex\)/);
});

test("MangaDex covers proxy through Axum and empty covers render no image", () => {
  const upstream = `https://uploads.mangadex.org/covers/m1/cover.jpg.256.jpg`;
  assert.equal(coverImageUrl(manga), `/api/content/img?u=${encodeURIComponent(upstream)}&v=2`);
  assert.equal(coverImageUrl({ ...manga, cover_file: null }), null);
});
