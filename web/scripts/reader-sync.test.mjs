import assert from "node:assert/strict";
import { test } from "node:test";

// Pure coordinator used by ReaderClient. It owns restoration generations and
// the "ready to write" gate; the browser test covers the visible retry UI.
const { ReaderRestoreCoordinator } = await import("../lib/reader-sync.ts");

test("delayed restore gates the first progress PUT until server page is applied", () => {
  const coordinator = new ReaderRestoreCoordinator();
  const key = "chapter-a|vi|opaque-user";
  const generation = coordinator.begin(key);

  // The GET is still in flight: a PUT must not be allowed, even if page state
  // already exists locally.
  assert.equal(coordinator.isReady(key), false);
  assert.equal(coordinator.resolve(generation + 99, key), null, "stale generation cannot unlock writes");

  // Simulate the delayed GET arriving later with the server page.
  assert.equal(coordinator.resolve(generation, key), key);
  assert.equal(coordinator.isReady(key), true);
  assert.equal(coordinator.isReady("chapter-a|vi|other-user"), false);
});

test("a slow chapter A response is ignored after navigating to chapter B", () => {
  const coordinator = new ReaderRestoreCoordinator();
  const a = "chapter-a|vi|opaque-user";
  const b = "chapter-b|vi|opaque-user";
  const first = coordinator.begin(a);
  assert.equal(coordinator.begin(b), first + 1);

  assert.equal(coordinator.resolve(first, a), null, "chapter A must not unlock chapter B");
  assert.equal(coordinator.isReady(a), false);
  assert.equal(coordinator.resolve(first + 1, b), b);
  assert.equal(coordinator.isReady(b), true);
});

test("failed restore clears the settle key so a retry can write", () => {
  const coordinator = new ReaderRestoreCoordinator();
  const key = "chapter-a|vi|opaque-user";
  const first = coordinator.begin(key);
  assert.equal(coordinator.fail(first, key), true);
  assert.equal(coordinator.isReady(key), false);

  const retry = coordinator.begin(key);
  assert.equal(retry, first + 1);
  assert.equal(coordinator.resolve(first, key), null);
  assert.equal(coordinator.resolve(retry, key), key);
});

test("responses after cleanup cannot revive a disposed reader session", () => {
  const coordinator = new ReaderRestoreCoordinator();
  const key = "chapter-a|vi|opaque-user";
  const generation = coordinator.begin(key);
  coordinator.dispose();
  assert.equal(coordinator.resolve(generation, key), null);
  assert.equal(coordinator.fail(generation, key), false);
  assert.equal(coordinator.isReady(key), false);
});
