import assert from "node:assert/strict";
import { test } from "node:test";
import { sourceLabel } from "../lib/contracts.ts";

test("sourceLabel maps known sources and falls back to MangaDex", () => {
  assert.equal(sourceLabel(), "MangaDex");
  assert.equal(sourceLabel("comick"), "Comick");
  assert.equal(sourceLabel("unknown"), "MangaDex");
});

test("legacy ChapterDto without source fields stays usable", () => {
  const legacyChapter = {
    id: "chapter-id",
    chapter: "1",
    volume: null,
    title: "Title",
    lang: "vi",
    pages: 12,
    external_url: null,
    publish_at: "2026-11-20T00:00:00Z",
    group: "Group",
  };
  assert.equal(sourceLabel(legacyChapter.source), "MangaDex");
});
