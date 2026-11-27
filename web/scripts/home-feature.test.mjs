import assert from "node:assert/strict";
import { test } from "node:test";

const { dailyFeatured } = await import("../lib/home-feature.ts");

const DAY = 86_400_000;
const now = Date.parse("2026-11-27T12:00:00.000Z");

function manga(id, follows, publishAt) {
  return {
    id,
    title: id,
    cover_file: null,
    status: "ongoing",
    year: 2026,
    description: "",
    tags: [],
    tag_ids: [],
    author: "",
    artist: "",
    rating: null,
    follows,
    latest_chapter: "1",
    source: "mangadex",
    chapters: [{ id: `${id}-c`, chapter: "1", lang: "vi", publish_at: new Date(publishAt).toISOString() }],
  };
}

test("dailyFeatured keeps only manga with a chapter in the last 24 hours", () => {
  const items = [
    manga("fresh", 1, now - 2 * 3600_000),
    manga("old", 99, now - 2 * DAY),
  ];
  assert.deepEqual(dailyFeatured(items, now).map((item) => item.id), ["fresh"]);
});

test("dailyFeatured sorts by follows then newest publish time", () => {
  const items = [
    manga("low", 1, now - 3600_000),
    manga("high", 50, now - 7200_000),
    manga("tie-newer", 50, now - 1800_000),
  ];
  assert.deepEqual(dailyFeatured(items, now).map((item) => item.id), ["tie-newer", "high", "low"]);
});

test("dailyFeatured returns an empty list when nothing is fresh", () => {
  assert.deepEqual(dailyFeatured([manga("old", 10, now - 3 * DAY)], now), []);
});