import assert from "node:assert/strict";
import { test } from "node:test";
import { searchQuery } from "../lib/contracts.ts";

test("searchQuery omits defaults so legacy URLs stay unchanged", () => {
  assert.equal(searchQuery({}), "");
  assert.equal(searchQuery({ source: "all", lang: "all" }), "");
});

test("searchQuery serializes source, lang and year", () => {
  const query = searchQuery({ source: "mangadex", lang: "vi", year: 2024 });
  const params = new URLSearchParams(query);
  assert.equal(params.get("source"), "mangadex");
  assert.equal(params.get("lang"), "vi");
  assert.equal(params.get("year"), "2024");
});

test("searchQuery preserves existing serialization", () => {
  assert.equal(
    searchQuery({
      q: "slime",
      tags: ["a", "b"],
      status: "ongoing",
      sort: "rating",
      page: 2,
    }),
    "?q=slime&tags=a%2Cb&status=ongoing&sort=rating&page=2",
  );
});
