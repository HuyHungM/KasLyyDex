import assert from "node:assert/strict";
import { test } from "node:test";

// Pure controller behind useRemoteResource: generation/abort correctness is
// deterministic here; the browser tests cover the React wiring.
const { RemoteResourceController } = await import("../lib/account/resource.ts");

test("remote resource state is cleared on key change and stale responses are ignored", () => {
  const controller = new RemoteResourceController();
  const first = controller.begin("user-a|/api/v1/me/library");
  assert.deepEqual(first.snapshot, { data: null, loading: true, error: null, key: "user-a|/api/v1/me/library" });
  const second = controller.begin("user-a|/api/v1/me/library");

  // A late response from the previous request must not write state.
  assert.equal(controller.resolve(first.generation, ["old"]), null);
  assert.deepEqual(controller.snapshot, { data: null, loading: true, error: null, key: "user-a|/api/v1/me/library" });

  const current = controller.resolve(second.generation, ["fresh"]);
  assert.deepEqual(current, { data: ["fresh"], loading: false, error: null, key: "user-a|/api/v1/me/library" });

  const switched = controller.begin("user-b|/api/v1/me/library");
  assert.equal(switched.generation, second.generation + 1);
  assert.deepEqual(controller.snapshot, { data: null, loading: true, error: null, key: "user-b|/api/v1/me/library" });
  assert.equal(controller.resolve(second.generation, ["user-a-again"]), null);
  assert.deepEqual(controller.resolve(switched.generation, ["user-b"]), {
    data: ["user-b"], loading: false, error: null, key: "user-b|/api/v1/me/library",
  });
});

test("post-cleanup responses cannot revive a disposed resource", () => {
  const controller = new RemoteResourceController();
  const started = controller.begin("user-a|/api/v1/me/progress");
  controller.resolve(started.generation, ["visible"]);
  controller.dispose();
  assert.equal(controller.resolve(started.generation, ["late"]), null);
  assert.equal(controller.reject(started.generation, "late failure"), null);
  assert.deepEqual(controller.snapshot.data, ["visible"]);
});

test("failure clears data and exposes an actionable error", () => {
  const controller = new RemoteResourceController();
  const started = controller.begin("user-a|/api/v1/me/settings");
  assert.deepEqual(controller.reject(started.generation, "mất kết nối"), {
    data: null, loading: false, error: "mất kết nối", key: "user-a|/api/v1/me/settings",
  });
});
