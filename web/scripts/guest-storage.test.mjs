import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

const guest = await import("../lib/guest.ts");
const format = await import("../lib/format.ts");

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

function seed(key, value) {
  globalThis.localStorage = new MemoryStorage({ [key]: JSON.stringify(value) });
}

beforeEach(() => {
  globalThis.localStorage = new MemoryStorage();
});

test("chapter labels use Vietnamese wording everywhere", () => {
  assert.equal(format.chapterLabel("3"), "Chương 3");
  assert.equal(format.chapterLabel(null), "Truyện ngắn");
  assert.equal(format.chapterName("12.5"), "Chương 12.5");
});

test("legacy camelCase and Leptos snake_case history normalize to one shape", () => {
  seed(guest.KEYS.history, [
    { mangaId: "m1", mangaTitle: "Old Next", chapterId: "c1", chapter: "1", title: "A", coverFile: "a.jpg", lang: "vi", ts: 10 },
    { manga_id: "m2", manga_title: "Leptos", chapter_id: "c2", chapter: "2", title: "B", cover_file: "b.jpg", lang: "en", ts: 20, page: 4, total: 12 },
  ]);
  const list = guest.getHistory();
  assert.deepEqual(list.map((entry) => entry.mangaId), ["m2", "m1"]);
  assert.equal(list[0].page, 4);
  assert.equal(list[0].total, 12);
  assert.equal(list[0].coverFile, "b.jpg");
  assert.equal(list[1].ts, 10);
});

test("corrupt and unavailable storage stay non-fatal and keep guest data", () => {
  globalThis.localStorage = { getItem: () => "{bad json", setItem: () => { throw new Error("quota"); } };
  assert.deepEqual(guest.getHistory(), []);
  assert.deepEqual(guest.getLibrary(), []);
  assert.deepEqual(guest.getSettings(), guest.DEFAULT_SETTINGS);
  assert.equal(guest.getTheme(), "light");
  assert.doesNotThrow(() => guest.pushHistory({ mangaId: "m", mangaTitle: "T", chapterId: "c", chapter: null, title: "", coverFile: null, lang: "vi" }));
});

test("theme round-trips light, dark and black", () => {
  globalThis.localStorage = new MemoryStorage();
  for (const mode of ["light", "dark", "black"]) {
    guest.saveTheme(mode);
    assert.equal(guest.getTheme(), mode);
  }
});

test("page restoration is chapter-local and clamped to the current page count", () => {
  seed(guest.KEYS.history, [{
    mangaId: "m", chapterId: "saved-chapter", page: 7, total: 20, ts: 1,
  }]);
  const history = guest.getHistoryFor("m");
  assert.equal(guest.restoredPage(history, "saved-chapter", 20), 6);
  assert.equal(guest.restoredPage(history, "other-chapter", 20), 0);
  assert.equal(guest.restoredPage(history, "saved-chapter", 3), 0);
  assert.equal(guest.restoredPage(null, "saved-chapter", 20), 0);

  guest.saveProgress("saved-chapter", 3, 20);
  assert.equal(guest.restoredPage(guest.getHistoryFor("m"), "saved-chapter", 20), 2);
});

test("library and reader settings accept both wire formats and invalid values", () => {
  seed(guest.KEYS.library, [
    { mangaId: "m1", title: "Next", coverFile: null, lang: "vi" },
    { manga_id: "m2", title: "Leptos", cover_file: "c.jpg", lang: "en", followed_at: 5, last_chapter_id: "ch", last_read_publish: 9 },
  ]);
  assert.equal(guest.getLibrary()[1].lastChapterId, "ch");
  assert.equal(guest.getLibrary()[0].followedAt > 0, true);
  assert.equal(guest.toggleLibrary({ mangaId: "m1", title: "Next", coverFile: null, lang: "vi" }), false);
  assert.equal(guest.getLibrary().length, 1);

  seed(guest.KEYS.reader, { mode: "horizontal", fit: false, bg: "sepia", speed: 99 });
  assert.deepEqual(guest.getSettings(), { mode: "horizontal", fit: false, bg: "sepia", speed: 3 });
  seed(guest.KEYS.reader, { mode: "diagonal", bg: "neon", speed: -2 });
  assert.deepEqual(guest.getSettings(), guest.DEFAULT_SETTINGS);
});
