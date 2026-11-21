import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { scanText } from "./whitespace-check.mjs";

const webDir = fileURLToPath(new URL("..", import.meta.url));
const script = fileURLToPath(new URL("./whitespace-check.mjs", import.meta.url));

test("scanText detects trailing whitespace and conflict markers", () => {
  assert.deepEqual(scanText("clean line\nsecond line\n"), []);
  assert.deepEqual(scanText("bad line \n"), [
    { file: "<text>", line: 1, rule: "trailing-whitespace" },
  ]);
  assert.deepEqual(scanText("<<<<<<< HEAD\n"), [
    { file: "<text>", line: 1, rule: "conflict-marker" },
  ]);
});

test("tracked-file whitespace gate RED on seeded file, GREEN after cleanup", () => {
  const fixture = join(webDir, ".test-cache", `whitespace-${process.pid}`);
  mkdirSync(fixture, { recursive: true });
  try {
    execFileSync("git", ["init", "-q"], { cwd: fixture });
    writeFileSync(join(fixture, "trailing.txt"), "seeded line \n");
    execFileSync("git", ["add", "trailing.txt"], { cwd: fixture });

    const red = spawnSync(process.execPath, [script, fixture], { encoding: "utf8" });
    assert.equal(red.status, 1, red.stderr);
    assert.match(red.stderr, /trailing\.txt:1: trailing-whitespace/);

    writeFileSync(join(fixture, "trailing.txt"), "clean line\n");
    execFileSync("git", ["add", "trailing.txt"], { cwd: fixture });
    const green = spawnSync(process.execPath, [script, fixture], { encoding: "utf8" });
    assert.equal(green.status, 0, green.stderr);
    assert.match(green.stdout, /0 findings/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
